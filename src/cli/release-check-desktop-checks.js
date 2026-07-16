export function getDesktopChecks(context) {
  const {
    aiSummonPanel,
    apiContractCore,
    apiContractDoc,
    appJs,
    desktopAiSummonSmoke,
    desktopFixtureClose,
    desktopPreflightCheck,
    desktopRuntimeLauncher,
    desktopVerificationFill,
    documentFlowPanel,
    fileExists,
    localServer,
    manifestPanel,
    packageJson,
    publicHtml,
    releaseDocTexts,
    sdkClient,
    tauriConfig,
    tauriLib,
    uiCheck,
    workspaceCommands,
    workspaceManifestCore
  } = context;

  return [
    {
      name: "desktop_preflight_check_present",
      ok: Boolean(
        packageJson.scripts?.["desktop-preflight-check"] === "node src/cli/desktop-preflight-check.js"
        && desktopPreflightCheck.includes("desktop-preflight-manifest.json")
        && desktopPreflightCheck.includes("createHash")
        && desktopPreflightCheck.includes("sha256_mismatch")
        && desktopPreflightCheck.includes("bytes_mismatch")
        && desktopPreflightCheck.includes("json_parse_failed")
        && desktopPreflightCheck.includes("file_count_mismatch")
        && desktopPreflightCheck.includes("resolveEvidencePath")
        && desktopPreflightCheck.includes("verifyHandoffSemantics")
        && desktopPreflightCheck.includes("handoff_summary_release_command_missing")
        && desktopPreflightCheck.includes("handoff_summary_release_commands_mismatch")
        && desktopPreflightCheck.includes("release_readiness_commands_missing")
        && desktopPreflightCheck.includes("handoff_release_command_checklist_missing")
        && desktopPreflightCheck.includes("handoff_summary_preflight_command_invalid")
        && desktopPreflightCheck.includes("handoff_preflight_check_command_missing")
        && desktopPreflightCheck.includes("handoff_summary_portable_evidence_missing")
        && desktopPreflightCheck.includes("handoff_summary_portable_evidence_mismatch")
        && desktopPreflightCheck.includes("handoff_portable_evidence_section_missing")
        && desktopPreflightCheck.includes("path.isAbsolute")
      ),
      expected: {}
    },
    {
      name: "desktop_verification_fill_present",
      ok: Boolean(
        packageJson.scripts?.["desktop-verification-fill"] === "node src/cli/desktop-verification-fill.js"
        && desktopVerificationFill.includes("fillDesktopVerificationRecord")
        && desktopVerificationFill.includes("--visible-ui-pass")
        && desktopVerificationFill.includes("--diagnostics-pass")
        && desktopVerificationFill.includes("--first-workflow-pass")
        && desktopVerificationFill.includes("--workspace-picker-pass")
        && desktopVerificationFill.includes("--file-picker-pass")
        && desktopVerificationFill.includes("--result-pass")
        && desktopVerificationFill.includes("--tester")
        && desktopVerificationFill.includes("--windows-version")
        && desktopVerificationFill.includes("--node-version")
        && desktopVerificationFill.includes("--webview2-present")
        && desktopVerificationFill.includes("quoteCommandArg")
        && desktopVerificationFill.includes("desktop-verification-check -- --strict")
        && desktopVerificationFill.includes("desktop-fixture-close -- --record")
        && desktopVerificationFill.includes("--write")
      ),
      expected: {}
    },
    {
      name: "desktop_fixture_close_present",
      ok: Boolean(
        packageJson.scripts?.["desktop-fixture-close"] === "node src/cli/desktop-fixture-close.js"
        && desktopFixtureClose.includes("desktop-verification-check.js")
        && desktopFixtureClose.includes("buildReleaseArtifactManifest")
        && desktopFixtureClose.includes("verifyRecordArtifact")
        && desktopFixtureClose.includes("artifact_not_in_release_manifest")
        && desktopFixtureClose.includes("--strict")
        && desktopFixtureClose.includes("F-012")
        && desktopFixtureClose.includes("--record")
        && desktopFixtureClose.includes("--write")
        && desktopFixtureClose.includes("sha256File")
        && desktopFixtureClose.includes("recordSha256")
        && desktopFixtureClose.includes("statusCounts")
      ),
      expected: {}
    },
    {
      name: "tauri_shell_config_present",
      ok: Boolean(
        tauriConfig
        && tauriConfig.version === packageJson.version
        && tauriConfig.identifier
        && !tauriConfig.identifier.endsWith(".app")
        && tauriConfig.build?.frontendDist === "../public"
        && tauriConfig.bundle?.active === true
      ),
      expected: {}
    },
    {
      name: "desktop_runtime_bridge_present",
      ok: Boolean(
        tauriConfig?.bundle?.resources?.["../src"] === "runtime/src"
        && tauriConfig?.bundle?.resources?.["../public"] === "runtime/public"
        && tauriConfig?.bundle?.resources?.["../package.json"] === "runtime/package.json"
        && tauriConfig?.bundle?.resources?.["resources/node.exe"] === "runtime/node.exe"
        && tauriLib.includes("spawn_desktop_runtime")
        && tauriLib.includes("desktop-runtime-launcher.js")
        && (
          tauriLib.includes("hidden_command(\"node\")")
          || tauriLib.includes("hidden_command(&node_cmd)")
          || tauriLib.includes("Command::new(\"node\")")
          || tauriLib.includes("Command::new(&node_cmd)")
        )
        && tauriLib.includes("creation_flags(0x08000000)")
        && tauriLib.includes("app_data_dir")
        && tauriLib.includes("SCHEMA_DOCS_RUNTIME_SESSION_DIR")
        && fileExists("src/cli/desktop-runtime-launcher.js")
        && desktopRuntimeLauncher.includes("SCHEMA_DOCS_RUNTIME_SESSION_DIR")
        && tauriLib.includes("RunEvent::ExitRequested")
      ),
      expected: {
        releaseAutoStart: "spawn_desktop_runtime",
        bundledNodeResource: "runtime/node.exe",
        bundledPublicResource: "runtime/public",
        writableSessionEnv: "SCHEMA_DOCS_RUNTIME_SESSION_DIR"
      }
    },
    {
      name: "desktop_native_pickers_present",
      ok: Boolean(
        tauriLib.includes("select_import_file_path")
        && tauriLib.includes("select_markdown_file_path")
        && tauriLib.includes("select_workspace_path")
        && tauriLib.includes("OpenFileDialog")
        && tauriLib.includes("FolderBrowserDialog")
        && tauriLib.includes("*.docx;*.pptx;*.pdf;*.txt;*.csv;*.xlsx;*.xls")
        && tauriLib.includes("*.md;*.markdown")
        && tauriLib.includes("tauri::generate_handler!")
        && tauriLib.includes("select_import_file_path,")
        && tauriLib.includes("select_markdown_file_path,")
        && tauriLib.includes("select_workspace_path,")
        && appJs.includes("tauriInvoke")
        && appJs.includes("createDocumentFlowPanel")
        && appJs.includes("handleOpenMarkdownFile")
        && appJs.includes('$("openMarkdownFile")?.addEventListener("click", () => run(handleOpenMarkdownFile))')
        && appJs.includes("select_workspace_path")
        && appJs.includes("chooseWorkspace")
        && publicHtml.includes("chooseLocalFile")
        && documentFlowPanel.includes("select_import_file_path")
        && documentFlowPanel.includes("chooseLocalFile")
        && documentFlowPanel.includes("/api/import")
        && documentFlowPanel.includes("/api/document/convert")
        && documentFlowPanel.includes("/api/document/export")
      ),
      expected: {
        workspaceCommand: "select_workspace_path",
        importFileCommand: "select_import_file_path",
        markdownFileCommand: "select_markdown_file_path",
        uiControls: ["chooseWorkspace", "dropZone", "fileInput"],
        importFormats: ["docx", "pptx", "pdf", "txt", "csv", "xlsx", "xls"],
        openFormats: ["md", "markdown"]
      }
    },
    {
      name: "visible_first_workflow_present",
      ok: Boolean(
        appJs.includes("runFirstWorkflow")
        && appJs.includes("ensureWorkspaceForFirstWorkflow")
        && appJs.includes("/api/samples/docx")
        && appJs.includes("/api/normalize")
        && appJs.includes("/api/exchange/package/read")
        && appJs.includes("/api/exchange/package/receiver-report")
        && appJs.includes("readBackValid")
        && appJs.includes("receiverReportWritten")
        && uiCheck.includes("runFirstWorkflow")
      ),
      expected: {
        uiControl: "runFirstWorkflow",
        verifies: ["temporary workspace", "Markdown DOCX/PDF export", "sample DOCX import/extract", "exchange package read-back", "receiver report write"]
      }
    },
    {
      name: "workspace_exchange_package_overview_present",
      ok: Boolean(
        appJs.includes("createManifestPanel")
        && manifestPanel.includes("manifest.exchangePackages")
        && manifestPanel.includes("receiverReportCount")
        && manifestPanel.includes("trustReportCount")
        && manifestPanel.includes("aiHandoffBundles")
        && manifestPanel.includes("AI handoff bundles")
        && manifestPanel.includes("package-overview-list")
        && manifestPanel.includes("package-overview-card")
        && manifestPanel.includes("receiverReport?.exists")
        && manifestPanel.includes("trustReport?.exists")
        && manifestPanel.includes("/api/exchange/package/receiver-report")
        && manifestPanel.includes("loadExchangePackageReport(packageRelativePath)")
        && workspaceManifestCore.includes("aiContextSelections")
        && workspaceManifestCore.includes("aiHandoffBundles")
        && workspaceManifestCore.includes("ai_handoff_bundle")
        && workspaceManifestCore.includes("ai_query_context_selected")
        && workspaceManifestCore.includes("selectionRange")
        && workspaceManifestCore.includes("queryShape")
        && workspaceManifestCore.includes("remainingRangeCount")
        && workspaceCommands.includes("Recent AI Context Selections")
        && workspaceCommands.includes("Recent AI Handoff Bundles")
        && workspaceCommands.includes("range unknown")
        && workspaceCommands.includes("remaining ${selection.continuation.remainingChunks || 0}")
        && workspaceCommands.includes("query tables")
        && localServer.includes("/api/workspace/manifest")
        && sdkClient.includes("compileWorkspaceManifest")
        && apiContractCore.includes("/api/workspace/manifest")
        && apiContractCore.includes("workspace handoff summary")
        && apiContractCore.includes("AI handoff bundle summaries")
        && apiContractDoc.includes("Workspace Manifest Handoff Summary")
        && apiContractDoc.includes("client.compileWorkspaceManifest()")
        && apiContractDoc.includes("workspace-manifest.json")
        && apiContractDoc.includes("aiContextSelections[].selectionRange")
        && apiContractDoc.includes("aiContextSelections[].queryShape")
        && apiContractDoc.includes("aiHandoffBundles[]")
        && releaseDocTexts["README.md"]?.includes("workspace ./tmp-workspace summary")
        && releaseDocTexts["docs/implementation-status.md"]?.includes("aiContextSelections")
        && releaseDocTexts["docs/implementation-status.md"]?.includes("aiHandoffBundles")
        && releaseDocTexts["docs/implementation-status.md"]?.includes("AI Handoff Bundle")
        && releaseDocTexts["docs/implementation-status.md"]?.includes("selection range")
        && releaseDocTexts["docs/implementation-status.md"]?.includes("safe `queryShape`")
        && releaseDocTexts["docs/implementation-status.md"]?.includes("POST /api/workspace/manifest")
      ),
      expected: {
        uiSurface: "workspace manifest summary",
        reports: ["exchange package count", "receiver report count", "trust report count", "AI context selection count", "AI handoff bundle count"],
        actions: ["view trust report", "write receiver report"]
      }
    },
    {
      name: "desktop_runtime_diagnostics_present",
      ok: Boolean(
        tauriLib.includes("get_desktop_runtime_diagnostics")
        && tauriLib.includes("node")
        && tauriLib.includes("--version")
        && tauriLib.includes("runtime-stdout.log")
        && tauriLib.includes("runtime-stderr.log")
        && tauriLib.includes("tauri-runtime.log")
        && appJs.includes("desktopDiagnostics")
        && appJs.includes("get_desktop_runtime_diagnostics")
        && uiCheck.includes("desktopDiagnostics")
      ),
      expected: {
        uiControl: "desktopDiagnostics",
        reports: ["node availability", "runtime resource paths", "session log paths", "api health"]
      }
    },
    {
      name: "desktop_ai_summon_bridge_present",
      ok: Boolean(
        tauriLib.includes("summon_ai_gate")
        && tauriLib.includes("schema-docs-ai-summon")
        && tauriLib.includes("\"source\": \"desktop-command\"")
        && tauriLib.includes("\"shortcut\": \"Ctrl+Alt+A\"")
        && tauriLib.includes("\"scope\": \"desktop-window\"")
        && tauriLib.includes("get_webview_window")
        && tauriLib.includes("set_focus")
        && appJs.includes("bindDesktopAiSummonEvent")
        && appJs.includes("schema-docs-ai-summon")
        && appJs.includes("summonAiGate")
        && aiSummonPanel.includes("scrollIntoView")
        && aiSummonPanel.includes("await updateAiWillSeePanel()")
        && aiSummonPanel.includes("aiSummonSourceLabel")
        && aiSummonPanel.includes("\"x-ai-doc-exchange-token\": token")
        && aiSummonPanel.includes("payload.data?.maskedText")
        && aiSummonPanel.includes("Clipboard not staged: local masking unavailable.")
        && (localServer.includes("url.pathname === \"/api/mask\"") || localServer.includes("\"/api/mask\""))
        && localServer.includes("maskSensitiveData(body.content)")
        && appJs.includes("event.ctrlKey && event.altKey && event.code === \"KeyA\"")
        && appJs.includes("$(\"aiSummonKey\")?.addEventListener")
        && appJs.includes("aiAssistantPanel.toggle()")
        && uiCheck.includes("aiSummonKey")
        && packageJson.scripts?.["desktop:ai-summon-smoke"] === "node src/cli/desktop-ai-summon-smoke.js"
        && desktopAiSummonSmoke.includes("tauri_focuses_main_window")
        && desktopAiSummonSmoke.includes("web_keyboard_shortcut_present")
        && desktopAiSummonSmoke.includes("web_summon_opens_send_gate_panel")
        && desktopAiSummonSmoke.includes("web_summon_refreshes_current_record_preview")
        && desktopAiSummonSmoke.includes("web_summon_masks_clipboard_through_local_api")
        && desktopAiSummonSmoke.includes("local_mask_api_does_not_require_workspace")
        && desktopAiSummonSmoke.includes("floating_button_present")
        && desktopAiSummonSmoke.includes("source-aware")
        && desktopAiSummonSmoke.includes("failedChecks")
      ),
      expected: {
        command: "summon_ai_gate",
        event: "schema-docs-ai-summon",
        shortcut: "Ctrl+Alt+A",
        scope: "desktop-window",
        behavior: "focus main window, locally mask clipboard text, and open source-aware AI Send Gate without staging raw clipboard fallback",
        smoke: "desktop:ai-summon-smoke"
      }
    }
  ];
}
