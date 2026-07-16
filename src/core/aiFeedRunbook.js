import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertSafeWritePath } from "./pathGuard.js";
import { compileAiIntakeManifest } from "./aiContext.js";
const DEFAULT_BUNDLE_TOKEN_BUDGET = 9000;
function suggestedRangeChunkCount(chunkTokenBudget = 3000, tokenBudget = DEFAULT_BUNDLE_TOKEN_BUDGET) {
return Math.max(1, Math.floor(Number(tokenBudget) / Math.max(1, Number(chunkTokenBudget))));
}
function rangeCommand(recordIdOrPackagePath, startChunkIndex, endChunkIndex, tokenBudget) {
return startChunkIndex
? `ai-context <workspace> range ${recordIdOrPackagePath} ${startChunkIndex} ${endChunkIndex} ${tokenBudget}`
: "";
}
function buildFullBatchPlan(recordIdOrPackagePath, plan, tokenBudget = DEFAULT_BUNDLE_TOKEN_BUDGET) {
const totalChunkCount = Math.max(0, Number(plan?.chunkCount) || 0);
const rangeWidth = Math.max(1, suggestedRangeChunkCount(plan?.chunkTokenBudget, tokenBudget));
const totalBatchCount = totalChunkCount > 0 ? Math.ceil(totalChunkCount / rangeWidth) : 0;
return Array.from({ length: totalBatchCount }, (_, index) => {
const batchIndex = index + 1;
const startChunkIndex = (index * rangeWidth) + 1;
const endChunkIndex = Math.min(totalChunkCount, startChunkIndex + rangeWidth - 1);
return {
batchIndex,
status: "planned",
startChunkIndex,
endChunkIndex,
tokenBudget,
requiresSendGateReview: true,
sendsContentAutomatically: false,
command: rangeCommand(recordIdOrPackagePath, startChunkIndex, endChunkIndex, tokenBudget),
api: {
method: "POST",
path: "/api/ai/context-range",
body: {
recordIdOrPackagePath,
startChunkIndex,
endChunkIndex,
tokenBudget
}
}
};
});
}
function safeRunbookSlug(recordIdOrPackagePath) {
return String(recordIdOrPackagePath || "record")
.replace(/[^a-zA-Z0-9._-]+/g, "-")
.replace(/^-+|-+$/g, "")
.slice(0, 80) || "record";
}
function summarizeRunbookStatus(batches = []) {
const completedStatuses = new Set(["reviewed", "sent", "skipped"]);
const completedBatches = batches.filter((batch) => completedStatuses.has(batch.status)).length;
const sentBatches = batches.filter((batch) => batch.status === "sent").length;
const readyToSendBatches = batches.filter((batch) => batch.status === "reviewed").length;
const blockedBatches = batches.filter((batch) => batch.status === "blocked").length;
const pulledBatches = batches.filter((batch) => batch.status === "pulled").length;
const plannedBatches = batches.filter((batch) => batch.status === "planned").length;
const nextPlanned = batches.find((batch) => batch.status === "planned" || batch.status === "pulled");
const nextPulled = batches.find((batch) => batch.status === "pulled");
const nextReviewed = batches.find((batch) => batch.status === "reviewed");
const nextBlocked = batches.find((batch) => batch.status === "blocked");
const remainingBatches = Math.max(0, batches.length - completedBatches - blockedBatches);
return {
completedBatches,
sentBatches,
readyToSendBatches,
blockedBatches,
plannedBatches,
pulledBatches,
remainingBatches,
totalBatches: batches.length,
percentComplete: batches.length > 0 ? Math.round((completedBatches / batches.length) * 100) : 100,
nextPlannedBatchIndex: nextPlanned?.batchIndex ?? null,
nextPlannedCommand: nextPlanned?.command ?? "",
nextPulledBatchIndex: nextPulled?.batchIndex ?? null,
nextReviewedBatchIndex: nextReviewed?.batchIndex ?? null,
nextBlockedBatchIndex: nextBlocked?.batchIndex ?? null
};
}
function assertRunbookBatchStatus(status) {
const normalized = String(status || "").trim().toLowerCase();
const allowed = new Set(["planned", "pulled", "reviewed", "sent", "skipped", "blocked"]);
if (!allowed.has(normalized)) {
throw new Error(`Unsupported AI feed batch status: ${status}`);
}
return normalized;
}
function renderAiFeedRunbookMarkdown(runbook) {
const statusSummary = runbook.statusSummary ?? summarizeRunbookStatus(runbook.batches ?? []);
const lines = [
`# AI Feed Runbook: ${runbook.recordIdOrPackagePath}`,
"",
`Created: ${runbook.createdAt}`,
`Mode: ${runbook.feedingPlan.mode}`,
`Priority: ${runbook.feedingPlan.priority}`,
`Send Gate per batch: ${runbook.feedingPlan.requiresSendGatePerBatch ? "yes" : "no"}`,
`Sends content automatically: ${runbook.feedingPlan.sendsContentAutomatically ? "yes" : "no"}`,
`Total chunks: ${runbook.totalChunkCount}`,
`Total batches: ${runbook.totalBatchCount}`,
`Token budget per batch: ${runbook.tokenBudget}`,
`Body-free: ${runbook.bodyFree ? "yes" : "no"}`,
`Completed batches: ${statusSummary.completedBatches}`,
`Sent batches: ${statusSummary.sentBatches}`,
`Pulled batches: ${statusSummary.pulledBatches}`,
`Ready-to-send batches: ${statusSummary.readyToSendBatches}`,
`Blocked batches: ${statusSummary.blockedBatches}`,
`Next planned batch: ${statusSummary.nextPlannedBatchIndex ?? "none"}`,
`Next pulled batch: ${statusSummary.nextPulledBatchIndex ?? "none"}`,
`Next reviewed batch: ${statusSummary.nextReviewedBatchIndex ?? "none"}`,
`Next blocked batch: ${statusSummary.nextBlockedBatchIndex ?? "none"}`,
"",
"## Operator Rules",
"",
"- Pull one planned range at a time.",
"- Review the returned range in AI Will See / Send Gate before any API send.",
"- Do not treat this runbook as document content; it contains only batch metadata.",
"- Stop and resolve quality warnings before sending when Send Gate is blocked.",
"",
"## Safety",
"",
`- Send Gate decision: ${runbook.sendGateDecision}`,
`- Send allowed after review: ${runbook.safety.sendAllowedAfterReview ? "yes" : "no"}`,
`- Quality warnings: ${runbook.qualityWarnings.join(", ") || "none"}`,
`- Known limits: ${runbook.knownLimits.join(", ") || "none"}`,
"",
"## Batches",
"",
"| Batch | Status | Chunks | Tokens | Command |",
"| --- | --- | --- | --- | --- |"
];
for (const batch of runbook.batches) {
lines.push(`| ${batch.batchIndex} | ${batch.status} | ${batch.startChunkIndex}-${batch.endChunkIndex} | ${batch.tokenBudget} | \`${batch.command}\` |`);
}
lines.push("", "## Resume", "", `Next command: \`${runbook.continuation.nextRangeCommand || ""}\``);
return lines.join("\n");
}
export async function compileAiFeedRunbook(workspacePath, recordIdOrPackagePath, options = {}) {
const manifest = await compileAiIntakeManifest(workspacePath, recordIdOrPackagePath);
const tokenBudget = Math.max(1, Number(options.tokenBudget ?? manifest.aiIntakePlan.defaultRangeTokenBudget ?? DEFAULT_BUNDLE_TOKEN_BUDGET));
const batches = buildFullBatchPlan(recordIdOrPackagePath, manifest.aiIntakePlan, tokenBudget);
const createdAt = new Date().toISOString();
const outputBase = options.outputBase || path.join("ai-feed", `${safeRunbookSlug(recordIdOrPackagePath)}-runbook`);
const markdownRelativePath = `${outputBase}.md`;
const jsonRelativePath = `${outputBase}.json`;
const runbook = {
kind: "ai_feed_runbook",
version: "0.1.0",
createdAt,
recordIdOrPackagePath,
bodyFree: true,
isPackage: manifest.isPackage,
metadata: manifest.metadata,
sendGateDecision: manifest.sendGateDecision,
qualityWarnings: manifest.qualityWarnings,
knownLimits: manifest.knownLimits,
recommendedNextAction: manifest.recommendedNextAction,
feedingPlan: {
...manifest.aiIntakePlan.feedingPlan,
recommendedBatchTokenBudget: tokenBudget
},
totalChunkCount: manifest.aiIntakePlan.chunkCount,
totalBatchCount: batches.length,
rangeWidth: batches[0]
? batches[0].endChunkIndex - batches[0].startChunkIndex + 1
: manifest.aiIntakePlan.suggestedRangeChunkCount,
tokenBudget,
continuation: manifest.continuation,
safety: manifest.safety,
batches,
markdownRelativePath,
jsonRelativePath,
statusSummary: summarizeRunbookStatus(batches)
};
const markdownPath = await assertSafeWritePath(path.join(workspacePath, markdownRelativePath), workspacePath, [".md"]);
const jsonPath = await assertSafeWritePath(path.join(workspacePath, jsonRelativePath), workspacePath, [".json"]);
await mkdir(path.dirname(markdownPath), { recursive: true });
await writeFile(markdownPath, renderAiFeedRunbookMarkdown(runbook), "utf8");
await writeFile(jsonPath, JSON.stringify(runbook, null, 2), "utf8");
return {
...runbook,
markdownPath,
jsonPath
};
}
export async function readAiFeedRunbook(workspacePath, jsonRelativePath) {
const jsonPath = await assertSafeWritePath(path.join(workspacePath, jsonRelativePath), workspacePath, [".json"]);
const runbook = JSON.parse(await readFile(jsonPath, "utf8"));
return {
...runbook,
jsonRelativePath: runbook.jsonRelativePath || jsonRelativePath,
jsonPath,
statusSummary: summarizeRunbookStatus(runbook.batches ?? [])
};
}
export async function updateAiFeedRunbookBatch(workspacePath, jsonRelativePath, batchIndex, status, note = "") {
const runbook = await readAiFeedRunbook(workspacePath, jsonRelativePath);
const targetIndex = Number(batchIndex);
const nextStatus = assertRunbookBatchStatus(status);
const batch = (runbook.batches ?? []).find((candidate) => candidate.batchIndex === targetIndex);
if (!batch) throw new Error(`AI feed runbook batch not found: ${batchIndex}`);
batch.status = nextStatus;
batch.updatedAt = new Date().toISOString();
batch.note = String(note || "");
runbook.updatedAt = batch.updatedAt;
runbook.statusSummary = summarizeRunbookStatus(runbook.batches ?? []);
const jsonPath = await assertSafeWritePath(path.join(workspacePath, runbook.jsonRelativePath || jsonRelativePath), workspacePath, [".json"]);
const markdownRelativePath = runbook.markdownRelativePath || String(jsonRelativePath).replace(/\.json$/i, ".md");
const markdownPath = await assertSafeWritePath(path.join(workspacePath, markdownRelativePath), workspacePath, [".md"]);
await writeFile(jsonPath, JSON.stringify(runbook, null, 2), "utf8");
await writeFile(markdownPath, renderAiFeedRunbookMarkdown(runbook), "utf8");
return {
...runbook,
jsonPath,
markdownPath,
updatedBatch: batch
};
}