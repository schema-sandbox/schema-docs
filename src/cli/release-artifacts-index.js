import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { buildReleaseArtifactManifest } from "./release-artifacts.js";
import { buildReleaseReadiness } from "./release-readiness.js";

const root = path.resolve(import.meta.dirname, "../..");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function resolveFromRoot(value) {
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}

function relativeFromRoot(value) {
  return path.relative(root, resolveFromRoot(value)).split(path.sep).join("/");
}

async function writeTextFile(filePath, content) {
  const resolvedPath = resolveFromRoot(filePath);
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, content, "utf8");
}

function quoteCommandArg(value) {
  return `"${String(value).replaceAll("\"", "\\\"")}"`;
}

function artifactAudience(artifactPath) {
  if (artifactPath.endsWith(".msi")) {
    return "Enterprise / managed Windows install";
  }
  if (artifactPath.endsWith("-setup.exe")) {
    return "Public preview tester";
  }
  if (artifactPath.endsWith("-portable.zip")) {
    return "Portable Windows package / no-install tester";
  }
  return "Developer / smoke verification";
}

function artifactInstallNote(artifactPath) {
  if (artifactPath.endsWith(".msi")) {
    return "Use for managed installation tests and enterprise deployment review.";
  }
  if (artifactPath.endsWith("-setup.exe")) {
    return "Use for ordinary public preview installer testing.";
  }
  if (artifactPath.endsWith("-portable.zip")) {
    return "Extract the complete portable Windows package before launch; keep app.exe beside its runtime directory.";
  }
  return "Use for direct packaged-app launch and smoke verification.";
}

function buildArtifactRows(artifacts) {
  return artifacts.map((artifact) => ({
    name: path.basename(artifact.path),
    path: artifact.path,
    exists: artifact.exists === true,
    bytes: artifact.bytes ?? 0,
    sha256: artifact.sha256 ?? "",
    recommendedAudience: artifactAudience(artifact.path),
    installNote: artifactInstallNote(artifact.path),
    verificationCommand: `certutil -hashfile ${quoteCommandArg(artifact.path)} SHA256`
  }));
}

function buildCommands({ mode, preflightDir }) {
  const commands = [
    "npm run release-check",
    "npm run large-intake-check",
    "npm run language-boundary-check",
    "npm run doctor",
    "npm run fixture-check -- --strict",
    `npm run release-readiness -- --mode ${mode}`,
    "npm run release-artifacts",
    "npm run release-index",
    "npm run public-preview-package -- --json"
  ];

  if (preflightDir) {
    commands.push(`npm run desktop-preflight-check -- ${quoteCommandArg(preflightDir)}`);
  } else {
    commands.push("npm run desktop-release-preflight -- --out-dir <dir> --include-gui-smoke");
    commands.push("npm run desktop-preflight-check -- <dir>");
  }

  commands.push("npm run desktop-verification-fill -- --record <partial-record.json> --diagnostics-pass --first-workflow-pass --workspace-picker-pass --file-picker-pass --result-pass --tester <name> --windows-version <windows-version> --node-version <node-version> --webview2-present yes --out <filled-record.json>");
  commands.push("npm run desktop-verification-check -- --strict <filled-record.json>");
  commands.push("npm run desktop-fixture-close -- --record <filled-record.json> --write");
  return commands;
}

function renderMarkdown(index) {
  const artifactRows = index.artifacts.map((artifact) => (
    `| ${artifact.name} | ${artifact.exists ? "yes" : "no"} | \`${artifact.path}\` | ${artifact.bytes} | \`${artifact.sha256 || "missing"}\` | ${artifact.recommendedAudience} |`
  ));
  const commandRows = index.commands.map((command) => `- \`${command}\``);
  const nextActionRows = index.releaseReadiness.nextActions.length
    ? index.releaseReadiness.nextActions.map((action) => `- ${action}`)
    : ["- None"];
  const blockerRows = index.releaseReadiness.blockingItems.length
    ? index.releaseReadiness.blockingItems.map((item) => `- ${item.id}: ${item.status}${item.reason ? ` (${item.reason})` : ""}`)
    : ["- None"];

  return `# Release Artifact Index

Generated At: ${index.generatedAt}
Target Version: ${index.targetVersion}
Release Mode: ${index.releaseMode}
Readiness: ${index.releaseReadiness.status}
Ready For Public Tag: ${index.releaseReadiness.readyForPublicTag ? "yes" : "no"}

## Desktop Artifacts

| Name | Exists | Path | Size (Bytes) | SHA-256 Hash | Target Audience |
|------|--------|------|--------------|--------------|-----------------|
${artifactRows.join("\n")}

## Verification Commands

${commandRows.join("\n")}

## Remaining Blockers

${blockerRows.join("\n")}

## Next Actions

${nextActionRows.join("\n")}

## Tester Notes

- **Recommended Installer**: Use the NSIS setup executable (\`schema-docs_0.1.1_x64-setup.exe\`) for ordinary public preview installation testing.
- **MSI vs NSIS Difference**: The NSIS installer (\`.exe\`) is designed for quick, user-scoped or machine-scoped desktop setup. The MSI package (\`.msi\`) is intended for enterprise managed installation via GPO or SCCM deployment.
- **First Action After Install**: Run the installed Schema Docs application. Create a temporary workspace or choose an existing local directory using the native folder picker.
- **Verify /api/health**: Navigate to \`http://127.0.0.1:4177/api/health\` in your local browser or query client to verify that the offline JS API server is running and healthy.
- **Run First Workflow**: In the Desktop UI side-bar, click the **Run first workflow** button to generate a synthetic sample Word document, import it, and verify the extraction read-back loop.
- **Feedback Evidence Collection**: Run \`npm run doctor\` or click the **Desktop diagnostics** button in the app's settings section to collect system health data and locate session logs.
`;
}

export async function buildReleaseArtifactIndex(options = {}) {
  const mode = options.mode ?? argValue("--mode", "public-preview");
  const preflightDir = options.preflightDir ?? argValue("--preflight-dir");
  const artifactManifest = await buildReleaseArtifactManifest();
  const releaseReadiness = await buildReleaseReadiness({ mode });

  return {
    targetVersion: "v0.1.1",
    generatedBy: "npm run release-index",
    generatedAt: new Date().toISOString(),
    releaseMode: mode,
    artifacts: buildArtifactRows(artifactManifest.artifacts),
    preflightDir: preflightDir ? relativeFromRoot(preflightDir) : "",
    commands: buildCommands({ mode, preflightDir }),
    releaseReadiness: {
      status: releaseReadiness.status,
      readyForPublicTag: releaseReadiness.readyForPublicTag,
      automaticChecksPassed: releaseReadiness.automaticChecksPassed,
      fixtureStrictPassed: releaseReadiness.fixtureStrictPassed,
      blockingItems: releaseReadiness.blockingItems ?? [],
      nextActions: releaseReadiness.nextActions ?? [],
      desktopGate: releaseReadiness.desktopGate
    }
  };
}

async function main() {
  const mdFile = argValue("--markdown", "docs/release-artifact-index.md");
  const jsonFile = argValue("--out", "samples/release-artifact-index.json");
  const index = await buildReleaseArtifactIndex();

  await writeTextFile(mdFile, renderMarkdown(index));
  await writeTextFile(jsonFile, `${JSON.stringify(index, null, 2)}\n`);

  if (hasFlag("--json")) {
    console.log(JSON.stringify(index, null, 2));
    return;
  }

  console.log(`Artifact index generated at ${relativeFromRoot(mdFile)} and ${relativeFromRoot(jsonFile)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
