import { getDesktopChecks } from "./release-check-desktop-checks.js";
import { getAiContextChecks } from "./release-check-ai-context-checks.js";
import { getAiPrepareChecks, getAiSupportChecks } from "./release-check-ai-support-checks.js";

export function getChecksPart2(context) {
  const {
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
    releaseDocTexts,
    releaseDocsCombined,
    releaseReadinessCli,
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
    workspaceManifest,
    workspaceManifestCore
  } = context;

  return [
    ...getDesktopChecks(context),
    {
      name: "open_core_policy_boundary_present",
      ok: Boolean(
        manifestCore.includes("policyMode: \"open-core\"")
        && settingsCore.includes("ALLOWED_POLICY_MODES")
        && settingsCore.includes("open-core")
        && settingsCore.includes("enterprise")
        && evidenceCore.includes("policySnapshot")
        && evidenceCore.includes("enterpriseHooks")
        && exchangePackage.includes("openCoreFree")
        && exchangePackage.includes("freeUseScope")
        && exchangePackage.includes("enterpriseOnly")
        && exchangePackage.includes("policy_mode")
        && workspaceDashboardPanel.includes("policyMode")
        && workspaceDashboardPanel.includes("open-core")
        && workspaceDashboardPanel.includes("enterprise")
        && uiCheck.includes("policyMode")
        && cliIndex.includes("settings")
        && releaseDocTexts["docs/implementation-status.md"]?.includes("policyMode")
      ),
      expected: {
        modes: ["open-core", "team", "enterprise"],
        openCoreFree: true,
        enterpriseHooks: ["dlp_policy_packs"]
      }
    },
    {
      name: "optional_adapter_capabilities_present",
      ok: Boolean(
        adapterCapabilitiesCore.includes("optional-system-adapter")
        && adapterCapabilitiesCore.includes("LibreOffice (soffice)")
        && adapterCapabilitiesCore.includes("Pandoc")
        && adapterCapabilitiesCore.includes("Tesseract OCR")
        && adapterCapabilitiesCore.includes("sendGateImpact")
        && recordsCore.includes("optional_adapter_required")
        && recordsCore.includes("LEGACY_OFFICE_EXTENSIONS")
        && qualityReportCore.includes("requiredAdaptersForQuality")
        && qualityReportCore.includes("ocr_adapter_missing")
        && knownLimitsCore.includes("legacy_office_adapter_required")
        && actionSuggestionsCore.includes("legacy_office_adapter_required")
        && appService.includes("detectAdapterCapabilities")
        && localServer.includes("/api/adapter/capabilities")
        && sdkClient.includes("adapterCapabilities")
        && cliIndex.includes("adapter-capabilities")
        && appJs.includes("createAdapterCapabilitiesPanel")
        && appJs.includes("adapterCapabilitiesPanel.renderAdapterCapabilities")
        && adapterCapabilitiesPanel.includes("renderAdapterCapabilities")
        && adapterCapabilitiesPanel.includes("/api/adapter/capabilities")
        && uiCheck.includes("adapterCapabilities")
        && uiCheck.includes("Adapter Capabilities")
        && webUiSmoke.includes("adapterCapabilities")
        && webUiSmoke.includes("/adapterCapabilitiesPanel.js")
        && apiContractDoc.includes("/api/adapter/capabilities")
        && releaseDocTexts["docs/implementation-status.md"]?.includes("/api/adapter/capabilities")
      ),
      expected: {
        adapters: ["soffice", "pandoc", "tesseract"],
        surfaces: ["doctor", "local-api", "sdk", "cli", "web-ui"]
      }
    },
    ...getAiPrepareChecks(context),
    ...getAiContextChecks(context),
    ...getAiSupportChecks(context),
    {
      name: "exchange_package_from_record_present",
      ok: Boolean(
        appService.includes("saveExchangePackageFromRecord")
        && localServer.includes("/api/exchange/package/from-record")
        && localServer.includes("/api/exchange-packages")
        && localServer.includes("/api/exchange/package/receiver-report")
        && manifestPanel.includes("/api/exchange/package/from-record")
        && appJs.includes("createExchangePackagePanel")
        && manifestPanel.includes("exchangePackagePanel.loadExchangePackageReport")
        && exchangePackagePanel.includes("/api/exchange/package/trust-report")
        && exchangePackagePanel.includes("trustExchangePackage")
        && exchangePackagePanel.includes("writeReceiverReport")
        && exchangePackagePanel.includes("renderExchangePackageReport")
        && uiCheck.includes("trustExchangePackage")
        && uiCheck.includes("writeReceiverReport")
        && cliIndex.includes("exchange-package <workspace> from-record")
        && cliIndex.includes("receiver-report")
        && sdkClient.includes("createPackageFromRecord")
        && sdkClient.includes("writeReceiverReport")
        && appService.includes("sourceRecords")
        && appService.includes("aiSendGateSummaries")
        && appService.includes("writeExchangePackageReceiverReport")
        && exchangeAudits.includes("renderReceiverReportMarkdown")
        && exchangeAudits.includes("Exchange Package Receiver Report")
        && exchangePackage.includes("receiverSummary")
        && exchangePackage.includes("recommendedActions")
        && exchangePackage.includes("sendGateStatus")
        && exchangePackage.includes("receiver-report.md")
        && exchangePackage.includes("isSensitivePackagePath")
        && exchangePackage.includes("manifestSecretValueRegex")
        && exchangePackage.includes("hasSecretInManifest")
        && exchangePackage.includes("listFilesRecursive(pkg.packageRoot)")
        && exchangePackage.includes("exchange_package_unsafe_raw_file")
        && coreTests.includes("monkey-notes.md")
        && coreTests.includes("manifest-secret-pkg")
        && coreTests.includes("token=sk-12345678901234567890")
        && coreTests.includes("unsafe raw source files")
        && workspaceManifest.includes("receiverReport")
        && workspaceManifest.includes("trustReport")
        && apiContractCore.includes("/api/exchange-packages")
        && apiContractTests.includes("/api/exchange-packages")
        && apiContractTests.includes("public plural route alias")
        && serverTests.includes("/api/exchange-packages")
        && apiContractDoc.includes("POST /api/exchange-packages")
        && apiContractDoc.includes("/api/exchange/package/receiver-report")
        && releaseDocTexts["docs/security-boundaries.md"]?.includes("undeclared raw sensitive files")
        && releaseDocTexts["docs/security-boundaries.md"]?.includes("credential-like API URLs")
        && releaseDocTexts["docs/v0.1.0-release-notes.md"]?.includes("receiver-report.md")
        && releaseDocTexts["docs/v0.1.0-release-notes.md"]?.includes("trust-report.json")
        && releaseDocTexts["docs/supported-formats.md"]?.includes("receiver-report.md")
        && releaseDocTexts["docs/supported-formats.md"]?.includes("trust-report.json")
        && testerOnboardingDoc.includes("directory-based `.exchange` package")
        && !testerOnboardingDoc.includes("structured ZIP")
      ),
      expected: {}
    },
    {
      name: "desktop_standalone_decision_present",
      ok: Boolean(
        standaloneDecision.includes("runtime/node.exe")
        && standaloneDecision.includes("Machines without system Node are supported by the packaged runtime resource")
        && standaloneDecision.includes("F-012 remains open for the current desktop artifact")
        && standaloneDecision.includes("F-012 should only be closed with `desktop-fixture-close`")
        && standaloneDecision.includes("SCHEMA_DOCS_RUNTIME_SESSION_DIR")
        && standaloneDecision.includes("Bundled Node Boundary")
        && desktopRuntimeGap.includes("F-012 remains a current automatic release blocker")
        && desktopRuntimeGap.includes("Public preview can ship")
        && desktopRuntimeGap.includes("Do not claim a polished Windows app")
        && desktopRuntimeGap.includes("bundled Node runtime path")
      ),
      expected: {}
    },
    {
      name: "desktop_bridge_smoke_present",
      ok: Boolean(
        packageJson.scripts?.["desktop:bridge-smoke"] === "node src/cli/desktop-bridge-smoke.js"
        && desktopBridgeSmoke.includes("src-tauri")
        && desktopBridgeSmoke.includes("target")
        && desktopBridgeSmoke.includes("release")
        && desktopBridgeSmoke.includes("runtime")
        && desktopBridgeSmoke.includes("desktop-runtime-launcher.js")
        && desktopBridgeSmoke.includes("SCHEMA_DOCS_RUNTIME_SESSION_DIR")
        && desktopBridgeSmoke.includes("/api/health")
      ),
      expected: {}
    },
    {
      name: "desktop_app_smoke_present",
      ok: Boolean(
        packageJson.scripts?.["desktop:app-smoke"] === "node src/cli/desktop-app-smoke.js"
        && desktopAppSmoke.includes("app.exe")
        && desktopAppSmoke.includes("--check-only")
        && desktopAppSmoke.includes("spawn(appPath")
        && desktopAppSmoke.includes("/api/health")
        && desktopAppSmoke.includes("process.kill")
        && desktopAppSmoke.includes("stillRunning")
        && desktopAppSmoke.includes("4177")
      ),
      expected: {}
    },
    {
      name: "desktop_workflow_smoke_present",
      ok: Boolean(
        packageJson.scripts?.["desktop:workflow-smoke"] === "node src/cli/desktop-workflow-smoke.js"
        && desktopWorkflowSmoke.includes("createSchemaDocsLocalClient")
        && desktopWorkflowSmoke.includes("randomBytes(24)")
        && desktopWorkflowSmoke.includes("SCHEMA_DOCS_DESKTOP_TOKEN")
        && desktopWorkflowSmoke.includes("runWorkflow(runtime, smokeToken)")
        && !desktopWorkflowSmoke.includes("/app-config.js")
        && !desktopWorkflowSmoke.includes("AI_DOC_EXCHANGE_TOKEN")
        && desktopWorkflowSmoke.includes("createTempWorkspace")
        && desktopWorkflowSmoke.includes("createSampleDocx")
        && desktopWorkflowSmoke.includes("sampleDocxOk")
        && desktopWorkflowSmoke.includes("exportDocument(\"docx\"")
        && desktopWorkflowSmoke.includes("exportDocument(\"pdf\"")
        && desktopWorkflowSmoke.includes("readPackage")
        && desktopWorkflowSmoke.includes("writeReceiverReport")
        && desktopWorkflowSmoke.includes("receiverReportOk")
        && desktopWorkflowSmoke.includes("readableMarkdownOk") && desktopWorkflowSmoke.includes("cleanAiReadyCopyOk") && desktopWorkflowSmoke.includes("aiHandoffBundleOk")
        && desktopWorkflowSmoke.includes("previewAiPayload")
        && desktopWorkflowSmoke.includes("sendAiRequest")
        && desktopWorkflowSmoke.includes("ai_send_gate_review_required")
        && desktopWorkflowSmoke.includes("taskkill")
        && desktopWorkflowSmoke.includes("stillRunning")
      ),
      expected: {}
    },
    {
      name: "ui_text_integrity_check_present",
      ok: Boolean(
        packageJson.scripts?.["ui-check"] === "node src/cli/ui-check.js"
        && uiCheck.includes("required_dom_ids_present")
        && uiCheck.includes("required_ui_text_present")
        && uiCheck.includes("no_known_mojibake_or_external_font_imports")
        && uiCheck.includes("knownMojibakeFragments")
        && uiCheck.includes("findKnownMojibake")
        && mojibakeGuard.includes("hasKnownMojibake")
        && cliTests.includes("validateI18nRuntimeTranslations")
        && cliTests.includes("findKnownMojibake")
        && uiCheck.includes("html_shell_integrity_present")
        && uiCheck.includes("public_module_imports_resolve")
        && uiCheck.includes("bilingual_ui_toggle_present")
        && uiCheck.includes("bilingual_ui_runtime_translations_valid")
        && uiCheck.includes("validateI18nRuntimeTranslations")
        && i18nRuntimeCheck.includes("createI18nPanel")
        && i18nRuntimeCheck.includes("translateUiText")
        && uiCheck.includes("uiLanguageToggle")
        && uiCheck.includes("i18nPanel")
        && appJs.includes("createI18nPanel")
        && appJs.includes("i18nPanel.bind()")
        && publicHtml.includes("uiLanguageToggle")
        && uiCheck.includes("product_mode_progressive_disclosure_present")
        && uiCheck.includes("drop_import_auto_workspace_present")
        && uiCheck.includes("fonts.googleapis.com")
        && appJs.includes("createActivityListsPanel")
        && appJs.includes("createAiSendGatePanel")
        && appJs.includes("aiSendGatePanel.bindAiSendGateEvents")
        && activityListsPanel.includes("No API profiles yet")
        && activityListsPanel.includes("No evidence records yet")
        && aiSendGatePanel.includes("previewStagedAiContext")
        && aiSendGatePanel.includes("/api/ai/preview")
        && aiSendGatePanel.includes("/api/ai/send")
        && aiSendGatePanel.includes("/api/profiles/save")
        && productModePanel.includes("Office / PDF / Excel")
        && appJs.includes("createSearchResultsPanel")
        && searchResultsPanel.includes("No matching notes found.")
        && searchResultsPanel.includes("/api/markdown/read")
        && appJs.includes("createVersionsPanel")
        && versionsPanel.includes("Restore this version")
        && versionsPanel.includes("/api/versions/promote")
        && uiCheck.includes("ai-summon-key")
        && publicHtml.includes("sendGateGuidance")
        && uiCheck.includes("sendGateGuidance")
        && uiCheck.includes("Required actions")
        && aiSendGatePanel.includes("renderSendGateGuidance")
        && aiSendGatePanel.includes("requiredActions")
        && aiSendGatePanel.includes("optionalActions")
      ),
      expected: {
        verifies: [
          "visible UI text integrity",
          "default English shell with bilingual toggle",
          "dynamic i18n panel binding",
          "runtime Chinese translation validation",
          "public module import resolution"
        ]
      }
    },
    {
      name: "web_ui_smoke_present",
      ok: Boolean(
        packageJson.scripts?.["web-ui-smoke"] === "node src/cli/web-ui-smoke.js"
        && webUiSmoke.includes("listenLocalServer")
        && webUiSmoke.includes("/app-config.js")
        && webUiSmoke.includes("/activityListsPanel.js")
        && webUiSmoke.includes("/alertPanel.js")
        && webUiSmoke.includes("/adapterCapabilitiesPanel.js")
        && webUiSmoke.includes("/aiContextPanel.js")
        && webUiSmoke.includes("/aiFeedRunbookPanel.js")
        && webUiSmoke.includes("/aiSummonPanel.js")
        && webUiSmoke.includes("/exchangePackagePanel.js")
        && webUiSmoke.includes("/importUploadPanel.js")
        && webUiSmoke.includes("/i18nPanel.js")
        && webUiSmoke.includes("/manifestPanel.js")
        && webUiSmoke.includes("/productModePanel.js")
        && webUiSmoke.includes("/searchResultsPanel.js")
        && webUiSmoke.includes("/versionsPanel.js")
        && webUiSmoke.includes("/workspaceDashboardPanel.js")
        && webUiSmoke.includes("/api/health")
        && webUiSmoke.includes("html_shell_ok")
        && webUiSmoke.includes("served_reader_facing_text_present")
        && webUiSmoke.includes("requiredServedUiText")
        && webUiSmoke.includes("bilingual_ui_toggle_present")
        && webUiSmoke.includes("served_bilingual_ui_runtime_translations_valid")
        && webUiSmoke.includes("validateI18nRuntimeTranslations")
        && i18nRuntimeCheck.includes("buildI18nRuntimeCases")
        && webUiSmoke.includes("served_product_mode_focus_route_present")
        && webUiSmoke.includes("no_served_mojibake")
        && webUiSmoke.includes("hasKnownMojibake")
        && languageBoundaryCheckCli.includes("hasKnownMojibake")
        && localServer.includes("canServeAppConfig")
        && localServer.includes("sec-fetch-site")
        && localServer.includes("cross-site")
        && serverTests.includes("blocks cross-site app config token reads")
        && releaseDocTexts["docs/security-boundaries.md"]?.includes("rejects browser requests marked as cross-site")
      ),
      expected: {
        verifies: [
          "served public UI routes",
          "served bilingual i18n panel",
          "served runtime Chinese translation validation",
          "runtime config and health endpoint",
          "served text mojibake guard"
        ]
      }
    },
    {
      name: "external_sync_receiver_report_present",
      ok: Boolean(
        externalSyncScenario.includes("'receiver-report'")
        && externalSyncScenario.includes("packages/external-sync")
        && externalSyncScenario.includes("receiver-report.md")
        && externalSyncScenario.includes("trust-report.json")
        && externalSyncScenario.includes("Receiver/trust reports written")
        && externalSyncScenario.includes("recommendedActions")
      ),
      expected: {}
    },
    {
      name: "sample_fixture_plan_ready",
      ok: Boolean(
        fixturePlan
        && fixturePlan.releaseTarget === "v0.1.2"
        && Array.isArray(fixturePlan.workflows)
        && fixturePlan.workflows.length >= (fixturePlan.policy?.minimumWorkflowCount ?? 10)
        && requiredFixtureCoverage.every((item) => fixtureCoverage.has(item))
        && fixtureCheck.includes("--plan")
        && fixtureCheck.includes("--results")
        && fixtureCheck.includes("missing_result_for_workflow")
        && fixtureCheck.includes("result_missing_evidence")
        && fixtureCheck.includes("result_missing_notes")
        && fixtureSmoke.includes("writeExchangePackageReceiverReport")
        && fixtureSmoke.includes("receiverReport")
        && fixtureSmoke.includes("trust-report.json")
        && exchangePackageFixture?.workflow?.includes("receiver/trust report")
        && exchangePackageFixture?.expected?.includes("receiver-report.md")
        && exchangePackageFixture?.expected?.includes("trust-report.json")
        && exchangePackageFixtureResult?.evidence?.includes("receiver/trust report")
      ),
      expected: {
        exchangePackageFixture: ["read-back verification", "receiver-report.md", "trust-report.json"]
      },
      actual: {
        workflowCount: fixturePlan?.workflows?.length ?? 0,
        coverage: [...fixtureCoverage].toSorted()
      }
    },
    {
      name: "sample_fixture_results_ready",
      ok: Boolean(
        fixtureResults
        && fixtureResults.releaseTarget === "v0.1.2"
        && Array.isArray(fixtureResults.results)
        && fixtureResults.results.length === (fixturePlan?.workflows?.length ?? 0)
        && fixtureResultsAligned
        && fixtureResultEvidenceReady
        && !fixtureResults.results.some((item) => item.status === "fail")
      ),
      actual: {
        resultCount: fixtureResults?.results?.length ?? 0,
        statusCounts: fixtureResultCounts,
        alignedWithPlan: fixtureResultsAligned,
        evidenceReady: fixtureResultEvidenceReady
      }
    }
  ];
}
