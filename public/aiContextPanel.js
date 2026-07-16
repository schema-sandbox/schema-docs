export function createAiContextPanel({ $, api, state, escapeHtml, showAlert }) {
async function updateAiWillSeePanel() {
const recordId = $("recordId").value.trim();
if (!recordId) {
$("aiWillSeePanel").classList.add("hidden");
return null;
}
try {
const preview = await api("/api/ai/context-preview", { recordIdOrPackagePath: recordId });
renderAiWillSeePreview(preview);
return preview;
} catch (e) {
$("aiWillSeePanel").classList.add("hidden");
return null;
}
}
function renderAiWillSeePreview(preview) {
$("aiWillSeePanel").classList.remove("hidden");
const intakePlan = preview.aiIntakePlan;
if ($("aiChunkIndex") && intakePlan?.chunkCount) {
$("aiChunkIndex").max = String(intakePlan.chunkCount);
const currentIndex = Number($("aiChunkIndex").value || 1);
if (currentIndex > intakePlan.chunkCount) {
$("aiChunkIndex").value = String(intakePlan.chunkCount);
}
}
const intakeSummary = intakePlan
? `<div><strong>AI Intake Plan:</strong> ${escapeHtml(intakePlan.mode)} / ${Number(intakePlan.chunkCount || 0)} chunks / first chunk ~${Number(intakePlan.firstChunkRange?.estimatedTokens || 0)} tokens</div><div><strong>Feeding Plan:</strong> ${escapeHtml(intakePlan.feedingPlan?.mode || "unknown")} / ${Number(intakePlan.feedingPlan?.estimatedBatchCount || 0)} batches / continuous loop ${intakePlan.feedingPlan?.suitableForContinuousAgentLoop ? "yes" : "no"}</div><div><strong>Chunk Strategy:</strong> ${escapeHtml(intakePlan.recommendedSendStrategy || "")}</div>`
: "";
const markdownSections = (preview.markdownSections ?? []).map(escapeHtml).join(", ") || "none";
const excludedOrSanitized = (preview.excludedOrSanitized ?? []).map(escapeHtml).join(", ") || "none";
const knownLimits = (preview.knownLimits ?? []).map(escapeHtml).join(", ") || "none";
$("aiWillSeeContent").innerHTML = `
   ${intakeSummary}<div><strong>Included headings:</strong> ${markdownSections}</div><div><strong>Masked or sanitized content:</strong> ${excludedOrSanitized}</div><div><strong>Estimated tokens:</strong> ${Number(preview.tokenEstimate || 0)}</div><div><strong>Extraction warnings:</strong> ${Number(preview.qualityWarnings?.length || 0)}</div><div><strong>Matched limits:</strong> ${knownLimits}</div><div><strong>AI gate decision:</strong> <span style="font-weight: bold; color: ${preview.sendGateDecision === "blocked" ? "#ef4444" : "#10b981"}">${escapeHtml(preview.sendGateDecision)}</span></div><div style="margin-top: 4px; color: #a5b4fc;"><strong>Recommended next step:</strong> ${escapeHtml(preview.recommendedNextAction || "")}</div>`;
}
async function loadAiIntakePlanIntoPanel() {
const recordId = $("recordId").value.trim();
if (!recordId) throw new Error("Select or enter a document/dataset/package id first.");
const manifest = await api("/api/ai/intake-plan", { recordIdOrPackagePath: recordId });
renderAiIntakeManifest(manifest);
return manifest;
}
function renderAiIntakeManifest(manifest) {
$("aiWillSeePanel").classList.remove("hidden");
const intakePlan = manifest.aiIntakePlan;
if ($("aiChunkIndex") && intakePlan?.chunkCount) {
$("aiChunkIndex").max = String(intakePlan.chunkCount);
$("aiChunkIndex").value = "1";
}
if ($("aiChunkRangeEnd") && intakePlan?.chunkCount) {
$("aiChunkRangeEnd").max = String(intakePlan.chunkCount);
$("aiChunkRangeEnd").value = String(Math.min(3, intakePlan.chunkCount));
}
const chunks = intakePlan?.chunks ?? [];
const continuation = manifest.continuation;
const batchPreview = manifest.batchPlanPreview;
const chunkRows = chunks.slice(0, 8).map((chunk) => (
`<div class="mono-line">${escapeHtml(chunk.id)} | ${chunk.index}/${intakePlan.chunkCount} | chars ${chunk.startChar}-${chunk.endChar} | tokens~${chunk.estimatedTokens}${chunk.headingHint ? ` | ${escapeHtml(chunk.headingHint)}` : ""}</div>`
)).join("");
const batchRows = (batchPreview?.batches ?? []).map((batch) => (
`<div class="mono-line">batch ${Number(batch.batchIndex)} | chunks ${Number(batch.startChunkIndex)}-${Number(batch.endChunkIndex)} | ${escapeHtml(batch.command || "")}</div>`
)).join("");
const finalBatchRow = batchPreview?.finalBatch
? `<div class="mono-line">final batch ${Number(batchPreview.finalBatch.batchIndex)} | chunks ${Number(batchPreview.finalBatch.startChunkIndex)}-${Number(batchPreview.finalBatch.endChunkIndex)} | ${escapeHtml(batchPreview.finalBatch.command || "")}</div>`
: "";
$("aiWillSeeContent").innerHTML = `<div><strong>AI Intake Plan:</strong> ${escapeHtml(intakePlan?.mode || "unknown")} / ${Number(intakePlan?.chunkCount || 0)} chunks / tokens~${Number(manifest.tokenEstimate || 0)}</div><div><strong>Feeding Plan:</strong> ${escapeHtml(intakePlan?.feedingPlan?.mode || "unknown")} / priority ${escapeHtml(intakePlan?.feedingPlan?.priority || "unknown")} / ${Number(intakePlan?.feedingPlan?.estimatedBatchCount || 0)} batches / continuous loop ${intakePlan?.feedingPlan?.suitableForContinuousAgentLoop ? "yes" : "no"}</div><div><strong>Batch Preview:</strong> ${Number(batchPreview?.previewBatchCount || 0)}/${Number(batchPreview?.totalBatchCount || 0)} shown / omitted ${Number(batchPreview?.omittedBatchCount || 0)} / range width ${Number(batchPreview?.rangeWidth || 0)}</div><div><strong>Range Budget:</strong> ${Number(intakePlan?.suggestedRangeChunkCount || 0)} chunks per batch / ${Number(intakePlan?.estimatedRangeCount || 0)} estimated batches / tokens~${Number(intakePlan?.defaultRangeTokenBudget || 0)}</div><div><strong>Continuation:</strong> ${continuation?.canContinue ? "ready" : "complete"} / remaining batches ${Number(continuation?.remainingRangeCount || 0)} / mode ${escapeHtml(continuation?.recommendedMode || "")}</div><div><strong>Safety:</strong> sendsContent=${manifest.safety?.sendsContent === false ? "false" : "unknown"} / reviewBeforeSend=${manifest.safety?.requiresReviewBeforeSend ? "true" : "false"} / previewChunks=${manifest.safety?.canPreviewChunks ? "true" : "false"} / sendAllowedAfterReview=${manifest.safety?.sendAllowedAfterReview ? "true" : "false"} / endpoint=${escapeHtml(manifest.safety?.chunkEndpoint || "")}</div><div><strong>Blocking Warnings:</strong> ${(manifest.safety?.blockingWarnings ?? []).map(escapeHtml).join(", ") || "none"}</div><div><strong>Next Chunk Command:</strong> <span class="mono-line">${escapeHtml(manifest.nextChunkCommand || "")}</span></div><div><strong>Next Range Command:</strong> <span class="mono-line">${escapeHtml(manifest.nextRangeCommand || "")}</span></div><div><strong>Send Gate:</strong> <span style="font-weight: bold; color: ${manifest.sendGateDecision === "blocked" ? "#ef4444" : "#10b981"}">${escapeHtml(manifest.sendGateDecision)}</span></div><div><strong>Quality Warnings:</strong> ${(manifest.qualityWarnings ?? []).map(escapeHtml).join(", ") || "none"}</div><div><strong>Known Limits:</strong> ${(manifest.knownLimits ?? []).map(escapeHtml).join(", ") || "none"}</div><div style="margin-top: 6px;"><strong>Planned Batches:</strong></div>${batchRows || "<div>No batch preview available.</div>"}
   ${finalBatchRow}<div style="margin-top: 6px;"><strong>Preview Chunks:</strong></div>${chunkRows || "<div>No chunks available.</div>"}<div style="margin-top: 4px; color: #a5b4fc;"><strong>Next:</strong> ${escapeHtml(manifest.recommendedNextAction || "")}</div>`;
}
function currentAiChunkIndex() {
return Math.max(1, Number($("aiChunkIndex")?.value || 1) || 1);
}
function currentAiChunkMax() {
return Math.max(1, Number($("aiChunkIndex")?.max || 1) || 1);
}
function aiChunkMarker(chunk) {
return `<!-- AI_CONTEXT_CHUNK ${chunk.chunk.index}/${chunk.totalChunkCount} ${chunk.chunk.id} -->`;
}
function rememberAiContinuation(result) {
state.lastAiContinuation = result?.hasMoreChunks
? {
nextChunkIndex: result.nextChunkIndex,
totalChunkCount: result.totalChunkCount,
nextChunkCommand: result.nextChunkCommand || "",
nextRangeCommand: result.nextRangeCommand || ""
}
: null;
}
function rememberAiContextEvidence(result) {
state.lastAiContextEvidenceId = result?.evidenceId || "";
}
function renderAiChunkLedger() {
const ledger = $("aiChunkLedger");
if (!ledger) {
return;
}
const content = $("aiContent")?.value || "";
const matches = [...content.matchAll(/AI_CONTEXT_CHUNK\s+(\d+)\/(\d+)\s+(chunk_\d+)/g)];
const estimatedTokens = Math.ceil(content.length / 4);
if (matches.length === 0) {
ledger.textContent = content.trim()
? `AI chunk ledger: manual context / tokens~${estimatedTokens}`
: "AI chunk ledger: empty";
return;
}
const chunks = matches.map((match) => Number(match[1]));
const total = Number(matches[0][2] || 0);
const uniqueChunks = [...new Set(chunks)].sort((a, b) => a - b);
const duplicateChunks = uniqueChunks.filter((chunk) => chunks.filter((item) => item === chunk).length > 1);
const missingChunks = total
? Array.from({ length: total }, (_, index) => index + 1).filter((chunk) => !uniqueChunks.includes(chunk))
: [];
const coverage = total ? `${Math.round((uniqueChunks.length / total) * 100)}%` : "unknown";
ledger.textContent = [
`AI chunk ledger: ${uniqueChunks.length} selected`,
`chunks ${uniqueChunks.join(", ")}${total ? ` / ${total}` : ""}`,
`coverage ${coverage}`,
missingChunks.length ? `missing ${missingChunks.slice(0, 8).join(", ")}${missingChunks.length > 8 ? "..." : ""}` : "missing none",
duplicateChunks.length ? `duplicates ${duplicateChunks.join(", ")}` : "duplicates none",
`tokens~${estimatedTokens}`,
state.lastAiContextEvidenceId ? `evidence ${state.lastAiContextEvidenceId}` : "evidence none"
].join(" | ");
}
async function loadAiChunkIntoEditor(chunkIndex = 1, options = {}) {
const recordId = $("recordId").value.trim();
if (!recordId) throw new Error("Select or enter a document/dataset/package id first.");
const normalizedChunkIndex = Math.max(1, Number(chunkIndex) || 1);
const chunk = await api("/api/ai/context-chunk", {
recordIdOrPackagePath: recordId,
chunkIndex: normalizedChunkIndex
});
if ($("aiChunkIndex")) {
$("aiChunkIndex").value = String(chunk.chunk.index);
$("aiChunkIndex").max = String(chunk.totalChunkCount);
}
rememberAiContinuation(chunk);
rememberAiContextEvidence(chunk);
if (options.append) {
const existing = $("aiContent").value.trimEnd();
const separator = existing
? `\n\n---\n\n${aiChunkMarker(chunk)}\n\n`
: "";
$("aiContent").value = existing
? `${existing}${separator}${chunk.content}`
: `${aiChunkMarker(chunk)}\n\n${chunk.content}`;
} else {
$("aiContent").value = `${aiChunkMarker(chunk)}\n\n${chunk.content}`;
}
$("sendGateSummary").textContent = [
`${options.append ? "Appended" : "Loaded"} AI chunk ${chunk.chunk.index}/${chunk.totalChunkCount}`,
`tokens~${chunk.tokenEstimate}`,
chunk.evidenceId ? `evidence ${chunk.evidenceId}` : "evidence none",
chunk.progress ? `progress ${chunk.progress.percentComplete}%` : "progress unknown",
chunk.continuation ? `remaining batches ${chunk.continuation.remainingRangeCount}` : "remaining batches unknown",
chunk.hasMoreChunks ? `next chunk ${chunk.nextChunkIndex}` : "last chunk",
`Send Gate: ${chunk.sendGateDecision}`,
"review required before send"
].join(" | ");
state.lastReviewedAiContextSignature = "";
state.stagedAiContextDirty = true;
renderAiChunkLedger();
$("aiContent").focus();
return {
loadedChunk: chunk.chunk.id,
tokenEstimate: chunk.tokenEstimate,
totalChunkCount: chunk.totalChunkCount,
sendGateDecision: chunk.sendGateDecision
};
}
function loadFirstAiChunkIntoEditor() {
return loadAiChunkIntoEditor(1);
}
function loadSelectedAiChunkIntoEditor() {
return loadAiChunkIntoEditor(currentAiChunkIndex());
}
function appendSelectedAiChunkIntoEditor() {
return loadAiChunkIntoEditor(currentAiChunkIndex(), { append: true });
}
function loadPreviousAiChunkIntoEditor() {
return loadAiChunkIntoEditor(Math.max(1, currentAiChunkIndex() - 1));
}
function loadNextAiChunkIntoEditor() {
return loadAiChunkIntoEditor(Math.min(currentAiChunkMax(), currentAiChunkIndex() + 1));
}
function appendNextAiChunkIntoEditor() {
const nextChunkIndex = state.lastAiContinuation?.nextChunkIndex
|| Math.min(currentAiChunkMax(), currentAiChunkIndex() + 1);
return loadAiChunkIntoEditor(nextChunkIndex, { append: true });
}
function currentAiChunkRange() {
const startChunkIndex = Math.max(1, Number($("aiChunkRangeStart")?.value || 1) || 1);
const endChunkIndex = Math.max(startChunkIndex, Number($("aiChunkRangeEnd")?.value || startChunkIndex) || startChunkIndex);
const tokenBudget = Math.max(500, Number($("aiChunkRangeBudget")?.value || 9000) || 9000);
return {
startChunkIndex,
endChunkIndex,
tokenBudget
};
}
async function loadAiChunkRangeIntoEditor(options = {}) {
const recordId = $("recordId").value.trim();
if (!recordId) throw new Error("Select or enter a document/dataset/package id first.");
const range = currentAiChunkRange();
const bundle = await api("/api/ai/context-range", {
recordIdOrPackagePath: recordId,
...range
});
if ($("aiChunkIndex") && bundle.includedRange?.endChunkIndex) {
$("aiChunkIndex").value = String(bundle.includedRange.endChunkIndex);
$("aiChunkIndex").max = String(bundle.totalChunkCount);
}
if ($("aiChunkRangeStart") && bundle.nextChunkIndex) {
$("aiChunkRangeStart").value = String(bundle.nextChunkIndex);
}
if ($("aiChunkRangeEnd") && bundle.nextChunkIndex) {
const width = Math.max(0, range.endChunkIndex - range.startChunkIndex);
$("aiChunkRangeEnd").value = String(Math.min(bundle.totalChunkCount, bundle.nextChunkIndex + width));
}
rememberAiContinuation(bundle);
rememberAiContextEvidence(bundle);
const existing = $("aiContent").value.trimEnd();
$("aiContent").value = options.append && existing
? `${existing}\n\n---\n\n${bundle.content}`
: bundle.content;
$("sendGateSummary").textContent = [
`${options.append ? "Appended" : "Loaded"} AI chunk range ${bundle.includedRange.startChunkIndex}-${bundle.includedRange.endChunkIndex}/${bundle.totalChunkCount}`,
`tokens~${bundle.tokenEstimate}/${bundle.tokenBudget}`,
bundle.evidenceId ? `evidence ${bundle.evidenceId}` : "evidence none",
bundle.progress ? `progress ${bundle.progress.percentComplete}%` : "progress unknown",
bundle.continuation ? `remaining batches ${bundle.continuation.remainingRangeCount}` : "remaining batches unknown",
bundle.truncatedByTokenBudget ? "truncated by token budget" : "complete range",
bundle.hasMoreChunks ? `next chunk ${bundle.nextChunkIndex}` : "last chunk",
`Send Gate: ${bundle.sendGateDecision}`,
"review required before send"
].join(" | ");
state.lastReviewedAiContextSignature = "";
state.stagedAiContextDirty = true;
renderAiChunkLedger();
$("aiContent").focus();
return {
loadedRange: bundle.includedRange,
tokenEstimate: bundle.tokenEstimate,
tokenBudget: bundle.tokenBudget,
truncatedByTokenBudget: bundle.truncatedByTokenBudget,
sendGateDecision: bundle.sendGateDecision
};
}
function loadSelectedAiChunkRangeIntoEditor() {
return loadAiChunkRangeIntoEditor();
}
function appendSelectedAiChunkRangeIntoEditor() {
return loadAiChunkRangeIntoEditor({ append: true });
}
function appendNextAiChunkRangeIntoEditor() {
if (state.lastAiContinuation?.nextChunkIndex && $("aiChunkRangeStart")) {
const nextChunkIndex = state.lastAiContinuation.nextChunkIndex;
const range = currentAiChunkRange();
const width = Math.max(0, range.endChunkIndex - range.startChunkIndex);
$("aiChunkRangeStart").value = String(nextChunkIndex);
$("aiChunkRangeEnd").value = String(Math.min(currentAiChunkMax(), nextChunkIndex + width));
}
return loadAiChunkRangeIntoEditor({ append: true });
}
function clearStagedAiContext() {
$("aiContent").value = "";
$("sendGateSummary").textContent = "Send Gate: staged context cleared";
state.lastReviewedAiContextSignature = "";
state.stagedAiContextDirty = false;
state.lastAiContinuation = null;
state.lastAiContextEvidenceId = "";
renderAiChunkLedger();
$("aiContent").focus();
return { cleared: true };
}
function timestampForPath() {
return new Date().toISOString().replace(/[:.]/g, "-");
}
async function saveStagedAiContext() {
const content = $("aiContent").value.trim();
if (!content) throw new Error("No staged AI context to save.");
renderAiChunkLedger();
const relativePath = `notes/staged-ai-context-${timestampForPath()}.md`;
const ledger = $("aiChunkLedger")?.textContent || "AI chunk ledger: unavailable";
const sendGate = $("sendGateSummary")?.textContent || "Send Gate: not reviewed";
const body = [
"## Staged Context Review",
"",
`- ${ledger}`,
`- ${sendGate}`,
`- Evidence: ${state.lastAiContextEvidenceId || "none"}`,
`- Operation: ${$("aiOperation").value}`,
"",
"## Staged Context",
"",
content
].join("\n");
const saved = await api("/api/exchange/save", {
relativePath,
input: {
title: "Staged AI Context",
source: "web-ui-staged-context",
body,
apiBaseUrl: $("apiBaseUrl").value.trim(),
model: $("apiModel").value.trim(),
auditId: state.lastAiAuditId || undefined,
evidenceId: state.lastAiContextEvidenceId || undefined
}
});
$("notePath").value = relativePath;
$("noteContent").value = body;
$("sendGateSummary").textContent = `Saved staged context: ${relativePath}`;
return {
savedStagedContext: relativePath,
result: saved
};
}
async function saveCleanAiReadyCopy() {
let content = $("aiContent").value.trim();
const recordId = $("recordId").value.trim();
if (!content) {
if (!recordId) throw new Error("Import or select a document first.");
await updateAiWillSeePanel();
await loadAiChunkRangeIntoEditor();
content = $("aiContent").value.trim();
}
if (!content) throw new Error("No AI-ready context could be prepared for this document.");
if (typeof showAlert === "function") showAlert("info", "Sanitizing and saving clean copy...");
const maskResult = await api("/api/mask", { content });
const maskedContent = maskResult.maskedText || "";
const mapping = maskResult.mapping || {};
const maskedCount = Object.keys(mapping).length;
renderAiChunkLedger();
let originalBaseName = "staged-context";
const sourcePathVal = $("sourcePath")?.value?.trim() || "";
if (sourcePathVal) {
const parts = sourcePathVal.replace(/\\/g, "/").split("/");
const filePart = parts[parts.length - 1];
const dotIndex = filePart.lastIndexOf(".");
if (dotIndex > 0) originalBaseName = filePart.slice(0, dotIndex);
else if (filePart) originalBaseName = filePart;
} else if (recordId) {
originalBaseName = recordId;
}
const maskedBaseResult = await api("/api/mask", { content: originalBaseName });
const cleanBaseName = (maskedBaseResult.maskedText || "staged-context")
.replace(/\[MASK_([A-Z]+)_(\d+)\]/g, "MASK-$1-$2")
.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]+/g, "-")
.replace(/^-+|-+$/g, "")
.slice(0, 80) || "staged-context";
const relativePath = `AIsafe-\u8131\u654f\u53ef\u8fdbAI/${cleanBaseName}-AI-safe.md`;
const body = [
"## Clean AI-Ready Copy", "",
"- Original local path and record metadata intentionally omitted.",
`- Redacted values: ${maskedCount}`,
"", "## Content", "", maskedContent
].join("\n");
const saved = await api("/api/exchange/save", {
relativePath,
input: {
title: "Clean AI-Ready Copy",
source: "web-ui-clean-ai-ready-copy",
body,
evidenceId: state.lastAiContextEvidenceId || undefined
}
});
$("notePath").value = relativePath;
$("noteContent").value = body;
$("sendGateSummary").textContent = `Saved clean AI-ready copy: ${relativePath} (masked items: ${maskedCount})`;
if (typeof showAlert === "function") {
showAlert("success", `Saved clean copy: ${relativePath} (Saved clean AI-ready copy. Ready for local API or external copy-paste. Masked items: ${maskedCount})`);
}
return {
savedCleanAiReadyCopy: relativePath,
result: saved,
maskedCount
};
}
async function saveAiHandoffBundle() {
const content = $("aiContent").value.trim();
if (!content) throw new Error("No staged AI context to bundle.");
renderAiChunkLedger();
const relativePath = `notes/ai-handoff-bundle-${timestampForPath()}.md`;
const ledger = $("aiChunkLedger")?.textContent || "AI chunk ledger: unavailable";
const sendGate = $("sendGateSummary")?.textContent || "Send Gate: not reviewed";
const saved = await api("/api/ai/handoff-bundle", {
relativePath,
input: {
title: "AI Handoff Bundle",
source: "web-ui-ai-handoff-bundle",
content,
chunkLedger: ledger,
sendGateSummary: sendGate,
operation: $("aiOperation").value,
apiBaseUrl: $("apiBaseUrl").value.trim(),
model: $("apiModel").value.trim(),
auditId: state.lastAiAuditId || undefined,
evidenceId: state.lastAiContextEvidenceId || undefined
}
});
$("notePath").value = relativePath;
$("noteContent").value = saved.body || "AI handoff bundle saved through the local API. Open the saved note to review the full bundle.";
$("sendGateSummary").textContent = `Saved AI handoff bundle: ${relativePath}`;
return {
savedAiHandoffBundle: relativePath,
result: saved
};
}
return {
appendNextAiChunkIntoEditor,
appendNextAiChunkRangeIntoEditor,
appendSelectedAiChunkIntoEditor,
appendSelectedAiChunkRangeIntoEditor,
clearStagedAiContext,
loadAiIntakePlanIntoPanel,
loadFirstAiChunkIntoEditor,
loadNextAiChunkIntoEditor,
loadPreviousAiChunkIntoEditor,
loadSelectedAiChunkIntoEditor,
loadSelectedAiChunkRangeIntoEditor,
renderAiChunkLedger,
renderAiWillSeePreview,
saveAiHandoffBundle,
saveCleanAiReadyCopy,
saveStagedAiContext,
updateAiWillSeePanel
};
}
