import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { buildReleaseArtifactManifest } from "./release-artifacts.js";
import { buildDesktopVerificationRecord } from "./desktop-verification-record.js";
import { buildReleaseReadiness } from "./release-readiness.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "../..");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function runJsonScript(scriptRelativePath, args, options = {}) {
  const scriptPath = path.join(root, scriptRelativePath);
  try {
    const { stdout } = await execFileAsync(process.execPath, [scriptPath, ...args], {
      cwd: root,
      maxBuffer: 1024 * 1024,
      ...options
    });
    return JSON.parse(stdout);
  } catch (error) {
    const stdout = typeof error.stdout === "string" ? error.stdout.trim() : "";
    let parsed = null;
    try {
      parsed = stdout ? JSON.parse(stdout) : null;
    } catch {
      // Keep raw output below.
    }
    if (parsed && typeof parsed === "object") {
      return {
        ...parsed,
        command: `node ${scriptRelativePath} ${args.join(" ")}`.trim()
      };
    }
    return {
      ok: false,
      command: `node ${scriptRelativePath} ${args.join(" ")}`.trim(),
      error: error.message,
      stdout,
      result: parsed
    };
  }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath, value) {
  await writeFile(filePath, `${value.trimEnd()}\n`, "utf8");
}

function portableEvidencePath(filePath, outDir) {
  return path.relative(outDir, filePath).split(path.sep).join("/");
}

function quoteCommandArg(value) {
  return `"${String(value).replaceAll("\"", "\\\"")}"`;
}

async function evidenceFileEntry(key, filePath, outDir) {
  const buffer = await readFile(filePath);
  const text = buffer.toString("utf8");
  const entry = {
    key,
    path: portableEvidencePath(filePath, outDir),
    bytes: buffer.byteLength,
    sha256: createHash("sha256").update(buffer).digest("hex")
  };
  if (filePath.endsWith(".json")) {
    try {
      JSON.parse(text);
      entry.jsonOk = true;
    } catch {
      entry.jsonOk = false;
    }
  }
  return entry;
}

async function buildPreflightManifest({ outDir, result }) {
  const files = [];
  for (const [key, filePath] of Object.entries(result.files)) {
    if (key !== "preflightManifest") {
      files.push(await evidenceFileEntry(key, filePath, outDir));
    }
  }
  return {
    releaseTarget: result.releaseTarget,
    manifestType: "desktop-preflight",
    outDir,
    generatedBy: "npm run desktop-release-preflight",
    automatedHandoffReady: result.automatedHandoffReady,
    strictRecordReady: result.checks.strictRecordReady,
    fileCount: files.length,
    files
  };
}

function buildHandoffSummary({ result, releaseArtifacts, releaseReadiness }) {
  return {
    releaseTarget: result.releaseTarget,
    summaryType: "desktop-handoff",
    readyForPublicTag: releaseReadiness.readyForPublicTag,
    releaseStatus: releaseReadiness.status,
    blockingItems: releaseReadiness.blockingItems ?? [],
    automatedHandoffReady: result.automatedHandoffReady,
    strictRecordReady: result.checks.strictRecordReady,
    preflightCheckCommand: `npm run desktop-preflight-check -- ${quoteCommandArg(result.outDir)}`,
    portableEvidence: Object.fromEntries(
      Object.entries(result.files).map(([key, filePath]) => [key, portableEvidencePath(filePath, result.outDir)])
    ),
    desktopVerificationRecord: portableEvidencePath(result.files.desktopVerificationRecord, result.outDir),
    strictPreview: portableEvidencePath(result.files.strictPreview, result.outDir),
    handoff: portableEvidencePath(result.files.handoff, result.outDir),
    artifacts: releaseArtifacts.artifacts.map((artifact) => ({
      path: artifact.path,
      exists: artifact.exists === true,
      bytes: artifact.bytes ?? 0,
      sha256: artifact.sha256 ?? ""
    })),
    remainingManualGate: result.remainingManualGate,
    releaseCommands: result.releaseCommands,
    nextActions: releaseReadiness.nextActions ?? []
  };
}

