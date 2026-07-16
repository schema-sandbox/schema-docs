import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createId, nowIso } from "./ids.js";
import { getAppDir, readManifest, writeManifest } from "./manifest.js";
import { AppError } from "./errors.js";
export const EVIDENCE_LOG_FILE_NAME = "evidence.jsonl";
export function getEvidenceLogPath(workspacePath) {
return path.join(getAppDir(workspacePath), "logs", EVIDENCE_LOG_FILE_NAME);
}
export function ensureEvidenceRecords(manifest) {
if (!Array.isArray(manifest.evidenceRecords)) {
manifest.evidenceRecords = [];
}
return manifest.evidenceRecords;
}
function workspacePolicySnapshot(manifest, input) {
return {
mode: input.policyMode ?? manifest.settings?.policyMode ?? "open-core",
openCoreFree: true,
enterpriseHooks: [
"dlp_policy_packs",
"send_gate_rules",
"audit_retention",
"private_deployment",
"model_routing"
]
};
}
function safeSelectionRange(selectionRange) {
if (!selectionRange || typeof selectionRange !== "object") return null;
const safe = {};
for (const key of [
"kind",
"chunkIndex",
"startChunkIndex",
"endChunkIndex",
"requestedStartChunkIndex",
"requestedEndChunkIndex",
"totalChunkCount",
"startChar",
"endChar",
"tokenBudget"
]) {
if (selectionRange[key] !== undefined) {
safe[key] = selectionRange[key];
}
}
if (Array.isArray(selectionRange.chunkIndexes)) {
safe.chunkIndexes = selectionRange.chunkIndexes.map((value) => Number(value)).filter(Number.isFinite);
}
return Object.keys(safe).length > 0 ? safe : null;
}
function safeContinuation(continuation) {
if (!continuation || typeof continuation !== "object") return null;
const safe = {};
for (const key of [
"canContinue",
"completedChunks",
"remainingChunks",
"totalChunkCount",
"remainingRangeCount",
"currentChunkIndex",
"nextChunkIndex",
"nextRangeStartChunkIndex",
"nextRangeEndChunkIndex",
"currentCommand",
"nextChunkCommand",
"nextRangeCommand",
"recommendedMode"
]) {
if (continuation[key] !== undefined) {
safe[key] = continuation[key];
}
}
if (continuation.currentRange && typeof continuation.currentRange === "object") {
safe.currentRange = {
startChunkIndex: continuation.currentRange.startChunkIndex ?? null,
endChunkIndex: continuation.currentRange.endChunkIndex ?? null
};
}
return Object.keys(safe).length > 0 ? safe : null;
}
function safeQueryShape(queryShape) {
if (!queryShape || typeof queryShape !== "object") return null;
const safe = {};
for (const key of [
"tableCount",
"primaryTable",
"joinedTable",
"hasJoin",
"hasWhere",
"hasGroupBy",
"hasOrderBy",
"selectedColumnCount",
"hasAggregates",
"limit"
]) {
if (queryShape[key] !== undefined) {
safe[key] = queryShape[key];
}
}
return Object.keys(safe).length > 0 ? safe : null;
}
export async function hashFile(filePath) {
const hash = createHash("sha256");
await new Promise((resolve, reject) => {
const stream = createReadStream(filePath);
stream.on("data", (chunk) => hash.update(chunk));
stream.on("error", reject);
stream.on("end", resolve);
});
return `sha256:${hash.digest("hex")}`;
}
export async function appendEvidenceRecord(workspacePath, input) {
const manifest = await readManifest(workspacePath);
const records = ensureEvidenceRecords(manifest);
const record = {
id: createId("evidence"),
traceId: input.traceId ?? createId("trace"),
kind: input.kind ?? "",
sourceRef: input.sourceRef ?? "",
inputFileHash: input.inputFileHash ?? "",
inputFileType: input.inputFileType ?? "",
outputArtifactHash: input.outputArtifactHash ?? "",
outputType: input.outputType ?? "",
converter: input.converter ?? "",
converterVersion: input.converterVersion ?? "0.1.0",
aiSent: Boolean(input.aiSent),
sentContentHash: input.sentContentHash ?? "",
storeRawPrompt: Boolean(input.storeRawPrompt),
policyDecision: input.policyDecision ?? "allow",
policyVersion: input.policyVersion ?? "doc-send-gate-v0.1",
policyMode: input.policyMode ?? manifest.settings?.policyMode ?? "open-core",
policySnapshot: workspacePolicySnapshot(manifest, input),
sendGateDecision: input.sendGateDecision ?? "",
sendGateSignals: input.sendGateSignals ?? [],
estimatedTokens: input.estimatedTokens ?? 0,
selectionRange: safeSelectionRange(input.selectionRange),
continuation: safeContinuation(input.continuation),
queryShape: safeQueryShape(input.queryShape),
userConfirmed: Boolean(input.userConfirmed),
createdAt: nowIso()
};
records.push(record);
await writeManifest(workspacePath, manifest);
await mkdir(path.dirname(getEvidenceLogPath(workspacePath)), { recursive: true });
await appendFile(getEvidenceLogPath(workspacePath), `${JSON.stringify(record)}\n`, "utf8");
return record;
}
export async function listEvidenceRecords(workspacePath) {
const manifest = await readManifest(workspacePath);
return ensureEvidenceRecords(manifest);
}
export async function getEvidenceRecord(workspacePath, evidenceId) {
const records = await listEvidenceRecords(workspacePath);
const record = records.find((candidate) => candidate.id === evidenceId);
if (!record) throw new AppError("evidence_record_not_found", `Evidence record not found: ${evidenceId}`, {
evidenceId
});
return record;
}
export async function deleteEvidenceRecord(workspacePath, evidenceId) {
const manifest = await readManifest(workspacePath);
const records = ensureEvidenceRecords(manifest);
const index = records.findIndex((record) => record.id === evidenceId);
if (index === -1) throw new AppError("evidence_record_not_found", `Evidence record not found: ${evidenceId}`, {
evidenceId
});
const [deleted] = records.splice(index, 1);
await writeManifest(workspacePath, manifest);
return deleted;
}