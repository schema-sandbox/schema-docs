import { createActivityListsPanel } from "./activityListsPanel.js";
import { createAdapterCapabilitiesPanel } from "./adapterCapabilitiesPanel.js";
import { showAlert } from "./alertPanel.js";
import { createAiContextPanel } from "./aiContextPanel.js";
import { createAiAssistantPanel } from "./aiAssistantPanel.js";
import { createAiFeedRunbookPanel } from "./aiFeedRunbookPanel.js";
import { createAiSendGatePanel } from "./aiSendGatePanel.js";
import { createAiSummonPanel } from "./aiSummonPanel.js";
import { createDocumentFlowPanel } from "./documentFlowPanel.js";
import { createExchangePackagePanel } from "./exchangePackagePanel.js";
import { createImportUploadPanel } from "./importUploadPanel.js";
import { createI18nPanel } from "./i18nPanel.js";
import { createManifestPanel } from "./manifestPanel.js";
import { createMarkdownWorkbenchPanel } from "./markdownWorkbenchPanel.js";
import { createProductModePanel } from "./productModePanel.js";
import { createQueryPanel } from "./queryPanel.js";
import { createSearchResultsPanel } from "./searchResultsPanel.js";
import { createVersionsPanel } from "./versionsPanel.js";
import { createWorkspaceDashboardPanel } from "./workspaceDashboardPanel.js";
import { configureFirstReleaseUi } from "./firstReleaseUi.js";

const firstReleaseStylesheet = document.createElement("link");
firstReleaseStylesheet.rel = "stylesheet";
firstReleaseStylesheet.href = "./firstRelease.css";
document.head.append(firstReleaseStylesheet);

