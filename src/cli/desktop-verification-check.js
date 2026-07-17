import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildReleaseArtifactManifest } from "./release-artifacts.js";

const root = path.resolve(import.meta.dirname, "../..");
const allowedStatuses = new Set(["pass", "fail", "blocked", "not_run"]);
const strict = process.argv.includes("--strict");
const recordArg = process.argv.find((arg) => arg.endsWith(".json"));
const recordPath = path.resolve(root, recordArg ?? "samples/desktop-verification-record.template.json");

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function statusOk(value) {
  return allowedStatuses.has(value);
}

function webView2Confirmed(value) {
  if (value === true) {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }
  return ["yes", "true", "present", "installed"].includes(value.trim().toLowerCase());
}

function fail(code, detail) {
  return { code, detail };
}

const nextActionByFailure = {
  artifact_path_required: "Run npm run desktop-verification-record -- --out <record.json> to prefill release artifact details.",
  artifact_sha256_required: "Run npm run release-artifacts and copy the SHA-256 for the tested app/MSI/NSIS artifact.",
  artifact_sha256_invalid: "Replace artifact.sha256 with a 64-character lowercase SHA-256 hash from npm run release-artifacts.",
  artifact_hash_mismatch: "Verify the artifact hash matches the currently built release artifacts from npm run release-artifacts.",
  windows_version_required: "Fill environment.windowsVersion from the target Windows machine.",
  webview2_not_confirmed: "Confirm WebView2 is present on the target Windows machine and set environment.webView2Present=yes.",
  node_version_required: "Record the Node.js version used by the current desktop runtime in environment.nodeVersion.",
  startup_not_pass: "Launch the packaged Desktop app and record startup.status=pass only after the window and local API are healthy.",
  runtime_health_not_ok: "Confirm /api/health from the packaged app runtime and set startup.runtimeHealthOk=true.",
  desktop_diagnostics_not_pass: "Click the Desktop UI diagnostics control and record a passing visibleUi.desktopDiagnostics result.",
  desktop_diagnostics_node_not_available: "Use the visible diagnostics result to confirm Node availability before setting nodeAvailable=true.",
  desktop_diagnostics_api_health_not_ok: "Use the visible diagnostics result to confirm API health before setting apiHealthOk=true.",
  desktop_diagnostics_runtime_paths_not_visible: "Use the visible diagnostics result to confirm runtime resource paths are visible before setting runtimePathsVisible=true.",
  desktop_diagnostics_session_logs_not_visible: "Use the visible diagnostics result to confirm session log paths are visible before setting sessionLogsVisible=true.",
  first_workflow_not_pass: "Click the visible first-workflow control and set visibleUi.firstWorkflow.status=pass only after it completes.",
  first_workflow_readback_not_valid: "Confirm the generated exchange package read-back is valid from the visible first workflow.",
  workspace_picker_not_pass: "Use the native workspace folder picker from the packaged Desktop UI.",
  workspace_picker_path_not_filled: "Confirm the native workspace picker fills the workspace path field.",
  workspace_picker_workspace_not_opened: "Confirm the picked workspace opens through the local API.",
  file_picker_not_pass: "Use the native file picker with a supported DOCX/PDF/MD/TXT/CSV/XLSX file.",
  file_picker_path_not_filled: "Confirm the native file picker fills the import path field.",
  file_picker_import_not_succeeded: "Confirm the selected file imports successfully through the local API.",
  desktop_app_smoke_not_ok: "Run npm run desktop:app-smoke and feed the saved JSON to desktop-verification-record with --app-smoke-json.",
  desktop_workflow_smoke_not_ok: "Run npm run desktop:workflow-smoke and feed the saved JSON to desktop-verification-record with --workflow-smoke-json.",
  desktop_bridge_smoke_not_ok: "Run npm run desktop:bridge-smoke and feed the saved JSON to desktop-verification-record with --bridge-smoke-json.",
  release_artifacts_not_recorded: "Run npm run release-artifacts or regenerate the record so automatedEvidence.releaseArtifactsRecorded=true.",
  send_gate_not_pass: "Use desktop workflow smoke evidence to verify AI Send Gate preview and blocking behavior.",
  credential_send_not_blocked: "Confirm credential-like confirmed send is blocked without a network request.",
  api_key_persisted_or_unverified: "Confirm API key material is not persisted in workspace, profile, or record outputs.",
  result_not_pass: "Set result.status=pass only after all visible UI and automated evidence checks pass.",
  result_tester_required: "Fill result.tester with the person or machine identity that performed the verification.",
  result_tested_at_required: "Fill result.testedAt with the verification timestamp."
};

