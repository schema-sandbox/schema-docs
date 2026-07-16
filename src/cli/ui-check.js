import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { validateI18nRuntimeTranslations } from "./i18n-runtime-check.js";
import { findKnownMojibake, hasKnownMojibake, knownMojibakeFragments } from "./mojibake-guard.js";

const root = path.resolve(import.meta.dirname, "../..");

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

const html = await read("public/index.html");
const appConfig = await read("public/app-config.js");
const appJs = await read("public/app.js");
const activityListsPanel = await read("public/activityListsPanel.js");
const alertPanel = await read("public/alertPanel.js");
const adapterCapabilitiesPanel = await read("public/adapterCapabilitiesPanel.js");
const aiContextPanel = await read("public/aiContextPanel.js");
const aiFeedRunbookPanel = await read("public/aiFeedRunbookPanel.js");
const aiSendGatePanel = await read("public/aiSendGatePanel.js");
const aiSummonPanel = await read("public/aiSummonPanel.js");
const documentFlowPanel = await read("public/documentFlowPanel.js");
const exchangePackagePanel = await read("public/exchangePackagePanel.js");
const importUploadPanel = await read("public/importUploadPanel.js");
const i18nPanel = await read("public/i18nPanel.js");
const manifestPanel = await read("public/manifestPanel.js");
const markdownWorkbenchPanel = await read("public/markdownWorkbenchPanel.js");
const productModePanel = await read("public/productModePanel.js");
const queryPanel = await read("public/queryPanel.js");
const searchResultsPanel = await read("public/searchResultsPanel.js");
const versionsPanel = await read("public/versionsPanel.js");
const workspaceDashboardPanel = await read("public/workspaceDashboardPanel.js");
const css = await read("public/styles.css");
const firstReleaseCss = await read("public/firstRelease.css");
const combined = [html, appConfig, appJs, activityListsPanel, alertPanel, adapterCapabilitiesPanel, aiContextPanel, aiFeedRunbookPanel, aiSendGatePanel, aiSummonPanel, documentFlowPanel, exchangePackagePanel, importUploadPanel, i18nPanel, manifestPanel, markdownWorkbenchPanel, productModePanel, queryPanel, searchResultsPanel, versionsPanel, workspaceDashboardPanel, css, firstReleaseCss].join("\n");
const chineseUiLabel = String.fromCodePoint(0x4e2d, 0x6587, 0x754c, 0x9762);

function includesAll(source, fragments) {
  return fragments.every((fragment) => source.includes(fragment));
}