const state = {
workspacePath: localStorage.getItem("workspacePath")?.includes("\ufffd") ? "" : (localStorage.getItem("workspacePath") ?? ""),
apiBaseUrl: localStorage.getItem("schemaDocsApiBaseUrl") ?? "",
  productMode: localStorage.getItem("schemaDocsProductMode") || "office",
  productModeConfigured: true,
  advancedToolsVisible: false,
aiAssistantPrompted: localStorage.getItem("schemaDocsAiAssistantPrompted") === "true",
aiPanelOpen: false,
activeView: localStorage.getItem("schemaDocsActiveView") ?? "home",
markdownViewMode: "edit",
lastAiAuditId: "",
lastAiResult: "",
lastQueryResult: null,
selectedApiProfileId: "",
selectedConversionAuditId: "",
selectedEvidenceId: "",
lastMaskMapping: null,
lastReviewedAiContextSignature: "",
stagedAiContextDirty: false,
lastAiContinuation: null,
lastAiContextEvidenceId: "",
lastAiFeedRunbookPath: "",
lastAiFeedRunbook: null,
lastAiFeedRunbookBatch: null,
markdownBaseline: null,
markdownDirty: false
};
const largeEditorLoadSourceBytes = 5 * 1024 * 1024;
const $ = (id) => document.getElementById(id);
const importFileInput = $("fileInput");
if (importFileInput) importFileInput.accept = ".md,.markdown,.docx,.pptx,.pdf,.txt,.csv,.xlsx,.xls";
const markdownImportButton = $("markdownImportFile");
if (markdownImportButton) markdownImportButton.textContent = "Import document";
const dropFormats = document.querySelector(".drop-formats");
if (dropFormats) dropFormats.textContent = "Markdown, Word, PowerPoint, PDF, Excel, CSV, TXT";
function print(value) {
$("output").textContent = JSON.stringify(value, null, 2);
}
function escapeHtml(value) {
return String(value ?? "")
.replace(/&/g, "&amp;")
.replace(/</g, "&lt;")
.replace(/>/g, "&gt;")
.replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");
}
function statusClass(value) {
 if (["trusted", "pass", "allow", "allowed"].includes(String(value))) {
  return "trust-pass";
 }
 if (["blocked", "fail", "never_send", "review_required"].includes(String(value))) {
  return "trust-fail";
 }
 return "trust-warning";
}
function pill(label, dataset = {}) {
 const button = document.createElement("button");
 button.className = "pill";
 button.type = "button";
 button.textContent = label;
 for (const [key, value] of Object.entries(dataset)) {
  button.dataset[key] = value;
 }
 return button;
}
function shouldUseChunkedEditorLoad(record = {}) {
 const readableCharacters = Number(record.markdownOutputs?.readableStats?.characters || 0);
 if (readableCharacters > 0) return readableCharacters >= largeEditorLoadSourceBytes;
 return Number(record.sourceSize || 0) >= largeEditorLoadSourceBytes;
}
function showChunkedEditorPlaceholder(record, relativePath) {
 const segments = record.markdownOutputs?.readableSegments;
 const firstSegment = segments?.segments?.[0]?.relativePath || "";
 const segmentCount = segments?.segmentCount || segments?.segments?.length || 0;
 $("noteContent").value = [
  `# ${record.title || record.name || record.id}`,
  "",
  "> Large file notice: this editor is not showing the whole document yet.",
  "> The document was split into numbered parts to keep the editor responsive.",
  "> Save and normal export use only the currently loaded file. Use merged export for the full document.",
  "",
  `- Record: ${record.id}`,
  `- Parts: ${segmentCount || "not segmented"}`,
  `- Full index: ${segments?.indexRelativePath || relativePath}`,
  `- First part: ${firstSegment || "not segmented"}`,
  ""
 ].join("\n");
}
function readableRelativePathForRecord(record) {
 const workspaceRoot = state.workspacePath || "";
 let target = record?.markdownOutputs?.defaultForHumans || record?.readableMarkdownPath || record?.markdownOutputs?.readable || record?.outputMarkdownPath || "";
 if (workspaceRoot && target.startsWith(workspaceRoot)) {
  target = target.slice(workspaceRoot.length).replace(/^[\\\/]+/, "").replace(/\\/g, "/");
 }
 return target;
}
function aiReadyRelativePathForRecord(record) {
 const workspaceRoot = state.workspacePath || "";
 let target = record?.outputMarkdownPath || record?.markdownOutputs?.aiReady || "";
 if (workspaceRoot && target.startsWith(workspaceRoot)) {
  target = target.slice(workspaceRoot.length).replace(/^[\\\/]+/, "").replace(/\\/g, "/");
 }
 return target;
}
function showExtractionPaths(record, readablePath) {
 const aiReadyPath = aiReadyRelativePathForRecord(record);
 showAlert("success", [
  "Document extracted.",
  `Readable Markdown: ${readablePath || "not available"}`,
  `AI-ready Markdown: ${aiReadyPath || "not available"}`
 ].join("\n"));
}
function setExtractionProgress(active, text = "Extracting to Markdown. Large PDFs take a while; keep window open.") {
 const panel = $("extractionProgress"), label = $("extractionProgressText"); if (!panel) return; panel.classList.toggle("hidden", !active); panel.dataset.active = active ? "true" : "false"; if (label) label.textContent = text;
}
function clickRun(id, action) {
 $(id).addEventListener("click", () => run(action));
}
function appendNoticeList(container, title, items, color = "") {
 if (!items?.length) return;
 const label = document.createElement("div");
 label.style.fontWeight = "600";
 label.style.fontSize = "13px";
 label.style.marginTop = "8px";
 label.textContent = title;
 container.appendChild(label);
 const list = document.createElement("ul");
 list.style.margin = "4px 0";
 list.style.paddingLeft = "20px";
 list.style.fontSize = "13px";
 if (color) list.style.color = color;
 items.forEach((item) => {
  const li = document.createElement("li");
  li.textContent = item;
  list.appendChild(li);
 });
 container.appendChild(list);
}
function miniActionButton(label, color, action) {
 const button = document.createElement("button");
 button.className = "mini-refresh-btn";
 button.type = "button";
 button.style.backgroundColor = color;
 button.style.color = "#ffffff";
 button.textContent = label;
 button.addEventListener("click", () => run(action));
 return button;
}
async function showEditorWarningsForRecord(record) {
 const container = $("editorWarnings");
 container.innerHTML = "";
 if (!record) {
  container.classList.add("hidden");
  return;
 }
 state.selectedRecord = record;
 container.className = "editor-warnings-bar";
 const leftDiv = document.createElement("div");
 leftDiv.className = "editor-warnings-left";
  if (record.quality) {
   const qState = record.quality.qualityState || (record.quality.confidence === "low" ? "ocr_required" : "clean_readable");
   const qBadge = document.createElement("span");
   qBadge.style.fontSize = "11px";
   qBadge.style.padding = "2px 8px";
   qBadge.style.borderRadius = "12px";
   qBadge.style.fontWeight = "600";
   qBadge.style.marginRight = "6px";

   let stateText = "Clean & Readable";
   let bgCol = "rgba(16, 185, 129, 0.15)";
   let textCol = "#10b981";

   if (qState === "blocked_untrusted") {
    stateText = "Blocked / Untrusted";
    bgCol = "rgba(239, 68, 68, 0.2)";
    textCol = "#ef4444";
   } else if (qState === "ocr_required") {
    stateText = "OCR Required";
    bgCol = "rgba(249, 115, 22, 0.2)";
    textCol = "#f97316";
   } else if (qState === "review_required") {
    stateText = "Review Required";
    bgCol = "rgba(245, 158, 11, 0.2)";
    textCol = "#f59e0b";
   }

   qBadge.style.backgroundColor = bgCol;
   qBadge.style.color = textCol;
   qBadge.textContent = window.translateText ? window.translateText(stateText) : stateText;
   leftDiv.appendChild(qBadge);

   const confBadge = document.createElement("span");
   confBadge.style.fontSize = "11px";
   confBadge.style.padding = "2px 8px";
   confBadge.style.borderRadius = "12px";
   confBadge.style.fontWeight = "500";
   confBadge.style.marginRight = "6px";
   const conf = record.quality.confidence;
   confBadge.style.backgroundColor = conf === "high" ? "rgba(16, 185, 129, 0.1)" : conf === "medium" ? "rgba(245, 158, 11, 0.1)" : "rgba(239, 68, 68, 0.1)";
   confBadge.style.color = conf === "high" ? "#10b981" : conf === "medium" ? "#f59e0b" : "#ef4444";
   confBadge.textContent = `Confidence: ${conf}`;
   leftDiv.appendChild(confBadge);
  }
 let sourceChanged = false;
 let lastRefreshed = "";
 try {
  const preview = await api("/api/record/refresh-preview", { recordId: record.id });
  if (preview) {
   sourceChanged = preview.sourceChanged;
   if (preview.lastExtractedTime) {
    lastRefreshed = new Date(preview.lastExtractedTime).toLocaleTimeString();
   }
  }
 } catch (e) {
 }
 const changeBadge = document.createElement("span");
 changeBadge.style.fontSize = "11px";
 changeBadge.style.padding = "2px 8px";
 changeBadge.style.borderRadius = "12px";
 changeBadge.style.fontWeight = "500";
 changeBadge.style.backgroundColor = sourceChanged ? "rgba(239, 68, 68, 0.2)" : "rgba(16, 185, 129, 0.1)";
 changeBadge.style.color = sourceChanged ? "#ef4444" : "#10b981";
 changeBadge.textContent = sourceChanged ? "Source modified" : "Source synced";
 leftDiv.appendChild(changeBadge);
 const infoText = document.createElement("span");
 infoText.style.marginLeft = "4px";
 if (sourceChanged) {
  infoText.innerHTML = `[Warning] External edits detected! Click <strong style="color:var(--primary)">Refresh</strong> to reload.`;
 } else {
  infoText.textContent = lastRefreshed ? `Refreshed at ${lastRefreshed}` : "Markdown workspace active";
 }
 leftDiv.appendChild(infoText);
 if (record.sourceType === "pdf" && record.status === "ready" && !record.pdfDiagnosticsPath) {
  const legacyBlock = document.createElement("div");
  legacyBlock.style.width = "100%";
  legacyBlock.style.marginTop = "4px";
  legacyBlock.style.color = "#f59e0b";
  legacyBlock.style.fontSize = "12px";
  const legacyMsg = window.translateText ? window.translateText("Legacy low-readable PDF output normalized. Retry extraction for a fresh result.") : "Legacy low-readable PDF output normalized. Retry extraction for a fresh result.";
  legacyBlock.append("[!] ");
  const strong = document.createElement("strong");
  strong.textContent = "Warning:";
  legacyBlock.append(strong, ` ${legacyMsg}`);
  leftDiv.appendChild(legacyBlock);
 }
 if (record.extractionQuality && record.extractionQuality.lowReadableText) {
  const warningBlock = document.createElement("div");
  warningBlock.style.width = "100%";
  warningBlock.style.marginTop = "4px";
  warningBlock.style.color = "#f59e0b";
  warningBlock.style.fontSize = "12px";
  warningBlock.innerHTML = `[!] <strong>Notice:</strong> Extracted PDF text layer is low-readable/scanned. Run OCR or import a searchable text-layer PDF before sending to AI.`;
  leftDiv.appendChild(warningBlock);
 } else if (record.warnings && record.warnings.length > 0) {
  const importantWarnings = record.warnings.filter(w => w.includes("mojibake") || w.includes("No readable text") || w.includes("Low-readable"));
  if (importantWarnings.length > 0) {
   const warningBlock = document.createElement("div");
   warningBlock.style.width = "100%";
   warningBlock.style.marginTop = "4px";
   warningBlock.style.color = "#f59e0b";
   warningBlock.style.fontSize = "12px";
   warningBlock.append("[!] ");
   const strong = document.createElement("strong");
   strong.textContent = "Warning:";
   warningBlock.append(strong, ` ${importantWarnings[0]}`);
   leftDiv.appendChild(warningBlock);
  }
 }
 container.appendChild(leftDiv);
 const rightDiv = document.createElement("div");
 rightDiv.className = "editor-warnings-right";
 const reproBtn = miniActionButton("Repro script", "var(--primary)", async () => {
  const res = await api("/api/repro-script", { recordId: record.id });
  showAlert("success", "Repro script generated and copied to clipboard.");
  navigator.clipboard.writeText(res.markdown);
  return res;
 });
 rightDiv.appendChild(reproBtn);
 const copySummaryBtn = miniActionButton("Copy debug summary", "#3b82f6", async () => {
  try {
   const health = await api("/api/health");
   const appMode = health.diagnostics?.appMode || "unknown";
   const summary = [
    `Workspace path: ${state.workspacePath || "-"}`,
    `Selected record ID: ${state.selectedRecord?.id || "-"}`,
    `Selected file path: ${state.selectedRecord?.sourcePath || "-"}`,
    `Output markdown path: ${state.selectedRecord?.outputMarkdownPath || "-"}`,
    `Readable markdown path: ${state.selectedRecord?.readableMarkdownPath || "-"}`,
    `Extraction quality: ${JSON.stringify(state.selectedRecord?.extractionQuality || {})}`,
    `Warnings: ${(state.selectedRecord?.warnings || []).join("; ") || "none"}`,
    `Current app mode: ${appMode}`
   ].join("\n");
   await navigator.clipboard.writeText(summary);
   showAlert("success", "Debug summary copied to clipboard.");
  } catch (err) {
   showAlert("error", "Failed to copy debug summary: " + err.message);
  }
 });
 rightDiv.appendChild(copySummaryBtn);
 const refreshBtn = miniActionButton("Refresh source", "#10b981", async () => {
  showAlert("info", "Refreshing source file and re-extracting...");
  const res = await api("/api/record/refresh", { recordId: record.id });
  if (res.kind === "document" && res.record.outputMarkdownPath) {
   const relPath = readableRelativePathForRecord(res.record);
   $("notePath").value = relPath;
   if (shouldUseChunkedEditorLoad(res.record)) {
    showChunkedEditorPlaceholder(res.record, relPath);
   } else {
    const noteContent = await api("/api/markdown/read", { relativePath: relPath });
    $("noteContent").value = noteContent;
   }
   showEditorWarningsForRecord(res.record);
   if (res.diff) {
    let diffMsg = `<strong style="color:#34d399">Re-extraction done</strong><div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:11px"><span>Chars:</span><span style="font-weight:700;color:${res.diff.charCountDelta >= 0 ? '#34d399' : '#f87171'}">${res.diff.charCountDelta >= 0 ? '+' : ''}${res.diff.charCountDelta}</span><span>Headings:</span><span style="font-weight:700;color:${res.diff.headingsDelta >= 0 ? '#34d399' : '#f87171'}">${res.diff.headingsDelta >= 0 ? '+' : ''}${res.diff.headingsDelta}</span><span>Tables:</span><span style="font-weight:700;color:${res.diff.tableCountDelta >= 0 ? '#34d399' : '#f87171'}">${res.diff.tableCountDelta >= 0 ? '+' : ''}${res.diff.tableCountDelta}</span></div>`;
    showAlert("success", diffMsg);
   } else {
    showAlert("success", "Source file refreshed and extracted.");
   }
  } else {
   showAlert("success", "Dataset source file refreshed.");
  }
  await refreshManifest();
  refreshTimeline();
  refreshVersions();
  return res;
 });
 rightDiv.appendChild(refreshBtn);
 container.appendChild(rightDiv);
 container.classList.remove("hidden");
}
function timestampForPath() {
 return new Date().toISOString().replace(/[:.]/g, "-");
}
function workspacePath() {
 const value = $("workspacePath").value.trim();
 if (!value) throw new Error("Enter a workspace path first.");
 setWorkspacePath(value);
 return value;
}
function setWorkspacePath(value) {
 $("workspacePath").value = value;
 state.workspacePath = value;
 localStorage.setItem("workspacePath", value);
}
function focusPrimaryWorkspaceMode(mode) {
 const targetId = mode === "markdown" ? "noteContent" : "sourcePath";
 const target = $(targetId);
 if (!target) {
  return;
 }
 target.scrollIntoView({ behavior: "smooth", block: "center" });
 window.setTimeout(() => target.focus(), 150);
}
function syncProgressiveUiState() {
 document.body.dataset.productMode = state.productMode || "markdown";
 document.body.dataset.advancedTools = state.advancedToolsVisible ? "true" : "false";
 document.body.dataset.aiPanelOpen = state.aiPanelOpen ? "true" : "false";
 document.body.dataset.productModeConfigured = state.productModeConfigured ? "true" : "false";
 document.body.dataset.activeView = state.activeView || "home";
 document.body.dataset.markdownView = ["read", "split", "edit"].includes(state.markdownViewMode) ? state.markdownViewMode : "edit";
 const toggle = $("advancedToolsToggle");
 if (toggle) {
    toggle.textContent = state.advancedToolsVisible ? "Hide developer tools" : "Developer tools";
  toggle.classList.toggle("active", state.advancedToolsVisible);
  toggle.setAttribute("aria-pressed", state.advancedToolsVisible ? "true" : "false");
 }
}
function setAiPanelOpen(open) {
 state.aiPanelOpen = Boolean(open);
 syncProgressiveUiState();
}
function setAdvancedToolsVisible(visible) {
 state.advancedToolsVisible = Boolean(visible);
 localStorage.setItem("schemaDocsAdvancedTools", state.advancedToolsVisible ? "true" : "false");
 syncProgressiveUiState();
}
function closeAiSetupDialog() {
 state.aiAssistantPrompted = true;
 localStorage.setItem("schemaDocsAiAssistantPrompted", "true");
 $("aiSetupDialog")?.classList.add("hidden");
}
function updateOfficeReaderShell() {
 const shell = $("officeReaderShell");
 if (!shell) return;
 const record = state.currentRecord;
 if (!record) {
  $("officeShellPath").textContent = "No document loaded";
  $("officeShellStatus").textContent = "Idle";
  $("officeShellExtraction").textContent = "Not processed";
  $("officeShellFileBadge").textContent = "Unknown Document";
  $("officeShellTitle").textContent = "Office Document View";
  return;
 }
 const origPath = record.originalPath || record.path || record.sourcePath || "Unknown path";
 $("officeShellPath").textContent = origPath;
 const fileName = origPath.split(/[/\\]/).pop() || record.id || "Document";
 $("officeShellTitle").textContent = fileName;
 const ext = fileName.split(".").pop().toLowerCase();
 let typeLabel = "Word Document";
 if (["xlsx", "xls", "csv"].includes(ext)) {
  typeLabel = "Excel/Spreadsheet";
 } else if (ext === "pptx") {
  typeLabel = "PowerPoint Presentation";
 } else if (ext === "pdf") {
  typeLabel = "PDF Document";
 } else if (["md", "txt"].includes(ext)) {
  typeLabel = "Text/Markdown";
 } else if (["wps", "doc"].includes(ext)) {
  typeLabel = "WPS Document";
 }
 $("officeShellFileBadge").textContent = typeLabel;
 let statusText = "Ready for Word/WPS Extraction";
 if (["xlsx", "xls", "csv"].includes(ext)) {
  statusText = "Ready for Excel/CSV Grid";
 } else if (ext === "pptx") {
  statusText = "Ready for PowerPoint Extraction";
 } else if (ext === "pdf") {
  statusText = "Ready for PDF Extraction";
 } else if (["md", "txt"].includes(ext)) {
  statusText = "Ready for Plain Text View";
 }
 $("officeShellStatus").textContent = statusText;
 const hasExtracted = Boolean(record.outputMarkdownPath || record.extractedText || $("noteContent").value.trim());
 if (hasExtracted) {
  const charCount = $("noteContent").value.length;
  $("officeShellExtraction").textContent = `Synced (extracted ${charCount} characters to sandbox)`;
 } else {
  $("officeShellExtraction").textContent = "Pending (Not synced to sandbox)";
 }
}
window.updateOfficeReaderShell = updateOfficeReaderShell;
function setActiveView(view) {
 let targetView = view;
 if (state.productMode === "markdown" && view === "home") {
  targetView = "editor";
 }
 state.activeView = targetView;
 document.body.dataset.activeView = targetView;
 localStorage.setItem("schemaDocsActiveView", targetView);
 updateOfficeReaderShell();
}
function maybePromptAiAssistantSetup() {
 const prompted = localStorage.getItem("schemaDocsAiAssistantPrompted") === "true";
 if (!prompted && !state.apiKey) {
  $("aiSetupDialog")?.classList.remove("hidden");
 } else {
  state.aiAssistantPrompted = true;
  localStorage.setItem("schemaDocsAiAssistantPrompted", "true");
 }
}
function handleModeSelected(mode) {
 setAiPanelOpen(false);
 if (mode === "markdown") {
  setActiveView("editor");
 } else {
  setActiveView("home");
 }
 syncProgressiveUiState();
 focusPrimaryWorkspaceMode(mode);
 maybePromptAiAssistantSetup();
}
function handleSetupAiLater() {
 closeAiSetupDialog();
 focusPrimaryWorkspaceMode(state.productMode);
}
function handleSetupAiNow() {
 closeAiSetupDialog();
 setAdvancedToolsVisible(true);
 setAiPanelOpen(true);
 $("apiProfileName")?.scrollIntoView({ behavior: "smooth", block: "center" });
 window.setTimeout(() => $("apiProfileName")?.focus(), 150);
}
function localApiBaseUrl() {
 const configured = window.SCHEMA_DOCS_API_BASE_URL || state.apiBaseUrl;
 if (configured) {
  state.apiBaseUrl = configured.replace(/\/$/, "");
  localStorage.setItem("schemaDocsApiBaseUrl", state.apiBaseUrl);
  return state.apiBaseUrl;
 }
 if (window.location.protocol === "http:" || window.location.protocol === "https:") return window.location.origin;
 state.apiBaseUrl = "http://127.0.0.1:4190";
 localStorage.setItem("schemaDocsApiBaseUrl", state.apiBaseUrl);
 return state.apiBaseUrl;
}
function apiUrl(route) {
 if (/^https?:\/\//.test(route)) {
  return route;
 }
 return `${localApiBaseUrl()}${route}`;
}
function tauriInvoke(command, args = {}) {
 const globalInvoke = window.__TAURI__?.core?.invoke;
 if (typeof globalInvoke === "function") return globalInvoke(command, args);
 const internalInvoke = window.__TAURI_INTERNALS__?.invoke;
 if (typeof internalInvoke === "function") return internalInvoke(command, args);
 throw new Error("Native desktop bridge is not available in this browser context.");
}
async function bindDesktopAiSummonEvent() {
 const listen = window.__TAURI__?.event?.listen;
 if (typeof listen !== "function") return { bound: false, reason: "tauri_event_api_unavailable" };
 await listen("schema-docs-ai-summon", (event) => {
  if (event?.payload?.clipboardText) {
   run(() => aiSummonPanel.summonAiGate({
    source: event?.payload?.source ?? "desktop-command",
    target: event?.payload?.target ?? "ai-send-gate",
    shortcut: event?.payload?.shortcut ?? "",
    clipboardText: event.payload.clipboardText
   }));
  } else {
   aiAssistantPanel.open();
  }
 });
 return { bound: true, event: "schema-docs-ai-summon" };
}
const localApiDiscovery = {
 host: "127.0.0.1",
 startPort: 4177,
 endPort: 4199,
 fetchBlockedPorts: new Set([4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080])
};
function applyAppConfigScript(script) {
 const token = /AI_DOC_EXCHANGE_TOKEN\s*=\s*"([^"]*)"/.exec(script)?.[1];
