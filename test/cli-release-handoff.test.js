import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import {
  execFileAsync,
  fixtureCheckPath,
  fixtureSmokePath,
  privateBetaPackagePath,
  projectRoot,
  rcCheckPath,
  releaseArtifactsIndexPath,
  releaseArtifactsPath,
  releaseReadinessPath
} from "./helpers/cliHarness.js";
import { buildPublicPreviewReleasePlan } from "../src/cli/public-preview-release.js";
const publicPreviewReleasePath = path.join(projectRoot, "src", "cli", "public-preview-release.js");
function assertExpectedSubset(actual, expected, label = "expected") {
  if (Array.isArray(expected)) {
    assert.deepEqual(actual, expected, label);
    return;
  }
  if (expected && typeof expected === "object") {
    if (expected.includes) {
      for (const value of expected.includes) {
        assert.ok(actual.includes(value), `${label} includes ${value}`);
      }
      return;
    }
    for (const [key, value] of Object.entries(expected)) {
      assertExpectedSubset(actual?.[key], value, `${label}.${key}`);
    }
    return;
  }
  assert.equal(actual, expected, label);
}
function assertAnyIncludes(actual, values, label = "items") {
  for (const value of values) {
    assert.ok(actual.some((item) => item.includes(value)), `${label} includes ${value}`);
  }
}
function assertArtifact(result, predicate) {
  assert.ok(result.artifacts.some(predicate));
}
function assertNamedChecksOk(checks, names) {
  const byName = new Map(checks.map((check) => [check.name, check]));
  for (const name of names) {
    assert.equal(byName.get(name)?.ok, true, name);
  }
}
test("public preview release plan wraps the required handoff commands", () => {
  const plan = buildPublicPreviewReleasePlan();
  assert.equal(plan.mode, "public-preview");
  assert.deepEqual(plan.steps.map((step) => step.id), [
    "rc-preflight",
    "artifact-manifest",
    "artifact-index",
    "installer-handoff"
  ]);
  assert.deepEqual(plan.steps[0].args, ["--mode", "public-preview"]);
  assert.equal(plan.steps[1].script, "release-artifacts");
  assert.deepEqual(plan.steps[2].args, ["--mode", "public-preview"]);
  assert.deepEqual(plan.steps[3].args, [
    "--json",
    "--out",
    "samples/public-preview-package.json",
    "--markdown",
    "docs/public-preview-package.md"
  ]);
});
test("public preview release dry run prints commands without running checks", async () => {
  const result = await runCliJson(publicPreviewReleasePath, ["--dry-run", "--json"]);
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.commands, [
    "npm run rc-check -- --mode public-preview",
    "npm run release-artifacts",
    "npm run release-index -- --mode public-preview",
    "npm run public-preview-package -- --json --out samples/public-preview-package.json --markdown docs/public-preview-package.md"
  ]);
});
async function runCliJson(scriptPath, args = [], options = {}) {
  const { stdout } = await execFileAsync(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    ...options
  });
  return JSON.parse(stdout);
}
async function runCliRejectJson(scriptPath, args = [], options = {}) {
  try {
    await execFileAsync(process.execPath, [scriptPath, ...args], {
      cwd: projectRoot,
      ...options
    });
  } catch (error) {
    return JSON.parse(error.stdout);
  }
  throw new Error(`Expected ${path.basename(scriptPath)} to fail.`);
}
function writeJson(filePath, value) {
  return writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}
