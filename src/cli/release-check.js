import { buildReleaseArtifactManifest } from "./release-artifacts.js";
import { loadReleaseCheckContext } from "./release-check-context.js";
import { getChecksPart1 } from "./release-check-part1.js";
import { getChecksPart2 } from "./release-check-part2.js";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const context = await loadReleaseCheckContext();
const { packageJson, releaseDocTexts } = context;

const checks = [
  ...getChecksPart1(context),
  ...getChecksPart2(context)
];
const cliDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(cliDirectory, "../..");
let currentSizeCheck = null;
try {
  currentSizeCheck = JSON.parse(execFileSync(process.execPath, [path.join(cliDirectory, "size-check.js")], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }));
} catch (error) {
  try {
    currentSizeCheck = JSON.parse(String(error.stdout || ""));
  } catch {
    currentSizeCheck = { ok: false, failures: ["size-check did not return JSON output"] };
  }
}
checks.push({
  name: "current_size_budget",
  ok: currentSizeCheck?.ok === true,
  expected: { command: "npm run size-check" },
  actual: currentSizeCheck
});
const desktopArtifacts = (await buildReleaseArtifactManifest()).artifacts;
const githubReleaseArtifactPaths = new Set([
  "release/windows/schema-docs_0.1.0_x64_en-US.msi",
  "release/windows/schema-docs_0.1.0_x64-setup.exe",
  "release/windows/schema-docs_0.1.0_x64-portable.zip"
]);
const githubReleaseArtifacts = desktopArtifacts.filter((artifact) => githubReleaseArtifactPaths.has(artifact.path));
const existingGithubReleaseArtifactCount = githubReleaseArtifacts.reduce(
  (count, artifact) => count + Number(artifact.exists === true),
  0
);
const windowsReleaseChecksumPath = "release/windows/SHA256SUMS.txt";

function findDocumentedNpmScripts(docs) {
  const commands = new Set();
  for (const text of Object.values(docs)) {
    for (const match of String(text).matchAll(/\bnpm run ([A-Za-z0-9:_-]+)/g)) {
      commands.add(match[1]);
    }
  }
  return [...commands].sort();
}

function missingPackageScripts(scriptNames) {
  return scriptNames.filter((script) => !packageJson.scripts?.[script]);
}

function scriptExistenceCheck(name, source, scripts) {
  const missingScripts = missingPackageScripts(scripts);
  return {
    name,
    ok: missingScripts.length === 0,
    expected: { source },
    actual: {
      documentedScriptCount: scripts.length,
      missingScripts
    }
  };
}

function formatBytesForReleaseDraft(bytes) {
  return Number(bytes).toLocaleString("en-US");
}

function releaseDraftIncludesArtifact(draft, artifact) {
  const name = artifact.path.split(/[\\/]/).pop();
  return Boolean(
    artifact.exists
    && draft.includes(`\`${name}\``)
    && draft.includes(`${formatBytesForReleaseDraft(artifact.bytes)} bytes`)
    && draft.includes(`\`${artifact.sha256}\``)
  );
}

async function auditWindowsReleaseChecksums() {
  let checksumText = "";
  let readError = null;
  try {
    checksumText = await readFile(path.join(projectRoot, windowsReleaseChecksumPath), "utf8");
  } catch (error) {
    readError = error instanceof Error ? error.message : String(error);
  }

  const lines = checksumText.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }

  const entries = [];
  const malformedLines = [];
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^([a-f0-9]{64}) {2}([^\s/\\]+)$/);
    if (!match) {
      malformedLines.push({ line: index + 1, value: line });
      continue;
    }
    entries.push({ line: index + 1, sha256: match[1], basename: match[2] });
  }

  const entriesByBasename = new Map();
  for (const entry of entries) {
    const matches = entriesByBasename.get(entry.basename) ?? [];
    matches.push(entry);
    entriesByBasename.set(entry.basename, matches);
  }

  const requiredEntries = githubReleaseArtifacts.map((artifact) => {
    const basename = path.basename(artifact.path);
    const matchingEntries = entriesByBasename.get(basename) ?? [];
    return {
      basename,
      artifactPath: artifact.path,
      artifactExists: artifact.exists === true,
      expectedSha256: artifact.sha256 ?? null,
      checksumEntryCount: matchingEntries.length,
      documentedSha256: matchingEntries.map((entry) => entry.sha256),
      matches: Boolean(
        artifact.exists === true
        && matchingEntries.length === 1
        && matchingEntries[0].sha256 === artifact.sha256
      )
    };
  });
  const duplicateBasenames = [...entriesByBasename.entries()]
    .filter(([, matchingEntries]) => matchingEntries.length > 1)
    .map(([basename]) => basename)
    .sort();
  const releaseAssetsComplete = (
    githubReleaseArtifacts.length === githubReleaseArtifactPaths.size
    && existingGithubReleaseArtifactCount === githubReleaseArtifactPaths.size
  );
  const sourceCheckoutWithoutReleaseAssets = (
    githubReleaseArtifacts.length === githubReleaseArtifactPaths.size
    && existingGithubReleaseArtifactCount === 0
  );
  const checksumEntriesCurrent = (
    readError === null
    && malformedLines.length === 0
    && duplicateBasenames.length === 0
    && requiredEntries.every((entry) => entry.matches)
  );

  return {
    ok: sourceCheckoutWithoutReleaseAssets || (releaseAssetsComplete && checksumEntriesCurrent),
    actual: {
      checksumFile: windowsReleaseChecksumPath,
      mode: sourceCheckoutWithoutReleaseAssets
        ? "source-checkout-without-release-assets"
        : "release-assets-present",
      requiredArtifactCount: githubReleaseArtifactPaths.size,
      presentArtifactCount: existingGithubReleaseArtifactCount,
      missingArtifactPaths: githubReleaseArtifacts
        .filter((artifact) => artifact.exists !== true)
        .map((artifact) => artifact.path),
      readError,
      entries,
      malformedLines,
      duplicateBasenames,
      requiredEntries
    }
  };
}

