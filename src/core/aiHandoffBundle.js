import { AppError } from "./errors.js";
import { appendTimelineEvent } from "./timeline.js";
function timestampForPath() {
return new Date().toISOString().replace(/[:.]/g, "-");
}
export function buildAiHandoffBundleBody(input) {
return [
"## AI Handoff Bundle",
"",
"This bundle captures the reviewed context that is ready to hand to an AI model. Treat it as the source of truth for what the model is allowed to see.",
"",
"### Send Gate",
"",
`- ${input.chunkLedger || "AI chunk ledger: unavailable"}`,
`- ${input.sendGateSummary || input.sendGate || "Send Gate: not reviewed"}`,
`- Evidence: ${input.evidenceId || "none"}`,
`- Audit: ${input.auditId || "none"}`,
`- Operation: ${input.operation || "not selected"}`,
`- Model: ${input.model || "not selected"}`,
`- API Base URL: ${input.apiBaseUrl || "not selected"}`,
"",
"### Operator Prompt",
"",
[
"Use only the staged context below.",
"Do not assume access to the original file.",
"Respect redaction markers and do not reconstruct masked secrets.",
"If context appears incomplete, ask for the next chunk or range instead of guessing."
].join(" "),
"",
"### Return Contract",
"",
"- Cite the section, table, or chunk you used when possible.",
"- Flag missing context before making a high-impact conclusion.",
"- Preserve Markdown structure in the response.",
"- Keep any suggested follow-up tied to the staged context and evidence.",
"",
"### Staged Context",
"",
input.content
].join("\n");
}
function selectionStart(selection) {
return selection?.selectionRange?.startChunkIndex
|| selection?.includedRange?.startChunkIndex
|| selection?.chunkIndex
|| 1;
}
function selectionEnd(selection) {
return selection?.selectionRange?.endChunkIndex
|| selection?.includedRange?.endChunkIndex
|| selection?.chunkIndex
|| 1;
}
export async function saveAiHandoffBundle(workspacePath, relativePath, input = {}, context = {}) {
const outputRelativePath = relativePath || input.relativePath || `notes/ai-handoff-bundle-${timestampForPath()}.md`;
const recordIdOrPackagePath = input.recordIdOrPackagePath || input.recordId || "";
let content = typeof input.content === "string"
? input.content
: (typeof input.body === "string" ? input.body : "");
let selection = null;
if (!content.trim() && recordIdOrPackagePath) {
if (input.startChunkIndex || input.endChunkIndex) {
selection = await context.resolveAiContextChunkRange(
recordIdOrPackagePath,
Number(input.startChunkIndex || 1),
Number(input.endChunkIndex || input.startChunkIndex || 1),
input.tokenBudget ? Number(input.tokenBudget) : undefined
);
content = selection.content || "";
} else {
selection = await context.resolveAiContextChunk(recordIdOrPackagePath, Number(input.chunkIndex || 1));
content = selection.content || "";
}
}
if (!content.trim()) {
throw new AppError("ai_handoff_context_empty", "AI handoff bundle requ...");
}
const evidenceId = input.evidenceId || selection?.evidenceId || "";
const body = buildAiHandoffBundleBody({
...input,
content,
evidenceId,
sendGateSummary: input.sendGateSummary || input.sendGate || (selection?.sendGateDecision ? `Send Gate: ${selection.sendGateDecision}` : ""),
chunkLedger: input.chunkLedger || (selection
? `AI chunk ledger: ${selectionStart(selection)}-${selectionEnd(selection)} of ${selection.totalChunkCount || "unknown"}`
: "")
});
const savedPath = await context.saveExchangeMarkdown(outputRelativePath, {
title: input.title || "AI Handoff Bundle",
source: input.source || input.sourceRef || "ai-handoff-bundle",
body,
apiBaseUrl: input.apiBaseUrl || "",
model: input.model || "",
auditId: input.auditId,
evidenceId: evidenceId || undefined,
createdAt: input.createdAt
});
await appendTimelineEvent(workspacePath, recordIdOrPackagePath || input.sourceRef || outputRelativePath, "ai_handoff_bundle", `Saved AI handoff bundle "${outputRelativePath}"`, {
evidenceId,
recordIdOrPackagePath,
artifactPath: outputRelativePath
});
return {
relativePath: outputRelativePath,
path: savedPath,
recordIdOrPackagePath,
evidenceId,
selectionRange: selection?.selectionRange ?? selection?.includedRange ?? null,
chunkIndex: selection?.chunkIndex ?? null,
tokenEstimate: selection?.tokenEstimate ?? 0,
body
};
}