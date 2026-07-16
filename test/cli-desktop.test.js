import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { cp, copyFile, link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { KATEX_WOFF2_FONT_FILES } from "../src/core/katexRuntimeAssets.js";
import {
  desktopAppSmokePath,
  desktopBridgeSmokePath,
  desktopFixtureClosePath,
  desktopVerificationCheckPath,
  desktopVerificationRecordPath,
  desktopWorkflowSmokePath,
  execFileAsync,
  projectRoot,
  releaseArtifactsPath
} from "./helpers/cliHarness.js";

const exportLibraryFiles = [
  "public/libs/markdown-it.min.js",
  "public/libs/docx.js",
  "public/libs/katex/katex.min.js",
  "public/libs/katex/katex.min.css",
  ...KATEX_WOFF2_FONT_FILES.map((fontName) => `public/libs/katex/fonts/${fontName}`)
];
async function writeFakeExportLibraries(runtimeRoot) {
  for (const relativePath of exportLibraryFiles) {
    const filePath = path.join(runtimeRoot, ...relativePath.split("/"));
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "");
  }
}

async function createPackagedLayout(prefix) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), prefix));
  const appPath = path.join(workspace, process.platform === "win32" ? "app.exe" : "app");
  const runtimeRoot = path.join(workspace, "runtime");
  const launcher = path.join(runtimeRoot, "src", "cli", "desktop-runtime-launcher.js");
  await mkdir(path.dirname(launcher), { recursive: true });
  await writeFile(appPath, "");
  await writeFile(path.join(runtimeRoot, "node.exe"), "");
  await writeFile(path.join(runtimeRoot, "package.json"), "{}");
  await writeFile(launcher, "");
  await mkdir(path.join(runtimeRoot, "public"), { recursive: true });
  await writeFile(path.join(runtimeRoot, "public", "index.html"), "<!doctype html>");
  await writeFakeExportLibraries(runtimeRoot);
  return { workspace, appPath, runtimeRoot, launcher };
}

async function runCliJson(scriptPath, args) {
  const { stdout } = await execFileAsync(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: "test" }
  });
  return JSON.parse(stdout);
}

async function rejectCliJson(scriptPath, args) {
  try {
    await runCliJson(scriptPath, args);
  } catch (error) {
    return JSON.parse(error.stdout);
  }
  throw new Error(`Expected ${path.basename(scriptPath)} to fail.`);
}

test("desktop GUI smokes pass a requested start port to the packaged app", async () => {
  for (const relativePath of ["src/cli/desktop-app-smoke.js", "src/cli/desktop-workflow-smoke.js"]) {
    const source = await readFile(path.join(projectRoot, relativePath), "utf8");
    assert.match(source, /SCHEMA_DOCS_DESKTOP_PORT: String\(startPort\)/, relativePath);
  }
  const rustSource = await readFile(path.join(projectRoot, "src-tauri/src/lib.rs"), "utf8");
  assert.match(rustSource, /std::env::var\("SCHEMA_DOCS_DESKTOP_PORT"\)/);
  assert.match(rustSource, /\.env\("SCHEMA_DOCS_DESKTOP_PORT", &desktop_port\)/);
});

