import { listenLocalServer } from "../server/localServer.js";
import { validateI18nRuntimeTranslations } from "./i18n-runtime-check.js";
import { hasKnownMojibake } from "./mojibake-guard.js";

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const fetchBlockedPorts = new Set([4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);
const chineseUiLabel = String.fromCodePoint(0x4e2d, 0x6587, 0x754c, 0x9762);

function tagCount(html, tag, closing = false) {
  const prefix = closing ? `</${tag}` : `<${tag}`;
  return html.match(new RegExp(prefix, "g"))?.length ?? 0;
}

function hasBareClosingTag(html, tag) {
  return new RegExp(`(^|[^<])/${tag}>`).test(html);
}

function htmlShellOk(html) {
  const pairedTags = ["button", "section", "article", "div", "main", "header"];
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<link rel=\"stylesheet\" href=\"./styles.css\">",
    "<script src=\"./app-config.js\"></script>",
    "<script type=\"module\" src=\"./app.js\"></script>"
  ].every((fragment) => html.includes(fragment))
    && pairedTags.every((tag) => tagCount(html, tag) === tagCount(html, tag, true))
    && !hasBareClosingTag(html, "button")
    && !hasBareClosingTag(html, "p");
}

const requiredServedUiText = [
  "Before sending a document to AI, see what AI will see.",
  "Do not send raw files directly to AI",
  "local AI document intake layer",
  "Prepare for AI",
  "Save clean AI-ready copy",
  "Import source file",
  "Prepare current file for AI",
  "Read",
  "Edit",
  "Refresh reading view",
  "Generate exchange package",
  "Choose workspace",
  "Run first workflow"
];

function noMojibake(value) {
  return !hasKnownMojibake(value);
}

async function fetchText(baseUrl, route) {
  const response = await fetch(`${baseUrl}${route}`, { cache: "no-store" });
  const text = await response.text();
  return {
    route,
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get("content-type") ?? "",
    text
  };
}