function buildReleaseCommandChecklist(commands = []) {
  const checklist = [...commands];
  const packageCommand = "npm run public-preview-package -- --json";
  if (!checklist.includes(packageCommand)) {
    checklist.splice(Math.min(1, checklist.length), 0, packageCommand);
  }
  return checklist;
}

function strictPreviewFromRecord(recordPath) {
  return runJsonScript("src/cli/desktop-verification-check.js", ["--strict", recordPath]);
}

function statusMark(value) {
  return value ? "pass" : "pending";
}

function renderList(items) {
  if (!items.length) {
    return "- None";
  }
  return items.map((item) => `- ${item}`).join("\n");
}

function buildManualVerificationSteps() {
  return [
    "Open desktop-handoff.md and keep the generated evidence folder with the release candidate.",
    "Launch the packaged Desktop app from the tested app.exe, MSI, or NSIS artifact on the target Windows machine.",
    "Confirm WebView2 is present and record the Windows version, WebView2 status, Node version, artifact path, artifact bytes, and artifact SHA-256 in the desktop verification record.",
    "Run or record full desktop:app-smoke evidence so startup.status=pass and startup.runtimeHealthOk=true are justified.",
    "Run or record full desktop:workflow-smoke evidence so the temporary workspace, Markdown save, DOCX/PDF export, sample DOCX flow, exchange package read-back, receiver/trust report artifacts, and AI Send Gate checks are justified.",
    "Click Desktop UI diagnostics and record nodeAvailable, apiHealthOk, runtimePathsVisible, and sessionLogsVisible as true only when the visible UI shows those facts.",
    "Click the visible first-workflow control and record firstWorkflow.status=pass and readBackValid=true only after the visible workflow completes.",
    "Use the native workspace folder picker and record pathFilled=true and workspaceOpened=true only after the picked workspace opens.",
    "Use the native supported-file picker and record pathFilled=true and importSucceeded=true only after the selected file imports.",
    "Generate the filled record with npm run desktop-verification-fill -- --record <partial-record.json> --diagnostics-pass --first-workflow-pass --workspace-picker-pass --file-picker-pass --result-pass --tester <name> --windows-version <windows-version> --node-version <node-version> --webview2-present yes --out <filled-record.json>.",
    "Run npm run desktop-verification-check -- --strict <filled-record.json>, then close F-012 only with npm run desktop-fixture-close -- --record <filled-record.json> --write."
  ];
}

function renderDesktopHandoff(result, releaseArtifacts) {
  const artifacts = releaseArtifacts.artifacts.map((artifact) => (
    `| ${artifact.path} | ${artifact.exists ? "yes" : "no"} | ${artifact.bytes} | ${artifact.sha256 || "missing"} |`
  )).join("\n");
  const checks = Object.entries(result.checks)
    .map(([key, value]) => `| ${key} | ${statusMark(value)} |`)
    .join("\n");
  const files = Object.entries(result.files)
    .map(([key, value]) => `| ${key} | ${value} |`)
    .join("\n");
  const portableFiles = Object.entries(result.files)
    .map(([key, value]) => `| ${key} | ${portableEvidencePath(value, result.outDir)} |`)
    .join("\n");
  const failures = (result.strictPreviewFailures ?? [])
    .map((failure) => `- ${failure.code}: ${JSON.stringify(failure.detail)}`)
    .join("\n") || "- None";

  return `# Schema Docs Desktop Handoff

Release target: ${result.releaseTarget}

Automated handoff ready: ${statusMark(result.automatedHandoffReady)}
Strict verification ready: ${statusMark(result.checks.strictRecordReady)}

## Evidence Files

| Key | Path |
| --- | --- |
${files}

## Portable Evidence Paths

| Key | Relative Path |
| --- | --- |
${portableFiles}

## Artifact Hashes

| Path | Exists | Bytes | SHA-256 |
| --- | --- | ---: | --- |
${artifacts}

## Automatic Checks

| Check | Status |
| --- | --- |
${checks}

## Remaining Manual Gate

${renderList(result.remainingManualGate)}

## Preflight Check Command

${result.preflightCheckCommand}

## Release Command Checklist

${renderList(result.releaseCommands)}

## Manual Verification Steps

${renderList(result.manualVerificationSteps)}

## Strict Preview Next Actions

${renderList(result.strictPreviewNextActions)}

## Strict Preview Failures

${failures}
`;
}