const apiBaseUrl = /SCHEMA_DOCS_API_BASE_URL\s*=\s*"([^"]*)"/.exec(script)?.[1];
 if (token) {
  window.AI_DOC_EXCHANGE_TOKEN = token;
 }
 if (apiBaseUrl) {
  window.SCHEMA_DOCS_API_BASE_URL = apiBaseUrl;
  state.apiBaseUrl = apiBaseUrl.replace(/\/$/, "");
  localStorage.setItem("schemaDocsApiBaseUrl", state.apiBaseUrl);
 }
}
async function tryApplyLocalApiConfig(baseUrl) {
 const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
 try {
  const healthResponse = await fetch(`${normalizedBaseUrl}/api/health`, {
   cache: "no-store"
  });
  if (!healthResponse.ok) return false;
  const health = await healthResponse.json();
  if (health?.data?.service !== "schema-docs-local-api") return false;
  const configResponse = await fetch(`${normalizedBaseUrl}/app-config.js`, {
   cache: "no-store"
  });
  if (!configResponse.ok) return false;
  applyAppConfigScript(await configResponse.text());
  state.apiBaseUrl = (window.SCHEMA_DOCS_API_BASE_URL || normalizedBaseUrl).replace(/\/$/, "");
  localStorage.setItem("schemaDocsApiBaseUrl", state.apiBaseUrl);
  return Boolean(window.AI_DOC_EXCHANGE_TOKEN);
 } catch {
  return false;
 }
}
async function discoverLocalApiConfig() {
 const candidates = [localApiBaseUrl()];
 for (let port = localApiDiscovery.startPort; port <= localApiDiscovery.endPort; port += 1) {
  if (localApiDiscovery.fetchBlockedPorts.has(port)) {
   continue;
  }
  candidates.push(`http://127.0.0.1:${port}`);
 }
 for (const baseUrl of [...new Set(candidates)]) {
  if (await tryApplyLocalApiConfig(baseUrl)) {
   return true;
  }
 }
 return false;
}
async function ensureLocalApiConfig() {
 if (window.AI_DOC_EXCHANGE_TOKEN) {
  return;
 }
 if (await discoverLocalApiConfig()) {
  return;
 }
 const { startPort, endPort } = localApiDiscovery;
 throw new Error(`Cannot connect to the local API service. Please run \`npm run serve\`, check Node.js installation (v22+), and view Desktop diagnostics.`);
}
async function api(path, body = {}) {
 return postApiPayload(path, { workspacePath: workspacePath(), ...body }, " Start the local server with npm run serve, or resolve the desktop runtime bridge before using the packaged app.");
}
async function apiWithoutWorkspace(path, body = {}) {
 return postApiPayload(path, body);
}
async function postApiPayload(path, body = {}, hint = "") {
 let response;
 await ensureLocalApiConfig();
 const url = apiUrl(path);
 try {
  response = await fetch(url, {
   method: "POST",
   headers: {
    "content-type": "application/json",
    "x-ai-doc-exchange-token": window.AI_DOC_EXCHANGE_TOKEN ?? ""
   },
   body: JSON.stringify(body)
  });
 } catch {
  throw new Error(`Local API is not reachable at ${url}.${hint}`);
 }
 return readApiPayload(response, url);
}
async function readApiPayload(response, url) {
 let payload;
 try {
  payload = await response.json();
 } catch {
  throw new Error(`Local API returned a non-JSON response for ${url}. Check that the Schema Docs local server is running.`);
 }
 if (!payload.ok) {
  const code = payload.error?.code ?? "error";
  const msg = payload.error?.message ?? "Unknown error";
  const guidance = payload.error?.guidance ?? "";
  throw new Error(guidance ? `${code}: ${msg} - ${guidance}` : `${code}: ${msg}`);
 }
 return payload.data;
}
async function run(action) {
 const e = window.event;
 const btn = e && (e.currentTarget || (e.target && e.target.closest("button, a")));
 const isBtn = btn && (btn.tagName === "BUTTON" || btn.tagName === "A");
 let origHtml, origText;
 if (isBtn) {
  if (btn.disabled || btn.getAttribute("aria-busy") === "true") return;
  origHtml = btn.innerHTML;
  origText = btn.textContent;
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  let t = "Processing...";
  if (origText.includes("Export") || origText.includes("\u5bfc\u51fa")) t = "Exporting...";
  else if (origText.includes("Import") || origText.includes("\u5bfc\u5165")) t = "Importing...";
  else if (origText.includes("Sanitize") || origText.includes("\u8131\u654f")) t = "Sanitizing...";
  btn.textContent = window.translateText ? window.translateText(t) : t;
 }
 try {
  const value = await action();
  print(value);
  if (isBtn) {
   btn.textContent = window.translateText ? window.translateText("Success") : "Success";
   btn.classList.add("btn-success-state");
   setTimeout(() => {
    btn.innerHTML = origHtml;
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
    btn.classList.remove("btn-success-state");
   }, 1000);
  }
  return value;
 } catch (error) {
  print({ ok: false, message: error.message });
  showAlert("error", error.message);
  if (isBtn) {
   btn.textContent = window.translateText ? window.translateText("Failed") : "Failed";
   btn.classList.add("btn-error-state");
   setTimeout(() => {
    btn.innerHTML = origHtml;
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
    btn.classList.remove("btn-error-state");
   }, 1500);
  }
 }
}
async function refreshManifest() {
 try {
  const [manifest, capabilities, adapterCapabilities, updates] = await Promise.all([
   api("/api/manifest"),
   api("/api/document/capabilities"),
   apiGet("/api/adapter/capabilities"),
   api("/api/workspace/detect-source-changes", {}).catch(() => [])
  ]);
  state.changedRecordIds = new Set((updates || []).filter((u) => u.changed).map((u) => u.id));
  state.missingRecordIds = new Set((updates || []).filter((u) => u.missing).map((u) => u.id));
  manifestPanel.renderManifest(manifest);
  renderApiProfiles(manifest.apiProfiles ?? []);
  renderFormatMatrix(capabilities);
  adapterCapabilitiesPanel.renderAdapterCapabilities(adapterCapabilities);
  return manifest;
 } catch (err) {
 }
}
async function ensureWorkspaceForFirstWorkflow() {
 if ($("workspacePath").value.trim()) {
  await api("/api/workspace/open");
  return {
   workspacePath: $("workspacePath").value.trim(),
   created: false
  };
 }
 const created = await apiWithoutWorkspace("/api/workspace/create-temp");
 setWorkspacePath(created.workspacePath);
 manifestPanel.renderManifest(created.manifest);
 return {
  workspacePath: created.workspacePath,
  created: true
 };
}
async function runFirstWorkflow() {
 const workspace = await ensureWorkspaceForFirstWorkflow();
 const notePath = "notes/first-workflow.md";
 const noteContent = [
  "# First Workflow",
  "",
  "Office, PDF, and spreadsheet files are the visible user entry.",
  "",
  "- Markdown is the exchange layer for AI preview, audit, API, and package handoff.",
  "- Export the exchange copy to Word and PDF.",
  "- Import Word back through the same local API.",
  ""
 ].join("\n");
 $("notePath").value = notePath;
 $("noteContent").value = noteContent;
 refreshMarkdownExportPaths(notePath);
 await api("/api/markdown/save", {
  relativePath: notePath,
  content: noteContent
 });
 const markdownDocx = await api("/api/markdown/export", {
  relativePath: notePath,
  outputRelativePath: "exports/first-workflow.docx",
  format: "docx"
 });
 const markdownPdf = await api("/api/markdown/export", {
  relativePath: notePath,
  outputRelativePath: "exports/first-workflow.pdf",
  format: "pdf"
 });
 const markdownHtml = await api("/api/markdown/export", {
  relativePath: notePath,
  outputRelativePath: "exports/first-workflow.html",
  format: "html"
 });
 const sample = await api("/api/samples/docx");
 $("sourcePath").value = sample.sourcePath;
 $("recordId").value = sample.document.id;
 const extracted = await api("/api/document/convert", {
  documentId: sample.document.id
 });
 const importedPdf = await api("/api/document/export", {
  documentId: sample.document.id,
  outputRelativePath: "exports/first-workflow-imported.pdf",
  format: "pdf"
 });
 const normalized = await api("/api/normalize", {
  packageRelativePath: "packages/first-workflow",
  input: {
   title: "First Workflow Package",
   body: "Visible UI workflow package generated from the first-run check.",
   exportFormats: ["docx", "pdf"]
  }
 });
 const readBack = await api("/api/exchange/package/read", {
  packageRelativePath: "packages/first-workflow"
 });
 const receiverReport = await api("/api/exchange/package/receiver-report", {
  packageRelativePath: "packages/first-workflow"
 });
 const manifest = await refreshManifest();
 showAlert("success", "First workflow completed successfully. Demo Word sample imported!");
 return {
  workspace,
  markdownDocx,
  markdownPdf,
  sampleDocx: sample,
  extracted,
  importedPdf,
  normalized,
  readBackValid: readBack.valid === true,
  receiverReportWritten: Boolean(receiverReport.markdownPath && receiverReport.jsonPath),
  receiverReportVerdict: receiverReport.verdict,
  documentCount: manifest.documents?.length ?? 0,
  datasetCount: manifest.datasets?.length ?? 0
 };
}
function clearMarkdownPreviewState({ clearRecord = true } = {}) {
 if (clearRecord) {
  state.currentRecord = null;
  state.selectedRecord = null;
  $("recordId").value = "";
 }
 $("notePath").value = "";
 $("noteContent").value = "";
 clearMarkdownExportPaths();
 markMarkdownClean("");
 renderMarkdownReadView();
}
async function selectAndPrepareImportedRecord(record) {
 const selected = Array.isArray(record) ? record[0] : record;
 if (!selected?.id) return { selected: false };
 state.currentRecord = selected;
 $("recordId").value = selected.id;
 showAlert("info", `Preparing preview for ${selected.title || selected.name || selected.id}...`);
 if (selected.kind === "dataset" || selected.sourceType === "csv" || selected.sourceType === "xlsx") {
  const inspected = selected.autoInspectJob
   ? selected.autoInspectJob
   : await api("/api/dataset/inspect", { datasetId: selected.id });
  await refreshManifest();
  refreshInbox();
  showAlert("success", `Table ready for filtering: ${selected.name || selected.id}`);
  return { selected, inspected };
 }
 setExtractionProgress(true, "Preparing AI-readable Markdown. Large PDFs can take a while; keep open.");
 await new Promise((resolve) => requestAnimationFrame(resolve));
 try {
  const extracted = await api("/api/document/convert", { documentId: selected.id });
  const manifest = await refreshManifest();
  refreshInbox();
  refreshTimeline();
  const doc = (manifest.documents ?? []).find((candidate) => candidate.id === selected.id);
  if (!doc?.outputMarkdownPath || !doc?.readableMarkdownPath) {
   throw new Error("Document conversion finished without a readable Markdown output.");
  }
  {
   state.currentRecord = doc;
   const indexPath = readableRelativePathForRecord(doc);
   const firstSegmentPath = doc.markdownOutputs?.readableSegments?.segments?.[0]?.relativePath || "";
   const relPath = firstSegmentPath || indexPath;
   $("notePath").value = relPath;
   refreshMarkdownExportPaths(relPath);
   if (firstSegmentPath) {
    $("noteContent").value = await api("/api/markdown/read", { relativePath: firstSegmentPath });
    showAlert("info", `Split ${doc.markdownOutputs.readableSegments.segmentCount}. Opened 1. Index: ${indexPath}`);
   } else if (shouldUseChunkedEditorLoad(doc)) {
    showChunkedEditorPlaceholder(doc, indexPath);
    showAlert("info", "Large file: chunked review mode.");
   } else {
    $("noteContent").value = await api("/api/markdown/read", { relativePath: relPath });
   }
   markMarkdownClean($("noteContent").value);
   renderMarkdownReadView();
   setMarkdownViewMode("edit");
   showEditorWarningsForRecord(doc);
   showExtractionPaths(doc, relPath);
   aiContextPanel.updateAiWillSeePanel();
   setActiveView("editor");
  }
  showAlert("success", `AI-readable preview ready: ${selected.title || selected.id}`);
  return { selected, extracted };
 } catch (error) {
  clearMarkdownPreviewState({ clearRecord: false });
  throw error;
 } finally {
  setExtractionProgress(false);
 }
}
async function desktopDiagnostics() {
 let runtimeDiagnostics = null;
 let runtimeError = "";
 try {
  runtimeDiagnostics = await tauriInvoke("get_desktop_runtime_diagnostics");
 } catch (error) {
  runtimeError = error.message;
 }
 let apiHealth = null;
 try {
  await ensureLocalApiConfig();
  const response = await fetch(`${localApiBaseUrl()}/api/health`, {
   cache: "no-store"
  });
  apiHealth = {
   status: response.status,
   body: await response.json()
  };
 } catch (error) {
  apiHealth = {
   ok: false,
   error: error.message
  };
 }
 showAlert("success", "Desktop diagnostics completed successfully. Local API is healthy!");
 return {
  apiBaseUrl: localApiBaseUrl(),
  apiHealth,
  runtimeDiagnostics,
  runtimeError
 };
}
async function apiGet(path, params = {}) {
 await ensureLocalApiConfig();
 const url = new URL(apiUrl(path));
 url.searchParams.set("workspacePath", workspacePath());
 for (const [key, value] of Object.entries(params)) {
  if (value != null) url.searchParams.set(key, value);
 }
 let response;
 try {
  response = await fetch(url.toString(), {
   method: "GET",
   headers: {
    "x-ai-doc-exchange-token": window.AI_DOC_EXCHANGE_TOKEN ?? ""
   }
  });
 } catch {
  throw new Error(`Local API is not reachable at ${url.toString()}.`);
 }
 return readApiPayload(response, url.toString());
}
async function saveCurrentNote() {
 await ensureWorkspaceForFirstWorkflow();
 if (window.markdownEditor && typeof window.markdownEditor.getValue === "function") {
  $("noteContent").value = window.markdownEditor.getValue();
 }
 const relativePath = $("notePath").value.trim();
 const content = $("noteContent").value;
 const result = isExternalMarkdownPath(relativePath)
  ? await api("/api/markdown/save-external", { sourcePath: relativePath, content })
  : await api("/api/markdown/save", { relativePath, content });
 markMarkdownClean(content);
 return result;
}
function currentMarkdownContent() {
 if (window.markdownEditor && typeof window.markdownEditor.getValue === "function") {
  return window.markdownEditor.getValue();
 }
 return $("noteContent")?.value || "";
}
function markMarkdownClean(content = currentMarkdownContent()) {
 state.markdownBaseline = String(content ?? "");
 state.markdownDirty = false;
 const status = $("markdownStatus");
 if (status) status.dataset.dirty = "false";
}
function updateMarkdownDirtyState() {
 if (state.markdownBaseline === null) return;
 state.markdownDirty = currentMarkdownContent() !== state.markdownBaseline;
 const status = $("markdownStatus");
 if (status) status.dataset.dirty = state.markdownDirty ? "true" : "false";
}
function confirmDiscardMarkdownChanges(action = "continue") {
 if (!state.markdownDirty) return true;
 return confirm(`This Markdown note has unsaved changes. Discard them and ${action}?`);
}
window.confirmDiscardMarkdownChanges = confirmDiscardMarkdownChanges;
window.addEventListener("beforeunload", (event) => {
 if (!state.markdownDirty) return;
 event.preventDefault();
 event.returnValue = "";
});
function normalizedWorkspaceRelativePath(value) {
 const workspaceRoot = state.workspacePath || "";
 let target = String(value || "").trim().replace(/\\/g, "/");
 const normalizedRoot = workspaceRoot.replace(/\\/g, "/");
 if (normalizedRoot && target.startsWith(normalizedRoot)) {
  target = target.slice(normalizedRoot.length).replace(/^\/+/, "");
 }
 return target;
}
function isAbsoluteLocalPath(value) {
 const target = String(value || "");
 return /^[A-Za-z]:[\\/]/.test(target) || target.startsWith("\\\\") || target.startsWith("/");
}
function isInsideCurrentWorkspace(value) {
 const workspaceRoot = String(state.workspacePath || "").replace(/\\/g, "/").replace(/\/+$/, "");
 const target = String(value || "").replace(/\\/g, "/");
 return Boolean(workspaceRoot && target.toLowerCase().startsWith(`${workspaceRoot.toLowerCase()}/`));
}
function isExternalMarkdownPath(value) {
 return isAbsoluteLocalPath(value) && !isInsideCurrentWorkspace(value);
}
function toCurrentWorkspaceRelative(value) {
 const workspaceRoot = String(state.workspacePath || "").replace(/\\/g, "/").replace(/\/+$/, "");
 const target = String(value || "").replace(/\\/g, "/");
 if (!workspaceRoot) return target;
 return target.slice(workspaceRoot.length).replace(/^\/+/, "");
}
function cleanMarkdownExportBaseName(relativePath) {
 const leaf = String(relativePath || "").trim().split(/[\\/]/).pop() || "";
 const withoutExtension = leaf.replace(/\.(md|markdown|docx|html|pdf)$/i, "");
 return withoutExtension.replace(/\.readable(?:_\d+|\.index)?$/i, "") || "schema-docs-export";
}
function segmentedSourcePathForMarkdownPath(relativePath) {
 const segmentsObj = state.selectedRecord?.markdownOutputs?.readableSegments;
 if (!segmentsObj?.segmented || !segmentsObj.segments?.length) return "";
 const target = normalizedWorkspaceRelativePath(relativePath);
 const candidates = [
  segmentsObj.indexRelativePath,
  segmentsObj.indexPath,
  ...segmentsObj.segments.map((segment) => segment.relativePath)
 ].filter(Boolean);
 const belongsToCurrentSegments = candidates.some((candidate) => normalizedWorkspaceRelativePath(candidate) === target);
 if (!belongsToCurrentSegments) return "";
 return segmentsObj.indexRelativePath || segmentsObj.indexPath || segmentsObj.segments[0].relativePath;
}
function exportBaseNameForMarkdownPath(relativePath) {
 return cleanMarkdownExportBaseName(segmentedSourcePathForMarkdownPath(relativePath) || relativePath);
}
function defaultSaveDialogPath(outputPath) {
 const target = String(outputPath || "").trim();
 if (!target) return target;
 if (isAbsoluteLocalPath(target)) return target.replace(/\//g, "\\");
 return target.split(/[\\/]/).pop() || target;
}
function defaultSaveAsMarkdownPath(currentPath) {
 const segmentInfo = getCurrentSegmentInfo();
 const normalizedCurrent = String(currentPath || "").replace(/\\/g, "/");
 if (segmentInfo || /^(outputs\/readable|exports)\//i.test(normalizedCurrent)) {
  const cleanName = `${exportBaseNameForMarkdownPath(currentPath)}.md`;
  return state.workspacePath ? `${state.workspacePath.replace(/[\\\/]$/, "")}/${cleanName}` : cleanName;
 }
 if (isAbsoluteLocalPath(currentPath)) return currentPath;
 return state.workspacePath ? `${state.workspacePath.replace(/[\\\/]$/, "")}/${currentPath}` : currentPath;
}
function temporaryMarkdownPath(prefix, directory = "notes") {
 const random = (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function")
  ? globalThis.crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
 const safeDirectory = String(directory || "notes").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") || "notes";
 return `${safeDirectory}/.schema-docs-${prefix}-${random}.md`;
}
function refreshMarkdownExportPaths(relativePath, { force = true } = {}) {
 const baseName = exportBaseNameForMarkdownPath(relativePath);
 const outputs = [
  ["mdExportPath", "md"],
  ["docExportPath", "docx"],
  ["htmlExportPath", "html"],
  ["pdfExportPath", "pdf"]
 ];
 for (const [id, extension] of outputs) {
  const el = $(id);
  if (!el) continue;
  const nextPath = `exports/${baseName}.${extension}`;
  if (force || !el.value.trim() || /^exports\/hello\.[^.]+$/i.test(el.value.trim())) {
   el.value = nextPath;
  }
  el.dataset.exportSourcePath = String(relativePath || "");
 }
}
function clearMarkdownExportPaths() {
 for (const id of ["mdExportPath", "docExportPath", "htmlExportPath", "pdfExportPath"]) {
  const el = $(id);
  if (el) {
   el.value = "";
   delete el.dataset.exportSourcePath;
  }
 }
}
function getCurrentSegmentInfo() {
 const segmentsObj = state.selectedRecord?.markdownOutputs?.readableSegments;
 if (!segmentsObj?.segmented || !segmentsObj.segments?.length) return null;
 const currentPath = normalizedWorkspaceRelativePath($("notePath").value);
 const index = segmentsObj.segments.findIndex((segment) => normalizedWorkspaceRelativePath(segment.relativePath) === currentPath);
 if (index < 0) return null;
 return {
  index,
  total: segmentsObj.segments.length,
  segment: segmentsObj.segments[index],
  segments: segmentsObj.segments
 };
}
function warnIfSavingOrExportingCurrentSegment(actionLabel) {
 const info = getCurrentSegmentInfo();
 if (!info) return true;
 const message = `${actionLabel} will use only the currently loaded segment: part ${info.index + 1} of ${info.total}.\n\nFor the full document, use the "Merge and export all parts" buttons in the segment banner. Continue with the current segment?`;
 return confirm(message);
}
async function chooseNativeSavePath({ inputId, defaultPath, filterName, extensions }) {
 const currentValue = defaultSaveDialogPath(defaultPath || $(inputId)?.value || "");
 try {
  const selected = await tauriInvoke("select_save_file_path", {
   defaultPath: currentValue,
   filterName,
   extensions
  });
  if (selected && inputId && $(inputId)) {
   $(inputId).value = selected;
  }
  return selected;
 } catch (error) {
  if (window.__TAURI__?.dialog?.save) {
   const selected = await window.__TAURI__.dialog.save({
    defaultPath: currentValue,
    filters: [{ name: filterName, extensions }]
   });
   if (selected && inputId && $(inputId)) {
    $(inputId).value = selected;
   }
   return selected;
  }
  const rawWebMsg = "Browser mode does not support native save dialogue. Type an output path in the input field.";
  const webMsg = (typeof window.translateText === "function") ? window.translateText(rawWebMsg) : rawWebMsg;
  showAlert("info", webMsg);
  return "";
 }
}
async function saveCurrentNoteWithDialog() {
 if (!warnIfSavingOrExportingCurrentSegment("Save")) return { cancelled: true };
 if (window.markdownEditor && typeof window.markdownEditor.getValue === "function") {
  $("noteContent").value = window.markdownEditor.getValue();
 }
 const currentPath = $("notePath").value.trim() || "notes/untitled.md";
 const defaultPath = defaultSaveAsMarkdownPath(currentPath);
 const selected = await chooseNativeSavePath({
  defaultPath,
  filterName: "Markdown Document",
  extensions: ["md"]
 });
 if (!selected) return { cancelled: true };
 let result;
 if (isAbsoluteLocalPath(selected) && !isInsideCurrentWorkspace(selected)) {
  const tempMdPath = temporaryMarkdownPath("save-as");
  try {
   await api("/api/markdown/save", {
    relativePath: tempMdPath,
    content: $("noteContent").value
   });
   result = await api("/api/markdown/export", {
    relativePath: tempMdPath,
    outputRelativePath: selected,
    format: "md"
   });
  } finally {
   try {
    await api("/api/markdown/delete", { relativePath: tempMdPath });
   } catch (error) {
    console.warn("Failed to delete temporary external save markdown:", error);
   }
  }
 } else {
  $("notePath").value = isAbsoluteLocalPath(selected) ? toCurrentWorkspaceRelative(selected) : selected;
  result = await saveCurrentNote();
 }
 markMarkdownClean($("noteContent").value);
 showAlert("success", `Markdown saved: ${selected}`);
 return result;
}
let redactionPreviewSource = "";
let redactionPreviewMapping = {};
function redactionUiText(value) {
 if (document.body.dataset.uiLanguage === "zh-CN" && typeof window.translateText === "function") {
  return window.translateText(value);
 }
 return value;
}
function ensureRedactionEntryButtons() {
 const topbarActions = document.querySelector(".topbar-actions");
 if (topbarActions && !$("openRedactionTool")) {
  const button = document.createElement("button");
  button.id = "openRedactionTool";
  button.className = "secondary";
  button.type = "button";
  button.textContent = "Redact";
  topbarActions.insertBefore(button, $("advancedToolsToggle"));
 }
 const importRow = document.querySelector(".markdown-import-row");
 if (importRow && !$("openMarkdownRedactionTool")) {
  const button = document.createElement("button");
  button.id = "openMarkdownRedactionTool";
  button.className = "secondary flex-button";
  button.type = "button";
  button.textContent = "Redact current document";
  importRow.insertBefore(button, $("markdownPrepareForAi"));
 }
}
function ensureRedactionToolDialog() {
 let dialog = $("redactionToolDialog");
 if (dialog) return dialog;
 if (!$("redactionToolStyles")) {
  const style = document.createElement("style");
  style.id = "redactionToolStyles";
  style.textContent = `
   .redaction-dialog-card{width:min(1100px,100%);max-height:88vh;overflow:auto}
   .redaction-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;margin:18px 0 12px}
   .redaction-pane{display:grid;gap:7px;color:var(--text-muted);font-size:12px}
   .redaction-pane textarea{min-height:320px;max-height:52vh;white-space:pre-wrap;overflow:auto}
   .redaction-pane textarea[readonly]{background:rgba(16,185,129,.035);border-color:rgba(16,185,129,.22)}
   .redaction-status{margin:0 0 14px;padding:10px 12px;border-left:3px solid var(--primary)}
   .redaction-actions{flex-wrap:wrap}
   @media(max-width:800px){.redaction-grid{grid-template-columns:1fr}.redaction-pane textarea{min-height:220px}}
  `;
  document.head.appendChild(style);
 }
 dialog = document.createElement("div");
 dialog.id = "redactionToolDialog";
 dialog.className = "mode-dialog hidden";
 dialog.setAttribute("role", "dialog");
 dialog.setAttribute("aria-modal", "true");
 dialog.setAttribute("aria-labelledby", "redactionToolTitle");
 dialog.innerHTML = `
  <section class="mode-dialog-card redaction-dialog-card">
   <div class="panel-heading-row">
    <div>
     <h2 id="redactionToolTitle">Redaction tool</h2>
     <p>Preview redaction locally. The source remains unchanged until you explicitly replace it.</p>
    </div>
    <button id="redactionClose" class="secondary compact-button" type="button">Close</button>
   </div>
   <div class="redaction-grid">
    <label class="redaction-pane"><strong>Source content</strong><textarea id="redactionSource" spellcheck="false"></textarea></label>
    <label class="redaction-pane"><strong>Redacted preview</strong><textarea id="redactionPreview" spellcheck="false" readonly></textarea></label>
   </div>
   <div id="redactionStatus" class="hint redaction-status">No redaction preview yet.</div>
   <div class="row redaction-actions">
    <button id="redactionLoadCurrent" class="secondary" type="button">Reload current document</button>
    <button id="redactionPreviewButton" type="button">Preview redaction</button>
    <button id="redactionReplaceEditor" class="secondary" type="button">Apply to current document</button>
    <button id="redactionSaveCopy" class="secondary" type="button">Save redacted copy...</button>
    <button id="redactionOpenFolderTool" class="secondary" type="button">Batch redact a folder...</button>
   </div>
  </section>`;
 document.body.appendChild(dialog);
 return dialog;
}
function summarizeRedactionMapping(mapping) {
 const counts = {};
 for (const placeholder of Object.keys(mapping || {})) {
  const type = placeholder.match(/^\[MASK_([A-Z]+)_/)?.[1] || "VALUE";
  counts[type] = (counts[type] || 0) + 1;
 }
 return Object.entries(counts).map(([type, count]) => `${type} ${count}`).join(", ");
}
function setRedactionStatus(message) {
 const status = $("redactionStatus");
 if (status) status.textContent = redactionUiText(message);
}
function loadCurrentDocumentForRedaction({ requireContent = true } = {}) {
 const content = currentMarkdownContent();
 if (!content.trim() && requireContent) {
  throw new Error("Open or import a Markdown document first.");
 }
 $("redactionSource").value = content;
 $("redactionPreview").value = "";
 redactionPreviewSource = "";
 redactionPreviewMapping = {};
 setRedactionStatus("No redaction preview yet.");
 return content;
}
async function previewRedaction() {
 const source = $("redactionSource").value;
 if (!source.trim()) throw new Error("There is no content to redact.");
 setRedactionStatus("Detecting sensitive values locally...");
 const result = await api("/api/mask", { content: source });
 redactionPreviewSource = source;
 redactionPreviewMapping = result.mapping || {};
 state.lastMaskMapping = redactionPreviewMapping;
 $("redactionPreview").value = result.maskedText || source;
 const count = Object.keys(redactionPreviewMapping).length;
 if (!count) {
  setRedactionStatus("No sensitive values detected. The preview matches the source.");
 } else {
  setRedactionStatus(`Redacted sensitive values: ${summarizeRedactionMapping(redactionPreviewMapping)}`);
 }
 return result;
}
async function ensureFreshRedactionPreview() {
 const source = $("redactionSource").value;
 if (source !== redactionPreviewSource || !$("redactionPreview").value) {
  await previewRedaction();
 }
 return $("redactionPreview").value;
}
async function replaceEditorWithRedactedText() {
 const maskedText = await ensureFreshRedactionPreview();
 if ($("noteContent")) $("noteContent").value = maskedText;
 window.markdownEditor?.setValue?.(maskedText);
 state.markdownDirty = true;
 const markdownStatus = $("markdownStatus");
 if (markdownStatus) markdownStatus.dataset.dirty = "true";
 window.renderMarkdownReadView?.();
 $("redactionToolDialog")?.classList.add("hidden");
 ($("markdownReadView") || $("noteContent"))?.scrollIntoView?.({ behavior: "smooth", block: "center" });
 showAlert("success", redactionUiText("Redaction applied to the current document. Save it to keep the change."));
 return { replaced: true, maskedCount: Object.keys(redactionPreviewMapping).length };
}
async function redactedCopyFileName() {
 const sourcePath = $("notePath")?.value || "document.md";
 const baseName = exportBaseNameForMarkdownPath(sourcePath) || "document";
 const maskedName = await api("/api/mask", { content: baseName });
 const safeName = String(maskedName.maskedText || "document")
  .replace(/\[MASK_([A-Z]+)_(\d+)\]/g, "MASK-$1-$2")
  .replace(/[<>:\"/\\|?*\u0000-\u001F]/g, "-")
  .replace(/\s+/g, " ")
  .trim() || "document";
 return `${safeName}-redacted.md`;
}
async function saveRedactedCopy() {
 const maskedText = await ensureFreshRedactionPreview();
 await ensureWorkspaceForFirstWorkflow();
 const fileName = await redactedCopyFileName();
 const workspaceRoot = String(state.workspacePath || "").replace(/[\\\/]$/, "");
 const defaultPath = workspaceRoot ? `${workspaceRoot}/${fileName}` : fileName;
 const selected = await chooseNativeSavePath({
  defaultPath,
  filterName: "Markdown Document",
  extensions: ["md"]
 });
 if (!selected) return { cancelled: true };
 let result;
 if (isAbsoluteLocalPath(selected) && !isInsideCurrentWorkspace(selected)) {
  const tempMdPath = temporaryMarkdownPath("redacted-copy");
  try {
   await api("/api/markdown/save", { relativePath: tempMdPath, content: maskedText });
   result = await api("/api/markdown/export", {
    relativePath: tempMdPath,
    outputRelativePath: selected,
    format: "md"
   });
  } finally {
   try {
    await api("/api/markdown/delete", { relativePath: tempMdPath });
   } catch (error) {
    console.warn("Failed to delete temporary redacted markdown:", error);
   }
  }
 } else {
  const relativePath = isAbsoluteLocalPath(selected) ? toCurrentWorkspaceRelative(selected) : selected;
  result = await api("/api/markdown/save", { relativePath, content: maskedText });
 }
 setRedactionStatus("Redacted copy saved. The current editor and source file were not changed.");
 showAlert("success", `${redactionUiText("Redacted copy saved:")} ${selected}`);
 return result;
}
function openFolderRedactionTool() {
 $("redactionToolDialog")?.classList.add("hidden");
 productModePanel.setProductMode("office", true);
 setActiveView("home");
 setAdvancedToolsVisible(true);
 const target = $("sanitizeFolderPath") || document.querySelector(".document-flow-panel");
 target?.scrollIntoView({ behavior: "smooth", block: "center" });
 window.setTimeout(() => target?.focus?.(), 150);
 showAlert("info", redactionUiText("Folder redaction writes a separate AI-safe copy. Original files are not changed."));
}
async function openRedactionTool({ loadCurrent = true } = {}) {
 const dialog = ensureRedactionToolDialog();
 dialog.classList.remove("hidden");
 if (loadCurrent) {
  const content = loadCurrentDocumentForRedaction({ requireContent: false });
  if (content.trim()) await previewRedaction();
  else $("redactionSource")?.focus();
 }
}
function bindRedactionToolEvents() {
 ensureRedactionEntryButtons();
 const dialog = ensureRedactionToolDialog();
 if (dialog.dataset.bound === "true") return;
 dialog.dataset.bound = "true";
 $("openRedactionTool")?.addEventListener("click", () => run(() => openRedactionTool()));
 $("openMarkdownRedactionTool")?.addEventListener("click", () => run(() => openRedactionTool()));
 $("redactionClose")?.addEventListener("click", () => dialog.classList.add("hidden"));
 $("redactionLoadCurrent")?.addEventListener("click", () => run(async () => {
  loadCurrentDocumentForRedaction();
  const result = await previewRedaction();
  showAlert("info", redactionUiText("Current document reloaded for redaction."));
  return result;
 }));
 $("redactionPreviewButton")?.addEventListener("click", () => run(previewRedaction));
 $("redactionReplaceEditor")?.addEventListener("click", () => run(replaceEditorWithRedactedText));
 $("redactionSaveCopy")?.addEventListener("click", () => run(saveRedactedCopy));
 $("redactionOpenFolderTool")?.addEventListener("click", openFolderRedactionTool);
 dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.classList.add("hidden");
 });
 document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !dialog.classList.contains("hidden")) dialog.classList.add("hidden");
 });
}
async function exportCurrentNote(format, outputId) {
 const output = $(outputId);
 const sourcePath = $("notePath").value.trim();
 const extension = format === "docx" ? "docx" : (format === "html" ? "html" : (format === "pdf" ? "pdf" : "md"));
 const baseName = exportBaseNameForMarkdownPath(sourcePath);
 if (output.dataset.exportSourcePath && output.dataset.exportSourcePath !== sourcePath) {
  output.value = `exports/${baseName}.${extension}`;
  output.dataset.exportSourcePath = sourcePath;
 }
 if (!output.value.trim() || output.value.trim() === `exports/hello.${extension}`) {
  output.value = `exports/${baseName}.${extension}`;
  output.dataset.exportSourcePath = sourcePath;
 }
 const targetVal = output.value.trim();
 if (!targetVal) {
  showAlert("danger", "Please enter a valid export output path.");
  return;
 }
 if (!warnIfSavingOrExportingCurrentSegment(`Export ${format.toUpperCase()}`)) {
  return { cancelled: true };
 }
 const label = format === "docx" ? "Word" : (format === "html" ? "HTML" : (format === "pdf" ? "PDF" : "Markdown"));
 const statusContainer = $("exportStatusContainer");
 const statusText = $("exportStatusText");
 const fullPathText = $("exportFullPathText");
 const folderBtn = $("btnOpenExportFolder");
 if (statusContainer) {
  statusContainer.classList.remove("hidden");
  statusText.textContent = `preparing...`;
  statusText.style.color = "var(--primary)";
  fullPathText.textContent = "";
  folderBtn.style.display = "none";
 }
 $("markdownStatus").textContent = `Exporting ${label} to ${targetVal}...`;
 showAlert("info", `Exporting ${label}: ${targetVal}`);
 let latestContent = $("noteContent").value;
 if (window.markdownEditor && typeof window.markdownEditor.getValue === "function") {
  latestContent = window.markdownEditor.getValue();
 }
 let temporarySourcePath = "";
 try {
  let exportSourcePath = sourcePath;
  if (isExternalMarkdownPath(sourcePath)) {
   await api("/api/markdown/save-external", {
    sourcePath,
    content: latestContent
   });
   temporarySourcePath = temporaryMarkdownPath("external-export");
   await api("/api/markdown/save", {
    relativePath: temporarySourcePath,
    content: latestContent
   });
   exportSourcePath = temporarySourcePath;
  } else {
   await api("/api/markdown/save", {
    relativePath: sourcePath,
    content: latestContent
   });
  }
  markMarkdownClean(latestContent);
  if (statusText) {
   statusText.textContent = `exporting...`;
  }
  const result = await api("/api/markdown/export", {
   relativePath: exportSourcePath,
   outputRelativePath: targetVal,
   format
  });
  const exportedPath = typeof result === "string" ? result : result?.outputPath || targetVal;
  let absolutePath = exportedPath;
  if (state.workspacePath && !exportedPath.includes(":\\") && !exportedPath.includes(":/") && !exportedPath.startsWith("/") && !exportedPath.startsWith("\\")) {
   const separator = state.workspacePath.endsWith("/") || state.workspacePath.endsWith("\\") ? "" : "/";
   absolutePath = state.workspacePath + separator + exportedPath;
  }
  $("markdownStatus").textContent = `Export complete: ${absolutePath}`;
  showAlert("success", `Export complete: ${absolutePath}`);
  if (statusText) {
   statusText.textContent = `completed`;
   statusText.style.color = "#10b981";
   fullPathText.textContent = absolutePath;
   folderBtn.style.display = "inline-block";
   folderBtn.onclick = async () => {
    try {
     await api("/api/document/open-folder", { folderPath: absolutePath });
    } catch (err) {
     showAlert("danger", `Failed to open folder: ${err.message}. Please manually open the path: ${absolutePath}`);
    }
   };
  }
  return result;
 } catch (err) {
  const errorMsg = err.message || "Unknown export error";
  $("markdownStatus").textContent = `Export failed: ${errorMsg}`;
  showAlert("danger", `Export failed: ${errorMsg}`);
  if (statusText) {
   statusText.textContent = `failed`;
   statusText.style.color = "#ef4444";
   fullPathText.textContent = errorMsg;
   folderBtn.style.display = "none";
  }
  throw err;
 } finally {
  if (temporarySourcePath) {
   try {
    await api("/api/markdown/delete", { relativePath: temporarySourcePath });
   } catch (cleanupError) {
    console.warn("Failed to delete temporary external export Markdown:", cleanupError);
   }
  }
 }
}
async function exportMergedNote(format) {
 const segmentsObj = state.selectedRecord?.markdownOutputs?.readableSegments;
 if (!segmentsObj || !segmentsObj.segmented || !segmentsObj.segments?.length) {
  showAlert("danger", "This document is not segmented.");
  return;
 }
 const extension = format === "docx" ? "docx" : (format === "html" ? "html" : (format === "pdf" ? "pdf" : "md"));
 const sourcePath = segmentsObj.indexRelativePath || segmentsObj.indexPath || segmentsObj.segments[0].relativePath || $("notePath").value.trim();
 const baseName = exportBaseNameForMarkdownPath(sourcePath);
  const exportVal = `exports/${baseName}.${extension}`;
  const outputId = format === "docx" ? "docExportPath" : (format === "html" ? "htmlExportPath" : (format === "pdf" ? "pdfExportPath" : "mdExportPath"));
  const outputInput = $(outputId);
  if (outputInput) {
   outputInput.value = exportVal;
  }
  const label = format === "docx" ? "Word" : (format === "html" ? "HTML" : (format === "pdf" ? "PDF" : "Markdown"));
  const selectedOutput = await chooseNativeSavePath({
   inputId: outputId,
   defaultPath: exportVal,
   filterName: `${label} Document`,
   extensions: [extension]
  });
  if (!selectedOutput) return { cancelled: true };
  const finalExportPath = $(outputId)?.value.trim() || selectedOutput;
  const statusContainer = $("exportStatusContainer");
 const statusText = $("exportStatusText");
 const fullPathText = $("exportFullPathText");
 const folderBtn = $("btnOpenExportFolder");
 if (statusContainer) {
  statusContainer.classList.remove("hidden");
  statusText.textContent = `Merging segments...`;
  statusText.style.color = "var(--primary)";
  fullPathText.textContent = "";
  folderBtn.style.display = "none";
 }
  $("markdownStatus").textContent = `Merging and exporting all ${segmentsObj.segments.length} segments to ${finalExportPath}...`;
  showAlert("info", `Merging all segments for ${label} export: ${finalExportPath}`);
 try {
  const segments = segmentsObj.segments;
  const currentPath = normalizedWorkspaceRelativePath($("notePath").value.trim());
  const currentSegment = segments.find((segment) => normalizedWorkspaceRelativePath(segment.relativePath) === currentPath);
  if (currentSegment) {
   const currentContent = window.markdownEditor && typeof window.markdownEditor.getValue === "function"
    ? window.markdownEditor.getValue()
    : $("noteContent").value;
   await api("/api/markdown/save", {
    relativePath: currentSegment.relativePath,
    content: currentContent
   });
   markMarkdownClean(currentContent);
  }
  let mergedContent = "";
  for (let i = 0; i < segments.length; i++) {
   if (statusText) {
    statusText.textContent = `Reading segment ${i + 1}/${segments.length}...`;
   }
   const segPath = segments[i].relativePath;
   const content = await api("/api/markdown/read", { relativePath: segPath });
   mergedContent += stripGeneratedSegmentMetadata(content) + "\n\n";
  }
  // Relative image links in every segment are rooted in the segment folder.
  const firstSegmentPath = normalizedWorkspaceRelativePath(segments[0]?.relativePath || "");
  const segmentDirectory = firstSegmentPath.includes("/")
   ? firstSegmentPath.slice(0, firstSegmentPath.lastIndexOf("/"))
   : "notes";
  const tempMdPath = temporaryMarkdownPath("merged-export", segmentDirectory);
  let result;
  try {
   await api("/api/markdown/save", {
    relativePath: tempMdPath,
    content: mergedContent
   });
   if (statusText) {
    statusText.textContent = `Exporting merged ${label}...`;
   }
   result = await api("/api/markdown/export", {
    relativePath: tempMdPath,
    outputRelativePath: finalExportPath,
    format
   });
  } finally {
   try {
    await api("/api/markdown/delete", { relativePath: tempMdPath });
   } catch (e) {
    console.warn("Failed to delete temporary merged markdown:", e);
   }
  }
   const exportedPath = typeof result === "string" ? result : result?.outputPath || finalExportPath;
  let absolutePath = exportedPath;
  if (state.workspacePath && !exportedPath.includes(":\\") && !exportedPath.includes(":/") && !exportedPath.startsWith("/") && !exportedPath.startsWith("\\")) {
   const separator = state.workspacePath.endsWith("/") || state.workspacePath.endsWith("\\") ? "" : "/";
   absolutePath = state.workspacePath + separator + exportedPath;
  }
  $("markdownStatus").textContent = `Export complete: ${absolutePath}`;
  showAlert("success", `Merged export complete: ${absolutePath}`);
  if (statusText) {
   statusText.textContent = `completed`;
   statusText.style.color = "#10b981";
   fullPathText.textContent = absolutePath;
   folderBtn.style.display = "inline-block";
   folderBtn.onclick = async () => {
    try {
     await api("/api/document/open-folder", { folderPath: absolutePath });
    } catch (err) {
      showAlert("danger", `Failed to open folder: ${err.message}. Please manually open the path: ${absolutePath}`);
    }
   };
  }
  return result;
 } catch (err) {
  const errorMsg = err.message || "Unknown merge export error";
  $("markdownStatus").textContent = `Merged export failed: ${errorMsg}`;
  showAlert("danger", `Merged export failed: ${errorMsg}`);
  if (statusText) {
   statusText.textContent = `failed`;
   statusText.style.color = "#ef4444";
   fullPathText.textContent = errorMsg;
   folderBtn.style.display = "none";
  }
  throw err;
 }
}
window.exportMergedNote = exportMergedNote;
function stripGeneratedSegmentMetadata(content) {
 const value = String(content ?? "");
 return value
  .replace(/^>\s*Human Markdown segment \d+\/\d+\s*\r?\n?/im, "")
  .replace(/^>\s*Source line range:\s*[^\r\n]*\r?\n?/im, "")
  .replace(/^\s+/, "")
  .trimEnd();
}
async function loadFullCurrentMarkdownFile() {
 await ensureWorkspaceForFirstWorkflow();
 if (!confirmDiscardMarkdownChanges("reload this file")) return { cancelled: true };
 const relativePath = $("notePath").value.trim();
 if (!relativePath) throw new Error("Select a Markdown file path first.");
 const segmentInfo = getCurrentSegmentInfo();
 if (segmentInfo) {
  showAlert("info", `Loading the full text of current segment ${segmentInfo.index + 1}/${segmentInfo.total}. This is not the merged full document.`);
 } else {
  showAlert("info", `Loading full Markdown file: ${relativePath}`);
 }
 const content = await api("/api/markdown/read", { relativePath });
 $("noteContent").value = content;
 markMarkdownClean(content);
 renderMarkdownReadView();
 setMarkdownViewMode("edit");
 showAlert("success", segmentInfo ? `Current segment loaded fully: ${relativePath}` : `Full Markdown loaded: ${relativePath}`);
 return { relativePath };
}
async function loadMarkdownRelativePath(relativePath) {
 await ensureWorkspaceForFirstWorkflow();
 if (!confirmDiscardMarkdownChanges("open another Markdown file")) return { cancelled: true };
 const targetPath = String(relativePath || "").trim();
 if (!targetPath) throw new Error("Select a Markdown file path first.");
 $("notePath").value = targetPath;
 refreshMarkdownExportPaths(targetPath);
 const content = await api("/api/markdown/read", { relativePath: targetPath });
 $("noteContent").value = content;
 markMarkdownClean(content);
 renderMarkdownReadView();
 setMarkdownViewMode("edit");
 refreshVersions();
 showAlert("success", `Markdown opened: ${targetPath}`);
 setActiveView("editor");
 return { relativePath: targetPath };
}
async function handleMarkdownImportFile() {
 await ensureWorkspaceForFirstWorkflow();
 if (!confirmDiscardMarkdownChanges("import another file")) return { cancelled: true };
 const selected = await tauriInvoke("select_import_file_path");
 if (!selected) return { cancelled: true };
 clearMarkdownPreviewState();
 $("sourcePath").value = selected;
 showAlert("info", "Importing selected file...");
 const imported = await api("/api/import", { sourcePath: selected });
 await refreshManifest();
 await selectAndPrepareImportedRecord(imported);
 showAlert("success", `File imported: ${imported.title || imported.name || imported.id}`);
 return imported;
}
async function handleOpenMarkdownFile() {
 await ensureWorkspaceForFirstWorkflow();
 if (!confirmDiscardMarkdownChanges("open another Markdown file")) return { cancelled: true };
 const selected = await tauriInvoke("select_markdown_file_path");
 if (!selected) return { cancelled: true };
 if (!/\.(md|markdown)$/i.test(selected)) {
  throw new Error("Choose a Markdown file (.md or .markdown).");
 }
 $("sourcePath").value = selected;
 showAlert("info", "Opening Markdown file...");
 const content = await api("/api/markdown/read-external", { sourcePath: selected });
 state.currentRecord = null;
 state.selectedRecord = null;
 $("recordId").value = "";
 $("notePath").value = selected;
 refreshMarkdownExportPaths(selected);
 $("noteContent").value = content;
 markMarkdownClean(content);
 renderMarkdownReadView();
 setMarkdownViewMode("edit");
 setActiveView("editor");
 showAlert("success", `Markdown opened: ${selected}`);
 return { sourcePath: selected, sourceType: "md", contentLength: content.length };
}
async function handleMarkdownPrepareForAi() {
 const recordId = $("recordId").value.trim();
 if (recordId) {
  showAlert("info", "Loading document preview for AI review...");
  setAiPanelOpen(true);
  await aiContextPanel.updateAiWillSeePanel();
  aiAssistantPanel.open();
  showAlert("success", "Loaded document preview in AI Will See.");
  return { preparedRecordId: recordId };
 }
 await saveCurrentNote();
 const content = $("noteContent").value.trim();
 if (!content) throw new Error("Write or import content first.");
 showAlert("info", "Staging current editor content for AI review...");
 $("aiContent").value = content;
 $("sendGateSummary").textContent = "Current Markdown file loaded for AI review. Generate send preview before sending or saving a clean copy.";
 setAiPanelOpen(true);
 aiContextPanel.renderAiChunkLedger();
 aiAssistantPanel.open();
 showAlert("success", "Loaded editor content in AI Will See.");
 return { preparedMarkdownPath: $("notePath").value.trim() };
}
$("workspacePath").value = state.workspacePath;
if (!$("noteContent").value.trim() && !state.advancedToolsVisible) {
 setActiveView("home");
}
syncProgressiveUiState();
const productModePanel = createProductModePanel({ $, state, onModeSelected: handleModeSelected });
const i18nPanel = createI18nPanel({ $ });
i18nPanel.bind();
$("productModeOffice").addEventListener("click", () => productModePanel.setProductMode("office", true));
$("productModeMarkdown").addEventListener("click", () => productModePanel.setProductMode("markdown", true));
$("firstRunOfficeMode").addEventListener("click", () => productModePanel.setProductMode("office", true));
$("firstRunMarkdownMode").addEventListener("click", () => productModePanel.setProductMode("markdown", true));
$("btnSwitchToMarkdown")?.addEventListener("click", () => productModePanel.setProductMode("markdown", true));
$("setupAiLater")?.addEventListener("click", handleSetupAiLater);
$("setupAiNow")?.addEventListener("click", handleSetupAiNow);
$("btnBackToHome")?.addEventListener("click", () => {
 if (confirmDiscardMarkdownChanges("leave the Markdown workspace")) setActiveView("home");
});
$("markdownImportFile")?.addEventListener("click", () => run(handleMarkdownImportFile));
$("markdownPrepareForAi")?.addEventListener("click", () => run(handleMarkdownPrepareForAi));
const aiContextPanel = createAiContextPanel({ $, api, state, escapeHtml, showAlert });
const queryPanel = createQueryPanel({ $, api, state, run, refreshManifest, timestampForPath, aiContextPanel });
queryPanel.bindQueryPanelEvents();
const versionsPanel = createVersionsPanel({ $, api, apiGet, run, showAlert });
const { renderVersions, refreshVersions } = versionsPanel;
const markdownWorkbenchPanel = createMarkdownWorkbenchPanel({
 $,
 state,
 run,
 saveCurrentNote,
 refreshVersions,
 escapeHtml,
 openMarkdownPath: loadMarkdownRelativePath,
 api,
 localApiBaseUrl,
 showAlert,
 onNoteClosed: clearMarkdownExportPaths
});
const { renderMarkdownReadView, setMarkdownViewMode } = markdownWorkbenchPanel;
window.setMarkdownViewMode = setMarkdownViewMode;
window.renderMarkdownReadView = renderMarkdownReadView;
markdownWorkbenchPanel.bindMarkdownWorkbenchEvents();
bindRedactionToolEvents();
function hijackNoteContentValue() {
 const textarea = $("noteContent");
 if (!textarea) return;
 const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
 Object.defineProperty(textarea, "value", {
  get() {
   if (window.markdownEditor && !window.markdownEditor.isFallback) return window.markdownEditor.getValue();
   return descriptor.get.call(textarea);
  },
  set(val) {
   descriptor.set.call(textarea, val);
   if (window.markdownEditor && !window.markdownEditor.isFallback) {
    window.markdownEditor.setValue(val);
   }
  },
  configurable: true
 });
}
async function initializeMarkdownEditor(initialVal) {
 if (window.markdownEditor) {
  window.markdownEditor.destroy();
 }
 window.markdownEditor = new window.MarkdownEditorAdapter();
 await window.markdownEditor.init("vditorContainer", "noteContent", initialVal || $("noteContent").value, {
  placeholder: "Start writing Markdown...",
  onChange: (val) => {
   const event = new Event("input", { bubbles: true });
   $("noteContent")?.dispatchEvent(event);
  },
  onHintSelect: (value) => {
   if (value === "/mask") {
    setTimeout(() => {
     if (window.markdownEditor) {
      const curVal = window.markdownEditor.getValue();
      window.markdownEditor.setValue(curVal.replace(/\/mask$/, ""));
      $("openMarkdownRedactionTool")?.click();
     }
    }, 50);
   } else if (value === "/sql") {
    setTimeout(() => {
     if (window.markdownEditor) {
      const curVal = window.markdownEditor.getValue();
      const targetTable = (state.workspaceManifest?.datasets && state.workspaceManifest.datasets[0])
       ? `${state.workspaceManifest.datasets[0].id}` : "employee_data";
      const sqlText = `\n\`\`\`sql\nSELECT * FROM ${targetTable} LIMIT 5;\n\`\`\`\n`;
      window.markdownEditor.setValue(curVal.replace(/\/sql$/, "") + sqlText);
     }
    }, 50);
   }
  }
 });
 hijackNoteContentValue();
}
initializeMarkdownEditor($("noteContent").value).then(() => {
 renderMarkdownReadView();
});
const aiSummonPanel = createAiSummonPanel({
 $,
 updateAiWillSeePanel: aiContextPanel.updateAiWillSeePanel,
 run
});
const aiFeedRunbookPanel = createAiFeedRunbookPanel({
 $,
 api,
 escapeHtml,
 run,
 state,
 loadAiChunkRange: aiContextPanel.loadSelectedAiChunkRangeIntoEditor,
 appendAiChunkRange: aiContextPanel.appendSelectedAiChunkRangeIntoEditor
});
aiFeedRunbookPanel.bindAiFeedRunbookRecoveryEvents();
configureFirstReleaseUi({ $ });
const adapterCapabilitiesPanel = createAdapterCapabilitiesPanel({ $, apiGet, pill });
clickRun("refreshAdapters", adapterCapabilitiesPanel.refreshAdapterCapabilities);
const exchangePackagePanel = createExchangePackagePanel({ $, api, escapeHtml, statusClass, run, showAlert, state });
exchangePackagePanel.bindTrustActions();
const activityListsPanel = createActivityListsPanel({ $, state, pill, showAlert });
const searchResultsPanel = createSearchResultsPanel({ $, api, run });
const workspaceDashboardPanel = createWorkspaceDashboardPanel({ $, api, apiGet, run, showAlert, refreshVersions });
const {
 renderApiProfiles,
 renderAudits,
 renderEvidence,
 rememberConversionAudit,
 renderConversions,
 renderFormatMatrix
} = activityListsPanel;
const {
 refreshInbox,
 refreshTimeline,
 refreshQuality,
 refreshDashboard
} = workspaceDashboardPanel;
const { renderSearchResults } = searchResultsPanel;
const manifestPanel = createManifestPanel({
 $,
 api,
 state,
 pill,
 escapeHtml,
 run,
 showAlert,
 exchangePackagePanel,
 aiContextPanel,
 aiSummonPanel,
 refreshManifest,
 refreshTimeline,
 refreshVersions,
 rememberConversionAudit,
 showEditorWarningsForRecord
});
const documentFlowPanel = createDocumentFlowPanel({
 $,
 api,
 run,
 state,
 tauriInvoke,
 refreshManifest,
 refreshInbox,
 refreshTimeline,
 refreshVersions,
 ensureWorkspace: ensureWorkspaceForFirstWorkflow,
 aiContextPanel,
 rememberConversionAudit,
 renderConversions,
 renderEvidence,
 showEditorWarningsForRecord,
 showAlert,
 onImportedRecord: selectAndPrepareImportedRecord
});
documentFlowPanel.bindDocumentFlowEvents();
const aiSendGatePanel = createAiSendGatePanel({
 $,
 api,
 run,
 state,
 timestampForPath,
 aiContextPanel,
 refreshManifest,
 renderAudits,
 escapeHtml,
 showAlert,
 onReviewedAiContext: () => aiFeedRunbookPanel.markStagedRunbookBatchReviewed(),
 onSentAiContext: () => aiFeedRunbookPanel.markStagedRunbookBatchSent()
});
aiSendGatePanel.bindAiSendGateEvents();
const aiAssistantPanel = createAiAssistantPanel({
 $,
 state,
 aiSendGatePanel,
 renderMarkdownReadView,
 saveCurrentNote,
 showAlert,
 setAdvancedToolsVisible,
 setAiPanelOpen
});
aiAssistantPanel.bind();
const importUploadPanel = createImportUploadPanel({
 $,
 workspacePath,
 ensureWorkspace: ensureWorkspaceForFirstWorkflow,
 localApiBaseUrl,
 showAlert,
 refreshManifest,
 refreshInbox,
 print,
 onImportedRecord: selectAndPrepareImportedRecord
});
importUploadPanel.bindImportUpload();
productModePanel.showFirstRunModeDialogIfNeeded();
syncProgressiveUiState();
setMarkdownViewMode(state.markdownViewMode);
$("changeMode")?.addEventListener("click", () => {
 $("firstRunModeDialog")?.classList.remove("hidden");
});
$("advancedToolsToggle")?.addEventListener("click", () => setAdvancedToolsVisible(!state.advancedToolsVisible));
$("closeAiPanel")?.addEventListener("click", () => setAiPanelOpen(false));
$("aiSummonKey")?.addEventListener("click", () => aiAssistantPanel.toggle());
bindDesktopAiSummonEvent().catch(() => {});
window.addEventListener("keydown", (event) => {
 if (event.ctrlKey && event.altKey && event.code === "KeyA") {
  event.preventDefault();
  aiAssistantPanel.toggle();
 }
});
$("openWorkspace").addEventListener("click", () => run(async () => {
 const path = $("workspacePath").value.trim();
 if (!path) throw new Error("Workspace path cannot be empty.");
 setWorkspacePath(path);
 await api("/api/workspace/open");
 const manifest = await refreshManifest();
 refreshDashboard();
 showAlert("success", `Workspace loaded: ${path}`);
 return manifest;
}));
$("chooseWorkspace").addEventListener("click", () => run(async () => {
 const selected = await tauriInvoke("select_workspace_path");
 if (!selected) return { cancelled: true };
 setWorkspacePath(selected);
 await api("/api/workspace/open");
 const manifest = await refreshManifest();
 refreshDashboard();
 showAlert("success", `Workspace loaded: ${selected}`);
 return {
  workspacePath: selected,
  manifest
 };
}));
$("createTempWorkspace").addEventListener("click", () => run(async () => {
 const created = await apiWithoutWorkspace("/api/workspace/create-temp");
 setWorkspacePath(created.workspacePath);
 const manifest = await refreshManifest();
 refreshDashboard();
 showAlert("success", `Temporary workspace created: ${created.workspacePath}`);
 return {
  workspacePath: created.workspacePath,
  manifest
 };
}));
clickRun("runFirstWorkflow", runFirstWorkflow);
clickRun("desktopDiagnostics", desktopDiagnostics);
clickRun("refreshManifest", refreshManifest);
 $("saveNote").addEventListener("click", () => run(async () => {
  const result = await saveCurrentNoteWithDialog();
  renderMarkdownReadView();
  refreshVersions();
  return result;
 }));
 $("btnChooseSavePath")?.addEventListener("click", () => run(async () => {
  const result = await saveCurrentNoteWithDialog();
  renderMarkdownReadView();
  refreshVersions();
  return result;
 }));
  $("loadFullMarkdown").addEventListener("click", () => run(loadFullCurrentMarkdownFile));
  $("openMarkdownFile")?.addEventListener("click", () => run(handleOpenMarkdownFile));
  $("exportDocx").addEventListener("click", () => run(() => exportCurrentNote("docx", "docExportPath")));
 $("exportPdf").addEventListener("click", () => run(() => exportCurrentNote("pdf", "pdfExportPath")));
 $("exportHtml").addEventListener("click", () => run(() => exportCurrentNote("html", "htmlExportPath")));
 $("exportMd")?.addEventListener("click", () => run(() => exportCurrentNote("md", "mdExportPath")));
 $("btnChooseMdExportPath")?.addEventListener("click", () => run(async () => {
  return chooseNativeSavePath({
   inputId: "mdExportPath",
   defaultPath: $("mdExportPath").value,
   filterName: "Markdown Document",
   extensions: ["md"]
  });
 }));
  const toggleBtn = $("toggleEditorType");
  if (toggleBtn) {
   toggleBtn.style.display = "none";
  }