export async function runWebUiSmoke(options = {}) {
  const preferredPort = Number(options.port ?? argValue("--port", "18190"));
  const endPort = Number(options.endPort ?? argValue("--end-port", String(preferredPort + 49)));
  let server = null;
  let port = preferredPort;
  let lastError = null;
  for (let candidate = preferredPort; candidate <= endPort; candidate += 1) {
    if (fetchBlockedPorts.has(candidate)) {
      continue;
    }
    try {
      server = await listenLocalServer({ port: candidate });
      port = candidate;
      break;
    } catch (error) {
      lastError = error;
      if (error.code !== "EADDRINUSE") {
        throw error;
      }
    }
  }
  if (!server) {
    throw lastError ?? new Error(`No available web UI smoke port from ${preferredPort} to ${endPort}.`);
  }
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const [html, appJs, activityListsPanel, alertPanel, adapterCapabilitiesPanel, aiContextPanel, aiFeedRunbookPanel, aiSendGatePanel, aiSummonPanel, documentFlowPanel, exchangePackagePanel, importUploadPanel, i18nPanel, manifestPanel, markdownWorkbenchPanel, productModePanel, queryPanel, searchResultsPanel, versionsPanel, workspaceDashboardPanel, css, appConfig] = await Promise.all([
      fetchText(baseUrl, "/"),
      fetchText(baseUrl, "/app.js"),
      fetchText(baseUrl, "/activityListsPanel.js"),
      fetchText(baseUrl, "/alertPanel.js"),
      fetchText(baseUrl, "/adapterCapabilitiesPanel.js"),
      fetchText(baseUrl, "/aiContextPanel.js"),
      fetchText(baseUrl, "/aiFeedRunbookPanel.js"),
      fetchText(baseUrl, "/aiSendGatePanel.js"),
      fetchText(baseUrl, "/aiSummonPanel.js"),
      fetchText(baseUrl, "/documentFlowPanel.js"),
      fetchText(baseUrl, "/exchangePackagePanel.js"),
      fetchText(baseUrl, "/importUploadPanel.js"),
      fetchText(baseUrl, "/i18nPanel.js"),
      fetchText(baseUrl, "/manifestPanel.js"),
      fetchText(baseUrl, "/markdownWorkbenchPanel.js"),
      fetchText(baseUrl, "/productModePanel.js"),
      fetchText(baseUrl, "/queryPanel.js"),
      fetchText(baseUrl, "/searchResultsPanel.js"),
      fetchText(baseUrl, "/versionsPanel.js"),
      fetchText(baseUrl, "/workspaceDashboardPanel.js"),
      fetchText(baseUrl, "/styles.css"),
      fetchText(baseUrl, "/app-config.js")
    ]);
    const healthResponse = await fetch(`${baseUrl}/api/health`, { cache: "no-store" });
    const health = await healthResponse.json();
    const combined = [html.text, appJs.text, activityListsPanel.text, alertPanel.text, adapterCapabilitiesPanel.text, aiContextPanel.text, aiFeedRunbookPanel.text, aiSendGatePanel.text, aiSummonPanel.text, documentFlowPanel.text, exchangePackagePanel.text, importUploadPanel.text, i18nPanel.text, manifestPanel.text, markdownWorkbenchPanel.text, productModePanel.text, queryPanel.text, searchResultsPanel.text, versionsPanel.text, workspaceDashboardPanel.text, css.text, appConfig.text].join("\n");
    const i18nRuntimeValidation = validateI18nRuntimeTranslations({
      hasMojibake: (value) => !noMojibake(value),
      servedText: i18nPanel.text,
      servedExpected: [
        "\u4e2d\u6587\u754c\u9762",
        "\u4fdd\u5b58\u5e72\u51c0 AI-ready \u526f\u672c"
      ]
    });
    const requiredIds = ["workspacePath", "runFirstWorkflow", "desktopDiagnostics", "chooseWorkspace", "chooseLocalFile", "sendGateSummary", "trustExchangePackage", "writeReceiverReport", "refreshAdapters", "adapterCapabilities", "aiSetupDialog", "setupAiNow", "setupAiLater", "changeMode", "advancedToolsToggle", "closeAiPanel", "markdownReadMode", "markdownSplitMode", "markdownEditMode", "markdownReadView", "markdownOutline", "markdownStatus", "markdownFormatToolbar", "reloadReadView", "markdownImportFile", "markdownPrepareForAi", "saveCleanAiReadyCopy", "output"];
    const checks = [
      {
        name: "routes_served",
        ok: [html, appJs, activityListsPanel, alertPanel, adapterCapabilitiesPanel, aiContextPanel, aiFeedRunbookPanel, aiSendGatePanel, aiSummonPanel, documentFlowPanel, exchangePackagePanel, importUploadPanel, i18nPanel, manifestPanel, markdownWorkbenchPanel, productModePanel, queryPanel, searchResultsPanel, versionsPanel, workspaceDashboardPanel, css, appConfig].every((item) => item.ok) && healthResponse.ok,
        statuses: {
          "/": html.status,
          "/app.js": appJs.status,
          "/activityListsPanel.js": activityListsPanel.status,
          "/alertPanel.js": alertPanel.status,
          "/adapterCapabilitiesPanel.js": adapterCapabilitiesPanel.status,
          "/aiContextPanel.js": aiContextPanel.status,
          "/aiFeedRunbookPanel.js": aiFeedRunbookPanel.status,
          "/aiSendGatePanel.js": aiSendGatePanel.status,
          "/aiSummonPanel.js": aiSummonPanel.status,
          "/documentFlowPanel.js": documentFlowPanel.status,
          "/exchangePackagePanel.js": exchangePackagePanel.status,
          "/importUploadPanel.js": importUploadPanel.status,
          "/i18nPanel.js": i18nPanel.status,
          "/manifestPanel.js": manifestPanel.status,
          "/markdownWorkbenchPanel.js": markdownWorkbenchPanel.status,
          "/productModePanel.js": productModePanel.status,
          "/queryPanel.js": queryPanel.status,
          "/searchResultsPanel.js": searchResultsPanel.status,
          "/versionsPanel.js": versionsPanel.status,
          "/workspaceDashboardPanel.js": workspaceDashboardPanel.status,
          "/styles.css": css.status,
          "/app-config.js": appConfig.status,
          "/api/health": healthResponse.status
        }
      },
      {
        name: "html_shell_ok",
        ok: htmlShellOk(html.text)
      },
      {
        name: "required_ui_ids_present",
        ok: requiredIds.every((id) => html.text.includes(`id="${id}"`)),
        missing: requiredIds.filter((id) => !html.text.includes(`id="${id}"`))
      },
      {
        name: "served_reader_facing_text_present",
        ok: requiredServedUiText.every((fragment) => combined.includes(fragment)),
        missing: requiredServedUiText.filter((fragment) => !combined.includes(fragment))
      },
      {
        name: "runtime_config_served",
        ok: appConfig.text.includes("AI_DOC_EXCHANGE_TOKEN")
          && appConfig.text.includes("SCHEMA_DOCS_API_BASE_URL")
          && appConfig.text.includes(baseUrl)
      },
      {
        name: "app_script_can_discover_local_api",
        ok: appJs.text.includes("discoverLocalApiConfig")
          && appJs.text.includes("tryApplyLocalApiConfig")
          && appJs.text.includes("/api/health")
          && appJs.text.includes("ensureWorkspace: ensureWorkspaceForFirstWorkflow")
          && importUploadPanel.text.includes("ensureWorkspace")
          && adapterCapabilitiesPanel.text.includes("/api/adapter/capabilities")
          && aiFeedRunbookPanel.text.includes("/api/ai/feed-runbook")
          && exchangePackagePanel.text.includes("/api/exchange/package/trust-report")
          && exchangePackagePanel.text.includes("/api/exchange/package/receiver-report")
      },
      {
        name: "bilingual_ui_toggle_present",
        ok: html.text.includes("id=\"uiLanguageToggle\"")
          && html.text.includes(`>${chineseUiLabel}</button>`)
          && html.text.indexOf("id=\"uiLanguageToggle\"") < html.text.indexOf("<main class=\"shell\"")
          && css.text.includes(".global-language-toggle")
          && appJs.text.includes("createI18nPanel")
          && appJs.text.includes("i18nPanel.bind()")
          && appJs.text.indexOf("const i18nPanel = createI18nPanel") < appJs.text.indexOf("const aiContextPanel = createAiContextPanel")
          && appJs.text.indexOf("i18nPanel.bind()") < appJs.text.indexOf("const aiContextPanel = createAiContextPanel")
          && i18nPanel.text.includes("schemaDocsUiLanguage")
          && i18nPanel.text.includes("zh-CN")
          && i18nPanel.text.includes("\u4e2d\u6587\u754c\u9762")
          && i18nPanel.text.includes("English UI")
          && i18nPanel.text.includes("MutationObserver")
          && i18nPanel.text.includes("originalText")
          && i18nPanel.text.includes("originalAttributes")
          && i18nPanel.text.includes("TRANSLATABLE_ATTRIBUTES")
          && i18nPanel.text.includes("applyLanguage")
          && i18nPanel.text.includes("translateText"),
        expected: [
          "language toggle button",
          "default-English bilingual UI binding",
          "Chinese locale persistence",
          "dynamic DOM translation observer",
          "original English text restoration"
        ]
      },
      {
        name: "served_bilingual_ui_runtime_translations_valid",
        ok: i18nRuntimeValidation.ok,
        cases: i18nRuntimeValidation.cases,
        fallbackOk: i18nRuntimeValidation.fallbackOk,
        servedTextOk: i18nRuntimeValidation.servedTextOk,
        expected: [
          "served bilingual module can execute runtime Chinese translations",
          "dynamic i18n pattern translations preserve interpolated filenames",
          "untranslated fallback text remains unchanged",
          "runtime translated text contains no known mojibake fragments"
        ]
      },
      {
        name: "served_product_mode_focus_route_present",
        ok: appJs.text.includes("onModeSelected: handleModeSelected")
          && appJs.text.includes("targetId = mode === \"markdown\" ? \"noteContent\" : \"sourcePath\"")
          && appJs.text.includes("maybePromptAiAssistantSetup")
          && appJs.text.includes("setAdvancedToolsVisible")
          && appJs.text.includes("setAiPanelOpen")
          && appJs.text.includes("dataset.aiPanelOpen")
          && appJs.text.includes("markdownImportFile")
          && appJs.text.includes("markdownPrepareForAi")
          && appJs.text.includes("createMarkdownWorkbenchPanel")
          && appJs.text.includes("setMarkdownViewMode")
          && appJs.text.includes("renderMarkdownReadView")
          && html.text.includes("id=\"loadFullMarkdown\"")
          && appJs.text.includes("loadFullCurrentMarkdownFile")
          && markdownWorkbenchPanel.text.includes("renderMarkdownOutline")
          && markdownWorkbenchPanel.text.includes("renderMarkdownDocMeta")
          && markdownWorkbenchPanel.text.includes("markdownDocSearch")
          && markdownWorkbenchPanel.text.includes("wiki-link")
          && markdownWorkbenchPanel.text.includes("markdown-frontmatter")
          && markdownWorkbenchPanel.text.includes("markdown-callout")
          && markdownWorkbenchPanel.text.includes("footnote-ref")
          && markdownWorkbenchPanel.text.includes("syncSplitScroll")
          && markdownWorkbenchPanel.text.includes("insertMarkdownSyntax")
          && markdownWorkbenchPanel.text.includes("markdownStats")
          && markdownWorkbenchPanel.text.includes("keydown")
          && appJs.text.includes("readableRelativePathForRecord")
          && appJs.text.includes("saveCleanAiReadyCopy")
          && combined.includes("readableMarkdownPath")
          && documentFlowPanel.text.includes("relativeHumanMarkdownPath")
          && documentFlowPanel.text.includes("record?.readableMarkdownPath || record?.markdownOutputs?.readable || record?.outputMarkdownPath")
          && manifestPanel.text.includes("relativeHumanMarkdownPath")
          && manifestPanel.text.includes("record?.readableMarkdownPath || record?.markdownOutputs?.readable || record?.outputMarkdownPath")
          && manifestPanel.text.includes("relativeAiReadyMarkdownPath")
          && css.text.includes("markdown-read-view")
          && css.text.includes("markdown-editor-shell")
          && css.text.includes("markdown-outline-panel")
          && css.text.includes("body[data-markdown-view=\"split\"]")
          && aiContextPanel.text.includes("web-ui-clean-ai-ready-copy")
          && documentFlowPanel.text.includes("ensureWorkspaceIfNeeded")
          && appJs.text.includes("schemaDocsAdvancedTools")
          && appJs.text.includes("schemaDocsAiAssistantPrompted")
          && appJs.text.includes("function handleSetupAiLater()")
          && appJs.text.includes("function handleSetupAiNow()")
          && appJs.text.includes("async function handleMarkdownImportFile()")
          && appJs.text.includes("async function handleMarkdownPrepareForAi()")
          && productModePanel.text.includes("document.body.dataset.productModeConfigured")
          && productModePanel.text.includes("onModeSelected(normalizedMode)")
          && appJs.text.includes("setupAiLater\")?.addEventListener(\"click\", handleSetupAiLater)")
          && appJs.text.includes("setupAiNow\")?.addEventListener(\"click\", handleSetupAiNow)")
          && appJs.text.includes("markdownImportFile\")?.addEventListener(\"click\", () => run(handleMarkdownImportFile))")
          && appJs.text.includes("markdownPrepareForAi\")?.addEventListener(\"click\", () => run(handleMarkdownPrepareForAi))")
          && appJs.text.indexOf("productModeOffice\").addEventListener") < appJs.text.indexOf("const aiContextPanel = createAiContextPanel")
          && appJs.text.indexOf("firstRunMarkdownMode\").addEventListener") < appJs.text.indexOf("const aiContextPanel = createAiContextPanel")
          && appJs.text.indexOf("setupAiLater\")?.addEventListener") < appJs.text.indexOf("const aiContextPanel = createAiContextPanel")
          && appJs.text.indexOf("setupAiNow\")?.addEventListener") < appJs.text.indexOf("const aiContextPanel = createAiContextPanel")
          && appJs.text.indexOf("markdownImportFile\")?.addEventListener") < appJs.text.indexOf("const aiContextPanel = createAiContextPanel")
          && appJs.text.indexOf("markdownPrepareForAi\")?.addEventListener") < appJs.text.indexOf("const aiContextPanel = createAiContextPanel")
      },
      {
        name: "health_ok",
        ok: health.ok === true && health.data?.service === "schema-docs-local-api"
      },
      {
        name: "no_served_mojibake",
        ok: noMojibake(combined)
      },
      {
        name: "offline_assets",
        ok: css.text.includes("Segoe UI")
          && css.text.includes("Cascadia Mono")
          && !combined.includes("fonts.googleapis.com")
      }
    ];

    return {
      ok: checks.every((check) => check.ok),
      baseUrl,
      port,
      scanRange: `127.0.0.1:${preferredPort}-${endPort}`,
      checks
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const result = await runWebUiSmoke();
console.log(JSON.stringify(result, null, 2));
if (!result.ok) {
  process.exitCode = 1;
}