export function buildRemainingManualGate({ appSmoke, workflowSmoke } = {}) {
  const gate = [];
  if (appSmoke?.ok !== true) {
    gate.push("Run full npm run desktop:app-smoke in a Windows GUI environment or record equivalent startup/API evidence.");
  }
  if (workflowSmoke?.ok !== true) {
    gate.push("Run full npm run desktop:workflow-smoke in a Windows GUI environment or record equivalent workflow evidence.");
  }
  gate.push(
    "Fill visible Desktop UI diagnostics, first workflow, native workspace picker, and native file picker results.",
    "Fill result.tester, result.testedAt, and result.status before strict verification can pass."
  );
  return gate;
}

export async function runDesktopReleasePreflight(options = {}) {
  const outDir = path.resolve(root, options.outDir ?? argValue("--out-dir", path.join(os.tmpdir(), "schema-docs-desktop-preflight")));
  const appPath = path.resolve(root, options.appPath ?? argValue("--app", path.join(root, "src-tauri", "target", "release", "app.exe")));
  const runtimeRoot = path.resolve(root, options.runtimeRoot ?? argValue("--runtime-root", path.join(root, "src-tauri", "target", "release", "runtime")));
  const bridgePort = String(options.bridgePort ?? argValue("--bridge-port", "18160"));
  const skipBridge = options.skipBridge ?? hasFlag("--skip-bridge");
  const includeGuiSmoke = options.includeGuiSmoke ?? hasFlag("--include-gui-smoke");
  const guiSmokeTimeoutMs = String(options.guiSmokeTimeoutMs ?? argValue("--gui-smoke-timeout-ms", "30000"));
  await mkdir(outDir, { recursive: true });

  const releaseArtifacts = await buildReleaseArtifactManifest();
  const appSmokeCheck = await runJsonScript("src/cli/desktop-app-smoke.js", ["--check-only", "--app", appPath]);
  const workflowSmokeCheck = await runJsonScript("src/cli/desktop-workflow-smoke.js", ["--check-only", "--app", appPath]);
  const appSmoke = includeGuiSmoke
    ? await runJsonScript("src/cli/desktop-app-smoke.js", ["--app", appPath, "--timeout-ms", guiSmokeTimeoutMs])
    : {
        ok: false,
        skipped: true,
        reason: "Skipped by default. Pass --include-gui-smoke in a Windows GUI environment."
      };
  const workflowSmoke = includeGuiSmoke
    ? await runJsonScript("src/cli/desktop-workflow-smoke.js", ["--app", appPath, "--timeout-ms", guiSmokeTimeoutMs])
    : {
        ok: false,
        skipped: true,
        reason: "Skipped by default. Pass --include-gui-smoke in a Windows GUI environment."
      };
  const bridgeSmoke = skipBridge
    ? {
        ok: false,
        skipped: true,
        reason: "Skipped by --skip-bridge."
      }
    : await runJsonScript("src/cli/desktop-bridge-smoke.js", ["--runtime-root", runtimeRoot, "--port", bridgePort]);
  const resultsPath = options.resultsPath ?? argValue("--results");
  const releaseReadiness = await buildReleaseReadiness({ resultsPath });

  const record = await buildDesktopVerificationRecord({
    appSmoke: appSmoke.ok ? appSmoke : null,
    workflowSmoke: workflowSmoke.ok ? workflowSmoke : null,
    bridgeSmoke: bridgeSmoke.ok ? bridgeSmoke : null
  });
  const recordPath = path.join(outDir, "desktop-verification-record.partial.json");
  const files = {
    releaseArtifacts: path.join(outDir, "release-artifacts.json"),
    appSmokeCheck: path.join(outDir, "desktop-app-smoke.check-only.json"),
    workflowSmokeCheck: path.join(outDir, "desktop-workflow-smoke.check-only.json"),
    appSmoke: path.join(outDir, "desktop-app-smoke.full.json"),
    workflowSmoke: path.join(outDir, "desktop-workflow-smoke.full.json"),
    bridgeSmoke: path.join(outDir, "desktop-bridge-smoke.json"),
    releaseReadiness: path.join(outDir, "release-readiness.json"),
    handoffSummary: path.join(outDir, "desktop-handoff-summary.json"),
    preflightManifest: path.join(outDir, "desktop-preflight-manifest.json"),
    desktopVerificationRecord: recordPath,
    strictPreview: path.join(outDir, "desktop-verification.strict-preview.json"),
    handoff: path.join(outDir, "desktop-handoff.md")
  };

  await writeJson(files.releaseArtifacts, releaseArtifacts);
  await writeJson(files.appSmokeCheck, appSmokeCheck);
  await writeJson(files.workflowSmokeCheck, workflowSmokeCheck);
  await writeJson(files.appSmoke, appSmoke);
  await writeJson(files.workflowSmoke, workflowSmoke);
  await writeJson(files.bridgeSmoke, bridgeSmoke);
  await writeJson(files.releaseReadiness, releaseReadiness);
  await writeJson(files.desktopVerificationRecord, record);

  const strictPreview = await strictPreviewFromRecord(recordPath);
  await writeJson(files.strictPreview, strictPreview);

  const releaseReadinessRecorded = releaseReadiness.releaseTarget === "v0.1.1" && typeof releaseReadiness.readyForPublicTag === "boolean";
  const automatedHandoffReady = Boolean(releaseArtifacts.artifacts.some((artifact) => artifact.exists && artifact.sha256)
    && releaseReadinessRecorded
    && appSmokeCheck.ok
    && workflowSmokeCheck.ok
    && bridgeSmoke.ok);
  const result = {
    ok: true,
    releaseTarget: "v0.1.1",
    outDir,
    files,
    automatedHandoffReady,
    checks: {
      releaseArtifactsRecorded: releaseArtifacts.artifacts.some((artifact) => artifact.exists && artifact.sha256),
      releaseReadinessRecorded,
      appSmokeCheckOnlyOk: appSmokeCheck.ok === true,
      workflowSmokeCheckOnlyOk: workflowSmokeCheck.ok === true,
      fullAppSmokeOk: appSmoke.ok === true,
      fullWorkflowSmokeOk: workflowSmoke.ok === true,
      bridgeSmokeOk: bridgeSmoke.ok === true,
      strictRecordReady: strictPreview.ok === true
    },
    remainingManualGate: buildRemainingManualGate({ appSmoke, workflowSmoke }),
    preflightCheckCommand: `npm run desktop-preflight-check -- ${quoteCommandArg(outDir)}`,
    releaseCommands: buildReleaseCommandChecklist(releaseReadiness.commands ?? []),
    manualVerificationSteps: buildManualVerificationSteps(),
    guiSmoke: {
      included: includeGuiSmoke,
      timeoutMs: Number(guiSmokeTimeoutMs)
    },
    strictPreviewFailures: strictPreview.failures ?? [],
    strictPreviewNextActions: strictPreview.nextActions ?? []
  };

  await writeText(files.handoff, renderDesktopHandoff(result, releaseArtifacts));
  const handoffSummary = buildHandoffSummary({ result, releaseArtifacts, releaseReadiness });
  await writeJson(files.handoffSummary, handoffSummary);
  const preflightManifest = await buildPreflightManifest({ outDir, result });
  await writeJson(files.preflightManifest, preflightManifest);

  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runDesktopReleasePreflight();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}
