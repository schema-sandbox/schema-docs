function t(text) {
return typeof window.translateText === "function" ? window.translateText(text) : text;
}
export function createManifestPanel({
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
}) {
function showDiagnosticsModal(data) {
const overlay = document.createElement("div");
overlay.style.position = "fixed";
overlay.style.top = "0";
overlay.style.left = "0";
overlay.style.width = "100%";
overlay.style.height = "100%";
overlay.style.backgroundColor = "rgba(0, 0, 0, 0.6)";
overlay.style.backdropFilter = "blur(8px)";
overlay.style.display = "flex";
overlay.style.alignItems = "center";
overlay.style.justifyContent = "center";
overlay.style.zIndex = "9999";
const modal = document.createElement("div");
modal.style.backgroundColor = "var(--bg-card, #1c1917)";
modal.style.border = "1px solid var(--border-color, #2e2a24)";
modal.style.borderRadius = "12px";
modal.style.padding = "24px";
modal.style.width = "90%";
modal.style.maxWidth = "600px";
modal.style.boxShadow = "0 10px 25px -5px rgba(0, 0, 0, 0.5)";
modal.style.color = "var(--text-color, #e7e5e4)";
const title = document.createElement("h3");
title.style.margin = "0 0 16px 0";
title.style.fontSize = "18px";
title.style.fontWeight = "600";
title.textContent = t("View PDF diagnostics");
const grid = document.createElement("div");
grid.style.display = "grid";
grid.style.gridTemplateColumns = "1fr 1fr";
grid.style.gap = "12px";
grid.style.marginBottom = "20px";
grid.style.fontSize = "13px";
const addField = (label, val) => {
const item = document.createElement("div");
item.style.padding = "8px 12px";
item.style.backgroundColor = "rgba(255, 255, 255, 0.03)";
item.style.borderRadius = "6px";
const labelSpan = document.createElement("span");
labelSpan.style.color = "var(--text-muted, #a8a29e)";
labelSpan.style.fontWeight = "500";
labelSpan.textContent = `${t(label)}: `;
const valueSpan = document.createElement("span");
valueSpan.style.fontFamily = "monospace";
valueSpan.textContent = String(val ?? "");
item.append(labelSpan, valueSpan);
grid.appendChild(item);
};
addField("Source Size", `${Number(data.sourceSize || 0).toLocaleString()} bytes`);
addField("Hash", data.hash ? `${data.hash.slice(0, 16)}...` : "-");
addField("Chosen Extractor", data.chosenExtractor || "-");
addField("Extractor Status", data.extractorStatus || "-");
addField("Chars Extracted", Number(data.charsExtracted || 0).toLocaleString());
addField("Replacement Chars", Number(data.replacementCharCount || 0).toLocaleString());
addField("Non-Printable Ratio", `${(Number(data.nonPrintableRatio || 0) * 100).toFixed(2)}%`);
addField("CJK Ratio", `${(Number(data.cjkRatio || 0) * 100).toFixed(2)}%`);
addField("ASCII Ratio", `${(Number(data.asciiRatio || 0) * 100).toFixed(2)}%`);
const ledgerTitle = document.createElement("h4");
ledgerTitle.style.margin = "16px 0 8px 0";
ledgerTitle.style.fontSize = "14px";
ledgerTitle.style.fontWeight = "600";
ledgerTitle.textContent = t("Extractor Attempts Ledger");
const ledgerContainer = document.createElement("div");
ledgerContainer.style.maxHeight = "150px";
ledgerContainer.style.overflowY = "auto";
ledgerContainer.style.border = "1px solid var(--border-color, #2e2a24)";
ledgerContainer.style.borderRadius = "6px";
ledgerContainer.style.fontSize = "12px";
(data.extractorAttempts || []).forEach(att => {
const row = document.createElement("div");
row.style.display = "flex";
row.style.justifyContent = "space-between";
row.style.padding = "8px 12px";
row.style.borderBottom = "1px solid rgba(255, 255, 255, 0.05)";
let color = "var(--text-muted, #a8a29e)";
if (att.status === "success") color = "#10b981";
if (att.status === "failed") color = "#ef4444";
if (att.status === "low_readable") color = "#f59e0b";
const nameSpan = document.createElement("span");
nameSpan.style.fontWeight = "600";
nameSpan.textContent = String(att.name ?? "");
const statusWrapper = document.createElement("span");
const statusSpan = document.createElement("span");
statusSpan.style.color = color;
statusSpan.style.fontWeight = "500";
statusSpan.textContent = t(att.status);
const durationSpan = document.createElement("span");
durationSpan.style.color = "var(--text-muted, #a8a29e)";
durationSpan.style.marginLeft = "8px";
durationSpan.textContent = `(${Number(att.durationMs || 0)}ms)`;
statusWrapper.append(statusSpan, durationSpan);
row.append(nameSpan, statusWrapper);
ledgerContainer.appendChild(row);
});
const actions = document.createElement("div");
actions.style.display = "flex";
actions.style.justifyContent = "flex-end";
actions.style.gap = "12px";
actions.style.marginTop = "20px";
const closeBtn = document.createElement("button");
closeBtn.type = "button";
closeBtn.className = "primary";
closeBtn.textContent = t("Close");
closeBtn.addEventListener("click", () => {
overlay.remove();
});
actions.appendChild(closeBtn);
modal.append(title, grid, ledgerTitle, ledgerContainer, actions);
overlay.appendChild(modal);
document.body.appendChild(overlay);
}
function showRetryModal(record) {
const overlay = document.createElement("div");
overlay.style.position = "fixed";
overlay.style.top = "0";
overlay.style.left = "0";
overlay.style.width = "100%";
overlay.style.height = "100%";
overlay.style.backgroundColor = "rgba(0, 0, 0, 0.6)";
overlay.style.backdropFilter = "blur(8px)";
overlay.style.display = "flex";
overlay.style.alignItems = "center";
overlay.style.justifyContent = "center";
overlay.style.zIndex = "9999";
const modal = document.createElement("div");
modal.style.backgroundColor = "var(--bg-card, #1c1917)";
modal.style.border = "1px solid var(--border-color, #2e2a24)";
modal.style.borderRadius = "12px";
modal.style.padding = "24px";
modal.style.width = "90%";
modal.style.maxWidth = "400px";
modal.style.boxShadow = "0 10px 25px -5px rgba(0, 0, 0, 0.5)";
modal.style.color = "var(--text-color, #e7e5e4)";
const title = document.createElement("h3");
title.style.margin = "0 0 16px 0";
title.style.fontSize = "16px";
title.style.fontWeight = "600";
title.textContent = t("Retry PDF extraction");
const desc = document.createElement("p");
desc.style.fontSize = "13px";
desc.style.color = "var(--text-muted, #a8a29e)";
desc.style.marginBottom = "16px";
desc.textContent = t("Select a preferred extractor for retry. This will overwrite previous extraction results.");
const select = document.createElement("select");
select.style.width = "100%";
select.style.padding = "8px 12px";
select.style.backgroundColor = "rgba(255, 255, 255, 0.05)";
select.style.border = "1px solid var(--border-color, #2e2a24)";
select.style.borderRadius = "6px";
select.style.color = "var(--text-color, #e7e5e4)";
select.style.marginBottom = "20px";
const options = [
{ value: "auto", label: "auto" },
{ value: "scientific", label: t("Scientific refinement (editable formulas, slow)") },
{ value: "marker", label: t("Marker full-page reconstruction (slowest)") },
{ value: "pdfplumber", label: t("Layout extraction (fast, uncertain formulas stay as images)") },
{ value: "ocr", label: "ocr" },
{ value: "built-in", label: "built-in" },
{ value: "pdftotext", label: "pdftotext" },
{ value: "mutool", label: "mutool" },
{ value: "pandoc", label: "pandoc" }
];
options.forEach(opt => {
const o = document.createElement("option");
o.value = opt.value;
o.textContent = opt.label;
select.appendChild(o);
});
const actions = document.createElement("div");
actions.style.display = "flex";
actions.style.justifyContent = "flex-end";
actions.style.gap = "12px";
const cancelBtn = document.createElement("button");
cancelBtn.type = "button";
cancelBtn.className = "secondary";
cancelBtn.textContent = t("Cancel");
cancelBtn.addEventListener("click", () => overlay.remove());
const submitBtn = document.createElement("button");
submitBtn.type = "button";
submitBtn.className = "primary";
submitBtn.textContent = t("Retry");
submitBtn.addEventListener("click", () => run(async () => {
const preferredExtractor = select.value;
overlay.remove();
$("noteContent").value = t("Extracting document to Markdown. Large PDFs can take a while; keep this window open.");
const progressPanel = $("extractionProgress");
const progressLabel = $("extractionProgressText");
if (progressPanel) {
progressPanel.classList.remove("hidden");
progressPanel.dataset.active = "true";
}
if (progressLabel) {
progressLabel.textContent = t("Extracting document to Markdown...");
}
try {
const result = await api("/api/document/retry-extraction", {
documentId: record.id,
preferredExtractor
});
const manifest = await refreshManifest();
refreshTimeline();
refreshVersions();
const doc = (manifest.documents ?? []).find((candidate) => candidate.id === record.id);
if (doc?.outputMarkdownPath) {
const relPath = relativeHumanMarkdownPath(doc);
$("notePath").value = relPath;
if (doc.markdownOutputs?.readableSegments?.segmented) {
const firstPart = doc.markdownOutputs.readableSegments.segments[0].relativePath;
$("notePath").value = firstPart;
$("noteContent").value = await api("/api/markdown/read", { relativePath: firstPart });
showAlert("success", t("Document extracted.") + "\n" + t("Loaded Part 1."));
} else if (shouldUseChunkedEditorLoad(doc)) {
showChunkedEditorPlaceholder(doc, relPath);
showAlert("info", t("Large document extracted. Readable Markdown is on disk; use chunked review in AI Will See for AI-ready intake."));
} else {
$("noteContent").value = await api("/api/markdown/read", { relativePath: relPath });
showAlert("success", [
t("Document extracted."),
`${t("Readable Markdown")}: ${relPath || "not available"}`,
`${t("AI-ready Markdown")}: ${relativeAiReadyMarkdownPath(doc) || "not available"}`
].join("\n"));
}
showEditorWarningsForRecord(doc);
await aiContextPanel.updateAiWillSeePanel();
}
} catch (err) {
showAlert("error", t("Extraction failed: ") + err.message);
} finally {
if (progressPanel) {
progressPanel.classList.add("hidden");
progressPanel.dataset.active = "false";
}
}
}));
actions.append(cancelBtn, submitBtn);
modal.append(title, desc, select, actions);
overlay.appendChild(modal);
document.body.appendChild(overlay);
}
const largeEditorLoadSourceBytes = 5 * 1024 * 1024;
function shouldUseChunkedEditorLoad(record = {}) {
const readableCharacters = Number(record.markdownOutputs?.readableStats?.characters || 0);
if (readableCharacters > 0) return readableCharacters >= largeEditorLoadSourceBytes;
return Number(record.sourceSize || 0) >= largeEditorLoadSourceBytes;
}
function relativeHumanMarkdownPath(record) {
const workspacePath = state.workspacePath || "";
let relPath = record?.markdownOutputs?.defaultForHumans || record?.readableMarkdownPath || record?.markdownOutputs?.readable || record?.outputMarkdownPath || "";
if (workspacePath && relPath.startsWith(workspacePath)) {
relPath = relPath.slice(workspacePath.length).replace(/^[\\\/]+/, "").replace(/\\/g, "/");
}
return relPath;
}
function relativeAiReadyMarkdownPath(record) {
const workspacePath = state.workspacePath || "";
let relPath = record?.outputMarkdownPath || record?.markdownOutputs?.aiReady || "";
if (workspacePath && relPath.startsWith(workspacePath)) {
relPath = relPath.slice(workspacePath.length).replace(/^[\\\/]+/, "").replace(/\\/g, "/");
}
return relPath;
}
function showChunkedEditorPlaceholder(record, relativePath) {
const segments = record.markdownOutputs?.readableSegments;
const firstSegment = segments?.segments?.[0]?.relativePath || "";
$("noteContent").value = [
`# ${record.title || record.name || record.id}`,
"",
"> Large document extracted. The full readable Markdown was split into numbered part files to keep the desktop UI responsive.",
"> Open the index or a numbered part file for human reading; use AI Will See for AI-ready chunk review.",
"",
`- Record: ${record.id}`,
`- Readable index: ${segments?.indexRelativePath || relativePath}`,
`- First part: ${firstSegment || "not segmented"}`,
`- Segment map: ${segments?.sourceMapRelativePath || "not segmented"}`,
`- Full readable file: ${record.markdownOutputs?.readable || record.readableMarkdownPath || relativePath}`,
`- Source size: ${Number(record.sourceSize || 0).toLocaleString()} bytes`,
""
].join("\n");
}
function nextFrame() {
return new Promise((resolve) => requestAnimationFrame(resolve));
}
function safeRecordStem(record, kind) {
const label = kind === "dataset" ? record.name : record.title;
return String(label || record.id)
.trim()
.replace(/\.[a-z0-9]+$/i, "")
.replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, "-")
.replace(/^-+|-+$/g, "")
.slice(0, 80) || record.id;
}
async function createExchangePackageForRecord(record, kind) {
const packageRelativePath = `packages/${safeRecordStem(record, kind)}-exchange`;
const result = await api("/api/exchange/package/from-record", {
recordId: record.id,
packageRelativePath,
input: {
title: `${safeRecordStem(record, kind)} Exchange Package`,
exportFormats: kind === "document" ? ["docx", "pdf"] : []
}
});
$("packagePath").value = packageRelativePath;
await exchangePackagePanel.loadExchangePackageReport(packageRelativePath);
showAlert("success", "Exchange package created and trust report loaded.");
return result;
}
async function selectRecordForWorkflow(record, kind) {
$("recordId").value = record.id;
if (kind === "document" && record.status === "ready" && record.outputMarkdownPath) {
const relPath = relativeHumanMarkdownPath(record);
$("notePath").value = relPath;
if (record.markdownOutputs?.readableSegments?.segmented) {
const firstPart = record.markdownOutputs.readableSegments.segments?.[0]?.relativePath || "";
if (firstPart) {
$("notePath").value = firstPart;
const noteContent = await api("/api/markdown/read", { relativePath: firstPart });
$("noteContent").value = noteContent;
showAlert("info", "Segmented large PDF: Loaded Part 1. Use outline or workbench to swap parts.");
} else if (shouldUseChunkedEditorLoad(record)) {
showChunkedEditorPlaceholder(record, relPath);
}
} else if (shouldUseChunkedEditorLoad(record)) {
showChunkedEditorPlaceholder(record, relPath);
} else {
const noteContent = await api("/api/markdown/read", { relativePath: relPath });
$("noteContent").value = noteContent;
}
showEditorWarningsForRecord(record);
} else {
$("editorWarnings").classList.add("hidden");
}
return { selectedRecordId: record.id, kind };
}
async function prepareAiForRecord(record, kind) {
await selectRecordForWorkflow(record, kind);
const prepared = await api("/api/ai/prepare-record", { recordId: record.id });
await refreshManifest();
const preview = prepared.preview ?? await aiContextPanel.updateAiWillSeePanel();
if (prepared.preview) {
aiContextPanel.renderAiWillSeePreview(prepared.preview);
}
await aiSummonPanel.summonAiGate();
return {
preparedRecordId: record.id,
kind,
sendGateDecision: preview?.sendGateDecision,
tokenEstimate: preview?.tokenEstimate,
preparationJob: prepared.preparationJob?.id ?? null
};
}
function renderManifest(manifest) {
const documents = manifest.documents ?? [];
const datasets = manifest.datasets ?? [];
const exchangePackages = manifest.exchangePackages ?? [];
const aiHandoffBundles = manifest.aiHandoffBundles ?? [];
const receiverReportCount = exchangePackages.filter((pkg) => pkg.receiverReport?.exists).length;
const trustReportCount = exchangePackages.filter((pkg) => pkg.trustReport?.exists).length;
const summary = $("manifestSummary");
summary.replaceChildren();
const counts = document.createElement("div");
counts.style.marginBottom = "10px";
counts.style.fontSize = "13px";
counts.style.color = "var(--text-muted)";
counts.textContent = `Workspace documents: ${documents.length} / datasets: ${datasets.length} / exchange packages: ${exchangePackages.length} / AI handoff bundles: ${aiHandoffBundles.length} / receiver reports: ${receiverReportCount} / trust reports: ${trustReportCount} / jobs: ${(manifest.jobs ?? []).length}`;
summary.append(counts);
if (documents.length === 0 && datasets.length === 0 && exchangePackages.length === 0) {
const empty = document.createElement("div");
empty.className = "empty-state";
empty.innerHTML = `<p style="font-size: 13px; color: var(--text-muted);">Workspace is empty. Import a Word/PDF/Excel/CSV file to start.</p>`;
summary.append(empty);
return;
}
if (exchangePackages.length > 0) {
const packageList = document.createElement("div");
packageList.className = "record-list package-overview-list";
for (const pkg of exchangePackages) {
const packageRelativePath = `packages/${pkg.name}`;
const card = document.createElement("div");
card.className = "record-card package-overview-card";
const header = document.createElement("div");
header.className = "record-header";
const titleArea = document.createElement("div");
titleArea.className = "record-title-area";
const typeBadge = document.createElement("span");
typeBadge.className = "record-badge badge-info";
typeBadge.textContent = "Exchange package";
const title = document.createElement("span");
title.className = "record-title";
title.textContent = pkg.title || pkg.name;
titleArea.append(typeBadge, title);
const openBtn = pill("View trust report", { packagePath: packageRelativePath });
openBtn.style.padding = "4px 10px";
openBtn.style.fontSize = "12px";
openBtn.addEventListener("click", () => run(async () => {
$("packagePath").value = packageRelativePath;
return exchangePackagePanel.loadExchangePackageReport(packageRelativePath);
}));
header.append(titleArea, openBtn);
card.append(header);
const metaRow = document.createElement("div");
metaRow.className = "record-meta-row";
const addPackageMeta = (label, value) => {
const item = document.createElement("div");
item.className = "record-meta-item";
item.innerHTML = `<span class="record-meta-label">${label}:</span> ${escapeHtml(value || "-")}`;
metaRow.append(item);
};
addPackageMeta("Path", packageRelativePath);
addPackageMeta("Version", pkg.packageVersion || "1.0.0");
addPackageMeta("Exports", (pkg.files ?? []).join(", "));
addPackageMeta("Created at", pkg.createdAt ? new Date(pkg.createdAt).toLocaleString() : "-");
card.append(metaRow);
const badges = document.createElement("div");
badges.className = "record-badges";
const receiverBadge = document.createElement("span");
receiverBadge.className = `record-badge ${pkg.receiverReport?.exists ? "badge-success" : "badge-warning"}`;
receiverBadge.textContent = pkg.receiverReport?.exists ? "Receiver report written" : "Receiver report pending";
const trustBadge = document.createElement("span");
trustBadge.className = `record-badge ${pkg.trustReport?.exists ? "badge-success" : "badge-warning"}`;
trustBadge.textContent = pkg.trustReport?.exists ? "Trust report written" : "Trust report pending";
badges.append(receiverBadge, trustBadge);
card.append(badges);
const actions = document.createElement("div");
actions.className = "record-actions";
const writeBtn = document.createElement("button");
writeBtn.type = "button";
writeBtn.className = "secondary compact-button";
writeBtn.textContent = "Write receiver report";
writeBtn.addEventListener("click", () => run(async () => {
$("packagePath").value = packageRelativePath;
const result = await api("/api/exchange/package/receiver-report", { packageRelativePath });
await exchangePackagePanel.loadExchangePackageReport(packageRelativePath);
await refreshManifest();
return result;
}));
actions.append(writeBtn);
card.append(actions);
packageList.append(card);
}
summary.append(packageList);
}
if (aiHandoffBundles.length > 0) {
const handoffList = document.createElement("div");
handoffList.className = "record-list";
for (const bundle of aiHandoffBundles.slice(0, 5)) {
const card = document.createElement("div");
card.className = "record-card";
const header = document.createElement("div");
header.className = "record-header";
const titleArea = document.createElement("div");
titleArea.className = "record-title-area";
const typeBadge = document.createElement("span");
typeBadge.className = "record-badge badge-info";
typeBadge.textContent = "AI handoff";
const title = document.createElement("span");
title.className = "record-title";
title.textContent = bundle.relativePath || "AI handoff bundle";
titleArea.append(typeBadge, title);
const openBtn = pill("Open", { path: bundle.relativePath });
openBtn.style.padding = "4px 10px";
openBtn.style.fontSize = "12px";
openBtn.addEventListener("click", () => run(async () => {
$("notePath").value = bundle.relativePath;
$("noteContent").value = await api("/api/markdown/read", { relativePath: bundle.relativePath });
return { openedAiHandoffBundle: bundle.relativePath };
}));
header.append(titleArea, openBtn);
card.append(header);
const metaRow = document.createElement("div");
metaRow.className = "record-meta-row";
const addBundleMeta = (label, value) => {
const item = document.createElement("div");
item.className = "record-meta-item";
item.innerHTML = `<span class="record-meta-label">${label}:</span> ${escapeHtml(value || "-")}`;
metaRow.append(item);
};
addBundleMeta("Record", bundle.recordId || "staged-context");
addBundleMeta("Evidence", bundle.evidenceId || "none");
addBundleMeta("Created at", bundle.createdAt ? new Date(bundle.createdAt).toLocaleString() : "-");
card.append(metaRow);
handoffList.append(card);
}
summary.append(handoffList);
}
const list = document.createElement("div");
list.className = "record-list";
const renderRecordCard = (record, kind) => {
const card = document.createElement("div");
card.className = "record-card";
const header = document.createElement("div");
header.className = "record-header";
const titleArea = document.createElement("div");
titleArea.className = "record-title-area";
const typeBadge = document.createElement("span");
typeBadge.className = `record-badge ${kind === "document" ? "badge-primary" : "badge-info"}`;
typeBadge.textContent = kind === "document" ? "Document" : "Dataset";
const title = document.createElement("span");
title.className = "record-title";
title.textContent = kind === "document" ? record.title : record.name;
titleArea.append(typeBadge, title);
const selectBtn = pill("Select", { recordId: record.id });
selectBtn.style.padding = "4px 10px";
selectBtn.style.fontSize = "12px";
selectBtn.addEventListener("click", () => run(() => selectRecordForWorkflow(record, kind)));
header.append(titleArea, selectBtn);
card.append(header);
const metaRow = document.createElement("div");
metaRow.className = "record-meta-row";
const addMeta = (label, val) => {
const item = document.createElement("div");
item.className = "record-meta-item";
const labelSpan = document.createElement("span");
labelSpan.className = "record-meta-label";
labelSpan.textContent = `${label}:`;
item.append(labelSpan, ` ${String(val || "-")}`);
metaRow.append(item);
};
addMeta("Format", record.sourceType?.toUpperCase());
addMeta("Source file", record.originalSourcePath ? record.originalSourcePath : "local drag-and-drop upload");
addMeta("Imported copy", record.sourcePath);
if (kind === "document") {
const extractedTime = record.lastExtractedAt
? new Date(record.lastExtractedAt).toLocaleString()
: "Not extracted yet";
addMeta("Last extracted at", extractedTime);
} else {
addMeta("Imported at", new Date(record.createdAt).toLocaleString());
}
if (record.hash) {
addMeta("Hash check", `${record.hash.slice(0, 8)}...`);
}
card.append(metaRow);
const badges = document.createElement("div");
badges.className = "record-badges";
const statusBadge = document.createElement("span");
statusBadge.className = `record-badge ${record.status === "ready" ? "badge-success" : "badge-warning"}`;
statusBadge.textContent = record.status === "ready" ? "Ready" : "Pending";
badges.append(statusBadge);
if (record.quality) {
const conf = record.quality.confidence;
const confBadge = document.createElement("span");
confBadge.className = `record-badge ${conf === "high" ? "badge-success" : conf === "medium" ? "badge-warning" : "badge-error"}`;
confBadge.textContent = `Confidence: ${conf}`;
badges.append(confBadge);
if (record.quality.hasTextLayer === false) {
const ocrBadge = document.createElement("span");
ocrBadge.className = "record-badge badge-error";
ocrBadge.textContent = "No text layer / OCR recommended";
badges.append(ocrBadge);
} else if (record.quality.hasOcrMissing === true) {
const ocrBadge = document.createElement("span");
ocrBadge.className = "record-badge badge-error";
ocrBadge.textContent = "OCR adapter missing";
badges.append(ocrBadge);
}
if (record.quality.hasTablesSimplified === true) {
const tblBadge = document.createElement("span");
tblBadge.className = "record-badge badge-warning";
tblBadge.textContent = "Table structure simplified";
badges.append(tblBadge);
}
}
if (record.warnings && record.warnings.length > 0) {
const warnBadge = document.createElement("span");
warnBadge.className = "record-badge badge-error";
warnBadge.textContent = `Warning: ${record.warnings[0]}`;
badges.append(warnBadge);
}
if (kind === "document" && record.markdownOutputs?.readableSegments?.segmented) {
const segmentBadge = document.createElement("span");
segmentBadge.className = "record-badge badge-info";
segmentBadge.textContent = `Human MD split: ${record.markdownOutputs.readableSegments.segmentCount} parts`;
badges.append(segmentBadge);
addMeta("Segment map", record.markdownOutputs.readableSegments.sourceMapRelativePath || "available");
}
card.append(badges);
const actions = document.createElement("div");
actions.className = "record-actions";
if (record.sourceType === "pdf") {
const pdfBadge = document.createElement("span");
let statusText = `PDF extraction: ${record.extractorName || "built-in"}`;
let className = "badge-info";
if (record.status !== "ready") {
statusText = "PDF extraction: pending";
className = "badge-warning";
} else if (record.extractionQuality?.lowReadableText) {
if (record.quality?.hasTextLayer === false) {
statusText = "PDF extraction: OCR needed";
className = "badge-error";
} else {
statusText = "PDF extraction: failed";
className = "badge-error";
}
}
pdfBadge.className = `record-badge ${className}`;
pdfBadge.textContent = t(statusText);
badges.append(pdfBadge);
}
const addAction = (label, action, className = "secondary") => {
const button = document.createElement("button");
button.type = "button";
button.className = `${className} compact-button`;
button.textContent = t(label);
button.addEventListener("click", () => run(() => action(button)));
actions.append(button);
};
addAction("Prepare for AI", () => prepareAiForRecord(record, kind), "primary-action");
if (kind === "document") {
if (record.sourceType === "pdf") {
addAction("View PDF diagnostics", async () => {
try {
const workspacePath = state.workspacePath || "";
let relDiagnosticsPath = record.pdfDiagnosticsPath || "";
if (workspacePath && relDiagnosticsPath.startsWith(workspacePath)) {
relDiagnosticsPath = relDiagnosticsPath.slice(workspacePath.length).replace(/^[\\\/]+/, "").replace(/\\/g, "/");
}
if (!relDiagnosticsPath) {
showAlert("error", t("No diagnostics report found for this PDF."));
return;
}
const diagnosticsContent = await api("/api/markdown/read", { relativePath: relDiagnosticsPath });
const diagnostics = JSON.parse(diagnosticsContent);
showDiagnosticsModal(diagnostics);
} catch (err) {
showAlert("error", t("Failed to read diagnostics: ") + err.message);
}
});
addAction("Retry PDF extraction", () => {
showRetryModal(record);
});
if (record.extractionQuality?.visualContentStatus === "mapped") {
addAction("Preserve PDF formulas and figures", async (button) => {
const originalLabel = button.textContent;
button.disabled = true;
button.textContent = t("Preserving visual content...");
showAlert("info", t("Rendering low-confidence formulas, tables, and figures from the original PDF. Large files can take a while."));
try {
const result = await api("/api/pdf/preserve-visual-assets", { documentId: record.id, mode: "fallback", dpi: 220 });
await refreshManifest();
showAlert(result.failed?.length ? "warning" : "success", `${t("PDF visual content preserved.")} ${t("Rendered")}: ${result.rendered}/${result.requested}. ${t("Failed")}: ${result.failed?.length || 0}.`);
} finally {
button.disabled = false;
button.textContent = originalLabel;
}
});
}
}
addAction(record.outputMarkdownPath ? "Retry / refresh extraction" : "Extract", async (button) => {
$("recordId").value = record.id;
const originalLabel = button.textContent;
button.disabled = true;
button.textContent = "Extracting...";
$("noteContent").value = "Extracting document to Markdown. Large PDFs can take a while; keep this window open.";
showAlert("info", "Extracting document to Markdown...");
await nextFrame();
try {
const result = await api("/api/document/convert", { documentId: record.id });
const manifest = await refreshManifest();
refreshTimeline();
refreshVersions();
const doc = (manifest.documents ?? []).find((candidate) => candidate.id === record.id);
if (doc?.outputMarkdownPath) {
const relPath = relativeHumanMarkdownPath(doc);
$("notePath").value = relPath;
if (shouldUseChunkedEditorLoad(doc)) {
showChunkedEditorPlaceholder(doc, relPath);
showAlert("info", "Large document extracted. Readable Markdown is on disk; use chunked review in AI Will See for AI-ready intake.");
} else {
$("noteContent").value = await api("/api/markdown/read", { relativePath: relPath });
}
showAlert("success", [
"Document extracted.",
`Readable Markdown: ${relPath || "not available"}`,
`AI-ready Markdown: ${relativeAiReadyMarkdownPath(doc) || "not available"}`
].join("\n"));
showEditorWarningsForRecord(doc);
await aiContextPanel.updateAiWillSeePanel();
}
return result;
} finally {
button.disabled = false;
button.textContent = originalLabel;
}
});
addAction("Export Word", () => api("/api/document/export", {
documentId: record.id,
outputRelativePath: `exports/${safeRecordStem(record, kind)}.docx`,
format: "docx"
}).then(rememberConversionAudit));
addAction("Export PDF", () => api("/api/document/export", {
documentId: record.id,
outputRelativePath: `exports/${safeRecordStem(record, kind)}.pdf`,
format: "pdf"
}).then(rememberConversionAudit));
} else {
addAction("Inspect table", async () => {
$("recordId").value = record.id;
const result = await api("/api/dataset/inspect", { datasetId: record.id });
await refreshManifest();
return result;
});
}
addAction("Generate exchange package", () => createExchangePackageForRecord(record, kind));
card.append(actions);
const isChanged = state.changedRecordIds?.has(record.id);
const isMissing = state.missingRecordIds?.has(record.id);
if (isChanged) {
const actionBox = document.createElement("div");
actionBox.className = "record-action-box";
const text = document.createElement("span");
text.textContent = "Source file changed externally.";
const refreshBtn = document.createElement("button");
refreshBtn.className = "mini-refresh-btn";
refreshBtn.textContent = "Refresh extraction";
refreshBtn.addEventListener("click", () => run(async () => {
const res = await api("/api/record/refresh-source", { recordId: record.id });
await refreshManifest();
return res;
}));
actionBox.append(text, refreshBtn);
card.append(actionBox);
} else if (isMissing) {
const actionBox = document.createElement("div");
actionBox.className = "record-action-box missing-box";
actionBox.innerHTML = "<span>Original source file is missing or moved; refresh is unavailable.</span>";
card.append(actionBox);
}
return card;
};
for (const record of documents) {
list.append(renderRecordCard(record, "document"));
}
for (const record of datasets) {
list.append(renderRecordCard(record, "dataset"));
}
summary.append(list);
}
return {
renderManifest,
safeRecordStem,
selectRecordForWorkflow,
prepareAiForRecord,
createExchangePackageForRecord
};
}