clickRun("loadFirstAiChunk", aiContextPanel.loadFirstAiChunkIntoEditor);
clickRun("loadSelectedAiChunk", aiContextPanel.loadSelectedAiChunkIntoEditor);
clickRun("appendSelectedAiChunk", aiContextPanel.appendSelectedAiChunkIntoEditor);
clickRun("loadPreviousAiChunk", aiContextPanel.loadPreviousAiChunkIntoEditor);
clickRun("loadNextAiChunk", aiContextPanel.loadNextAiChunkIntoEditor);
clickRun("appendNextAiChunk", aiContextPanel.appendNextAiChunkIntoEditor);
clickRun("loadAiIntakePlan", aiContextPanel.loadAiIntakePlanIntoPanel);
clickRun("loadAiChunkRange", aiContextPanel.loadSelectedAiChunkRangeIntoEditor);
clickRun("appendAiChunkRange", aiContextPanel.appendSelectedAiChunkRangeIntoEditor);
clickRun("appendNextAiChunkRange", aiContextPanel.appendNextAiChunkRangeIntoEditor);
clickRun("createAiFeedRunbook", aiFeedRunbookPanel.createAiFeedRunbook);
clickRun("readAiFeedRunbook", aiFeedRunbookPanel.readAiFeedRunbookStatus);
clickRun("loadNextRunbookBatch", aiFeedRunbookPanel.loadNextRunbookBatch);
clickRun("appendNextRunbookBatch", aiFeedRunbookPanel.appendNextRunbookBatch);
clickRun("continueRunbookAfterSent", aiFeedRunbookPanel.continueRunbookAfterSent);
clickRun("markAiFeedBatch", aiFeedRunbookPanel.markAiFeedBatchStatus);
clickRun("clearAiContext", aiContextPanel.clearStagedAiContext);
clickRun("saveStagedAiContext", aiContextPanel.saveStagedAiContext);
clickRun("saveCleanAiReadyCopy", aiContextPanel.saveCleanAiReadyCopy);
clickRun("saveAiHandoffBundle", aiContextPanel.saveAiHandoffBundle);
$("searchNotes").addEventListener("click", () => run(async () => {
 await ensureWorkspaceForFirstWorkflow();
 const keyword = $("searchKeyword").value.trim();
 if (!keyword) {
  $("searchResults").innerHTML = "";
  $("searchResults").classList.add("hidden");
  return { message: "Enter a search keyword" };
 }
 const results = await api("/api/workspace/search", { keyword });
 renderSearchResults(results);
 const searchTab = $("tabSearch");
 if (searchTab) {
  searchTab.click();
 }
 return { resultsCount: results.length };
}));
clickRun("refreshInbox", refreshInbox);
clickRun("refreshTimeline", refreshTimeline);
clickRun("refreshVersions", refreshVersions);
clickRun("refreshQuality", refreshQuality);
$("timelineFilter").addEventListener("keydown", (e) => {
 if (e.key === "Enter") {
  run(refreshTimeline);
 }
});
$("notePath").addEventListener("change", () => {
 refreshVersions();
});
$("generateFeedbackBundle").addEventListener("click", () => run(async () => {
 const res = await api("/api/feedback-bundle", { redact: true });
 showAlert("success", `Diagnostic bundle generated: ${res.bundlePath}`);
 return res;
}));
$("runSecuritySecretsAudit").addEventListener("click", () => run(async () => {
 const res = await api("/api/security/secrets-audit");
 if (res.ok) {
  showAlert("success", "Security audit passed: no leaked API keys detected.");
 } else {
  showAlert("danger", "Security audit failed: potential sensitive items detected.");
 }
 return res;
}));
$("recordId").addEventListener("change", () => {
 aiContextPanel.updateAiWillSeePanel();
});
$("recordId").addEventListener("input", () => {
 aiContextPanel.updateAiWillSeePanel();
});
if (window.__TAURI__) {
 $("backfillActiveWindow")?.classList.remove("hidden");
}
$("backfillActiveWindow")?.addEventListener("click", () => run(async () => {
 const content = state.lastAiResult;
 if (!content) throw new Error("No AI result to backfill yet.");
 await tauriInvoke("backfill_paste_to_active_window", { content });
}));
$("btnOfficeBackToHome")?.addEventListener("click", () => setActiveView("home"));
$("btnOfficeOpenOriginal")?.addEventListener("click", () => run(async () => {
 const record = state.currentRecord;
 if (!record) throw new Error("No document loaded to open.");
 const origPath = record.originalPath || record.path || record.sourcePath;
 if (!origPath) throw new Error("Document path is unknown.");
 showAlert("info", `Opening ${origPath}...`);
 await api("/api/document/open-original", { originalPath: origPath });
}));
$("btnOfficeRefresh")?.addEventListener("click", () => run(async () => {
 const record = state.currentRecord;
 if (!record) throw new Error("No document loaded to refresh.");
 showAlert("info", `Re-extracting...`);
 await selectAndPrepareImportedRecord(record);
}));
$("btnOfficeConvertToMd")?.addEventListener("click", () => {
 productModePanel.setProductMode("markdown", true);
 setActiveView("editor");
});
$("btnOfficeSanitize")?.addEventListener("click", () => run(() => openRedactionTool()));
$("btnOfficePrepareGate")?.addEventListener("click", () => {
 setAdvancedToolsVisible(true);
 setAiPanelOpen(true);
 $("aiSendGatePanel")?.scrollIntoView({ behavior: "smooth", block: "center" });
});
