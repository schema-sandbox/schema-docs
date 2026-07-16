import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { desktopHandoffLabels, expectedTestSummary, forbiddenDocFragments, requiredDocs, requiredScripts } from "./release-check-data.js";

const root = path.resolve(import.meta.dirname, "../..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function readOptionalJson(relativePath) {
  return fileExists(relativePath) ? readJson(relativePath) : null;
}

async function readText(relativePath) {
  return fileExists(relativePath) ? readFile(path.join(root, relativePath), "utf8") : "";
}

function fileExists(relativePath) {
  return existsSync(path.join(root, relativePath));
}

export async function loadReleaseCheckContext() {
  const packageJson = await readJson("package.json");
  const releaseArtifactsCli = await readText("src/cli/release-artifacts.js");
  const releaseArtifactsIndexCli = await readText("src/cli/release-artifacts-index.js");
  const privateBetaPackageCli = await readText("src/cli/private-beta-package.js");
  const betaCheckCli = await readText("src/cli/beta-check.js");
  const releaseReadinessCli = await readText("src/cli/release-readiness.js");
  const rcCheckCli = await readText("src/cli/rc-check.js");
  const largeIntakeCheckCli = await readText("src/cli/large-intake-check.js");
  const languageBoundaryCheckCli = await readText("src/cli/language-boundary-check.js");
  const doctorCli = await readText("src/cli/doctor.js");
  const fixtureCheck = await readText("src/cli/fixture-check.js");
  const fixtureSmoke = await readText("src/cli/fixture-smoke.js");
  const sizeCheckCli = await readText("src/cli/size-check.js");
  const cleanupArtifactsCli = await readText("src/cli/cleanup-artifacts.js");
  const externalSyncScenario = await readText("test/manual/external-sync.mjs");
  const desktopVerificationCheck = await readText("src/cli/desktop-verification-check.js");
  const desktopVerificationRecord = await readText("src/cli/desktop-verification-record.js");
  const desktopVerificationFill = await readText("src/cli/desktop-verification-fill.js");
  const desktopReleasePreflight = await readText("src/cli/desktop-release-preflight.js");
  const desktopPreflightCheck = await readText("src/cli/desktop-preflight-check.js");
  const desktopFixtureClose = await readText("src/cli/desktop-fixture-close.js");
  const desktopRuntimeLauncher = await readText("src/cli/desktop-runtime-launcher.js");
  const desktopVerificationTemplate = await readOptionalJson("samples/desktop-verification-record.template.json");
  const fixturePlan = await readOptionalJson("samples/fixture-plan.json");
  const fixtureResults = await readOptionalJson("samples/fixture-results.json");
  const realSampleResults = await readOptionalJson("samples/real-sample-results.json");
  const tauriConfig = await readOptionalJson("src-tauri/tauri.conf.json");
  const tauriLib = await readText("src-tauri/src/lib.rs");
  const desktopBridgeSmoke = await readText("src/cli/desktop-bridge-smoke.js");
  const desktopAppSmoke = await readText("src/cli/desktop-app-smoke.js");
  const desktopWorkflowSmoke = await readText("src/cli/desktop-workflow-smoke.js");
  const desktopAiSummonSmoke = await readText("src/cli/desktop-ai-summon-smoke.js");
  const coreSmoke = await readText("src/cli/smoke.js");
  const appJs = await readText("public/app.js");
  const activityListsPanel = await readText("public/activityListsPanel.js");
  const adapterCapabilitiesPanel = await readText("public/adapterCapabilitiesPanel.js");
  const aiContextPanel = await readText("public/aiContextPanel.js");
  const aiFeedRunbookPanel = await readText("public/aiFeedRunbookPanel.js");
  const aiSendGatePanel = await readText("public/aiSendGatePanel.js");
  const aiSummonPanel = await readText("public/aiSummonPanel.js");
  const documentFlowPanel = await readText("public/documentFlowPanel.js");
  const exchangePackagePanel = await readText("public/exchangePackagePanel.js");
  const manifestPanel = await readText("public/manifestPanel.js");
  const markdownWorkbenchPanel = await readText("public/markdownWorkbenchPanel.js");
  const productModePanel = await readText("public/productModePanel.js");
  const queryPanel = await readText("public/queryPanel.js");
  const searchResultsPanel = await readText("public/searchResultsPanel.js");
  const versionsPanel = await readText("public/versionsPanel.js");
  const workspaceDashboardPanel = await readText("public/workspaceDashboardPanel.js");
  const publicHtml = await readText("public/index.html");
  const appService = await readText("src/core/appService.js");
  const exchangeAudits = await readText("src/core/exchangeAudits.js");
  const exchangePackage = await readText("src/core/exchangePackage.js");
  const aiContext = await readText("src/core/aiContext.js");
  const aiFeedRunbook = await readText("src/core/aiFeedRunbook.js");
  const aiHandoffBundle = await readText("src/core/aiHandoffBundle.js");
  const aiCore = await readText("src/core/ai.js");
  const queriesCore = await readText("src/core/queries.js");
  const memoryQueryEngine = await readText("src/adapters/memoryQueryEngine.js");
  const workspaceManifestCore = await readText("src/core/workspaceManifest.js");
  const maskingCore = await readText("src/core/masking.js");
  const secretsAuditCore = await readText("src/core/secretsAudit.js");
  const coreTests = [
    await readText("test/core.test.js"),
    await readText("test/core-workspace.test.js"),
    await readText("test/core-documents.test.js"),
    await readText("test/core-queries.test.js"),
    await readText("test/core-ai.test.js"),
    await readText("test/core-exchange-package.test.js"),
    await readText("test/core-masking.test.js"),
    await readText("test/trustReport.test.js")
  ].join("\n");
  const serverTests = [
    await readText("test/server.test.js"),
    await readText("test/server-documents.test.js"),
    await readText("test/server-ai.test.js")
  ].join("\n");
  const aiContextTests = await readText("test/aiContext.test.js");
  const apiContractTests = await readText("test/apiContract.test.js");
  const cliTests = [
    await readText("test/cli.test.js"),
    await readText("test/cli-ai-context.test.js"),
    await readText("test/cli-exchange-package.test.js"),
    await readText("test/cli-desktop.test.js"),
    await readText("test/cli-desktop-preflight.test.js"),
    await readText("test/cli-guards.test.js"),
    await readText("test/cli-workspace.test.js")
  ].join("\n");
  const localServer = await readText("src/server/localServer.js");
  const cliIndex = await readText("src/cli/index.js");
  const workspaceCommands = await readText("src/cli/workspace-commands.js");
  const sdkClient = await readText("src/sdk/localApiClient.js");
  const workspaceManifest = await readText("src/core/workspaceManifest.js");
  const settingsCore = await readText("src/core/settings.js");
  const evidenceCore = await readText("src/core/evidence.js");
  const timelineCore = await readText("src/core/timeline.js");
  const manifestCore = await readText("src/core/manifest.js");
  const recordsCore = await readText("src/core/records.js");
  const qualityReportCore = await readText("src/core/qualityReport.js");
  const knownLimitsCore = await readText("src/core/knownLimits.js");
  const knownLimitsRegistry = await readText("samples/known-limits.json");
  const actionSuggestionsCore = await readText("src/core/actionSuggestions.js");
  const adapterCapabilitiesCore = await readText("src/core/adapterCapabilities.js");
  const apiContractDoc = await readText("docs/api-contract.md");
  const knownLimitsDoc = await readText("docs/known-limits.md");
  const testerOnboardingDoc = await readText("docs/tester-onboarding.md");
  const apiContractCore = await readText("src/core/apiContract.js");
  const standaloneDecision = await readText("docs/desktop-standalone-decision.md");
  const desktopRuntimeGap = await readText("docs/desktop-runtime-gap.md");
  const i18nRuntimeCheck = await readText("src/cli/i18n-runtime-check.js");
  const mojibakeGuard = await readText("src/cli/mojibake-guard.js");
  const uiCheck = await readText("src/cli/ui-check.js");
  const webUiSmoke = await readText("src/cli/web-ui-smoke.js");
  const releaseDocTexts = Object.fromEntries(await Promise.all(
    requiredDocs.filter(fileExists).map(async (relativePath) => [relativePath, await readText(relativePath)])
  ));
  const releaseDocsCombined = Object.values(releaseDocTexts).join("\n");
  const coreEntrypoints = ["web-ui", "local-api", "sdk", "cli"];
  const noSdkEntrypoints = ["web-ui", "local-api", "cli"];
  const forbiddenDocFragmentCodes = forbiddenDocFragments.map((fragment) => Array.from(fragment).map((char) => `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`).join(" "));
  const desktopFixtureCloseWriteCommand = "npm run desktop-fixture-close -- --record <filled-record.json> --write";
  const requiredFixtureCoverage = fixturePlan?.policy?.requiredCoverage ?? [];
  const fixtureCoverage = new Set((fixturePlan?.workflows ?? []).flatMap((workflow) => workflow.coverage ?? []));
  const fixtureWorkflowIds = new Set((fixturePlan?.workflows ?? []).map((workflow) => workflow.id));
  const fixtureResultIds = new Set((fixtureResults?.results ?? []).map((result) => result.id));
  const exchangePackageFixture = (fixturePlan?.workflows ?? []).find((workflow) => workflow.id === "F-010");
  const exchangePackageFixtureResult = (fixtureResults?.results ?? []).find((result) => result.id === "F-010");
  const fixtureResultsAligned = (fixturePlan?.workflows ?? []).every((workflow) => fixtureResultIds.has(workflow.id)) && (fixtureResults?.results ?? []).every((result) => fixtureWorkflowIds.has(result.id));
  const hasText = (value) => typeof value === "string" && value.trim().length > 0;
  const fixtureResultEvidenceReady = (fixtureResults?.results ?? []).every((result) => !["pass", "known_limit", "blocked", "fail"].includes(result.status) || hasText(result.evidence))
    && (fixtureResults?.results ?? []).every((result) => !["known_limit", "blocked", "fail"].includes(result.status) || hasText(result.notes));
  const fixtureResultCounts = (fixtureResults?.results ?? []).reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
  const realSampleSummary = (realSampleResults?.samples ?? []).reduce((summary, sample) => {
    summary.total += 1;
    summary.statusCounts[sample.status] = (summary.statusCounts[sample.status] ?? 0) + 1;
    for (const capability of sample.capabilities ?? []) {
      summary.capabilityCoverage[capability] = (summary.capabilityCoverage[capability] ?? 0) + 1;
    }
    return summary;
  }, {
    total: 0,
    statusCounts: { pass: 0, known_limit: 0, fail: 0, blocked: 0 },
    capabilityCoverage: {}
  });

  return {
    actionSuggestionsCore,
    activityListsPanel,
    adapterCapabilitiesCore,
    adapterCapabilitiesPanel,
    aiContext,
    aiContextPanel,
    aiContextTests,
    aiCore,
    aiFeedRunbook,
    aiFeedRunbookPanel,
    aiHandoffBundle,
    aiSendGatePanel,
    aiSummonPanel,
    apiContractCore,
    apiContractDoc,
    apiContractTests,
    appJs,
    appService,
    betaCheckCli,
    cleanupArtifactsCli,
    cliIndex,
    cliTests,
    coreEntrypoints,
    coreSmoke,
    coreTests,
    desktopAiSummonSmoke,
    desktopAppSmoke,
    desktopBridgeSmoke,
    desktopFixtureClose,
    desktopFixtureCloseWriteCommand,
    desktopHandoffLabels,
    desktopPreflightCheck,
    desktopReleasePreflight,
    desktopRuntimeGap,
    desktopRuntimeLauncher,
    desktopVerificationCheck,
    desktopVerificationFill,
    desktopVerificationRecord,
    desktopVerificationTemplate,
    desktopWorkflowSmoke,
    doctorCli,
    documentFlowPanel,
    evidenceCore,
    exchangeAudits,
    exchangePackage,
    exchangePackageFixture,
    exchangePackageFixtureResult,
    expectedTestSummary,
    exchangePackagePanel,
    externalSyncScenario,
    fileExists,
    fixtureCheck,
    fixtureCoverage,
    fixturePlan,
    fixtureResultCounts,
    fixtureResultEvidenceReady,
    fixtureResults,
    fixtureResultsAligned,
    fixtureSmoke,
    forbiddenDocFragmentCodes,
    forbiddenDocFragments,
    i18nRuntimeCheck,
    knownLimitsCore,
    knownLimitsDoc,
    knownLimitsRegistry,
    languageBoundaryCheckCli,
    largeIntakeCheckCli,
    localServer,
    manifestCore,
    manifestPanel,
    markdownWorkbenchPanel,
    maskingCore,
    memoryQueryEngine,
    mojibakeGuard,
    noSdkEntrypoints,
    packageJson,
    privateBetaPackageCli,
    productModePanel,
    publicHtml,
    qualityReportCore,
    queriesCore,
    queryPanel,
    rcCheckCli,
    recordsCore,
    releaseArtifactsCli,
    releaseArtifactsIndexCli,
    releaseDocsCombined,
    releaseDocTexts,
    releaseReadinessCli,
    realSampleResults,
    realSampleSummary,
    requiredDocs,
    requiredFixtureCoverage,
    requiredScripts,
    sdkClient,
    searchResultsPanel,
    secretsAuditCore,
    serverTests,
    settingsCore,
    sizeCheckCli,
    standaloneDecision,
    tauriConfig,
    tauriLib,
    testerOnboardingDoc,
    timelineCore,
    uiCheck,
    versionsPanel,
    webUiSmoke,
    workspaceDashboardPanel,
    workspaceCommands,
    workspaceManifest,
    workspaceManifestCore
  };
}
