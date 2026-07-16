import { readManifest, writeManifest } from "./manifest.js";
import { createId, nowIso } from "./ids.js";
export async function appendTimelineEvent(workspacePath, recordId, type, summary, details = {}) {
let manifest;
try {
manifest = await readManifest(workspacePath);
} catch {
return null;
}
manifest.timelineEvents = manifest.timelineEvents || [];
const scrubbedDetails = {};
if (details.evidenceId) scrubbedDetails.evidenceId = details.evidenceId;
if (details.artifactPath) scrubbedDetails.artifactPath = details.artifactPath;
if (details.artifactHash) scrubbedDetails.artifactHash = details.artifactHash;
if (details.policyDecision) scrubbedDetails.policyDecision = details.policyDecision;
if (details.overrideReason) scrubbedDetails.overrideReason = details.overrideReason;
if (details.selectionRange) {
scrubbedDetails.selectionRange = {
kind: details.selectionRange.kind,
chunkIndex: details.selectionRange.chunkIndex,
startChunkIndex: details.selectionRange.startChunkIndex,
endChunkIndex: details.selectionRange.endChunkIndex,
requestedStartChunkIndex: details.selectionRange.requestedStartChunkIndex,
requestedEndChunkIndex: details.selectionRange.requestedEndChunkIndex,
totalChunkCount: details.selectionRange.totalChunkCount,
tokenBudget: details.selectionRange.tokenBudget,
chunkIndexes: Array.isArray(details.selectionRange.chunkIndexes)
? details.selectionRange.chunkIndexes.map((value) => Number(value)).filter(Number.isFinite)
: undefined
};
}
if (details.continuation) {
scrubbedDetails.continuation = {
canContinue: Boolean(details.continuation.canContinue),
completedChunks: details.continuation.completedChunks,
remainingChunks: details.continuation.remainingChunks,
totalChunkCount: details.continuation.totalChunkCount,
remainingRangeCount: details.continuation.remainingRangeCount,
nextChunkIndex: details.continuation.nextChunkIndex,
nextRangeStartChunkIndex: details.continuation.nextRangeStartChunkIndex,
nextRangeEndChunkIndex: details.continuation.nextRangeEndChunkIndex,
nextChunkCommand: details.continuation.nextChunkCommand,
nextRangeCommand: details.continuation.nextRangeCommand
};
}
if (details.queryShape) {
scrubbedDetails.queryShape = {
tableCount: details.queryShape.tableCount,
primaryTable: details.queryShape.primaryTable,
joinedTable: details.queryShape.joinedTable,
hasJoin: Boolean(details.queryShape.hasJoin),
hasWhere: Boolean(details.queryShape.hasWhere),
hasGroupBy: Boolean(details.queryShape.hasGroupBy),
hasOrderBy: Boolean(details.queryShape.hasOrderBy),
selectedColumnCount: details.queryShape.selectedColumnCount,
hasAggregates: Boolean(details.queryShape.hasAggregates),
limit: details.queryShape.limit
};
}
const event = {
id: createId("event"),
recordId,
type,
timestamp: nowIso(),
actor: details.actor || "local_user",
summary,
...scrubbedDetails
};
manifest.timelineEvents.push(event);
await writeManifest(workspacePath, manifest);
return event;
}
export async function getTimelineEvents(workspacePath, recordId = null) {
const manifest = await readManifest(workspacePath);
const events = manifest.timelineEvents || [];
if (recordId) return events.filter(e => e.recordId === recordId);
return events;
}