function desktopVerificationPassRecord({ bytes = 8725504, sha256 = "95881102234c4bd0345b6d3ac39e89e1f9ae0bf89ea80e93d4e42786bd59a58d" } = {}) {
  return {
    releaseTarget: "v0.1.0",
    recordType: "desktop-verification",
    artifact: {
      path: "src-tauri/target/release/app.exe",
      kind: "app.exe",
      bytes,
      sha256
    },
    environment: {
      windowsVersion: "Windows test",
      webView2Present: "yes",
      nodeVersion: "v22.20.0",
      machineProfile: "near-clean"
    },
    startup: {
      status: "pass",
      startupTimeMs: 1200,
      windowTitle: "Schema Docs",
      apiBaseUrl: "http://127.0.0.1:4178",
      runtimeHealthOk: true,
      smartscreenOrAvInterruption: "",
      notes: ""
    },
    visibleUi: {
      desktopDiagnostics: {
        status: "pass",
        nodeAvailable: true,
        apiHealthOk: true,
        runtimePathsVisible: true,
        sessionLogsVisible: true,
        notes: ""
      },
      firstWorkflow: {
        status: "pass",
        readBackValid: true,
        notes: ""
      },
      workspacePicker: {
        status: "pass",
        pathFilled: true,
        workspaceOpened: true,
        notes: ""
      },
      filePicker: {
        status: "pass",
        pathFilled: true,
        importSucceeded: true,
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
      status: "pass",
      tester: "automated-test",
      testedAt: "2026-07-01T00:00:00.000Z",
      notes: ""
    }
  };
}

test("desktop packaged-app checks reject a bare executable without its runtime tree", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-bare-app-"));
  const appPath = path.join(workspace, process.platform === "win32" ? "app.exe" : "app");
  await writeFile(appPath, "");
  try {
    for (const scriptPath of [desktopAppSmokePath, desktopWorkflowSmokePath]) {
      const result = await rejectCliJson(scriptPath, ["--check-only", "--app", appPath]);
      assert.equal(result.ok, false);
      assert.equal(result.mode, "check-only");
      assert.equal(result.appPath, appPath);
      assert.equal(result.packagedRuntime.ok, false);
      assert.equal(result.packagedRuntime.missingFiles.length, 28);
      assert.match(result.packagedRuntime.requiredFiles.katex, /katex[\\/]katex\.min\.js$/);
      assert.match(result.error, /runtime resources are missing/i);
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("desktop packaged-app checks accept an executable with the complete runtime tree", async () => {
  const layout = await createPackagedLayout("schema-docs-complete-app-");
  try {
    for (const scriptPath of [desktopAppSmokePath, desktopWorkflowSmokePath]) {
      const result = await runCliJson(scriptPath, ["--check-only", "--app", layout.appPath]);
      assert.equal(result.ok, true);
      assert.equal(result.mode, "check-only");
      assert.equal(result.packagedRuntime.ok, true);
      assert.equal(result.packagedRuntime.runtimeRoot, layout.runtimeRoot);
      assert.deepEqual(result.packagedRuntime.missingFiles, []);
    }
  } finally {
    await rm(layout.workspace, { recursive: true, force: true });
  }
});

test("desktop bridge smoke selects runtime node.exe when it is bundled", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-bundled-node-"));
  const runtimeRoot = path.join(workspace, "runtime");
  const bundledNode = path.join(runtimeRoot, "node.exe");
  await mkdir(runtimeRoot, { recursive: true });
  await cp(path.join(projectRoot, "src"), path.join(runtimeRoot, "src"), { recursive: true });
  await writeFile(path.join(runtimeRoot, "package.json"), JSON.stringify({ type: "module" }));
  await mkdir(path.join(runtimeRoot, "public"), { recursive: true });
  await writeFile(path.join(runtimeRoot, "public", "index.html"), "<!doctype html>");
  await writeFakeExportLibraries(runtimeRoot);
  try {
    await link(process.execPath, bundledNode);
  } catch {
    await copyFile(process.execPath, bundledNode);
  }
  try {
    const result = await runCliJson(desktopBridgeSmokePath, ["--runtime-root", runtimeRoot, "--port", "18261"]);
    assert.equal(result.ok, true);
    assert.equal(result.isBundled, true);
    assert.equal(result.nodePath, bundledNode);
    assert.equal(result.runtime.port, 18261);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("desktop-verification-record generates a partial record from smoke outputs", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-desktop-record-input-"));
  const appSmokePath = path.join(workspace, "app-smoke.json");
  const workflowSmokePath = path.join(workspace, "workflow-smoke.json");
  const bridgeSmokePath = path.join(workspace, "bridge-smoke.json");
  await writeFile(appSmokePath, JSON.stringify({
    ok: true,
    runtime: {
      baseUrl: "http://127.0.0.1:4178",
      health: { ok: true }
    },
    cleanup: { ok: true, stillRunning: false }
  }));
  await writeFile(workflowSmokePath, JSON.stringify({
    ok: true,
    runtime: {
      baseUrl: "http://127.0.0.1:4178",
      health: { ok: true }
    },
    workflow: {
      aiPreviewOk: true,
      aiSensitivePreviewOk: true,
      aiBlockedSendOk: true
    }
  }));
  await writeFile(bridgeSmokePath, JSON.stringify({ ok: true }));
  const { stdout } = await execFileAsync(process.execPath, [
    desktopVerificationRecordPath,
    "--app-smoke-json",
    appSmokePath,
    "--workflow-smoke-json",
    workflowSmokePath,
    "--bridge-smoke-json",
    bridgeSmokePath
  ], {
    cwd: projectRoot
  });
  const record = JSON.parse(stdout);
  assert.equal(record.recordType, "desktop-verification");
  assert.equal(record.startup.status, "pass");
  assert.equal(record.startup.runtimeHealthOk, true);
  assert.equal(record.automatedEvidence.desktopAppSmokeOk, true);
  assert.equal(record.automatedEvidence.desktopWorkflowSmokeOk, true);
  assert.equal(record.automatedEvidence.desktopBridgeSmokeOk, true);
  assert.equal(record.automatedEvidence.releaseArtifactsRecorded, Boolean(record.artifact.sha256));
  assert.equal(record.sendGate.status, "pass");
  assert.equal(record.sendGate.ordinaryPreviewDecision, "selected_context_preview");
  assert.equal(record.sendGate.sensitivePreviewDecision, "review_recommended");
  assert.equal(record.sendGate.credentialSendBlocked, true);
  assert.equal(record.visibleUi.firstWorkflow.status, "not_run");
  const generatedRecordPath = path.join(workspace, "generated", "desktop-record.json");
  const generated = await execFileAsync(process.execPath, [
    desktopVerificationRecordPath,
    "--app-smoke-json",
    appSmokePath,
    "--workflow-smoke-json",
    workflowSmokePath,
    "--bridge-smoke-json",
    bridgeSmokePath,
    "--out",
    generatedRecordPath
  ], {
    cwd: projectRoot
  });
  const generatedResult = JSON.parse(generated.stdout);
  assert.equal(generatedResult.ok, true);
  assert.equal(generatedResult.recordPath, generatedRecordPath);
  assert.equal(generatedResult.generated.sendGateRecorded, true);
  const generatedRecord = JSON.parse(await readFile(generatedRecordPath, "utf8"));
  assert.equal(generatedRecord.recordType, "desktop-verification");
  assert.equal(generatedRecord.automatedEvidence.desktopWorkflowSmokeOk, true);
});
test("desktop-verification-check validates template and strict pass records", async () => {
  const template = await execFileAsync(process.execPath, [desktopVerificationCheckPath], {
    cwd: projectRoot
  });
  const templateResult = JSON.parse(template.stdout);
  assert.equal(templateResult.ok, true);
  assert.equal(templateResult.strict, false);
  await assert.rejects(
    execFileAsync(process.execPath, [desktopVerificationCheckPath, "--strict"], {
      cwd: projectRoot
    }),
    (error) => {
      const result = JSON.parse(error.stdout);
      assert.equal(result.ok, false);
      assert.equal(result.strict, true);
      assert.ok(result.failures.some((failure) => failure.code === "webview2_not_confirmed"));
      assert.ok(result.failures.some((failure) => failure.code === "node_version_required"));
      assert.ok(result.failures.some((failure) => failure.code === "startup_not_pass"));
      assert.ok(result.failures.some((failure) => failure.code === "desktop_diagnostics_node_not_available"));
      assert.ok(result.failures.some((failure) => failure.code === "desktop_diagnostics_runtime_paths_not_visible"));
      assert.ok(result.failures.some((failure) => failure.code === "desktop_diagnostics_session_logs_not_visible"));
      assert.ok(result.failures.some((failure) => failure.code === "result_tester_required"));
      assert.ok(result.nextActions.some((action) => action.includes("WebView2")));
      assert.ok(result.nextActions.some((action) => action.includes("Node.js version")));
      assert.ok(result.nextActions.some((action) => action.includes("Desktop app")));
      assert.ok(result.nextActions.some((action) => action.includes("result.tester")));
      return true;
    }
  );
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-desktop-record-"));
  const recordPath = path.join(workspace, "desktop-verification-record.json");
  const artifactsResult = await execFileAsync(process.execPath, [releaseArtifactsPath], { cwd: projectRoot });
  const artifactsManifest = JSON.parse(artifactsResult.stdout);
  const appArtifact = artifactsManifest.artifacts.find((a) => a.path.endsWith("app.exe"));
  const actualHash = appArtifact?.sha256 || "95881102234c4bd0345b6d3ac39e89e1f9ae0bf89ea80e93d4e42786bd59a58d";
  const actualBytes = appArtifact?.bytes || 8725504;
  await writeFile(recordPath, JSON.stringify(desktopVerificationPassRecord({ bytes: actualBytes, sha256: actualHash }), null, 2));
  const strict = await execFileAsync(process.execPath, [desktopVerificationCheckPath, "--strict", recordPath], {
    cwd: projectRoot
  });
  const strictResult = JSON.parse(strict.stdout);
  assert.equal(strictResult.ok, true);
  assert.equal(strictResult.strict, true);
});
test("desktop-fixture-close only closes F-012 from a strict desktop verification record", async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-fixture-close-"));
  const fixtureResultsPath = path.join(projectRoot, "samples", "fixture-results.json");
  const outputResultsPath = path.join(workspace, "fixture-results.closed.json");
  const recordPath = path.join(workspace, "desktop-verification-record.json");
  const artifactsResult = await execFileAsync(process.execPath, [releaseArtifactsPath], { cwd: projectRoot });
  const artifactsManifest = JSON.parse(artifactsResult.stdout);
  const appArtifact = artifactsManifest.artifacts.find((a) => a.path.endsWith("app.exe"));
  if (!appArtifact?.exists || !appArtifact.sha256) {
    t.skip("desktop release artifact has not been built");
    return;
  }
  const actualHash = appArtifact.sha256;
  const actualBytes = appArtifact.bytes;
  await writeFile(recordPath, JSON.stringify(desktopVerificationPassRecord({ bytes: actualBytes, sha256: actualHash }), null, 2));
  await assert.rejects(
    execFileAsync(process.execPath, [
      desktopFixtureClosePath,
      "--record",
      path.join(projectRoot, "samples", "desktop-verification-record.template.json"),
      "--results",
      fixtureResultsPath
    ], {
      cwd: projectRoot
    }),
    (error) => {
      const result = JSON.parse(error.stdout);
      assert.equal(result.ok, false);
      assert.equal(result.updated, false);
      assert.equal(result.strictCheck.ok, false);
      return true;
    }
  );
  const dryRun = await execFileAsync(process.execPath, [
    desktopFixtureClosePath,
    "--record",
    recordPath,
    "--results",
    fixtureResultsPath
  ], {
    cwd: projectRoot
  });
  const dryRunResult = JSON.parse(dryRun.stdout);
  assert.equal(dryRunResult.ok, true);
  assert.equal(dryRunResult.dryRun, true);
  assert.equal(dryRunResult.updated, false);
  assert.equal(dryRunResult.artifactCheck.ok, true);
  assert.equal(dryRunResult.artifactCheck.matchedArtifact.sha256, actualHash);
  assert.match(dryRunResult.recordSha256, /^[a-f0-9]{64}$/);
  assert.equal(dryRunResult.f012.status, "pass");
  assert.match(dryRunResult.f012.notes, /recordSha256=[a-f0-9]{64}/);
  const written = await execFileAsync(process.execPath, [
    desktopFixtureClosePath,
    "--record",
    recordPath,
    "--results",
    fixtureResultsPath,
    "--out",
    outputResultsPath
  ], {
    cwd: projectRoot
  });
  const writtenResult = JSON.parse(written.stdout);
  assert.equal(writtenResult.ok, true);
  assert.equal(writtenResult.updated, true);
  assert.match(writtenResult.recordSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(writtenResult.statusCounts, { pass: 11, known_limit: 1 });
  const closedResults = JSON.parse(await readFile(outputResultsPath, "utf8"));
  const closedF012 = closedResults.results.find((item) => item.id === "F-012");
  assert.equal(closedF012.status, "pass");
  assert.match(closedF012.evidence, /desktop verification record passed strict check/);
  assert.match(closedF012.notes, /tester=automated-test/);
  assert.match(closedF012.notes, /recordSha256=[a-f0-9]{64}/);
  const wrongArtifactRecordPath = path.join(workspace, "desktop-verification-record.wrong-artifact.json");
  const wrongArtifactRecord = JSON.parse(await readFile(recordPath, "utf8"));
  wrongArtifactRecord.artifact.sha256 = "0".repeat(64);
  await writeFile(wrongArtifactRecordPath, JSON.stringify(wrongArtifactRecord, null, 2));
  await assert.rejects(
    execFileAsync(process.execPath, [
      desktopFixtureClosePath,
      "--record",
      wrongArtifactRecordPath,
      "--results",
      fixtureResultsPath
    ], {
      cwd: projectRoot
    }),
    (error) => {
      const result = JSON.parse(error.stdout);
      assert.equal(result.ok, false);
      assert.equal(result.updated, false);
      assert.equal(result.strictCheck.ok, false);
      assert.equal(result.strictCheck.failures[0].code, "artifact_hash_mismatch");
      return true;
    }
  );
});