checks.push({
  name: "github_release_draft_artifacts_current",
  ok: Boolean(
    githubReleaseArtifacts.length === githubReleaseArtifactPaths.size
      && (
        existingGithubReleaseArtifactCount === 0
        || (
          existingGithubReleaseArtifactCount === githubReleaseArtifactPaths.size
          && githubReleaseArtifacts.every((artifact) => releaseDraftIncludesArtifact(
            releaseDocTexts["docs/github-release-draft-v0.1.0.md"] ?? "",
            artifact
          ))
        )
      )
  ),
  expected: {
    docs: ["docs/github-release-draft-v0.1.0.md"],
    verifies: [
      "source checkout may contain zero release assets",
      "a partial release asset set fails",
      "complete artifact name, byte count, and SHA-256 match"
    ]
  },
  actual: githubReleaseArtifacts.map((artifact) => ({
    path: artifact.path,
    exists: artifact.exists,
    bytes: artifact.bytes,
    sha256: artifact.sha256
  }))
});

const windowsReleaseChecksumAudit = await auditWindowsReleaseChecksums();
checks.push({
  name: "windows_release_checksums_current",
  ok: windowsReleaseChecksumAudit.ok,
  expected: {
    file: windowsReleaseChecksumPath,
    requiredAssets: [...githubReleaseArtifactPaths].map((artifactPath) => path.basename(artifactPath)),
    format: "<64 lowercase hexadecimal SHA-256>  <artifact basename>",
    policy: [
      "zero present release assets is valid for a clean source checkout",
      "if any release asset exists, all three release assets must exist",
      "each required basename must have exactly one matching checksum entry",
      "malformed lines, duplicate basenames, and mismatched hashes fail"
    ]
  },
  actual: windowsReleaseChecksumAudit.actual
});

const manualGate = [
  "npm test",
  "npm run smoke",
  "npm run fixture-smoke",
  "npm run size-check",
  "npm run large-intake-check",
  "npm run language-boundary-check",
  "npm run ui-check",
  "npm run web-ui-smoke",
  "npm run release-check",
  "npm run release-readiness",
  "npm run release-artifacts",
  "npm run release-index",
  "npm run public-preview-package -- --json",
  "npm run rc-check -- --mode public-preview",
  "npm run desktop-verification-check",
  "npm run desktop-verification-record",
  "npm run desktop-verification-fill -- --record <partial-record.json> --diagnostics-pass --first-workflow-pass --workspace-picker-pass --file-picker-pass --result-pass --tester <name> --windows-version <windows-version> --node-version <node-version> --webview2-present yes --out <filled-record.json>",
  "npm run desktop-release-preflight",
  "npm run desktop-preflight-check -- <preflight-dir>",
  "npm run desktop-fixture-close -- --record <filled-record.json> --write",
  "npm run desktop-runtime-check",
  "npm run desktop:app-smoke -- --check-only",
  "npm run desktop:workflow-smoke -- --check-only",
  "npm run desktop:ai-summon-smoke",
  "npm run desktop:bridge-smoke",
  "npm run fixture-check -- --strict",
  "npm run desktop:dev",
  "npm run desktop:build",
  "Windows app starts without development tooling",
  "Packaged Desktop UI diagnostics reports Node/runtime/API status",
  "Packaged Desktop UI first workflow check completes from the visible UI",
  "Packaged Desktop UI native workspace picker fills and opens the workspace path",
  "Packaged Desktop UI native file picker fills the import path field",
  "At least 20 real DOCX/PDF/XLSX/CSV sample workflows reviewed",
  "Known limits visible in README and supported formats docs",
  "API key is not persisted"
];

const requiredManualGateCommands = [
  "npm run release-check",
  "npm run release-index",
  "npm run public-preview-package -- --json",
  "npm run rc-check -- --mode public-preview",
  "npm run desktop-release-preflight",
  "npm run desktop-preflight-check -- <preflight-dir>"
];

checks.push({
  name: "manual_gate_release_commands_current",
  ok: requiredManualGateCommands.every((command) => manualGate.includes(command)),
  expected: {
    commands: requiredManualGateCommands
  }
});

const documentedNpmScripts = findDocumentedNpmScripts(releaseDocTexts);
const manualGateNpmScripts = findDocumentedNpmScripts({ manualGate: manualGate.join("\n") });
checks.push(
  scriptExistenceCheck("release_docs_npm_scripts_exist", "release docs npm run commands must exist in package.json scripts", documentedNpmScripts),
  scriptExistenceCheck("manual_gate_npm_scripts_exist", "manual gate npm run commands must exist in package.json scripts", manualGateNpmScripts)
);

const result = {
  version: packageJson.version,
  releaseTarget: "v0.1.0",
  automaticChecksPassed: checks.every((check) => check.ok),
  checks,
  manualGate,
  desktopArtifacts
};

console.log(JSON.stringify(result, null, 2));

if (!result.automaticChecksPassed) {
  process.exitCode = 1;
}
