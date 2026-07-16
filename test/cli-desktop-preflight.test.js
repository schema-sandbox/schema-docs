import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { KATEX_WOFF2_FONT_FILES } from "../src/core/katexRuntimeAssets.js";
import {
  desktopPreflightCheckPath,
  desktopReleasePreflightPath,
  desktopVerificationCheckPath,
  desktopVerificationFillPath,
  execFileAsync,
  projectRoot,
  releaseArtifactsPath
} from "./helpers/cliHarness.js";
async function rewriteHandoffSummary(outDir, mutateSummary) {
  const manifestPath = path.join(outDir, "desktop-preflight-manifest.json");
  const summaryPath = path.join(outDir, "desktop-handoff-summary.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const summary = JSON.parse(await readFile(summaryPath, "utf8"));
  mutateSummary(summary);
  const summaryJson = `${JSON.stringify(summary, null, 2)}\n`;
  await writeFile(summaryPath, summaryJson, "utf8");
  const summaryEntry = manifest.files.find((file) => file.key === "handoffSummary");
  summaryEntry.bytes = Buffer.byteLength(summaryJson);
  summaryEntry.sha256 = createHash("sha256").update(summaryJson).digest("hex");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
async function expectPreflightFailure(outDir, expectedCode) {
  await assert.rejects(
    execFileAsync(process.execPath, [desktopPreflightCheckPath, outDir], {
      cwd: projectRoot
    }),
    (error) => {
      const result = JSON.parse(error.stdout);
      assert.equal(result.ok, false);
      assert.ok(result.failures.some((failure) => failure.code === expectedCode));
      return true;
    }
  );
}
test("desktop-release-preflight writes a handoff evidence package without launching GUI", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-preflight-"));
  const fakeApp = path.join(workspace, process.platform === "win32" ? "app.exe" : "app");
  const fakeRuntime = path.join(workspace, "runtime");
  const fakeLauncher = path.join(fakeRuntime, "src", "cli", "desktop-runtime-launcher.js");
  const outDir = path.join(workspace, "preflight evidence");
  await mkdir(path.dirname(fakeLauncher), { recursive: true });
  await writeFile(fakeApp, "");
  await writeFile(path.join(fakeRuntime, "node.exe"), "");
  await writeFile(path.join(fakeRuntime, "package.json"), "{}");
  await writeFile(fakeLauncher, "");
  await mkdir(path.join(fakeRuntime, "public"), { recursive: true });
  await writeFile(path.join(fakeRuntime, "public", "index.html"), "<!doctype html>");
  for (const relativePath of [
    "public/libs/markdown-it.min.js",
    "public/libs/docx.js",
    "public/libs/katex/katex.min.js",
    "public/libs/katex/katex.min.css",
    ...KATEX_WOFF2_FONT_FILES.map((fontName) => `public/libs/katex/fonts/${fontName}`)
  ]) {
    const filePath = path.join(fakeRuntime, ...relativePath.split("/"));
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "");
  }
  const resultsDir = await mkdtemp(path.join(os.tmpdir(), "schema-docs-preflight-results-"));
  const tempResultsPath = path.join(resultsDir, "fixture-results.json");
  const resultsContent = JSON.parse(await readFile(path.join(projectRoot, "samples/fixture-results.json"), "utf8"));
  resultsContent.results = resultsContent.results.map((r) => r.id === "F-012" ? { ...r, status: "blocked", evidence: "Pending verification" } : r);
  resultsContent.statusCounts = { pass: 10, known_limit: 1, blocked: 1 };
  await writeFile(tempResultsPath, JSON.stringify(resultsContent, null, 2), "utf8");
  const { stdout } = await execFileAsync(process.execPath, [
    desktopReleasePreflightPath,
    "--app",
    fakeApp,
    "--out-dir",
    outDir,
    "--skip-bridge",
    "--results",
    tempResultsPath
  ], {
    cwd: projectRoot
  });
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  assert.equal(result.outDir, outDir);
  assert.equal(result.checks.appSmokeCheckOnlyOk, true);
  assert.equal(result.checks.workflowSmokeCheckOnlyOk, true);
  assert.equal(result.checks.releaseReadinessRecorded, true);
  assert.equal(result.checks.fullAppSmokeOk, false);
  assert.equal(result.checks.fullWorkflowSmokeOk, false);
  assert.equal(result.checks.bridgeSmokeOk, false);
  assert.equal(result.checks.strictRecordReady, false);
  assert.equal(result.automatedHandoffReady, false);
  assert.ok(result.remainingManualGate.some((item) => item.includes("visible Desktop UI")));
  assert.ok(result.manualVerificationSteps.some((item) => item.includes("Confirm WebView2")));
  assert.ok(result.manualVerificationSteps.some((item) => item.includes("Desktop UI diagnostics")));
  assert.ok(result.manualVerificationSteps.some((item) => item.includes("--webview2-present yes")));
  assert.ok(result.manualVerificationSteps.some((item) => item.includes("desktop-fixture-close")));
  assert.ok(result.strictPreviewNextActions.some((action) => action.includes("visible first-workflow")));
  const appSmokeCheck = JSON.parse(await readFile(result.files.appSmokeCheck, "utf8"));
  const workflowSmokeCheck = JSON.parse(await readFile(result.files.workflowSmokeCheck, "utf8"));
  const appSmoke = JSON.parse(await readFile(result.files.appSmoke, "utf8"));
  const workflowSmoke = JSON.parse(await readFile(result.files.workflowSmoke, "utf8"));
  const releaseReadiness = JSON.parse(await readFile(result.files.releaseReadiness, "utf8"));
  const handoffSummary = JSON.parse(await readFile(result.files.handoffSummary, "utf8"));
  const preflightManifest = JSON.parse(await readFile(result.files.preflightManifest, "utf8"));
  const partialRecord = JSON.parse(await readFile(result.files.desktopVerificationRecord, "utf8"));
  const strictPreview = JSON.parse(await readFile(result.files.strictPreview, "utf8"));
  const handoff = await readFile(result.files.handoff, "utf8");
  assert.equal(appSmokeCheck.mode, "check-only");
  assert.equal(workflowSmokeCheck.mode, "check-only");
  assert.equal(appSmoke.skipped, true);
  assert.equal(workflowSmoke.skipped, true);
  assert.equal(releaseReadiness.readyForPublicTag, false);
  assert.equal(releaseReadiness.blockingItems[0].id, "F-012");
  assert.equal(handoffSummary.summaryType, "desktop-handoff");
  assert.equal(handoffSummary.readyForPublicTag, false);
  assert.equal(handoffSummary.blockingItems[0].id, "F-012");
  assert.match(handoffSummary.preflightCheckCommand, /desktop-preflight-check/);
  assert.ok(handoffSummary.preflightCheckCommand.includes(`"${outDir}"`));
  assert.ok(handoffSummary.releaseCommands.includes("npm run public-preview-package -- --json"));
  assert.ok(handoffSummary.releaseCommands.includes("npm run release-artifacts"));
  assert.ok(handoffSummary.releaseCommands.some((command) => command.includes("desktop-verification-fill")));
  assert.equal(handoffSummary.portableEvidence.desktopVerificationRecord, "desktop-verification-record.partial.json");
  assert.equal(handoffSummary.portableEvidence.strictPreview, "desktop-verification.strict-preview.json");
  assert.equal(handoffSummary.portableEvidence.handoff, "desktop-handoff.md");
  assert.equal(handoffSummary.portableEvidence.preflightManifest, "desktop-preflight-manifest.json");
  assert.ok(Object.values(handoffSummary.portableEvidence).every((filePath) => !path.isAbsolute(filePath)));
  assert.ok(handoffSummary.artifacts.some((artifact) => artifact.path.endsWith("app.exe")));
  assert.equal(preflightManifest.manifestType, "desktop-preflight");
  assert.equal(preflightManifest.fileCount, 11);
  assert.ok(preflightManifest.files.every((file) => !path.isAbsolute(file.path)));
  assert.ok(preflightManifest.files.some((file) => file.key === "releaseReadiness" && file.jsonOk === true && /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.ok(preflightManifest.files.some((file) => file.key === "handoffSummary" && file.jsonOk === true && /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.ok(preflightManifest.files.some((file) => file.key === "handoff" && /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.equal(partialRecord.recordType, "desktop-verification");
  assert.equal(strictPreview.ok, false);
  assert.ok(strictPreview.nextActions.some((action) => action.includes("visible first-workflow")));
  assert.match(handoff, /# Schema Docs Desktop Handoff/);
  assert.match(handoff, /desktop-verification-record\.partial\.json/);
  assert.match(handoff, /Preflight Check Command/);
  assert.ok(handoff.includes(`"${outDir}"`));
  assert.match(handoff, /Portable Evidence Paths/);
  assert.match(handoff, /Release Command Checklist/);
  assert.match(handoff, /npm run public-preview-package -- --json/);
  assert.match(handoff, /desktop-verification-fill/);
  assert.match(handoff, /Manual Verification Steps/);
  assert.match(handoff, /Confirm WebView2/);
  assert.match(handoff, /--webview2-present yes/);
  assert.match(handoff, /Strict Preview Next Actions/);
  const preflightCheck = await execFileAsync(process.execPath, [desktopPreflightCheckPath, outDir], {
    cwd: projectRoot
  });
  const preflightCheckResult = JSON.parse(preflightCheck.stdout);
  assert.equal(preflightCheckResult.ok, true);
  assert.equal(preflightCheckResult.checkedFileCount, 11);
  assert.ok(preflightCheckResult.files.every((file) => file.ok));
  const copiedOutDir = path.join(workspace, "preflight-copy");
  await cp(outDir, copiedOutDir, { recursive: true });
  const copiedPreflightCheck = await execFileAsync(process.execPath, [desktopPreflightCheckPath, copiedOutDir], {
    cwd: projectRoot
  });
  const copiedPreflightCheckResult = JSON.parse(copiedPreflightCheck.stdout);
  assert.equal(copiedPreflightCheckResult.ok, true);
  assert.equal(copiedPreflightCheckResult.checkedFileCount, 11);
  assert.ok(copiedPreflightCheckResult.files.every((file) => file.ok));
  const tamperCases = [
    ["preflight-semantic-copy", "handoff_summary_release_commands_missing", (summary) => delete summary.releaseCommands],
    ["preflight-command-copy", "handoff_summary_preflight_command_invalid", (summary) => {
      summary.preflightCheckCommand = "npm run desktop-preflight-check -- unquoted-path";
    }],
    ["preflight-portable-copy", "handoff_summary_portable_evidence_path_invalid", (summary) => {
      summary.portableEvidence.handoff = "/absolute/path/to/evidence";
    }],
    ["preflight-mismatch-copy", "handoff_summary_release_commands_mismatch", (summary) => {
      summary.releaseCommands = summary.releaseCommands.filter((command) => !command.includes("desktop-verification-fill"));
    }]
  ];
  for (const [dirName, expectedCode, mutateSummary] of tamperCases) {
    const tamperedOutDir = path.join(workspace, dirName);
    await cp(outDir, tamperedOutDir, { recursive: true });
    await rewriteHandoffSummary(tamperedOutDir, mutateSummary);
    await expectPreflightFailure(tamperedOutDir, expectedCode);
  }
  await writeFile(result.files.handoff, `${handoff}\nchanged after manifest\n`, "utf8");
  await assert.rejects(
    execFileAsync(process.execPath, [desktopPreflightCheckPath, result.files.preflightManifest], {
      cwd: projectRoot
    }),
    (error) => {
      const tampered = JSON.parse(error.stdout);
      assert.equal(tampered.ok, false);
      assert.ok(tampered.failures.some((failure) => failure.code === "bytes_mismatch" || failure.code === "sha256_mismatch"));
      return true;
    }
  );
});
test("desktop-release-preflight only keeps full GUI smoke gates when they are still missing", async () => {
  const preflightModuleUrl = pathToFileURL(path.join(projectRoot, "src", "cli", "desktop-release-preflight.js"));
  const { buildRemainingManualGate } = await import(preflightModuleUrl.href);
  const missingSmokeGate = buildRemainingManualGate({
    appSmoke: { ok: false, skipped: true },
    workflowSmoke: { ok: false, skipped: true }
  });
  assert.ok(missingSmokeGate.some((item) => item.includes("desktop:app-smoke")));
  assert.ok(missingSmokeGate.some((item) => item.includes("desktop:workflow-smoke")));
  assert.ok(missingSmokeGate.some((item) => item.includes("visible Desktop UI")));
  const completedSmokeGate = buildRemainingManualGate({
    appSmoke: { ok: true },
    workflowSmoke: { ok: true }
  });
  assert.equal(completedSmokeGate.some((item) => item.includes("desktop:app-smoke")), false);
  assert.equal(completedSmokeGate.some((item) => item.includes("desktop:workflow-smoke")), false);
  assert.ok(completedSmokeGate.some((item) => item.includes("visible Desktop UI")));
});
test("desktop-verification-fill creates a strict-checkable record from explicit visible UI evidence", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "schema docs desktop fill-"));
  const workspace = path.join(workspaceRoot, "space dir");
  const recordPath = path.join(workspace, "desktop-verification-record.partial.json");
  const filledPath = path.join(workspace, "desktop-verification-record.filled.json");
  await mkdir(workspace, { recursive: true });
  const artifactsResult = await execFileAsync(process.execPath, [releaseArtifactsPath], { cwd: projectRoot });
  const artifactsManifest = JSON.parse(artifactsResult.stdout);
  const appArtifact = artifactsManifest.artifacts.find((a) => a.path.endsWith("app.exe"));
  const actualHash = appArtifact?.sha256 || "95881102234c4bd0345b6d3ac39e89e1f9ae0bf89ea80e93d4e42786bd59a58d";
  const actualBytes = appArtifact?.bytes || 8725504;
  await writeFile(recordPath, JSON.stringify({
    releaseTarget: "v0.1.0",
    recordType: "desktop-verification",
    artifact: {
      path: "src-tauri/target/release/app.exe",
      kind: "app.exe",
      bytes: actualBytes,
      sha256: actualHash
    },
    environment: {
      windowsVersion: "Windows_NT 10.0.26200",
      webView2Present: "unknown",
      nodeVersion: "v22.20.0",
      machineProfile: "developer"
    },
    startup: {
      status: "pass",
      startupTimeMs: 0,
      windowTitle: "Schema Docs",
      apiBaseUrl: "http://127.0.0.1:4178",
      runtimeHealthOk: true,
      smartscreenOrAvInterruption: "",
      notes: ""
    },
    visibleUi: {
      desktopDiagnostics: {
        status: "not_run",
        nodeAvailable: false,
        apiHealthOk: false,
        runtimePathsVisible: false,
        sessionLogsVisible: false,
        notes: ""
      },
      firstWorkflow: {
        status: "not_run",
        readBackValid: false,
        notes: ""
      },
      workspacePicker: {
        status: "not_run",
        pathFilled: false,
        workspaceOpened: false,
        notes: ""
      },
      filePicker: {
        status: "not_run",
        pathFilled: false,
        importSucceeded: false,
        notes: ""
      }
    },
    automatedEvidence: {
      desktopAppSmokeOk: true,
      desktopWorkflowSmokeOk: true,
      desktopBridgeSmokeOk: true,
      releaseArtifactsRecorded: true,
      notes: ""
    },
    sendGate: {
      status: "pass",
      ordinaryPreviewDecision: "selected_context_preview",
      sensitivePreviewDecision: "review_recommended",
      credentialSendBlocked: true,
      apiKeyNotPersisted: true,
      notes: ""
    },
    result: {
      status: "not_run",
      tester: "",
      testedAt: "",
      notes: ""
    }
  }, null, 2));
  await assert.rejects(
    execFileAsync(process.execPath, [
      desktopVerificationFillPath,
      "--record",
      recordPath,
      "--visible-ui-pass",
      "--result-pass",
      "--out",
      filledPath
    ], {
      cwd: projectRoot
    }),
    (error) => {
      const result = JSON.parse(error.stdout);
      assert.equal(result.ok, false);
      assert.match(result.error, /--tester/);
      return true;
    }
  );
  const filled = await execFileAsync(process.execPath, [
    desktopVerificationFillPath,
    "--record",
    recordPath,
    "--diagnostics-pass",
    "--first-workflow-pass",
    "--workspace-picker-pass",
    "--file-picker-pass",
    "--result-pass",
    "--tester",
    "desktop-tester",
    "--tested-at",
    "2026-07-01T00:00:00.000Z",
    "--windows-version",
    "Windows 11 23H2 Build 22631",
    "--node-version",
    "v22.20.1",
    "--webview2-present",
    "yes",
    "--machine-profile",
    "near-clean",
    "--out",
    filledPath
  ], {
    cwd: projectRoot
  });
  const filledResult = JSON.parse(filled.stdout);
  assert.equal(filledResult.ok, true);
  assert.equal(filledResult.outPath, filledPath);
  assert.match(filledResult.nextCommand, /desktop-verification-check/);
  assert.ok(filledResult.nextCommand.includes(`"${filledPath}"`));
  assert.ok(filledResult.closeCommand.includes(`"${filledPath}"`));
  assert.match(filledResult.closeCommand, /desktop-fixture-close/);
  assert.match(filledResult.closeCommand, /--write/);
  const filledRecord = JSON.parse(await readFile(filledPath, "utf8"));
  assert.equal(filledRecord.visibleUi.desktopDiagnostics.status, "pass");
  assert.equal(filledRecord.visibleUi.firstWorkflow.readBackValid, true);
  assert.equal(filledRecord.visibleUi.workspacePicker.workspaceOpened, true);
  assert.equal(filledRecord.visibleUi.filePicker.importSucceeded, true);
  assert.equal(filledRecord.result.status, "pass");
  assert.equal(filledRecord.result.tester, "desktop-tester");
  assert.equal(filledRecord.environment.windowsVersion, "Windows 11 23H2 Build 22631");
  assert.equal(filledRecord.environment.nodeVersion, "v22.20.1");
  const strict = await execFileAsync(process.execPath, [desktopVerificationCheckPath, "--strict", filledPath], {
    cwd: projectRoot
  });
  const strictResult = JSON.parse(strict.stdout);
  assert.equal(strictResult.ok, true);
});
test("desktop-verification-fill can fill visible UI evidence one step at a time", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-desktop-fill-partial-"));
  const recordPath = path.join(workspace, "desktop-verification-record.partial.json");
  const partiallyFilledPath = path.join(workspace, "desktop-verification-record.partial-filled.json");
  const artifactsResult = await execFileAsync(process.execPath, [releaseArtifactsPath], { cwd: projectRoot });
  const artifactsManifest = JSON.parse(artifactsResult.stdout);
  const appArtifact = artifactsManifest.artifacts.find((a) => a.path.endsWith("app.exe"));
  const actualHash = appArtifact?.sha256 || "95881102234c4bd0345b6d3ac39e89e1f9ae0bf89ea80e93d4e42786bd59a58d";
  const actualBytes = appArtifact?.bytes || 8725504;
  await writeFile(recordPath, JSON.stringify({
    releaseTarget: "v0.1.0",
    recordType: "desktop-verification",
    artifact: {
      path: "src-tauri/target/release/app.exe",
      kind: "app.exe",
      bytes: actualBytes,
      sha256: actualHash
    },
    environment: {
      windowsVersion: "Windows_NT 10.0.26200",
      webView2Present: "yes",
      nodeVersion: "v22.20.0",
      machineProfile: "developer"
    },
    startup: {
      status: "pass",
      runtimeHealthOk: true
    },
    visibleUi: {
      desktopDiagnostics: {
        status: "not_run",
        nodeAvailable: false,
        apiHealthOk: false,
        runtimePathsVisible: false,
        sessionLogsVisible: false
      },
      firstWorkflow: {
        status: "not_run",
        readBackValid: false
      },
      workspacePicker: {
        status: "not_run",
        pathFilled: false,
        workspaceOpened: false
      },
      filePicker: {
        status: "not_run",
        pathFilled: false,
        importSucceeded: false
      }
    },
    automatedEvidence: {
      desktopAppSmokeOk: true,
      desktopWorkflowSmokeOk: true,
      desktopBridgeSmokeOk: true,
      releaseArtifactsRecorded: true
    },
    sendGate: {
      status: "pass",
      credentialSendBlocked: true,
      apiKeyNotPersisted: true
    },
    result: {
      status: "pass",
      tester: "desktop-tester",
      testedAt: "2026-07-01T00:00:00.000Z"
    }
  }, null, 2));
  const filled = await execFileAsync(process.execPath, [
    desktopVerificationFillPath,
    "--record",
    recordPath,
    "--diagnostics-pass",
    "--first-workflow-pass",
    "--out",
    partiallyFilledPath
  ], {
    cwd: projectRoot
  });
  const filledResult = JSON.parse(filled.stdout);
  assert.equal(filledResult.ok, true);
  const partiallyFilledRecord = JSON.parse(await readFile(partiallyFilledPath, "utf8"));
  assert.equal(partiallyFilledRecord.visibleUi.desktopDiagnostics.status, "pass");
  assert.equal(partiallyFilledRecord.visibleUi.firstWorkflow.status, "pass");
  assert.equal(partiallyFilledRecord.visibleUi.workspacePicker.status, "not_run");
  assert.equal(partiallyFilledRecord.visibleUi.filePicker.status, "not_run");
  await assert.rejects(
    execFileAsync(process.execPath, [desktopVerificationCheckPath, "--strict", partiallyFilledPath], {
      cwd: projectRoot
    }),
    (error) => {
      const strictResult = JSON.parse(error.stdout);
      assert.equal(strictResult.ok, false);
      assert.ok(strictResult.failures.some((failure) => failure.code === "workspace_picker_not_pass"));
      assert.ok(strictResult.failures.some((failure) => failure.code === "file_picker_not_pass"));
      return true;
    }
  );
});