function buildNextActions(failures) {
  return [...new Set(failures.map((failure) => nextActionByFailure[failure.code]).filter(Boolean))];
}

const record = JSON.parse(await readFile(recordPath, "utf8"));
const visibleUi = record.visibleUi ?? {};
const releaseArtifacts = await buildReleaseArtifactManifest();

const failures = [
  record.releaseTarget !== "v0.1.1" && fail("release_target_mismatch", record.releaseTarget),
  record.recordType !== "desktop-verification" && fail("record_type_mismatch", record.recordType),
  (!record.artifact || typeof record.artifact !== "object") && fail("artifact_missing", null),
  (!record.environment || typeof record.environment !== "object") && fail("environment_missing", null),
  (!record.startup || typeof record.startup !== "object") && fail("startup_missing", null),
  (!record.visibleUi || typeof record.visibleUi !== "object") && fail("visible_ui_missing", null),
  (!record.automatedEvidence || typeof record.automatedEvidence !== "object") && fail("automated_evidence_missing", null),
  (!record.sendGate || typeof record.sendGate !== "object") && fail("send_gate_missing", null),
  (!record.result || typeof record.result !== "object") && fail("result_missing", null),
  record.startup && !statusOk(record.startup.status) && fail("startup_status_invalid", record.startup.status),
  record.sendGate && !statusOk(record.sendGate.status) && fail("send_gate_status_invalid", record.sendGate.status),
  record.result && !statusOk(record.result.status) && fail("result_status_invalid", record.result.status),
  ...["desktopDiagnostics", "firstWorkflow", "workspacePicker", "filePicker"].flatMap((key) => {
    const item = visibleUi[key];
    if (!item) {
      return [fail("visible_ui_item_missing", key)];
    }
    if (!statusOk(item.status)) {
      return [fail("visible_ui_status_invalid", { key, status: item.status })];
    }
    return [];
  })
].filter(Boolean);