async function writeBlockedF012Results(filePath) {
  const resultsContent = JSON.parse(await readFile(path.join(projectRoot, "samples/fixture-results.json"), "utf8"));
  resultsContent.results = resultsContent.results.map((result) => (
    result.id === "F-012" ? { ...result, status: "blocked", evidence: "Pending verification" } : result
  ));
  resultsContent.statusCounts = { pass: 10, known_limit: 1, blocked: 1 };
  await writeJson(filePath, resultsContent);
}
test("release-artifacts reports build artifact checksums when present", async () => {
  const result = await runCliJson(releaseArtifactsPath);
  assert.equal(result.releaseTarget, "v0.1.2");
  assert.equal(result.generatedBy, "npm run release-artifacts");
  assert.equal(result.artifacts.length, 4);
  assertArtifact(result, (artifact) => artifact.path.endsWith("app.exe"));
  assertArtifact(result, (artifact) => artifact.path.endsWith("schema-docs_0.1.2_x64-portable.zip"));
  for (const artifact of result.artifacts) {
    if (artifact.exists) {
      assert.equal(typeof artifact.bytes, "number");
      assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    }
  }
});
test("release-index writes tester handoff artifact index", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "schema-docs-release-index-"));
  const jsonPath = path.join(outDir, "nested", "release-artifact-index.json");
  const markdownPath = path.join(outDir, "nested", "release-artifact-index.md");
  const result = await runCliJson(releaseArtifactsIndexPath, ["--out", jsonPath, "--markdown", markdownPath, "--json"]);
  assert.equal(result.targetVersion, "v0.1.2");
  assert.equal(result.generatedBy, "npm run release-index");
  assert.equal(result.releaseMode, "public-preview");
  assert.equal(result.artifacts.length, 4);
  assertArtifact(result, (artifact) => artifact.name.endsWith("-setup.exe"));
  assertArtifact(result, (artifact) => (
    artifact.name.endsWith("-portable.zip")
    && artifact.recommendedAudience === "Portable Windows package / no-install tester"
  ));
  assertExpectedSubset(result, {
    commands: { includes: ["npm run release-index", "npm run public-preview-package -- --json", "npm run doctor"] },
    releaseReadiness: { desktopGate: { requiredEvidence: { includes: ["strict desktop verification record"] } } }
  });
  assertAnyIncludes(result.commands, ["desktop-verification-fill"], "commands");
  const writtenJson = JSON.parse(await readFile(jsonPath, "utf8"));
  assert.equal(writtenJson.generatedBy, "npm run release-index");
  const writtenMarkdown = await readFile(markdownPath, "utf8");
  assert.match(writtenMarkdown, /Release Artifact Index/);
  assert.match(writtenMarkdown, /Desktop Artifacts/);
  assert.match(writtenMarkdown, /Verification Commands/);
  assert.match(writtenMarkdown, /public-preview-package -- --json/);
  assert.match(writtenMarkdown, /desktop-fixture-close/);
});
test("rc-check json output is archive-ready", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-rc-check-"));
  const tempResultsPath = path.join(workspace, "fixture-results.json");
  await writeBlockedF012Results(tempResultsPath);
  const result = await runCliJson(rcCheckPath, ["--json", "--results", tempResultsPath]);
  assert.equal(result.ok, false);
  assert.equal(result.releaseTarget, "v0.1.2");
  assert.equal(result.releaseMode, "public-preview");
  assert.match(result.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assertExpectedSubset(result, {
    commands: {
      tests: "npm test",
      releaseCheck: "npm run release-check",
      fixtureStrict: `npm run fixture-check -- --strict --results ${tempResultsPath}`,
      readiness: `npm run release-readiness -- --mode public-preview --results ${tempResultsPath}`,
      betaCheck: `npm run beta-check -- --mode public-preview --json --results ${tempResultsPath}`
    },
    checks: {
      tests: { ok: true },
      releaseCheck: { ok: true },
      fixtureStrict: { ok: false },
      readiness: { ok: false },
      betaCheck: { ok: false }
    }
  });
  await rm(workspace, { recursive: true, force: true });
});
test("private-beta-package summarizes tester-ready installer handoff", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "schema-docs-private-beta-"));
  const jsonPath = path.join(outDir, "private-beta-package.json");
  const markdownPath = path.join(outDir, "private-beta-package.md");
  const tempResultsPath = path.join(outDir, "fixture-results.json");
  await writeBlockedF012Results(tempResultsPath);
  const result = await runCliRejectJson(privateBetaPackagePath, ["--json", "--out", jsonPath, "--markdown", markdownPath, "--results", tempResultsPath]);
  assert.equal(result.releaseTarget, "v0.1.2");
  assert.equal(result.generatedBy, "npm run private-beta-package");
  assert.equal(result.releaseMode, "private-beta");
  assert.equal(result.decision.recommendedAudience, result.decision.ready ? "private-beta-testers" : "internal-only");
  assertArtifact(result, (artifact) => artifact.role === "primary-private-beta-installer" && artifact.path.endsWith("-setup.exe"));
  assertArtifact(result, (artifact) => artifact.role === "portable-windows-package" && artifact.path.endsWith("-portable.zip"));
  assertExpectedSubset(result, {
    commands: { includes: ["npm run beta-check -- --mode private-beta --json", "npm run doctor", "npm run desktop:ai-summon-smoke"] }
  });
  assert.equal(result.releaseReadiness.automaticChecksPassed, true);
  const writtenJson = JSON.parse(await readFile(jsonPath, "utf8"));
  assert.equal(writtenJson.generatedBy, "npm run private-beta-package");
  const writtenMarkdown = await readFile(markdownPath, "utf8");
  assert.match(writtenMarkdown, /Private Beta Package Report/);
  assert.match(writtenMarkdown, /primary-private-beta-installer/);
  assert.match(writtenMarkdown, /Verification Commands/);
  await rm(outDir, { recursive: true, force: true });
});
test("public-preview-package summarizes public installer handoff", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "schema-docs-public-preview-"));
  const jsonPath = path.join(outDir, "public-preview-package.json");
  const markdownPath = path.join(outDir, "public-preview-package.md");
  const tempResultsPath = path.join(outDir, "fixture-results.json");
  await writeBlockedF012Results(tempResultsPath);
  const result = await runCliRejectJson(privateBetaPackagePath, ["--mode", "public-preview", "--json", "--out", jsonPath, "--markdown", markdownPath, "--results", tempResultsPath]);
  assert.equal(result.releaseTarget, "v0.1.2");
  assert.equal(result.generatedBy, "npm run public-preview-package");
  assert.equal(result.releaseMode, "public-preview");
  assert.equal(result.decision.recommendedAudience, result.decision.ready ? "public-preview-testers" : "internal-only");
  assertArtifact(result, (artifact) => artifact.role === "primary-public-preview-installer" && artifact.path.endsWith("-setup.exe"));
  assertArtifact(result, (artifact) => artifact.role === "portable-windows-package" && artifact.path.endsWith("-portable.zip"));
  assertExpectedSubset(result, {
    commands: { includes: ["npm run rc-check -- --mode public-preview", "npm run beta-check -- --mode public-preview --json", "npm run doctor"] }
  });
  assert.equal(result.releaseReadiness.automaticChecksPassed, true);
  const writtenJson = JSON.parse(await readFile(jsonPath, "utf8"));
  assert.equal(writtenJson.generatedBy, "npm run public-preview-package");
  const writtenMarkdown = await readFile(markdownPath, "utf8");
  assert.match(writtenMarkdown, /Public Preview Package Report/);
  assert.match(writtenMarkdown, /primary-public-preview-installer/);
  assert.match(writtenMarkdown, /Verification Commands/);
  await rm(outDir, { recursive: true, force: true });
});
test("package report keeps unsupported release modes out of tester handoff roles", async () => {
  const result = await runCliRejectJson(privateBetaPackagePath, ["--mode", "publc-preview"]);
  assert.equal(result.generatedBy, "npm run private-beta-package");
  assert.equal(result.releaseMode, "publc-preview");
  assert.equal(result.decision.ready, false);
  assert.equal(result.decision.recommendedAudience, "internal-only");
  assert.equal(result.decision.primaryInstallerPath, "");
  assert.ok(result.decision.blockers.some((blocker) => blocker.includes("release_mode: Unsupported release mode")));
  assertArtifact(result, (artifact) => artifact.role === "unsupported-mode-installer" && artifact.path.endsWith("-setup.exe"));
});
test("fixture-check validates sample plan structure and coverage", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-fixture-check-plan-"));
  const tempResultsPath = path.join(workspace, "fixture-results.json");
  await writeBlockedF012Results(tempResultsPath);
  const { stdout } = await execFileAsync(process.execPath, [fixtureCheckPath, "--results", tempResultsPath], {
    cwd: projectRoot
  });
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  assert.equal(result.strict, false);
  assert.equal(result.workflowCount, 12);
  assert.deepEqual(result.statusCounts, { pass: 10, known_limit: 1, blocked: 1 });
  assert.equal(result.resultCount, 12);
  assert.deepEqual(result.requiredCoverage, ["docx", "pdf", "md", "csv", "xlsx", "api", "desktop"]);
  assert.deepEqual(result.resultAudit, { alignedWithPlan: true, evidenceReady: true });
  assert.deepEqual(result.failures, []);
  await rm(workspace, { recursive: true, force: true });
});
test("fixture-smoke can write generated results outside tracked samples", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-fixture-smoke-out-"));
  const resultsPath = path.join(workspace, "nested", "fixture-results.json");
  const { stdout } = await execFileAsync(process.execPath, [fixtureSmokePath, "--out", resultsPath], {
    cwd: projectRoot,
    maxBuffer: 16 * 1024 * 1024
  });
  const result = JSON.parse(stdout);
  const written = JSON.parse(await readFile(resultsPath, "utf8"));
  assert.equal(result.outputPath, resultsPath);
  assert.equal(written.generatedBy, "npm run fixture-smoke");
  assert.equal(written.results.length, 12);
  const check = await execFileAsync(process.execPath, [fixtureCheckPath, "--results", resultsPath], {
    cwd: projectRoot
  });
  assert.equal(JSON.parse(check.stdout).ok, true);
});
test("fixture-smoke reports F-012 blocked when no current desktop verification exists", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-fixture-smoke-stale-"));
  const tempResultsPath = path.join(workspace, "fixture-results.input.json");
  await writeBlockedF012Results(tempResultsPath);
  const resultsPath = path.join(workspace, "fixture-results.json");
  const { stdout } = await execFileAsync(process.execPath, [fixtureSmokePath, "--out", resultsPath, "--results", tempResultsPath], {
    cwd: projectRoot,
    maxBuffer: 16 * 1024 * 1024
  });
  const result = JSON.parse(stdout);
  const f012 = result.results.find((item) => item.id === "F-012");
  assert.equal(f012.status, "blocked");
  assert.match(f012.notes, /(does not match the current release artifacts|No previously closed F-012 result is available)/);
  const strict = await execFileAsync(process.execPath, [fixtureCheckPath, "--results", resultsPath, "--strict", "--json"], {
    cwd: projectRoot
  }).catch((error) => error);
  assert.notEqual(strict.code, 0);
  const strictResult = JSON.parse(strict.stdout);
  assert.equal(strictResult.ok, false);
  assert.equal(strictResult.failures[0].code, "workflow_not_release_ready");
  assert.equal(strictResult.failures[0].detail.id, "F-012");
  await rm(workspace, { recursive: true, force: true });
});
test("fixture-check validates result evidence and plan/result alignment", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-fixture-check-"));
  const planPath = path.join(workspace, "fixture-plan.json");
  const resultsPath = path.join(workspace, "fixture-results.json");
  await writeJson(planPath, {
    releaseTarget: "v0.1.2",
    policy: {
      allowSensitiveFiles: false,
      minimumWorkflowCount: 1,
      requiredCoverage: ["docx"]
    },
    workflows: [
      {
        id: "F-A",
        coverage: ["docx"],
        input: "synthetic/a.docx",
        workflow: "DOCX -> Markdown",
        path: "CLI",
        expected: "text extracted",
        status: "planned"
      },
      {
        id: "F-B",
        coverage: ["docx"],
        input: "synthetic/b.docx",
        workflow: "DOCX -> Markdown",
        path: "CLI",
        expected: "text extracted",
        status: "planned"
      }
    ]
  });
  await writeJson(resultsPath, {
    releaseTarget: "v0.1.2",
    results: [
      {
        id: "F-A",
        status: "known_limit",
        evidence: "synthetic document exercised",
        notes: ""
      },
      {
        id: "F-X",
        status: "pass",
        evidence: "unknown workflow should fail",
        notes: ""
      }
    ]
  });
  await assert.rejects(
    execFileAsync(process.execPath, [fixtureCheckPath, "--plan", planPath, "--results", resultsPath], {
      cwd: projectRoot
    }),
    (error) => {
      const result = JSON.parse(error.stdout);
      assert.equal(result.ok, false);
      assert.ok(result.failures.some((failure) => failure.code === "missing_result_for_workflow" && failure.detail === "F-B"));
      assert.ok(result.failures.some((failure) => failure.code === "result_without_workflow" && failure.detail === "F-X"));
      assert.ok(result.failures.some((failure) => failure.code === "result_missing_notes" && failure.detail.id === "F-A"));
      return true;
    }
  );
});
test("release-check validates desktop runtime bridge and current size budget", async () => {
  const releaseCheckPath = path.join(projectRoot, "src", "cli", "release-check.js");
  const result = await runCliJson(releaseCheckPath, []);
  const byName = new Map(result.checks.map((check) => [check.name, check]));
  const getCheck = (name) => byName.get(name);
  const expectedFields = {
    desktop_runtime_bridge_present: {
      releaseAutoStart: "spawn_desktop_runtime",
      bundledNodeResource: "runtime/node.exe",
      writableSessionEnv: "SCHEMA_DOCS_RUNTIME_SESSION_DIR"
    },
    desktop_native_pickers_present: {
      workspaceCommand: "select_workspace_path",
      importFileCommand: "select_import_file_path",
      markdownFileCommand: "select_markdown_file_path",
      uiControls: ["chooseWorkspace", "dropZone", "fileInput"],
      importFormats: ["docx", "pptx", "pdf", "txt", "csv", "xlsx", "xls"],
      openFormats: ["md", "markdown"]
    },
    visible_first_workflow_present: {
      uiControl: "runFirstWorkflow",
      verifies: ["temporary workspace", "Markdown DOCX/PDF export", "sample DOCX import/extract", "exchange package read-back", "receiver report write"]
    },
    workspace_exchange_package_overview_present: {
      uiSurface: "workspace manifest summary",
      reports: ["exchange package count", "receiver report count", "trust report count", "AI context selection count", "AI handoff bundle count"],
      actions: ["view trust report", "write receiver report"]
    },
    desktop_runtime_diagnostics_present: {
      uiControl: "desktopDiagnostics",
      reports: ["node availability", "runtime resource paths", "session log paths", "api health"]
    },
    desktop_ai_summon_bridge_present: {
      command: "summon_ai_gate",
      event: "schema-docs-ai-summon",
      shortcut: "Ctrl+Alt+A",
      scope: "desktop-window",
      behavior: "focus main window, locally mask clipboard text, and open source-aware AI Send Gate without staging raw clipboard fallback",
      smoke: "desktop:ai-summon-smoke"
    },
    large_ai_intake_check_present: {
      script: "large-intake-check",
      verifies: { includes: ["content-free intake manifest", "range content pulled only on demand"] }
    },
    language_boundary_check_present: {
      script: "language-boundary-check",
      verifies: { includes: ["default runtime English boundary", "mojibake guard"] }
    },
    doctor_cli_present: {
      script: "doctor",
      outputStyle: "ASCII status labels",
      verifies: { includes: ["optional adapter capabilities"] }
    },
    open_core_policy_boundary_present: {
      modes: ["open-core", "team", "enterprise"],
      openCoreFree: true,
      enterpriseHooks: { includes: ["dlp_policy_packs"] }
    },
    optional_adapter_capabilities_present: {
      adapters: ["soffice", "pandoc", "tesseract"],
      surfaces: ["doctor", "local-api", "sdk", "cli", "web-ui"]
    },
    release_docs_text_integrity: {
      docs: ["README.md", "docs/desktop-verification-protocol.md", "docs/release-checklist.md", "docs/sample-fixture-checklist.md", "docs/v0.1.0-release-plan.md", "docs/v0.1.0-release-notes.md"],
      requiredDesktopLabels: ["Desktop diagnostics", "Run first workflow", "Choose workspace", "Choose local file", "Create temporary workspace", "Create sample Word and import"],
      publicPreviewPackageCommand: "npm run public-preview-package -- --json",
      runtimeDiagnosticExpectation: "bundled runtime/node.exe or system node fallback",
      desktopFixtureCloseWriteCommand: "npm run desktop-fixture-close -- --record <filled-record.json> --write",
      forbiddenMojibakeFragments: { includes: ["U+951F", "U+9983"] }
    },
    core_smoke_receiver_report_present: {
      script: "smoke",
      verifies: ["exchange package read-back", "receiver report write", "trust report write"],
      failsOnBrokenChecks: true
    },
    release_artifact_manifest_present: {
      reports: ["path", "exists", "bytes", "sha256"]
    },
    windows_release_checksums_current: {
      file: "release/windows/SHA256SUMS.txt",
      requiredAssets: [
        "schema-docs_0.1.2_x64_en-US.msi",
        "schema-docs_0.1.2_x64-setup.exe",
        "schema-docs_0.1.2_x64-portable.zip"
      ],
      format: "<64 lowercase hexadecimal SHA-256>  <artifact basename>",
      policy: {
        includes: [
          "zero present release assets is valid for a clean source checkout",
          "if any release asset exists, all three release assets must exist",
          "each required basename must have exactly one matching checksum entry",
          "malformed lines, duplicate basenames, and mismatched hashes fail"
        ]
      }
    },
    release_package_handoff_present: {
      scripts: ["public-preview-package", "private-beta-package"],
      commands: { includes: ["npm run doctor", "npm run rc-check -- --mode <mode>"] }
    },
    manual_gate_release_commands_current: {
      commands: { includes: ["npm run release-check", "npm run release-index", "npm run public-preview-package -- --json", "npm run rc-check -- --mode public-preview"] }
    },
    beta_check_release_blocker_exit_present: {
      script: "beta-check",
      verifies: { includes: ["nonzero exit when not ready", "--write-report output directory creation"] }
    },
    release_readiness_present: {
      combines: ["release-check", "fixture-check --strict"],
      reports: ["readyForPublicTag", "blockingItems", "nextActions"],
      commands: ["release-check", "large-intake-check", "language-boundary-check", "doctor", "fixture-check --strict", "release-artifacts", "release-index", "public-preview-package -- --json", "desktop-release-preflight", "desktop-preflight-check", "desktop-verification-fill", "desktop-verification-check --strict", "desktop-fixture-close --write"],
      reportOnlyMode: "--report-only",
      writes: "--out <readiness.json>",
      desktopArtifactGate: "filled record artifact SHA-256 must match npm run release-artifacts before F-012 closure"
    },
    public_preview_sample_report_current: {
      sampleMinimum: 20,
      requiredCapabilities: ["ai_intake", "safety_gate", "format_exchange", "table_filter", "long_input", "external_refresh"],
      source: "samples/real-sample-results.json",
      report: "docs/public-preview-sample-report.md"
    },
    ui_text_integrity_check_present: {
      verifies: { includes: ["default English shell with bilingual toggle", "dynamic i18n panel binding"] }
    },
    web_ui_smoke_present: {
      verifies: { includes: ["served bilingual i18n panel", "served text mojibake guard"] }
    }
  };
  assert.equal(result.automaticChecksPassed, true);
  assert.equal(getCheck("current_size_budget").ok, true);
  for (const name of Object.keys(expectedFields)) {
    assert.equal(getCheck(name)?.ok, true, name);
  }
  assertNamedChecksOk(result.checks, [
    "required_scripts_present",
    "rc_preflight_present",
    "release_docs_npm_scripts_exist",
    "manual_gate_npm_scripts_exist",
    "sample_fixture_plan_ready",
    "sample_fixture_results_ready"
  ]);
  for (const [name, expected] of Object.entries(expectedFields)) {
    assertExpectedSubset(getCheck(name).expected, expected, name);
  }
  const requiredScriptsCheck = getCheck("required_scripts_present");
  const windowsReleaseChecksumCheck = getCheck("windows_release_checksums_current");
  const rcPreflightCheck = getCheck("rc_preflight_present");
  const docsScriptsCheck = getCheck("release_docs_npm_scripts_exist");
  const manualGateScriptsCheck = getCheck("manual_gate_npm_scripts_exist");
  assertExpectedSubset(requiredScriptsCheck, { scripts: { includes: ["public-preview-package", "beta-check"] } });
  assert.equal(windowsReleaseChecksumCheck.actual.checksumFile, "release/windows/SHA256SUMS.txt");
  assert.equal(windowsReleaseChecksumCheck.actual.requiredArtifactCount, 3);
  assert.ok([
    "source-checkout-without-release-assets",
    "release-assets-present"
  ].includes(windowsReleaseChecksumCheck.actual.mode));
  assertExpectedSubset(rcPreflightCheck, { expected: { verifies: { includes: ["beta-check --mode <mode> --json", "public-preview-package -- --json installer handoff", "JSON report metadata for release archive"] } } });
  assert.deepEqual(docsScriptsCheck.actual.missingScripts, []);
  assert.ok(docsScriptsCheck.actual.documentedScriptCount >= 25);
  assert.deepEqual(manualGateScriptsCheck.actual.missingScripts, []);
  assert.ok(manualGateScriptsCheck.actual.documentedScriptCount >= 25);
  assertExpectedSubset(result, {
    manualGate: { includes: ["npm run release-check", "npm run release-index", "npm run public-preview-package -- --json", "npm run rc-check -- --mode public-preview"] }
  });
  const sampleFixturePlanCheck = getCheck("sample_fixture_plan_ready");
  assert.deepEqual(sampleFixturePlanCheck.expected.exchangePackageFixture, ["read-back verification", "receiver-report.md", "trust-report.json"]);
  const sampleReportCheck = getCheck("public_preview_sample_report_current");
  assert.equal(sampleReportCheck.actual.total, 20);
  assert.deepEqual(sampleReportCheck.actual.statusCounts, { pass: 9, known_limit: 10, fail: 0, blocked: 1 });
});
test("release-readiness summarizes current F-012 release blocker", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-readiness-"));
  const tempResultsPath = path.join(workspace, "fixture-results.json");
  await writeBlockedF012Results(tempResultsPath);
  const failedOutPath = path.join(workspace, "readiness.blocked.json");
  const reportOnlyOutPath = path.join(workspace, "readiness.report.json");
  const result = await runCliRejectJson(releaseReadinessPath, ["--out", failedOutPath, "--results", tempResultsPath]);
  assert.equal(result.releaseTarget, "v0.1.2");
  assert.equal(result.releaseMode, "public-preview");
  assert.equal(result.reportOnly, false);
  assert.equal(result.outPath, failedOutPath);
  assert.equal(result.readyForPublicTag, false);
  assert.equal(result.automaticChecksPassed, true);
  assert.equal(result.fixtureStrictPassed, false);
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.statusCounts, { pass: 10, known_limit: 1, blocked: 1 });
  assert.equal(result.blockingItems[0].id, "F-012");
  assert.equal(result.desktopGate.f012Status, "blocked");
  assertExpectedSubset(result, {
    desktopGate: { requiredEvidence: { includes: ["visible Desktop UI diagnostics", "release artifact SHA-256 match"] } },
    commands: { includes: ["npm run release-artifacts", "npm run public-preview-package -- --json"] }
  });
  assertAnyIncludes(result.commands, ["desktop-verification-fill"], "commands");
  assertAnyIncludes(result.nextActions, ["desktop-release-preflight", "desktop-preflight-check", "release-artifacts", "desktop-verification-check", "desktop-fixture-close"], "nextActions");
  assert.deepEqual(result.releaseCheck.failedChecks, []);
  assert.equal(result.fixtureStrict.failures[0].detail.id, "F-012");
  const failedOut = JSON.parse(await readFile(failedOutPath, "utf8"));
  assert.equal(failedOut.readyForPublicTag, false);
  assert.equal(failedOut.outPath, failedOutPath);
  const reportOnly = await execFileAsync(process.execPath, [releaseReadinessPath, "--report-only", "--out", reportOnlyOutPath, "--results", tempResultsPath], {
    cwd: projectRoot
  });
  const reportOnlyResult = JSON.parse(reportOnly.stdout);
  assert.equal(reportOnlyResult.reportOnly, true);
  assert.equal(reportOnlyResult.releaseMode, "public-preview");
  assert.equal(reportOnlyResult.outPath, reportOnlyOutPath);
  assert.equal(reportOnlyResult.readyForPublicTag, false);
  assert.equal(reportOnlyResult.blockingItems[0].id, "F-012");
  const reportOnlyOut = JSON.parse(await readFile(reportOnlyOutPath, "utf8"));
  assert.equal(reportOnlyOut.reportOnly, true);
  assert.equal(reportOnlyOut.blockingItems[0].id, "F-012");
});
test("release-readiness reports unsupported release modes clearly", async () => {
  const result = await runCliRejectJson(releaseReadinessPath, ["--mode", "publc-preview"]);
  assert.equal(result.releaseTarget, "v0.1.2");
  assert.equal(result.releaseMode, "publc-preview");
  assert.equal(result.readyForPublicTag, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.blockingItems[0].id, "release_mode");
  assert.equal(result.blockingItems[0].status, "unsupported");
  assert.match(result.blockingItems[0].reason, /Unsupported release mode "publc-preview"/);
  assertAnyIncludes(result.nextActions, ["--mode public-preview"], "nextActions");
});