function cssRuleIncludes(selector, fragments) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`, "m"));
  return Boolean(match && fragments.every((fragment) => {
    const cleanFragment = fragment.replace(/\s+/g, "");
    const cleanMatch = match[1].replace(/\s+/g, "");
    return cleanMatch.includes(cleanFragment);
  }));
}

const requiredIds = [
  "workspacePath",
  "chooseWorkspace",
  "openWorkspace",
  "createTempWorkspace",
  "runFirstWorkflow",
  "desktopDiagnostics",
  "uiLanguageToggle",
  "productModeOffice",
  "productModeMarkdown",
  "firstRunModeDialog",
  "firstRunOfficeMode",
  "firstRunMarkdownMode",
  "aiSetupDialog",
  "setupAiNow",
  "setupAiLater",
  "changeMode",
  "advancedToolsToggle",
  "closeAiPanel",
  "aiSummonKey",
  "notePath",
  "noteContent",
  "markdownReadMode",
  "markdownSplitMode",
  "markdownEditMode",
  "markdownReadView",
  "markdownOutline",
  "markdownStatus",
  "markdownFormatToolbar",
  "reloadReadView",
  "markdownImportFile",
  "markdownPrepareForAi",
  "saveNote",
  "exportDocx",
  "exportPdf",
  "sourcePath",
  "chooseLocalFile",
  "importFile",
  "createSampleDocx",
  "recordId",
  "convertDocument",
  "recordToDocx",
  "recordToPdf",
  "saveExchange",
  "writeBackAiResult",
  "loadQueryForAi",
  "saveQueryHandoff",
  "output",
  "tabInbox",
  "tabTimeline",
  "tabSettings",
  "tabQuality",
  "inboxPanel",
  "timelinePanel",
  "settingsPanel",
  "qualityPanel",
  "inboxList",
  "timelineList",
  "settingsList",
  "qualityGrid",
  "versionList",
  "refreshInbox",
  "refreshTimeline",
  "refreshVersions",
  "refreshQuality",
  "timelineFilter",
  "generateFeedbackBundle",
  "runSecuritySecretsAudit",
  "aiWillSeePanel",
  "aiWillSeeContent",
  "sendGateGuidance",
  "aiChunkIndex",
  "reviewStagedAiContext",
  "saveCleanAiReadyCopy",
  "loadFirstAiChunk",
  "loadSelectedAiChunk",
  "appendSelectedAiChunk",
  "appendNextAiChunk",
  "loadPreviousAiChunk",
  "loadNextAiChunk",
  "loadAiIntakePlan",
  "aiChunkRangeStart",
  "aiChunkRangeEnd",
  "aiChunkRangeBudget",
  "loadAiChunkRange",
  "appendAiChunkRange",
  "appendNextAiChunkRange",
  "createAiFeedRunbook",
  "aiFeedRunbookPath",
  "readAiFeedRunbook",
  "loadNextRunbookBatch",
  "appendNextRunbookBatch",
  "continueRunbookAfterSent",
  "aiFeedBatchIndex",
  "aiFeedBatchStatus",
  "markAiFeedBatch",
  "aiRunbookBatchStatus",
  "aiChunkLedger",
  "clearAiContext",
  "saveStagedAiContext",
  "saveAiHandoffBundle",
  "trustExchangePackage",
  "writeReceiverReport",
  "refreshAdapters",
  "adapterCapabilities"
];

const requiredText = [
  "Schema Docs",
  "Before sending a document to AI",
  "Do not send raw files directly to AI",
  "Start here: Import and prepare documents for AI",
  "Import document",
  "AI context is previewed before send",
  "Office / PDF / Excel",
  "Markdown / API",
  "AI Send Gate",
  "Required actions",
  "Load next batch",
  "Append next batch",
  "Continue next batch",
  "Current runbook batch",
  "Review batch",
  "Confirm send batch",
  "Resolve blocked batch",
  "runbook-batch-action",
  "Ready send",
  "Save clean AI-ready copy",
  "Import source file",
  "Prepare current file for AI",
  "Read",
  "Edit",
  "Refresh reading view",
  "markdown-read-view",
  "readableMarkdownPath",
  "readableMarkdown",
  "Queue recovery",
  "Next action",
  "Output Console",
  "product-mode-panel",
  "markdown-workbench",
  "document-flow-panel",
  "exchange-package-panel",
  "ai-summon-key",
  "Ctrl+Alt+A",
  "schema-docs-ai-summon",
  "bindDesktopAiSummonEvent",
  "policyMode",
  "open-core",
  "enterprise",
  "Adapter Capabilities",
  "LibreOffice",
  "Pandoc",
  "Tesseract OCR",
  "/api/adapter/capabilities",
  "renderAdapterCapabilities",
  "record-actions",
  "Prepare for AI",
  "/api/ai/prepare-record",
  "/api/ai/feed-runbook",
  "/api/exchange/package/trust-report",
  "/api/exchange/package/receiver-report",
  "renderExchangePackageReport",
  "trust-report",
  "Generate exchange package"
];

const forbiddenFragments = [
  "fonts.googleapis.com",
  ...knownMojibakeFragments
];

const requiredHtmlFragments = [
  "<!doctype html>",
  "<html lang=\"en\">",
  "<body",
  "</body>",
  "</html>",
  "<link rel=\"stylesheet\" href=\"./styles.css\">",
  "<script src=\"./app-config.js\"></script>",
  "<script type=\"module\" src=\"./app.js\"></script>"
];
const pairedTags = ["button", "section", "article", "div", "main", "header"];
const publicDir = path.join(root, "public");
const publicJsFiles = (await readdir(publicDir))
  .filter((file) => file.endsWith(".js"))
  .sort();
const publicJsTexts = Object.fromEntries(await Promise.all(
  publicJsFiles.map(async (file) => [file, await read(`public/${file}`)])
));
const buttonIds = [...html.matchAll(/<button\b[^>]*\bid="([^"]+)"/g)].map((match) => match[1]), buttonBindingText = Object.values(publicJsTexts).join("\n");
function buttonBound(id) { return [`$("${id}")`, `clickRun("${id}"`, `getElementById("${id}"`, `tabId: "${id}"`].some((fragment) => buttonBindingText.includes(fragment)); }
const publicModuleImports = [];
for (const [file, text] of Object.entries(publicJsTexts)) {
  const importRegex = /import\s+(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g;
  let match;
  while ((match = importRegex.exec(text)) !== null) {
    publicModuleImports.push({ file, specifier: match[1] });
  }
}
const unresolvedPublicImports = publicModuleImports.filter(({ file, specifier }) => {
  if (/^https?:\/\//i.test(specifier) || !specifier.startsWith("./")) {
    return true;
  }
  const resolved = path.normalize(path.join(path.dirname(file), specifier)).replace(/\\/g, "/");
  return !publicJsFiles.includes(resolved);
});
function containsForbiddenFragment(text) {
  return String(text).includes("fonts.googleapis.com") || hasKnownMojibake(text);
}

const i18nRuntimeValidation = validateI18nRuntimeTranslations({
  hasMojibake: containsForbiddenFragment
});

function tagCount(tag, closing = false) {
  const prefix = closing ? `</${tag}` : `<${tag}`;
  return html.match(new RegExp(prefix, "g"))?.length ?? 0;
}

function tagPairOk(tag) {
  return tagCount(tag) === tagCount(tag, true);
}

function hasBareClosingTag(tag) {
  return new RegExp(`(^|[^<])/${tag}>`).test(html);
}

const checks = [
  {
    name: "packaged_app_config_present",
    ok: appConfig.trimStart().startsWith("//")
      && appConfig.includes("window.SCHEMA_DOCS_API_BASE_URL")
      && !appConfig.trimStart().startsWith("<"),
    detail: "The packaged desktop build must serve JavaScript for /app-config.js, not the HTML fallback."
  },
  {
    name: "required_dom_ids_present",
    ok: requiredIds.every((id) => html.includes(`id="${id}"`)),
    missing: requiredIds.filter((id) => !html.includes(`id="${id}"`))
  },
  { name: "static_button_bindings_present", ok: buttonIds.every(buttonBound), missing: buttonIds.filter((id) => !buttonBound(id)) },
  {
    name: "required_ui_text_present",
    ok: requiredText.every((text) => combined.includes(text)),
    missing: requiredText.filter((text) => !combined.includes(text))
  },
  {
    name: "no_known_mojibake_or_external_font_imports",
    ok: !forbiddenFragments.some((fragment) => combined.includes(fragment)),
    forbiddenFound: [
      ...(combined.includes("fonts.googleapis.com") ? ["fonts.googleapis.com"] : []),
      ...findKnownMojibake(combined)
    ]
  },
  {
    name: "html_shell_integrity_present",
    ok: requiredHtmlFragments.every((fragment) => html.includes(fragment))
      && pairedTags.every(tagPairOk)
      && !hasBareClosingTag("button")
      && !hasBareClosingTag("p"),
    missingFragments: requiredHtmlFragments.filter((fragment) => !html.includes(fragment)),
    bareClosingTags: ["button", "p"].filter(hasBareClosingTag),
    tagPairs: pairedTags.map((tag) => ({
      tag,
      open: tagCount(tag),
      close: tagCount(tag, true),
      ok: tagPairOk(tag)
    }))
  },
  {
    name: "local_api_discovery_present",
    ok: appJs.includes("discoverLocalApiConfig")
      && appJs.includes("127.0.0.1")
      && appJs.includes("AI_DOC_EXCHANGE_TOKEN")
  },
  {
    name: "public_module_imports_resolve",
    ok: unresolvedPublicImports.length === 0,
    imports: publicModuleImports,
    unresolved: unresolvedPublicImports
  },
  {
    name: "bilingual_ui_toggle_present",
    ok: html.includes("id=\"uiLanguageToggle\"")
      && html.includes(`>${chineseUiLabel}</button>`)
      && html.indexOf("id=\"uiLanguageToggle\"") < html.indexOf("<main class=\"shell\"")
      && css.includes(".global-language-toggle")
      && appJs.includes("createI18nPanel")
      && appJs.includes("i18nPanel.bind()")
      && appJs.indexOf("const i18nPanel = createI18nPanel") < appJs.indexOf("const aiContextPanel = createAiContextPanel")
      && appJs.indexOf("i18nPanel.bind()") < appJs.indexOf("const aiContextPanel = createAiContextPanel")
      && i18nPanel.includes("schemaDocsUiLanguage")
      && i18nPanel.includes("uiLanguage")
      && i18nPanel.includes("languageState")
      && i18nPanel.includes("zh-CN")
      && i18nPanel.includes("\u4e2d\u6587\u754c\u9762")
      && i18nPanel.includes("English UI")
      && i18nPanel.includes("MutationObserver")
      && i18nPanel.includes("originalText")
      && i18nPanel.includes("originalAttributes")
      && i18nPanel.includes("TRANSLATABLE_ATTRIBUTES")
      && i18nPanel.includes("applyLanguage")
      && i18nPanel.includes("translateText"),
    expected: [
      "language toggle is present in the default English shell",
      "bilingual panel is bound by app.js",
      "Chinese locale can persist without replacing default English",
      "dynamic DOM translation and original text restoration are present"
    ]
  },
  {
    name: "large_extraction_progress_feedback_present",
    ok: html.includes("id=\"extractionProgress\"")
      && html.includes("id=\"extractionProgressText\"")
      && documentFlowPanel.includes("setExtractionProgress")
      && (documentFlowPanel.includes("Batch extracting unconverted documents")
        || documentFlowPanel.includes("Batch extracting documents"))
      && appJs.includes("Preparing AI-readable Markdown")
      && css.includes("extraction-progress-bar")
      && i18nPanel.includes("Preparing extraction..."),
    expected: [
      "visible extraction progress region",
      "manual and batch extraction status updates",
      "auto AI-readable preparation status updates",
      "localized progress text"
    ]
  },
  {
    name: "bilingual_ui_runtime_translations_valid",
    ok: i18nRuntimeValidation.ok,
    cases: i18nRuntimeValidation.cases,
    fallbackOk: i18nRuntimeValidation.fallbackOk,
    expected: [
      "runtime Chinese translations return real Han text",
      "dynamic i18n pattern translations preserve interpolated filenames",
      "untranslated fallback text remains unchanged",
      "runtime translated text contains no known mojibake fragments"
    ]
  },
  {
    name: "product_mode_progressive_disclosure_present",
    ok: html.includes("id=\"firstRunModeDialog\"")
      && html.includes("id=\"productModeOffice\"")
      && html.includes("id=\"productModeMarkdown\"")
      && appJs.includes("schemaDocsProductMode")
      && appJs.includes("schemaDocsAdvancedTools")
      && appJs.includes("productModeConfigured: true")
      && appJs.includes("advancedToolsVisible: false")
      && appJs.includes("firstRelease.css")
      && firstReleaseCss.includes("body[data-advanced-tools=\"false\"]")
      && firstReleaseCss.includes("#openRedactionTool")
      && firstReleaseCss.includes(".ai-summon-key")
      && appJs.includes("schemaDocsAiAssistantPrompted")
      && appJs.includes("dataset.aiPanelOpen")
      && productModePanel.includes("document.body.dataset.productMode")
      && productModePanel.includes("document.body.dataset.productModeConfigured")
      && appJs.includes("showFirstRunModeDialogIfNeeded")
      && appJs.includes("onModeSelected: handleModeSelected")
      && appJs.includes("targetId = mode === \"markdown\" ? \"noteContent\" : \"sourcePath\"")
      && appJs.includes("maybePromptAiAssistantSetup")
      && appJs.includes("function handleSetupAiLater()")
      && appJs.includes("function handleSetupAiNow()")
      && appJs.includes("async function handleMarkdownImportFile()")
      && appJs.includes("async function handleMarkdownPrepareForAi()")
      && appJs.includes("setAdvancedToolsVisible")
      && appJs.includes("setAiPanelOpen")
      && appJs.includes("markdownImportFile")
      && appJs.includes("markdownPrepareForAi")
      && appJs.includes("createMarkdownWorkbenchPanel")
      && appJs.includes("setMarkdownViewMode")
      && appJs.includes("renderMarkdownReadView")
      && html.includes("id=\"loadFullMarkdown\"")
      && appJs.includes("loadFullCurrentMarkdownFile")
      && markdownWorkbenchPanel.includes("renderMarkdownOutline")
      && markdownWorkbenchPanel.includes("renderMarkdownDocMeta")
      && markdownWorkbenchPanel.includes("markdownDocSearch")
      && markdownWorkbenchPanel.includes("wiki-link")
      && markdownWorkbenchPanel.includes("markdown-frontmatter")
      && markdownWorkbenchPanel.includes("markdown-callout")
      && markdownWorkbenchPanel.includes("footnote-ref")
      && markdownWorkbenchPanel.includes("syncSplitScroll")
      && markdownWorkbenchPanel.includes("insertMarkdownSyntax")
      && markdownWorkbenchPanel.includes("markdownStats")
      && markdownWorkbenchPanel.includes("keydown")
      && appJs.includes("readableRelativePathForRecord")
      && appJs.includes("saveCleanAiReadyCopy")
      && documentFlowPanel.includes("relativeHumanMarkdownPath")
      && documentFlowPanel.includes("record?.readableMarkdownPath || record?.markdownOutputs?.readable || record?.outputMarkdownPath")
      && manifestPanel.includes("relativeHumanMarkdownPath")
      && manifestPanel.includes("record?.readableMarkdownPath || record?.markdownOutputs?.readable || record?.outputMarkdownPath")
      && manifestPanel.includes("relativeAiReadyMarkdownPath")
      && css.includes("markdown-editor-shell")
      && css.includes("markdown-outline-panel")
      && css.includes("body[data-markdown-view=\"split\"]")
      && aiContextPanel.includes("web-ui-clean-ai-ready-copy")
      && documentFlowPanel.includes("ensureWorkspaceIfNeeded")
      && productModePanel.includes("onModeSelected(normalizedMode)")
      && appJs.includes("productModeOffice\").addEventListener")
      && appJs.includes("productModeMarkdown\").addEventListener")
      && appJs.includes("firstRunOfficeMode\").addEventListener")
      && appJs.includes("firstRunMarkdownMode\").addEventListener")
      && appJs.includes("setupAiLater\")?.addEventListener(\"click\", handleSetupAiLater)")
      && appJs.includes("setupAiNow\")?.addEventListener(\"click\", handleSetupAiNow)")
      && appJs.includes("markdownImportFile\")?.addEventListener(\"click\", () => run(handleMarkdownImportFile))")
      && appJs.includes("markdownPrepareForAi\")?.addEventListener(\"click\", () => run(handleMarkdownPrepareForAi))")
      && appJs.indexOf("productModeOffice\").addEventListener") < appJs.indexOf("const aiContextPanel = createAiContextPanel")
      && appJs.indexOf("firstRunMarkdownMode\").addEventListener") < appJs.indexOf("const aiContextPanel = createAiContextPanel")
      && appJs.indexOf("setupAiLater\")?.addEventListener") < appJs.indexOf("const aiContextPanel = createAiContextPanel")
      && appJs.indexOf("setupAiNow\")?.addEventListener") < appJs.indexOf("const aiContextPanel = createAiContextPanel")
      && appJs.indexOf("markdownImportFile\")?.addEventListener") < appJs.indexOf("const aiContextPanel = createAiContextPanel")
      && appJs.indexOf("markdownPrepareForAi\")?.addEventListener") < appJs.indexOf("const aiContextPanel = createAiContextPanel"),
    expected: [
      "default document workflow without a first-run decision",
      "advanced tools hidden until explicitly requested",
      "office/markdown mode switching remains available",
      "body product mode marker",
      "mode selection focuses the matching primary work area",
      "specialist tools remain available without crowding the default UI"
    ]
  },
  {
    name: "office_worker_mode_workspace_layout_present",
    ok: cssRuleIncludes("body[data-product-mode=\"office\"] .document-flow-panel", [
      "order: 1",
      "grid-column: 1 / -1"
    ])
      && cssRuleIncludes("body[data-product-mode=\"office\"] .markdown-workbench", [
        "order: 2",
        "grid-column: 1 / -1"
      ])
      && cssRuleIncludes("body[data-product-mode=\"markdown\"] .markdown-workbench", [
        "order: 1",
        "grid-column: 1 / -1"
      ])
      && cssRuleIncludes("body[data-product-mode=\"markdown\"] .document-flow-panel", [
        "display: none !important"
      ])
      && includesAll(appJs, [
        "function focusPrimaryWorkspaceMode(mode)",
        "const targetId = mode === \"markdown\" ? \"noteContent\" : \"sourcePath\"",
        "target.scrollIntoView({ behavior: \"smooth\", block: \"center\" })",
        "window.setTimeout(() => target.focus(), 150)",
        "focusPrimaryWorkspaceMode(mode)",
        "maybePromptAiAssistantSetup()"
      ]),
    expected: [
      "Office-first opens the document flow as the first full-width workspace",
      "Markdown-first opens the Markdown workbench as the first full-width workspace",
      "Markdown-first hides the file intake panel until the user explicitly switches mode",
      "mode selection scrolls and focuses the matching primary input"
    ]
  },
  {
    name: "markdown_office_worker_shortcuts_present",
    ok: includesAll(markdownWorkbenchPanel, [
      "event.key.toLowerCase() === \"s\"",
      "event.key.toLowerCase() === \"f\"",
      "event.key.toLowerCase() === \"e\"",
      "event.key.toLowerCase() === \"b\"",
      "event.key.toLowerCase() === \"i\"",
      "event.key.toLowerCase() === \"k\"",
      "insertMarkdownSyntax(\"bold\")",
      "insertMarkdownSyntax(\"italic\")",
      "insertMarkdownSyntax(\"link\")",
      "indentSelectedLines(event.shiftKey)",
      "cycleMarkdownViewMode()",
      "saveCurrentNote()",
      "renderMarkdownReadView()",
      "markdownDocSearch"
    ]),
    expected: [
      "Ctrl/Cmd+S saves notes",
      "Ctrl/Cmd+F focuses in-document search",
      "Ctrl/Cmd+E cycles read/split/edit mode",
      "Ctrl/Cmd+B/I/K applies common Markdown formatting",
      "Tab indents selected lines"
    ]
  },
  {
    name: "drop_import_auto_workspace_present",
    ok: importUploadPanel.includes("ensureWorkspace")
      && appJs.includes("ensureWorkspace: ensureWorkspaceForFirstWorkflow")
      && importUploadPanel.includes("/api/import-upload")
      && importUploadPanel.includes("workspacePath()"),
    expected: [
      "drop import calls ensureWorkspace before upload",
      "upload still posts to /api/import-upload",
      "temporary workspace can be created before first file import"
    ]
  },
  {
    name: "offline_font_stack_present",
    ok: css.includes("Segoe UI")
      && css.includes("Cascadia Mono")
      && !css.includes("@import")
  }
];

const result = {
  ok: checks.every((check) => check.ok),
  checks
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