if (strict) {
  failures.push(...[
    !hasText(record.artifact?.path) && fail("artifact_path_required", null),
    !hasText(record.artifact?.sha256) && fail("artifact_sha256_required", null),
    !/^[a-f0-9]{64}$/.test(record.artifact?.sha256 ?? "") && fail("artifact_sha256_invalid", record.artifact?.sha256),
    (() => {
      const artifactSha256 = record.artifact?.sha256 ?? "";
      const exists = releaseArtifacts.artifacts.some((a) => a.exists);
      if (exists && artifactSha256) {
        const match = releaseArtifacts.artifacts.some((a) => a.exists && a.sha256 === artifactSha256);
        if (!match) {
          return fail("artifact_hash_mismatch", {
            recordHash: artifactSha256,
            releaseHashes: releaseArtifacts.artifacts.filter((a) => a.exists).map((a) => a.sha256)
          });
        }
      }
      return null;
    })(),
    !hasText(record.environment?.windowsVersion) && fail("windows_version_required", null),
    !webView2Confirmed(record.environment?.webView2Present) && fail("webview2_not_confirmed", record.environment?.webView2Present),
    !hasText(record.environment?.nodeVersion) && fail("node_version_required", null),
    record.startup?.status !== "pass" && fail("startup_not_pass", record.startup?.status),
    record.startup?.runtimeHealthOk !== true && fail("runtime_health_not_ok", null),
    visibleUi.desktopDiagnostics?.status !== "pass" && fail("desktop_diagnostics_not_pass", visibleUi.desktopDiagnostics?.status),
    visibleUi.desktopDiagnostics?.nodeAvailable !== true && fail("desktop_diagnostics_node_not_available", null),
    visibleUi.desktopDiagnostics?.apiHealthOk !== true && fail("desktop_diagnostics_api_health_not_ok", null),
    visibleUi.desktopDiagnostics?.runtimePathsVisible !== true && fail("desktop_diagnostics_runtime_paths_not_visible", null),
    visibleUi.desktopDiagnostics?.sessionLogsVisible !== true && fail("desktop_diagnostics_session_logs_not_visible", null),
    visibleUi.firstWorkflow?.status !== "pass" && fail("first_workflow_not_pass", visibleUi.firstWorkflow?.status),
    visibleUi.firstWorkflow?.readBackValid !== true && fail("first_workflow_readback_not_valid", null),
    visibleUi.workspacePicker?.status !== "pass" && fail("workspace_picker_not_pass", visibleUi.workspacePicker?.status),
    visibleUi.workspacePicker?.pathFilled !== true && fail("workspace_picker_path_not_filled", null),
    visibleUi.workspacePicker?.workspaceOpened !== true && fail("workspace_picker_workspace_not_opened", null),
    visibleUi.filePicker?.status !== "pass" && fail("file_picker_not_pass", visibleUi.filePicker?.status),
    visibleUi.filePicker?.pathFilled !== true && fail("file_picker_path_not_filled", null),
    visibleUi.filePicker?.importSucceeded !== true && fail("file_picker_import_not_succeeded", null),
    record.automatedEvidence?.desktopAppSmokeOk !== true && fail("desktop_app_smoke_not_ok", null),
    record.automatedEvidence?.desktopWorkflowSmokeOk !== true && fail("desktop_workflow_smoke_not_ok", null),
    record.automatedEvidence?.desktopBridgeSmokeOk !== true && fail("desktop_bridge_smoke_not_ok", null),
    record.automatedEvidence?.releaseArtifactsRecorded !== true && fail("release_artifacts_not_recorded", null),
    record.sendGate?.status !== "pass" && fail("send_gate_not_pass", record.sendGate?.status),
    record.sendGate?.credentialSendBlocked !== true && fail("credential_send_not_blocked", null),
    record.sendGate?.apiKeyNotPersisted !== true && fail("api_key_persisted_or_unverified", null),
    record.result?.status !== "pass" && fail("result_not_pass", record.result?.status),
    !hasText(record.result?.tester) && fail("result_tester_required", null),
    !hasText(record.result?.testedAt) && fail("result_tested_at_required", null)
  ].filter(Boolean));
}

const result = {
  releaseTarget: "v0.1.1",
  strict,
  ok: failures.length === 0,
  recordPath,
  failures,
  nextActions: strict && failures.length > 0 ? buildNextActions(failures) : []
};

function shouldOutputJson() {
  return process.argv.includes("--json") ||
         process.env.NODE_TEST_CONTEXT !== undefined ||
         process.env.NODE_ENV === "test";
}

if (shouldOutputJson()) {
  console.log(JSON.stringify(result, null, 2));
} else {
  if (result.ok) {
    console.log(`=== Desktop Verification Check: PASS ===`);
    console.log(`Verification record is valid.`);
  } else {
    console.log(`=== Desktop Verification Check: FAILED ===`);
    console.log(`Failing Checks:`);
    for (const failure of result.failures) {
      console.log(`- ${failure.code}: ${typeof failure.detail === 'object' ? JSON.stringify(failure.detail) : failure.detail}`);
    }
    if (result.nextActions.length > 0) {
      console.log(`\nNext Actions:`);
      for (const action of result.nextActions) {
        console.log(`- ${action}`);
      }
    }
  }
}

if (!result.ok) {
  process.exitCode = 1;
}
