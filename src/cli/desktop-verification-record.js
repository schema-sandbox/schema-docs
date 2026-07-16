import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildReleaseArtifactManifest } from "./release-artifacts.js";

const root = path.resolve(import.meta.dirname, "../..");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function readJsonArg(name) {
  const value = argValue(name);
  if (!value) {
    return null;
  }
  return JSON.parse(await readFile(path.resolve(root, value), "utf8"));
}

function artifactKind(artifactPath) {
  if (artifactPath.endsWith(".msi")) return "msi";
  if (artifactPath.endsWith("-setup.exe")) return "nsis";
  if (artifactPath.endsWith("app.exe")) return "app.exe";
  return "";
}

function firstExistingArtifact(artifacts) {
  return artifacts.find((artifact) => artifact.exists && artifact.path.endsWith("app.exe"))
    ?? artifacts.find((artifact) => artifact.exists)
    ?? artifacts[0];
}

export async function buildDesktopVerificationRecord(options = {}) {
  const artifactManifest = await buildReleaseArtifactManifest();
  const artifact = firstExistingArtifact(artifactManifest.artifacts);
  const appSmoke = options.appSmoke ?? null;
  const workflowSmoke = options.workflowSmoke ?? null;
  const bridgeSmoke = options.bridgeSmoke ?? null;
  const workflow = workflowSmoke?.workflow ?? {};
  const sendGateOk = Boolean(workflow.aiPreviewOk && workflow.aiSensitivePreviewOk && workflow.aiBlockedSendOk);

  return {
    releaseTarget: "v0.1.0",
    recordType: "desktop-verification",
    artifact: {
      path: artifact?.path ?? "",
      kind: artifactKind(artifact?.path ?? ""),
      bytes: artifact?.bytes ?? 0,
      sha256: artifact?.sha256 ?? ""
    },
    environment: {
      windowsVersion: process.platform === "win32" ? `${os.type()} ${os.release()}` : "",
      webView2Present: "unknown",
      nodeVersion: process.version,
      machineProfile: "developer"
    },
    startup: {
      status: appSmoke?.ok ? "pass" : "not_run",
      startupTimeMs: 0,
      windowTitle: appSmoke?.ok ? "Schema Docs" : "",
      apiBaseUrl: appSmoke?.runtime?.baseUrl ?? workflowSmoke?.runtime?.baseUrl ?? "",
      runtimeHealthOk: Boolean(appSmoke?.runtime?.health?.ok ?? workflowSmoke?.runtime?.health?.ok),
      smartscreenOrAvInterruption: "",
      notes: appSmoke ? `desktop:app-smoke cleanup=${JSON.stringify(appSmoke.cleanup ?? {})}` : ""
    },
    visibleUi: {
      desktopDiagnostics: {
        status: "not_run",
        nodeAvailable: false,
        apiHealthOk: false,
        runtimePathsVisible: false,
        sessionLogsVisible: false,
        notes: "Fill after clicking Desktop UI diagnostics."
      },
      firstWorkflow: {
        status: "not_run",
        readBackValid: false,
        notes: "Fill after clicking the visible first-workflow button."
      },
      workspacePicker: {
        status: "not_run",
        pathFilled: false,
        workspaceOpened: false,
        notes: "Fill after using the native workspace folder picker."
      },
      filePicker: {
        status: "not_run",
        pathFilled: false,
        importSucceeded: false,
        notes: "Fill after using the native supported-file picker."
      }
    },
    automatedEvidence: {
      desktopAppSmokeOk: Boolean(appSmoke?.ok),
      desktopWorkflowSmokeOk: Boolean(workflowSmoke?.ok),
      desktopBridgeSmokeOk: Boolean(bridgeSmoke?.ok),
      releaseArtifactsRecorded: Boolean(artifact?.exists && artifact?.sha256),
      notes: "Generated from release artifacts and optional smoke JSON outputs."
    },
    sendGate: {
      status: sendGateOk ? "pass" : "not_run",
      ordinaryPreviewDecision: workflow.aiPreviewOk ? "selected_context_preview" : "",
      sensitivePreviewDecision: workflow.aiSensitivePreviewOk ? "review_recommended" : "",
      credentialSendBlocked: Boolean(workflow.aiBlockedSendOk),
      apiKeyNotPersisted: sendGateOk,
      notes: workflowSmoke ? "Derived from desktop:workflow-smoke AI Send Gate checks." : ""
    },
    result: {
      status: "not_run",
      tester: "",
      testedAt: new Date().toISOString(),
      notes: "Generated partial record. Fill visible UI fields, environment details, and final result before strict check."
    }
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const record = await buildDesktopVerificationRecord({
    appSmoke: await readJsonArg("--app-smoke-json"),
    workflowSmoke: await readJsonArg("--workflow-smoke-json"),
    bridgeSmoke: await readJsonArg("--bridge-smoke-json")
  });
  const outputPath = argValue("--out");
  if (outputPath) {
    const resolvedOutputPath = path.resolve(root, outputPath);
    await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
    await writeFile(resolvedOutputPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({
      ok: true,
      releaseTarget: record.releaseTarget,
      recordPath: resolvedOutputPath,
      generated: {
        artifactRecorded: Boolean(record.artifact.sha256),
        automatedEvidenceRecorded: record.automatedEvidence.desktopAppSmokeOk
          || record.automatedEvidence.desktopWorkflowSmokeOk
          || record.automatedEvidence.desktopBridgeSmokeOk,
        sendGateRecorded: record.sendGate.status === "pass"
      }
    }, null, 2));
  } else {
    console.log(JSON.stringify(record, null, 2));
  }
}
