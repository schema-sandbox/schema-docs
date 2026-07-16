import { createHash } from "node:crypto";
import { AppError } from "./errors.js";
import { runJob } from "./jobs.js";
import { appendExchangeAudit } from "./exchangeAudits.js";
import { appendEvidenceRecord } from "./evidence.js";
import { readManifest } from "./manifest.js";
import { appendTimelineEvent } from "./timeline.js";
const OPERATIONS = new Set(["summarize", "translate", "extract", "explain_table", "ask", "rewrite"]);
export function hashContent(content) {
return createHash("sha256").update(content, "utf8").digest("hex");
}
export function clipText(content, length = 280) {
if (content.length <= length) return content;
const half = Math.floor((length - 20) / 2);
return `${content.slice(0, half)}\n...[clipped]...\n${content.slice(-half)}`;
}
export function buildAiPrompt(operation, content) {
if (!OPERATIONS.has(operation)) {
throw new AppError("ai_operation_unsupported", `Unsupported AI operation: ${operation}`, {
operation
});
}
const instructions = {
summarize: "Summarize the following content into concise bullet points.",
translate: "Translate the following content while preserving Markdown structure.",
extract: "Extract key entities, facts, dates, amounts, and action items from the following content.",
explain_table: "Explain the table, identify fields, possible anomalies, and useful follow-up queries.",
ask: "Answer the user's request using only the supplied document context. Say when the context is insufficient and preserve Markdown where it improves clarity.",
rewrite: "Rewrite the supplied document context according to the user's request. Preserve factual meaning and return only the revised Markdown unless the request asks for an explanation."
};
return `${instructions[operation]}\n\n---\n\n${content}`;
}
export function estimateTokenCount(content) {
return Math.max(1, Math.ceil(String(content ?? "").length / 4));
}
export function detectSendGateSignals(content, documentRecord = null) {
const text = String(content ?? "");
const signals = [];
if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) {
signals.push("email");
}
if (/\b(?:\+?\d[\d\s().-]{7,}\d)\b/.test(text)) {
signals.push("phone_or_numeric_identifier");
signals.push("phone");
}
if (/(?:\b(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|secret[_-]?access[_-]?key|client[_-]?secret|secret|password|token)\b|\u5bc6\u7801|\u53e3\u4ee4|\u5bc6\u94a5)\s*[:=\uff1a]/i.test(text)) {
signals.push("credential_like_text");
}
if (/\b(?:authorization\s*[:=]\s*Bearer\s+|Bearer\s+)[a-zA-Z0-9._~+/=-]{12,}/i.test(text)) {
signals.push("credential_like_text");
signals.push("bearer_token_like");
}
if (/\b(?:sk-[a-zA-Z0-9_-]{6,}|key-[a-zA-Z0-9_-]{6,}|(?:AKIA|ASIA|LTAI|AIza)[a-zA-Z0-9_-]{12,}|(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}|(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|xox[abprs]-[A-Za-z0-9-]{20,})\b/i.test(text)) {
signals.push("api_key_like");
}
if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/.test(text)) {
signals.push("credential_like_text");
}
if (/\b(?:token|session[_-]?token|auth[_-]?token|credential[_-]?id)\b\s*[:=]\s*[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(text)) {
signals.push("credential_like_text");
signals.push("uuid_token_like");
}
if (/\blocal-only\b|<!--\s*local-only\s*-->/i.test(text)) {
signals.push("local_only_marker");
}
if (/\b\d{17}[\dXx]\b|\b\d{3}-\d{2}-\d{4}\b/.test(text)) {
signals.push("id_number_like");
}
if (text.length > 10000) {
signals.push("long_context");
}
if (text.includes("|") && /\|[\s-|-:\s]*\|/.test(text)) {
signals.push("table_included");
}
if (documentRecord && documentRecord.originalSourcePath) {
signals.push("external_source_included");
}
if (documentRecord) {
const isLow = documentRecord.quality?.confidence === "low" ||
documentRecord.extractionQuality?.scannedLikely === true ||
documentRecord.extractionQuality?.possibleMojibake === true ||
documentRecord.extractionQuality?.confidence === "low";
if (isLow) {
signals.push("low_quality_extraction");
}
}
return signals;
}
export function sendGateDecision(signals) {
if (signals.includes("local_only_marker")) {
return "never_send";
}
if (signals.includes("credential_like_text") || signals.includes("api_key_like") || signals.includes("low_quality_extraction")) {
return "review_required";
}
if (signals.length > 0) return "review_recommended";
return "selected_context_preview";
}
function describeSendGateSignal(signal) {
const descriptions = {
api_key_like: "Found a value that looks like an API key or cloud access key.",
bearer_token_like: "Found an Authorization Bearer token pattern.",
credential_like_text: "Found text pattern resembling API keys or credentials.",
email: "Found email address pattern.",
external_source_included: "The staged context comes from an imported local source file.",
id_number_like: "Found a value that looks like a personal or government identifier.",
local_only_marker: "Found a local-only marker that must not be sent to an AI provider.",
long_context: "The staged context is large and should be reviewed or chunked before sending.",
low_quality_extraction: "The source extraction has low confidence or OCR/layout warnings.",
phone: "Found phone number pattern.",
phone_or_numeric_identifier: "Found phone number or long numeric identifier pattern.",
table_included: "The staged context includes table rows; filter to the needed rows when possible.",
uuid_token_like: "Found a credential-labeled UUID token pattern."
};
return descriptions[signal] ?? `Detected signal: ${signal}`;
}
function buildSendGateGuidance(signals, standardDecision) {
const signalSet = new Set(signals);
const requiredActions = [];
const optionalActions = [];
if (standardDecision === "block") {
requiredActions.push("Remove local-only markers and any sensitive credentials before sending.");
}
if (signalSet.has("credential_like_text") || signalSet.has("api_key_like") || signalSet.has("bearer_token_like") || signalSet.has("uuid_token_like")) {
requiredActions.push("Remove or mask credentials, API keys, tokens, and secrets.");
}
if (signalSet.has("low_quality_extraction")) {
requiredActions.push("Review extraction quality before relying on or sending this context.");
}
if (standardDecision === "review_required" && requiredActions.length === 0) {
requiredActions.push("Verify target AI endpoint and confirm data sanitization.");
}
if (signalSet.has("email") || signalSet.has("phone") || signalSet.has("phone_or_numeric_identifier") || signalSet.has("id_number_like")) {
optionalActions.push("Run automatic mask/redaction filter before sharing externally.");
}
if (signalSet.has("long_context")) {
optionalActions.push("Use AI Will See chunk or range review instead of sending the full context at once.");
}
if (signalSet.has("table_included")) {
optionalActions.push("Filter the table locally and send only the relevant rows.");
}
if (signalSet.has("external_source_included")) {
optionalActions.push("Confirm the imported source file is approved for AI use.");
}
return {
reasons: signals.map(describeSendGateSignal),
requiredActions: [...new Set(requiredActions)],
optionalActions: [...new Set(optionalActions)]
};
}
export function buildConfirmedAiRequest(input, documentRecord = null) {
if (!input.confirmed) throw new AppError("ai_confirmation_required", "User confirmation is r...");
const content = input.content ?? "";
const operation = input.operation ?? "summarize";
const preview = previewAiPayload(input, documentRecord);
const prompt = buildAiPrompt(operation, content);
if (preview.sendGate.decision === "never_send") throw new AppError("ai_send_gate_review_required", "Send Gate blocked cont...", {
signals: preview.sendGate.signals,
policyVersion: preview.sendGate.policyVersion
});
if (preview.sendGate.decision === "review_required") {
const hasQualityBlock = preview.sendGate.signals.includes("low_quality_extraction");
const hasHardBlock = preview.sendGate.signals.includes("credential_like_text") ||
preview.sendGate.signals.includes("api_key_like");
if (hasQualityBlock && !hasHardBlock) {
if (input.qualityOverride) {
if (!input.overrideReason || typeof input.overrideReason !== "string" || !input.overrideReason.trim()) {
throw new AppError("ai_override_reason_required", "Quality override requi...");
}
preview.sendGate.overridden = true;
preview.sendGate.overrideReasonHash = hashContent(input.overrideReason);
} else {
throw new AppError("ai_send_gate_review_required", "Send Gate blocked cont...", {
signals: preview.sendGate.signals,
policyVersion: preview.sendGate.policyVersion
});
}
} else {
throw new AppError("ai_send_gate_review_required", "Send Gate blocked cont...", {
signals: preview.sendGate.signals,
policyVersion: preview.sendGate.policyVersion
});
}
}
return {
preview,
request: {
apiBaseUrl: input.apiBaseUrl,
apiKey: input.apiKey,
model: input.model,
prompt,
temperature: input.temperature
}
};
}
export function previewAiPayload(input, documentRecord = null) {
const content = input.content ?? "";
const operation = input.operation ?? "summarize";
if (!content.trim()) {
throw new AppError("ai_content_empty", "AI payload content is ...");
}
const prompt = buildAiPrompt(operation, content);
const signals = detectSendGateSignals(content, documentRecord);
const sourceFiles = documentRecord ? [documentRecord.originalSourcePath || documentRecord.sourcePath].filter(Boolean) : [];
const isLowQuality = documentRecord ? (documentRecord.quality?.confidence === "low" || documentRecord.extractionQuality?.scannedLikely === true) : false;
const hasKnownLimit = documentRecord ? (documentRecord.warnings && documentRecord.warnings.length > 0) : false;
const tableRows = content.split("\n").filter(line => line.trim().startsWith("|") && line.trim().endsWith("|")).length;
const gateDecision = sendGateDecision(signals);
let standardDecision = "allow";
if (gateDecision === "never_send") {
standardDecision = "block";
} else if (gateDecision === "review_recommended" || gateDecision === "review_required") {
standardDecision = "review_required";
}
const { reasons, requiredActions, optionalActions } = buildSendGateGuidance(signals, standardDecision);
const overrideAllowed = gateDecision !== "never_send";
const overrideReasonRequired = standardDecision !== "allow";
const qualityScore = isLowQuality ? 0.5 : (hasKnownLimit ? 0.8 : 1.0);
const knownLimitIds = hasKnownLimit ? (documentRecord?.warnings || []) : [];
return {
operation,
model: input.model ?? "",
apiBaseUrl: input.apiBaseUrl ?? "",
sourceRef: input.sourceRef ?? "",
contentLength: content.length,
promptLength: prompt.length,
estimatedTokens: estimateTokenCount(prompt),
contentHash: hashContent(content),
preview: clipText(content),
sourceFiles,
isLowQualityExtraction: isLowQuality,
hasKnownLimitContent: hasKnownLimit,
markdownCharCount: content.length,
tableRowCountEstimate: tableRows,
hasEvidenceSummary: !!(input.evidenceId || input.auditId || documentRecord?.qualityReportId),
decision: standardDecision,
reasons,
requiredActions,
optionalActions,
overrideAllowed,
overrideReasonRequired,
qualityScore,
knownLimitIds,
sendGate: {
policyVersion: "doc-send-gate-v0.1",
decision: gateDecision,
signals,
apiKeySource: input.apiKey ? "request_body_not_stored" : "not_provided",
overridden: !!(input.qualityOverride && input.overrideReason),
overrideReasonHash: (input.qualityOverride && input.overrideReason) ? hashContent(input.overrideReason) : null
},
willSend: {
content: true,
apiKey: false,
workspaceFiles: false
}
};
}
export async function previewAiPayloadAsJob(workspacePath, input) {
return runJob(
workspacePath,
"ai_request",
{
operation: input.operation,
sourceRef: input.sourceRef ?? "",
dryRun: true
},
async ({ update }) => {
await update({
progress: 50,
message: "Building AI payload preview"
});
const manifest = await readManifest(workspacePath);
const doc = manifest.documents?.find(d => d.id === input.sourceRef);
const preview = previewAiPayload(input, doc);
const evidence = await appendEvidenceRecord(workspacePath, {
kind: "ai_preview",
sourceRef: preview.sourceRef,
sentContentHash: `sha256:${preview.contentHash}`,
outputType: "api_preview",
aiSent: false,
storeRawPrompt: false,
policyDecision: "preview_only",
sendGateDecision: preview.sendGate.decision,
sendGateSignals: preview.sendGate.signals,
estimatedTokens: preview.estimatedTokens,
userConfirmed: false
});
const audit = await appendExchangeAudit(workspacePath, {
kind: "api_preview",
operation: preview.operation,
sourceRef: preview.sourceRef,
apiBaseUrl: preview.apiBaseUrl,
model: preview.model,
contentLength: preview.contentLength,
contentHash: preview.contentHash,
sendGateDecision: preview.sendGate.decision,
sendGateSignals: preview.sendGate.signals,
estimatedTokens: preview.estimatedTokens,
sent: false,
evidenceId: evidence.id
});
await appendTimelineEvent(workspacePath, preview.sourceRef, "ai_preview", `Generated AI payload preview for operation "${preview.operation}"`, {
evidenceId: evidence.id,
policyDecision: "preview_only"
});
return {
...preview,
evidenceId: evidence.id,
auditId: audit.id
};
}
);
}
async function recordBlockedAiSend(workspacePath, input, documentRecord, error) {
const preview = previewAiPayload(input, documentRecord);
const policyDecision = preview.sendGate.decision === "never_send" ? "blocked_never_send" : "blocked_review_required";
const evidence = await appendEvidenceRecord(workspacePath, {
kind: "ai_send_blocked",
sourceRef: preview.sourceRef,
sentContentHash: `sha256:${preview.contentHash}`,
outputType: "api_send_blocked",
aiSent: false,
storeRawPrompt: false,
policyDecision,
sendGateDecision: preview.sendGate.decision,
sendGateSignals: preview.sendGate.signals,
estimatedTokens: preview.estimatedTokens,
userConfirmed: Boolean(input.confirmed)
});
const audit = await appendExchangeAudit(workspacePath, {
kind: "api_send_blocked",
operation: preview.operation,
sourceRef: preview.sourceRef,
apiBaseUrl: preview.apiBaseUrl,
model: preview.model,
contentLength: preview.contentLength,
contentHash: preview.contentHash,
sendGateDecision: preview.sendGate.decision,
sendGateSignals: preview.sendGate.signals,
estimatedTokens: preview.estimatedTokens,
sent: false,
evidenceId: evidence.id
});
await appendTimelineEvent(workspacePath, preview.sourceRef, "ai_send_blocked", `AI Send blocked by Send Gate: ${error.message}`, {
evidenceId: evidence.id,
policyDecision
});
return { preview, evidence, audit };
}
export async function sendAiRequestAsJob(workspacePath, input, aiClient) {
return runJob(
workspacePath,
"ai_request",
{
operation: input.operation,
sourceRef: input.sourceRef ?? "",
dryRun: false
},
async ({ update }) => {
await update({
progress: 20,
message: "Preparing confirmed API request"
});
const manifest = await readManifest(workspacePath);
const doc = manifest.documents?.find(d => d.id === input.sourceRef);
let confirmed;
try {
confirmed = buildConfirmedAiRequest(input, doc);
} catch (err) {
if (err.code === "ai_send_gate_review_required" || err.code === "ai_override_reason_required") {
await recordBlockedAiSend(workspacePath, input, doc, err);
}
throw err;
}
await update({
progress: 50,
message: "Sending API request"
});
const result = await aiClient.send(confirmed.request);
const evidence = await appendEvidenceRecord(workspacePath, {
kind: "ai_send",
sourceRef: confirmed.preview.sourceRef,
sentContentHash: `sha256:${confirmed.preview.contentHash}`,
outputType: "api_result",
aiSent: true,
storeRawPrompt: false,
policyDecision: "user_confirmed_selected_context",
sendGateDecision: confirmed.preview.sendGate.decision,
sendGateSignals: confirmed.preview.sendGate.signals,
estimatedTokens: confirmed.preview.estimatedTokens,
userConfirmed: true,
qualityOverride: confirmed.preview.sendGate.overridden || false,
qualityOverrideReasonHash: confirmed.preview.sendGate.overrideReasonHash || null
});
const audit = await appendExchangeAudit(workspacePath, {
kind: "api_send",
operation: confirmed.preview.operation,
sourceRef: confirmed.preview.sourceRef,
apiBaseUrl: confirmed.preview.apiBaseUrl,
model: confirmed.preview.model,
contentLength: confirmed.preview.contentLength,
contentHash: confirmed.preview.contentHash,
sendGateDecision: confirmed.preview.sendGate.decision,
sendGateSignals: confirmed.preview.sendGate.signals,
estimatedTokens: confirmed.preview.estimatedTokens,
sent: true,
evidenceId: evidence.id,
qualityOverride: confirmed.preview.sendGate.overridden || false,
qualityOverrideReasonHash: confirmed.preview.sendGate.overrideReasonHash || null
});
await appendTimelineEvent(workspacePath, confirmed.preview.sourceRef, "ai_send_confirmed", `AI Send confirmed to model "${confirmed.preview.model}"`, {
evidenceId: evidence.id,
policyDecision: "user_confirmed_selected_context",
overrideReason: confirmed.preview.sendGate.overridden ? "quality_override" : null
});
await update({
progress: 90,
message: "API response received"
});
return {
preview: confirmed.preview,
evidenceId: evidence.id,
auditId: audit.id,
result: {
provider: result.provider,
model: result.model,
text: result.text
}
};
}
);
}
