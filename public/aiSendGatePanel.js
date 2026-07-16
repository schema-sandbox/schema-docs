function simpleHash(value) {
let hash = 0;
const text = String(value ?? "");
for (let i = 0; i < text.length; i += 1) {
hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
}
return `${text.length}:${Math.abs(hash)}`;
}
export function createAiSendGatePanel({
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
onReviewedAiContext,
onSentAiContext
}) {
function uiText(value) {
if (typeof document !== "undefined" && document.body?.dataset?.uiLanguage === "zh-CN" && typeof window?.translateText === "function") {
return window.translateText(value);
}
return value;
}
function aiReviewSignature(content = $("aiContent")?.value || "") {
return [
simpleHash(content),
$("aiOperation")?.value || "",
$("apiBaseUrl")?.value.trim() || "",
$("apiModel")?.value.trim() || "",
$("aiMaskEnabled")?.checked ? "mask:on" : "mask:off"
].join("|");
}
function updateSendGateStateClass(stateName) {
const el = document.querySelector(".ai-send-gate-panel");
if (!el) return;
el.classList.remove("state-allow", "state-review", "state-blocked");
if (stateName) {
el.classList.add(`state-${stateName}`);
}
}
function markStagedAiContextDirty(reason = "changed") {
state.stagedAiContextDirty = true;
aiContextPanel.renderAiChunkLedger();
const summary = $("sendGateSummary");
if (summary) {
summary.textContent = `${uiText("Send Gate")}: ${uiText("Review required")} (${uiText(reason)})`;
}
const guidance = $("sendGateGuidance");
if (guidance) {
guidance.classList.add("hidden");
guidance.innerHTML = "";
}
updateSendGateStateClass("review");
}
function markStagedAiContextReviewed() {
state.lastReviewedAiContextSignature = aiReviewSignature();
state.stagedAiContextDirty = false;
}
function assertStagedAiContextReviewed() {
const signature = aiReviewSignature();
if (!state.lastAiAuditId || state.stagedAiContextDirty || signature !== state.lastReviewedAiContextSignature) {
const message = uiText("Staged context has changed. Please review before sending.");
const summary = $("sendGateSummary");
if (summary) {
summary.textContent = `${uiText("Send Gate")}: ${uiText("Blocked")} | ${message}`;
}
updateSendGateStateClass("blocked");
throw new Error(message);
}
}
function renderGuidanceList(items) {
const values = Array.isArray(items) ? items.filter(Boolean) : [];
if (values.length === 0) return `<span>${escapeHtml(uiText("none"))}</span>`;
return `<ul>${values.map((item) => `<li>${escapeHtml(uiText(item))}</li>`).join("")}</ul>`;
}
function renderSendGateGuidance(preview) {
const guidance = $("sendGateGuidance");
if (!guidance) {
return;
}
if (!preview?.sendGate) {
guidance.classList.add("hidden");
guidance.innerHTML = "";
return;
}
guidance.classList.remove("hidden");
guidance.innerHTML = `<div class="send-gate-guidance-row"><span class="send-gate-guidance-label">${escapeHtml(uiText("Reasons"))}</span><div>${renderGuidanceList(preview.reasons)}</div></div><div class="send-gate-guidance-row"><span class="send-gate-guidance-label">${escapeHtml(uiText("Required actions"))}</span><div>${renderGuidanceList(preview.requiredActions)}</div></div><div class="send-gate-guidance-row"><span class="send-gate-guidance-label">${escapeHtml(uiText("Optional actions"))}</span><div>${renderGuidanceList(preview.optionalActions)}</div></div>`;
}
function humanDecision(decision) {
const labels = {
never_send: "Blocked",
review_required: "Review required",
review_recommended: "Review recommended",
selected_context_preview: "Ready to send"
};
return uiText(labels[decision] ?? decision);
}
function humanSignal(signal) {
const labels = {
api_key_like: "API key detected",
bearer_token_like: "bearer token detected",
credential_like_text: "credential detected",
email: "email address",
phone: "phone number",
phone_or_numeric_identifier: "numeric identifier",
id_number_like: "ID number detected",
local_only_marker: "local-only content",
long_context: "large context",
low_quality_extraction: "low-quality extraction",
table_included: "table data included",
external_source_included: "imported source file",
uuid_token_like: "UUID token detected"
};
return uiText(labels[signal] ?? signal);
}
function renderSendGateSummary(job) {
const preview = job?.output?.preview ?? job?.output;
const sendGate = preview?.sendGate;
if (!sendGate) {
return;
}
const warnings = sendGate.signals?.length
? sendGate.signals.map(humanSignal).join(", ")
: uiText("none");
const tokenDisplay = (preview.estimatedTokens ?? 0).toLocaleString();
const keyStatus = sendGate.apiKeySource === "session_key_present" ? uiText("provided") : uiText(sendGate.apiKeySource || "none");
$("sendGateSummary").textContent = [
`${uiText("Send Gate")}: ${humanDecision(sendGate.decision)}`,
`~${tokenDisplay} ${uiText("tokens")}`,
`${uiText("Warnings")}: ${warnings}`,
`${uiText("API key")}: ${keyStatus}`
].join(" | ");
if (sendGate.decision === "never_send") {
updateSendGateStateClass("blocked");
} else if (sendGate.decision === "review_required" || sendGate.decision === "review_recommended") {
updateSendGateStateClass("review");
} else if (sendGate.decision === "selected_context_preview") {
updateSendGateStateClass("allow");
}
renderSendGateGuidance(preview);
}
function rememberAiAudit(job) {
renderSendGateSummary(job);
const auditId = job?.output?.auditId;
if (auditId) {
state.lastAiAuditId = auditId;
$("lastAuditId").textContent = `Last audit: ${auditId}`;
}
if (job?.output?.result) {
state.lastAiResult = typeof job.output.result === "string"
? job.output.result
: JSON.stringify(job.output.result, null, 2);
}
return job;
}
async function previewStagedAiContext(sourceRef = "web-ui") {
let content = $("aiContent").value;
if (typeof showAlert === "function") showAlert("info", uiText("Analyzing content and estimated tokens for Send Preview..."));
let mapping = null;
if ($("aiMaskEnabled").checked) {
const maskResponse = await api("/api/mask", { content });
content = maskResponse.maskedText;
mapping = maskResponse.mapping;
state.lastMaskMapping = mapping;
} else {
state.lastMaskMapping = null;
}
const job = await api("/api/ai/preview", {
input: {
operation: $("aiOperation").value,
content,
apiBaseUrl: $("apiBaseUrl").value.trim(),
model: $("apiModel").value.trim(),
apiKey: $("apiKey").value ? "session_key_present" : "",
sourceRef
}
});
const audited = rememberAiAudit(job);
markStagedAiContextReviewed();
if (typeof onReviewedAiContext === "function") {
await onReviewedAiContext(audited);
}
aiContextPanel.renderAiChunkLedger();
if (typeof showAlert === "function") showAlert("success", uiText("Send Preview generated successfully."));
return {
...audited,
stagedContext: {
sourceRef,
masked: Boolean(mapping),
chunkLedger: $("aiChunkLedger")?.textContent || ""
}
};
}
async function sendReviewedAiContext() {
assertStagedAiContextReviewed();
let content = $("aiContent").value;
if (typeof showAlert === "function") showAlert("info", uiText("Sending reviewed context to AI service..."));
let mapping = null;
if ($("aiMaskEnabled").checked) {
const maskResponse = await api("/api/mask", { content });
content = maskResponse.maskedText;
mapping = maskResponse.mapping;
state.lastMaskMapping = mapping;
} else {
state.lastMaskMapping = null;
}
const job = await api("/api/ai/send", {
input: {
operation: $("aiOperation").value,
content,
apiBaseUrl: $("apiBaseUrl").value.trim(),
apiKey: $("apiKey").value,
model: $("apiModel").value.trim(),
sourceRef: "web-ui",
confirmed: $("aiConfirmed").checked
}
});
if (job?.status === "failed") {
const failure = job.error ?? {};
const status = failure.details?.status;
const statusSuffix = status && !String(failure.message || "").includes(String(status)) ? ` (HTTP ${status})` : "";
const guidance = failure.guidance ? ` ${failure.guidance}` : "";
throw new Error(`${failure.code || "ai_request_failed"}: ${failure.message || "AI request failed."}${statusSuffix}${guidance}`);
}
const audited = rememberAiAudit(job);
if (typeof onSentAiContext === "function") {
await onSentAiContext(audited);
}
if (audited?.output?.result?.text) {
let responseText = audited.output.result.text;
if (mapping) {
responseText = await api("/api/unmask", { content: responseText, mapping });
audited.output.result.text = responseText;
}
state.lastAiResult = responseText;
}
if (typeof showAlert === "function") showAlert("success", uiText("AI response received and unmasked locally."));
return audited;
}
function ensureOperationOption(operation) {
const select = $("aiOperation");
if (!select || !operation) return;
if (![...select.options].some((option) => option.value === operation)) {
const option = document.createElement("option");
option.value = operation;
option.textContent = operation === "ask" ? "Ask about document" : "Rewrite selection";
select.appendChild(option);
}
select.value = operation;
}
async function prepareAssistantRequest({ content, operation = "ask", sourceRef = "markdown-assistant" } = {}) {
if (!String(content || "").trim()) {
throw new Error(uiText("Select or open document content first."));
}
ensureOperationOption(operation);
$("aiContent").value = String(content);
$("aiConfirmed").checked = false;
markStagedAiContextDirty("assistant request changed");
return previewStagedAiContext(sourceRef);
}
async function confirmAssistantRequest() {
$("aiConfirmed").checked = true;
return sendReviewedAiContext();
}
async function writeBackAiResult() {
if (!state.lastAiResult || !String(state.lastAiResult).trim()) {
throw new Error(uiText("No AI result to write back."));
}
const chosenPath = $("exchangePath").value.trim();
const relativePath = chosenPath && chosenPath !== "notes/exchange.md"
? chosenPath
: `notes/ai-result-${timestampForPath()}.md`;
const result = await api("/api/ai/result/write-back", {
relativePath,
input: {
title: "AI Result Write-back",
source: "web-ui-ai-result-writeback",
sourceRef: "web-ui",
body: $("aiContent").value,
aiResult: state.lastAiResult,
apiBaseUrl: $("apiBaseUrl").value.trim(),
model: $("apiModel").value.trim(),
auditId: state.lastAiAuditId || undefined
}
});
$("notePath").value = result.relativePath;
const noteContent = await api("/api/markdown/read", { relativePath: result.relativePath });
$("noteContent").value = noteContent;
$("sendGateSummary").textContent = `${uiText("AI result written back")}: ${result.relativePath}`;
return result;
}
async function saveApiConfigurationProfile({ name, apiBaseUrl, model }) {
const profile = await api("/api/profiles/save", {
input: {
id: state.selectedApiProfileId || undefined,
name,
apiBaseUrl,
model
}
});
state.selectedApiProfileId = profile.id;
if ($("apiProfileName")) $("apiProfileName").value = profile.name;
if ($("selectedApiProfile")) $("selectedApiProfile").textContent = `Current profile: ${profile.name}#${profile.id}`;
await refreshManifest();
document.dispatchEvent(new CustomEvent("schema-docs:api-config-changed"));
return profile;
}
function bindAiSendGateEvents() {
$("aiPreview").addEventListener("click", () => run(() => previewStagedAiContext("web-ui")));
$("reviewStagedAiContext").addEventListener("click", () => run(() => previewStagedAiContext("web-ui-staged-context")));
$("aiContent").addEventListener("input", () => markStagedAiContextDirty("content changed"));
$("aiOperation").addEventListener("change", () => markStagedAiContextDirty("operation changed"));
$("apiBaseUrl").addEventListener("input", () => markStagedAiContextDirty("api base changed"));
$("apiModel").addEventListener("input", () => markStagedAiContextDirty("model changed"));
$("aiMaskEnabled").addEventListener("change", () => markStagedAiContextDirty("mask setting changed"));
$("saveApiProfile").addEventListener("click", () => run(async () => {
return saveApiConfigurationProfile({
name: $("apiProfileName").value.trim(),
apiBaseUrl: $("apiBaseUrl").value.trim(),
model: $("apiModel").value.trim()
});
}));
$("deleteApiProfile").addEventListener("click", () => run(async () => {
if (!state.selectedApiProfileId) throw new Error(uiText("Select an API profile first."));
const deleted = await api("/api/profiles/delete", {
profileId: state.selectedApiProfileId
});
state.selectedApiProfileId = "";
$("apiProfileName").value = "";
$("selectedApiProfile").textContent = "Current profile: none selected";
await refreshManifest();
return deleted;
}));
$("aiSend").addEventListener("click", () => run(sendReviewedAiContext));
$("saveExchange").addEventListener("click", () => run(() => api("/api/exchange/save", {
relativePath: $("exchangePath").value.trim(),
input: {
title: "API Exchange",
body: $("aiContent").value,
apiBaseUrl: $("apiBaseUrl").value.trim(),
model: $("apiModel").value.trim(),
queryResult: state.lastQueryResult || undefined,
aiResult: state.lastAiResult || undefined,
auditId: state.lastAiAuditId || undefined
}
})));
$("writeBackAiResult").addEventListener("click", () => run(writeBackAiResult));
$("listAudits").addEventListener("click", () => run(async () => {
const audits = await api("/api/audits/list");
renderAudits(audits);
return audits;
}));
$("deleteAudit").addEventListener("click", () => run(async () => {
if (!state.lastAiAuditId) throw new Error(uiText("Select an API audit summary first."));
const deleted = await api("/api/audits/delete", {
auditId: state.lastAiAuditId
});
state.lastAiAuditId = "";
$("lastAuditId").textContent = "Last audit: not generated yet";
const audits = await api("/api/audits/list");
renderAudits(audits);
return deleted;
}));
}
return {
bindAiSendGateEvents,
previewStagedAiContext,
sendReviewedAiContext,
prepareAssistantRequest,
confirmAssistantRequest,
markStagedAiContextDirty,
rememberAiAudit,
saveApiConfigurationProfile
};
}
