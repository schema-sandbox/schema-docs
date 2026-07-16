export function createAiFeedRunbookPanel({ $, api, escapeHtml, state, loadAiChunkRange, appendAiChunkRange, run }) {
function statusBadgeClass(status) {
const normalized = String(status || "planned");
if (normalized === "sent" || normalized === "reviewed" || normalized === "skipped") return "badge-success";
if (normalized === "blocked") return "badge-error";
if (normalized === "pulled") return "badge-warning";
return "badge-info";
}
function nextActionForBatchStatus(status) {
const normalized = String(status || "none");
if (normalized === "pulled") return "Next action: Review staged context";
if (normalized === "reviewed") return "Next action: Confirm send";
if (normalized === "sent" || normalized === "skipped" || normalized === "blocked") return "Next action: Continue next batch";
if (normalized === "planned") return "Next action: Load next batch";
return "Next action: create or read a runbook";
}
function renderStagedRunbookBatchStatus() {
const container = $("aiRunbookBatchStatus");
if (!container) {
return;
}
const staged = state.lastAiFeedRunbookBatch;
if (!staged?.batchIndex) {
container.classList.add("hidden");
container.innerHTML = "";
return;
}
const status = String(staged.status || "planned");
container.classList.remove("hidden");
container.innerHTML = `<span><strong>Current runbook batch</strong> ${Number(staged.batchIndex)}</span><span class="record-badge ${statusBadgeClass(status)}">${escapeHtml(status)}</span><span>${escapeHtml(nextActionForBatchStatus(status))}</span>`;
}
function renderRecoveryActionButton(action, batchIndex, label) {
if (!batchIndex) return "";
return `<button class="secondary runbook-recovery-button" type="button" data-runbook-recovery="${escapeHtml(action)}" data-batch-index="${Number(batchIndex)}">${escapeHtml(label)} ${Number(batchIndex)}</button>`;
}
function renderRecoveryActions(status) {
const actions = [
renderRecoveryActionButton("review", status.nextPulledBatchIndex, "Review batch"),
renderRecoveryActionButton("confirm", status.nextReviewedBatchIndex, "Confirm send batch"),
renderRecoveryActionButton("resolve", status.nextBlockedBatchIndex, "Resolve blocked batch"),
renderRecoveryActionButton("load", status.nextPlannedBatchIndex, "Load batch")
].filter(Boolean).join("");
return actions || "<span class=\"trust-muted\">No pending batch</span>";
}
function renderBatchRecoveryAction(batch) {
const batchIndex = Number(batch?.batchIndex || 0);
const status = String(batch?.status || "planned");
if (status === "planned") return renderRecoveryActionButton("load", batchIndex, "Load");
if (status === "pulled") return renderRecoveryActionButton("review", batchIndex, "Review");
if (status === "reviewed") return renderRecoveryActionButton("confirm", batchIndex, "Confirm");
if (status === "blocked") return renderRecoveryActionButton("resolve", batchIndex, "Resolve");
return "<span class=\"trust-muted\">Done</span>";
}
function renderAiFeedRunbook(runbook) {
$("aiWillSeePanel").classList.remove("hidden");
state.lastAiFeedRunbook = runbook;
state.lastAiFeedRunbookPath = runbook.jsonRelativePath || state.lastAiFeedRunbookPath || "";
if ($("aiFeedRunbookPath")) {
$("aiFeedRunbookPath").value = state.lastAiFeedRunbookPath;
}
const status = runbook.statusSummary || {};
const nextBatch = status.nextPlannedBatchIndex ?? "none";
const totalBatches = Number(status.totalBatches || runbook.totalBatchCount || 0);
const completedBatches = Number(status.completedBatches || 0);
const sentBatches = Number(status.sentBatches || 0);
const pulledBatches = Number(status.pulledBatches || 0);
const readyToSendBatches = Number(status.readyToSendBatches || 0);
const blockedBatches = Number(status.blockedBatches || 0);
const remainingBatches = Number(status.remainingBatches ?? Math.max(0, totalBatches - completedBatches - blockedBatches));
const percentComplete = Number(status.percentComplete || 0);
const nextCommand = status.nextPlannedCommand || runbook.continuation?.nextRangeCommand || "";
const queueRecovery = [
status.nextPulledBatchIndex ? `Review batch ${Number(status.nextPulledBatchIndex)}` : "",
status.nextReviewedBatchIndex ? `Confirm send batch ${Number(status.nextReviewedBatchIndex)}` : "",
status.nextBlockedBatchIndex ? `Resolve blocked batch ${Number(status.nextBlockedBatchIndex)}` : "",
status.nextPlannedBatchIndex ? `Load batch ${Number(status.nextPlannedBatchIndex)}` : ""
].filter(Boolean).join(" / ") || "No pending batch";
const batchRows = (runbook.batches || []).slice(0, 12).map((batch) => (
`<div class="runbook-batch-row${Number(batch.batchIndex) === Number(nextBatch) ? " is-next" : ""}"><span class="record-badge ${statusBadgeClass(batch.status)}">${escapeHtml(batch.status || "planned")}</span><strong>Batch ${Number(batch.batchIndex)}</strong><span>chunks ${Number(batch.startChunkIndex)}-${Number(batch.endChunkIndex)}</span><span class="mono-line">${escapeHtml(batch.command || "")}</span><span class="runbook-batch-action">${renderBatchRecoveryAction(batch)}</span></div>`
)).join("");
$("aiWillSeeContent").innerHTML = `<div class="runbook-dashboard"><div class="runbook-header"><div><strong>AI Feed Runbook</strong><div class="trust-muted">${escapeHtml(runbook.recordIdOrPackagePath || "unknown")}</div></div><span class="record-badge ${runbook.sendGateDecision === "blocked" ? "badge-error" : "badge-success"}">Send Gate ${escapeHtml(runbook.sendGateDecision || "unknown")}</span></div><div class="runbook-kpi-grid"><div><span>Total batches</span><strong>${totalBatches}</strong></div><div><span>Completed</span><strong>${completedBatches}</strong></div><div><span>Sent</span><strong>${sentBatches}</strong></div><div><span>Pulled</span><strong>${pulledBatches}</strong></div><div><span>Ready send</span><strong>${readyToSendBatches}</strong></div><div><span>Remaining</span><strong>${remainingBatches}</strong></div><div><span>Blocked</span><strong>${blockedBatches}</strong></div><div><span>Total chunks</span><strong>${Number(runbook.totalChunkCount || 0)}</strong></div><div><span>Next batch</span><strong>${escapeHtml(String(nextBatch))}</strong></div></div><div class="runbook-progress" aria-label="AI feed runbook progress"><div style="width: ${Math.min(100, Math.max(0, percentComplete))}%"></div></div><div class="runbook-meta"><div><strong>Safety:</strong> body-free=${runbook.bodyFree ? "true" : "false"} / per-batch Send Gate=${runbook.feedingPlan?.requiresSendGatePerBatch ? "true" : "false"} / auto-send=${runbook.feedingPlan?.sendsContentAutomatically ? "true" : "false"}</div><div><strong>Files:</strong> <span class="mono-line">${escapeHtml(runbook.markdownRelativePath || "")}</span> / <span class="mono-line">${escapeHtml(runbook.jsonRelativePath || "")}</span></div><div><strong>Continuation:</strong> ${runbook.continuation?.canContinue ? "ready" : "complete"} / remaining batches ${remainingBatches}</div><div><strong>Queue recovery:</strong> ${escapeHtml(queueRecovery)}</div><div class="runbook-recovery-actions">${renderRecoveryActions(status)}</div><div><strong>Next Range Command:</strong> <span class="mono-line">${escapeHtml(nextCommand)}</span></div></div><div class="runbook-section-title">Batch Queue</div><div class="runbook-batch-list">${batchRows || "<div>No batches planned.</div>"}</div></div>`;
$("sendGateSummary").textContent = [
`AI feed runbook ${runbook.jsonRelativePath || ""}`,
`completed ${completedBatches}/${totalBatches}`,
`sent ${sentBatches}`,
`ready ${readyToSendBatches}`,
`pulled ${pulledBatches}`,
`remaining ${remainingBatches}`,
`blocked ${blockedBatches}`,
`next ${nextBatch}`,
"body-free"
].join(" | ");
renderStagedRunbookBatchStatus();
}
async function createAiFeedRunbook() {
const recordId = $("recordId").value.trim();
if (!recordId) throw new Error("Select or enter a document/dataset/package id first.");
const tokenBudget = Math.max(500, Number($("aiChunkRangeBudget")?.value || 9000) || 9000);
const runbook = await api("/api/ai/feed-runbook", {
recordIdOrPackagePath: recordId,
options: { tokenBudget }
});
renderAiFeedRunbook(runbook);
return runbook;
}
async function readAiFeedRunbookStatus() {
const jsonRelativePath = $("aiFeedRunbookPath")?.value.trim() || state.lastAiFeedRunbookPath;
if (!jsonRelativePath) throw new Error("Create or enter an AI feed runbook JSON path first.");
const runbook = await api("/api/ai/feed-runbook/status", { jsonRelativePath });
renderAiFeedRunbook(runbook);
return runbook;
}
function nextActionableBatch(runbook) {
const batches = Array.isArray(runbook?.batches) ? runbook.batches : [];
const nextBatchIndex = runbook?.statusSummary?.nextPlannedBatchIndex;
return batches.find((batch) => Number(batch.batchIndex) === Number(nextBatchIndex))
|| batches.find((batch) => ["planned", "pulled"].includes(String(batch.status || "planned")));
}
async function readLatestRunbook() {
const jsonRelativePath = $("aiFeedRunbookPath")?.value.trim() || state.lastAiFeedRunbookPath;
if (!jsonRelativePath && state.lastAiFeedRunbook) {
renderAiFeedRunbook(state.lastAiFeedRunbook);
return state.lastAiFeedRunbook;
}
if (!jsonRelativePath) throw new Error("Create or enter an AI feed runbook JSON path first.");
const runbook = await api("/api/ai/feed-runbook/status", { jsonRelativePath });
renderAiFeedRunbook(runbook);
return runbook;
}
async function stageRunbookBatch(batch, runbook, options = {}) {
if (!batch) throw new Error("AI feed batch not found.");
if (runbook.recordIdOrPackagePath && $("recordId")) {
$("recordId").value = runbook.recordIdOrPackagePath;
}
$("aiChunkRangeStart").value = String(Number(batch.startChunkIndex || 1));
$("aiChunkRangeEnd").value = String(Number(batch.endChunkIndex || batch.startChunkIndex || 1));
$("aiChunkRangeBudget").value = String(Number(batch.tokenBudget || runbook.tokenBudget || 9000));
$("aiFeedBatchIndex").value = String(Number(batch.batchIndex || 1));
state.lastAiFeedRunbookBatch = {
jsonRelativePath: runbook.jsonRelativePath || $("aiFeedRunbookPath")?.value.trim() || state.lastAiFeedRunbookPath,
batchIndex: Number(batch.batchIndex || 1),
status: String(batch.status || "planned")
};
renderStagedRunbookBatchStatus();
const staged = options.append
? await appendAiChunkRange()
: await loadAiChunkRange();
const jsonRelativePath = runbook.jsonRelativePath || $("aiFeedRunbookPath")?.value.trim() || state.lastAiFeedRunbookPath;
if (jsonRelativePath && String(batch.status || "planned") === "planned") {
const updated = await api("/api/ai/feed-runbook/batch", {
jsonRelativePath,
batchIndex: Number(batch.batchIndex),
status: "pulled",
note: "staged from Web/Desktop next batch control"
});
state.lastAiFeedRunbook = updated;
state.lastAiFeedRunbookPath = updated.jsonRelativePath || jsonRelativePath;
state.lastAiFeedRunbookBatch.status = "pulled";
}
renderStagedRunbookBatchStatus();
return {
...staged,
runbookBatch: Number(batch.batchIndex),
runbookBatchStatus: "pulled"
};
}
async function stageRunbookBatchByIndex(batchIndex, options = {}) {
const runbook = await readLatestRunbook();
const batch = (runbook.batches || []).find((candidate) => Number(candidate.batchIndex) === Number(batchIndex));
return stageRunbookBatch(batch, runbook, options);
}
async function stageNextRunbookBatch(options = {}) {
const runbook = await readLatestRunbook();
const batch = nextActionableBatch(runbook);
if (!batch) throw new Error("No planned or pulled AI feed batch remains in this runbook.");
return stageRunbookBatch(batch, runbook, options);
}
async function markStagedRunbookBatchReviewed() {
const staged = state.lastAiFeedRunbookBatch;
if (!staged?.jsonRelativePath || !staged.batchIndex || staged.status !== "pulled") return null;
const runbook = await api("/api/ai/feed-runbook/batch", {
jsonRelativePath: staged.jsonRelativePath,
batchIndex: staged.batchIndex,
status: "reviewed",
note: "Send Gate reviewed from Web/Desktop"
});
state.lastAiFeedRunbook = runbook;
state.lastAiFeedRunbookPath = runbook.jsonRelativePath || staged.jsonRelativePath;
state.lastAiFeedRunbookBatch = {
jsonRelativePath: runbook.jsonRelativePath || staged.jsonRelativePath,
batchIndex: staged.batchIndex,
status: "reviewed"
};
renderStagedRunbookBatchStatus();
return {
runbookBatch: staged.batchIndex,
runbookBatchStatus: "reviewed"
};
}
async function markStagedRunbookBatchSent() {
const staged = state.lastAiFeedRunbookBatch;
if (!staged?.jsonRelativePath || !staged.batchIndex || !["pulled", "reviewed"].includes(staged.status)) {
return null;
}
const runbook = await api("/api/ai/feed-runbook/batch", {
jsonRelativePath: staged.jsonRelativePath,
batchIndex: staged.batchIndex,
status: "sent",
note: "confirmed AI send completed from Web/Desktop"
});
state.lastAiFeedRunbook = runbook;
state.lastAiFeedRunbookPath = runbook.jsonRelativePath || staged.jsonRelativePath;
state.lastAiFeedRunbookBatch = {
jsonRelativePath: runbook.jsonRelativePath || staged.jsonRelativePath,
batchIndex: staged.batchIndex,
status: "sent"
};
renderStagedRunbookBatchStatus();
return {
runbookBatch: staged.batchIndex,
runbookBatchStatus: "sent"
};
}
function loadNextRunbookBatch() {
return stageNextRunbookBatch();
}
function appendNextRunbookBatch() {
return stageNextRunbookBatch({ append: true });
}
async function continueRunbookAfterSent() {
const staged = state.lastAiFeedRunbookBatch;
if (staged?.status === "pulled") throw new Error("Review the staged runbook batch before continuing to the next batch.");
if (staged?.status === "reviewed") throw new Error("Confirm send for the reviewed runbook batch before continuing to the next batch.");
return stageNextRunbookBatch({ afterSent: true });
}
async function focusReviewedRunbookBatch(batchIndex) {
const runbook = await readLatestRunbook();
const batch = (runbook.batches || []).find((candidate) => Number(candidate.batchIndex) === Number(batchIndex));
if (!batch || String(batch.status || "") !== "reviewed") {
throw new Error("Only reviewed AI feed batches can be focused for confirm send.");
}
$("aiFeedBatchIndex").value = String(Number(batch.batchIndex));
state.lastAiFeedRunbookBatch = {
jsonRelativePath: runbook.jsonRelativePath || $("aiFeedRunbookPath")?.value.trim() || state.lastAiFeedRunbookPath,
batchIndex: Number(batch.batchIndex),
status: "reviewed"
};
renderStagedRunbookBatchStatus();
$("aiSendGateTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
$("aiConfirmed")?.focus();
return {
runbookBatch: Number(batch.batchIndex),
runbookBatchStatus: "reviewed",
nextAction: "Confirm send"
};
}
async function focusBlockedRunbookBatch(batchIndex) {
const runbook = await readLatestRunbook();
const batch = (runbook.batches || []).find((candidate) => Number(candidate.batchIndex) === Number(batchIndex));
if (!batch || String(batch.status || "") !== "blocked") {
throw new Error("Only blocked AI feed batches can be focused for resolution.");
}
$("aiFeedBatchIndex").value = String(Number(batch.batchIndex));
$("aiFeedBatchStatus").value = "blocked";
state.lastAiFeedRunbookBatch = {
jsonRelativePath: runbook.jsonRelativePath || $("aiFeedRunbookPath")?.value.trim() || state.lastAiFeedRunbookPath,
batchIndex: Number(batch.batchIndex),
status: "blocked"
};
renderStagedRunbookBatchStatus();
$("markAiFeedBatch")?.scrollIntoView({ behavior: "smooth", block: "center" });
$("aiFeedBatchStatus")?.focus();
return {
runbookBatch: Number(batch.batchIndex),
runbookBatchStatus: "blocked",
nextAction: "Resolve blocked batch"
};
}
function bindAiFeedRunbookRecoveryEvents() {
const container = $("aiWillSeeContent");
if (!container || container.dataset.runbookRecoveryBound === "true") {
return;
}
container.dataset.runbookRecoveryBound = "true";
container.addEventListener("click", (event) => {
const button = event.target.closest("[data-runbook-recovery]");
if (!button) {
return;
}
event.preventDefault();
const action = button.dataset.runbookRecovery;
const batchIndex = Number(button.dataset.batchIndex || 0);
const operation = async () => {
if (action === "review" || action === "load") return stageRunbookBatchByIndex(batchIndex);
if (action === "confirm") return focusReviewedRunbookBatch(batchIndex);
if (action === "resolve") return focusBlockedRunbookBatch(batchIndex);
throw new Error(`Unsupported runbook recovery action: ${action}`);
};
if (typeof run === "function") {
run(operation);
} else {
operation();
}
});
}
async function markAiFeedBatchStatus() {
const jsonRelativePath = $("aiFeedRunbookPath")?.value.trim() || state.lastAiFeedRunbookPath;
if (!jsonRelativePath) throw new Error("Create or enter an AI feed runbook JSON path first.");
const batchIndex = Math.max(1, Number($("aiFeedBatchIndex")?.value || 1) || 1);
const status = $("aiFeedBatchStatus")?.value || "reviewed";
const runbook = await api("/api/ai/feed-runbook/batch", {
jsonRelativePath,
batchIndex,
status,
note: "updated from Web/Desktop AI panel"
});
if (state.lastAiFeedRunbookBatch?.batchIndex === batchIndex) {
state.lastAiFeedRunbookBatch.status = status;
state.lastAiFeedRunbookBatch.jsonRelativePath = jsonRelativePath;
}
renderAiFeedRunbook(runbook);
return runbook;
}
return {
createAiFeedRunbook,
appendNextRunbookBatch,
bindAiFeedRunbookRecoveryEvents,
continueRunbookAfterSent,
focusBlockedRunbookBatch,
focusReviewedRunbookBatch,
loadNextRunbookBatch,
markStagedRunbookBatchReviewed,
markStagedRunbookBatchSent,
readAiFeedRunbookStatus,
markAiFeedBatchStatus,
renderAiFeedRunbook,
stageRunbookBatchByIndex,
renderStagedRunbookBatchStatus
};
}