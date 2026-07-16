import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { readManifest } from "./manifest.js";
function makeRelative(absolutePath, workspacePath) {
if (!absolutePath) return "";
const resolvedAbs = path.resolve(absolutePath);
const resolvedWs = path.resolve(workspacePath);
if (resolvedAbs.startsWith(resolvedWs)) {
return resolvedAbs.slice(resolvedWs.length).replace(/^[\\\/]+/, "").replace(/\\/g, "/");
}
return path.basename(absolutePath);
}
function redactSettings(settings) {
const redacted = {};
for (const [key, val] of Object.entries(settings || {})) {
if (/key|token|password|secret/i.test(key) && typeof val === "string" && val.length > 0) {
redacted[key] = "[REDACTED_SECRET]";
} else if (typeof val === "string" && (val.includes("?token=") || val.includes("&token="))) {
redacted[key] = val.replace(/([\?&]token=)([^&]*)/g, "$1[REDACTED_SECRET]");
} else {
redacted[key] = val;
}
}
return redacted;
}
async function packageArtifactInfo(packageRoot, filename) {
const artifactPath = path.join(packageRoot, filename);
try {
const artifactStat = await stat(artifactPath);
return {
path: filename,
exists: true,
bytes: artifactStat.size,
updatedAt: artifactStat.mtime.toISOString()
};
} catch {
return {
path: filename,
exists: false,
bytes: 0,
updatedAt: ""
};
}
}
export async function compileWorkspaceManifest(workspacePath) {
const manifest = await readManifest(workspacePath);
let sourceFiles = [];
try {
const importsDir = path.join(workspacePath, "imports");
const files = await readdir(importsDir);
sourceFiles = files.map(f => `imports/${f}`);
} catch {
sourceFiles = [];
}
const markdownDocuments = [];
for (const doc of manifest.documents || []) {
if (doc.outputMarkdownPath) {
markdownDocuments.push({
id: doc.id,
title: doc.title,
relativePath: makeRelative(doc.outputMarkdownPath, workspacePath),
status: doc.status,
lastExtractedAt: doc.lastExtractedAt
});
}
}
const exchangePackages = [];
try {
const packagesDir = path.join(workspacePath, "packages");
const pkgs = await readdir(packagesDir, { withFileTypes: true });
for (const p of pkgs) {
if (p.isDirectory()) {
try {
const manifestFile = path.join(packagesDir, p.name, "manifest.json");
const packageRoot = path.join(packagesDir, p.name);
const raw = await readFile(manifestFile, "utf8");
const pkgManifest = JSON.parse(raw);
exchangePackages.push({
name: p.name,
title: pkgManifest.title,
packageVersion: pkgManifest.packageVersion,
createdAt: pkgManifest.createdAt,
files: (pkgManifest.exports || []).map(e => e.path),
receiverReport: await packageArtifactInfo(packageRoot, "receiver-report.md"),
trustReport: await packageArtifactInfo(packageRoot, "trust-report.json")
});
} catch {
}
}
}
} catch {
}
const qualityReports = [];
try {
const qualityLogFile = path.join(workspacePath, ".ai-doc-exchange", "logs", "conversion-quality.jsonl");
const content = await readFile(qualityLogFile, "utf8");
const lines = content.split("\n").filter(Boolean);
for (const line of lines) {
try {
const report = JSON.parse(line);
qualityReports.push({
id: report.id,
recordId: report.recordId,
inputType: report.inputType,
confidence: report.confidence,
warningsCount: (report.warnings || []).length,
createdAt: report.createdAt
});
} catch {
}
}
} catch {
}
const aiSendGateDecisions = [];
const aiContextSelections = [];
const evidence = manifest.evidenceRecords || [];
for (const ev of evidence) {
if (["ai_context_chunk_selected", "ai_context_range_selected", "ai_query_context_selected"].includes(ev.kind)) {
aiContextSelections.push({
id: ev.id,
type: ev.kind,
sourceRef: ev.sourceRef,
outputType: ev.outputType,
estimatedTokens: ev.estimatedTokens,
aiSent: Boolean(ev.aiSent),
signals: ev.sendGateSignals,
selectionRange: ev.selectionRange ?? null,
queryShape: ev.queryShape
? {
tableCount: ev.queryShape.tableCount ?? 0,
primaryTable: ev.queryShape.primaryTable ?? "",
joinedTable: ev.queryShape.joinedTable ?? "",
hasJoin: Boolean(ev.queryShape.hasJoin),
hasWhere: Boolean(ev.queryShape.hasWhere),
hasGroupBy: Boolean(ev.queryShape.hasGroupBy),
hasOrderBy: Boolean(ev.queryShape.hasOrderBy),
selectedColumnCount: ev.queryShape.selectedColumnCount ?? 0,
hasAggregates: Boolean(ev.queryShape.hasAggregates),
limit: ev.queryShape.limit ?? null
}
: null,
continuation: ev.continuation
? {
canContinue: Boolean(ev.continuation.canContinue),
completedChunks: ev.continuation.completedChunks ?? 0,
remainingChunks: ev.continuation.remainingChunks ?? 0,
remainingRangeCount: ev.continuation.remainingRangeCount ?? 0,
nextChunkIndex: ev.continuation.nextChunkIndex ?? null,
nextRangeStartChunkIndex: ev.continuation.nextRangeStartChunkIndex ?? null,
nextRangeEndChunkIndex: ev.continuation.nextRangeEndChunkIndex ?? null,
nextRangeCommand: ev.continuation.nextRangeCommand ?? ""
}
: null,
createdAt: ev.createdAt
});
} else if (ev.sendGateDecision) {
aiSendGateDecisions.push({
id: ev.id,
type: ev.kind,
decision: ev.sendGateDecision,
signals: ev.sendGateSignals,
createdAt: ev.createdAt
});
}
}
const settingsSnapshot = redactSettings(manifest.settings);
const timelineEvents = manifest.timelineEvents || [];
const aiHandoffBundles = timelineEvents
.filter((event) => event.type === "ai_handoff_bundle")
.map((event) => ({
id: event.id,
recordId: event.recordId,
relativePath: String(event.artifactPath ?? "").replace(/\\/g, "/"),
evidenceId: event.evidenceId ?? "",
summary: event.summary,
createdAt: event.timestamp
}));
const refreshHistory = timelineEvents
.filter(e => e.type === "refresh" || e.type === "import")
.map(e => ({
id: e.id,
recordId: e.recordId,
type: e.type,
summary: e.summary,
timestamp: e.timestamp
}));
return {
workspaceId: manifest.workspaceId,
createdAt: manifest.createdAt,
updatedAt: manifest.updatedAt,
sourceFiles,
markdownDocuments,
refreshHistory,
qualityReports,
exchangePackages,
aiSendGateDecisions,
aiContextSelections,
aiHandoffBundles,
timelineEvents,
settingsSnapshot
};
}