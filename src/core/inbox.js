import path from "node:path";
import { readManifest, writeManifest } from "./manifest.js";
import { getSingleRecordStatus } from "./records.js";
import { AppError } from "./errors.js";
import { appendTimelineEvent } from "./timeline.js";
const SUPPORTED_EXTENSIONS = new Set(["pdf", "docx", "pptx", "md", "txt", "csv", "xlsx"]);
export async function getInboxItems(workspacePath) {
const manifest = await readManifest(workspacePath);
const items = [];
for (const doc of manifest.documents) {
const statusInfo = await getSingleRecordStatus(workspacePath, doc, "document");
const item = mapRecordToInboxItem(doc, "document", statusInfo);
items.push(item);
}
for (const ds of manifest.datasets) {
const statusInfo = await getSingleRecordStatus(workspacePath, ds, "dataset");
const item = mapRecordToInboxItem(ds, "dataset", statusInfo);
items.push(item);
}
return items;
}
function mapRecordToInboxItem(record, kind, statusInfo) {
const sourcePath = record.originalSourcePath || record.sourcePath;
const originalName = sourcePath ? path.basename(sourcePath) : "untitled";
const detectedType = record.sourceType || "";
const size = record.sourceSize || 0;
const sourceHash = record.sourceHash || record.hash || "";
const recommendedActions = [];
const warnings = [];
if (record.status === "archived") {
recommendedActions.push("unarchive");
} else {
if (record.status === "failed") {
warnings.push("Extraction failed");
}
if (record.originalSourcePath && !statusInfo.sourceAvailable) {
warnings.push("Source file is missing");
}
if (statusInfo.sourceChanged) {
warnings.push("Source file changed externally");
recommendedActions.push("refresh");
}
if (["docx", "pptx", "pdf", "txt", "md"].includes(detectedType)) {
if (record.status === "imported" || record.status === "failed" || statusInfo.sourceChanged) {
recommendedActions.push("extract");
}
}
if (["csv", "xlsx"].includes(detectedType)) {
if (record.status === "imported" || record.status === "failed") {
recommendedActions.push("inspect");
}
}
if (detectedType === "md" || record.outputMarkdownPath) {
if (record.status === "converted" || record.status === "imported") {
recommendedActions.push("open_note");
}
}
if (!SUPPORTED_EXTENSIONS.has(detectedType)) {
recommendedActions.push("show_known_limit");
warnings.push("Unsupported file type");
}
const isLow = record.quality?.confidence === "low" ||
record.extractionQuality?.scannedLikely === true ||
record.extractionQuality?.possibleMojibake === true ||
record.extractionQuality?.confidence === "low";
if (isLow) {
recommendedActions.push("review_before_ai");
if (record.extractionQuality?.scannedLikely === true) {
warnings.push("Scanned document detected - requires OCR");
}
if (record.extractionQuality?.possibleMojibake === true) {
warnings.push("Possible CJK character corruption (mojibake)");
}
if (record.quality?.confidence === "low" || record.extractionQuality?.confidence === "low") {
warnings.push("Low quality extraction (confidence: low)");
}
}
}
return {
id: record.id,
kind,
sourcePath,
importedCopyPath: record.importedCopyPath || record.sourcePath || null,
originalName,
detectedType,
size,
sourceHash,
importedAt: record.createdAt,
status: statusInfo.sourceChanged && record.status !== "archived" ? "stale" : record.status,
recommendedActions,
warnings
};
}
export async function archiveInboxItem(workspacePath, itemId) {
const manifest = await readManifest(workspacePath);
let recordKind = "";
let recordName = "";
const docIndex = manifest.documents.findIndex(d => d.id === itemId);
if (docIndex >= 0) {
manifest.documents[docIndex].status = "archived";
recordKind = "document";
recordName = manifest.documents[docIndex].title;
} else {
const dsIndex = manifest.datasets.findIndex(d => d.id === itemId);
if (dsIndex >= 0) {
manifest.datasets[dsIndex].status = "archived";
recordKind = "dataset";
recordName = manifest.datasets[dsIndex].name;
} else {
throw new AppError("record_not_found", `Record not found: ${itemId}`);
}
}
await writeManifest(workspacePath, manifest);
await appendTimelineEvent(workspacePath, itemId, "inbox_archive", `Archived ${recordKind} "${recordName}" in inbox`, {
itemId,
recordKind
});
return { id: itemId, status: "archived" };
}
export async function unarchiveInboxItem(workspacePath, itemId) {
const manifest = await readManifest(workspacePath);
let recordKind = "";
let recordName = "";
const docIndex = manifest.documents.findIndex(d => d.id === itemId);
if (docIndex >= 0) {
manifest.documents[docIndex].status = "imported";
recordKind = "document";
recordName = manifest.documents[docIndex].title;
} else {
const dsIndex = manifest.datasets.findIndex(d => d.id === itemId);
if (dsIndex >= 0) {
manifest.datasets[dsIndex].status = "imported";
recordKind = "dataset";
recordName = manifest.datasets[dsIndex].name;
} else {
throw new AppError("record_not_found", `Record not found: ${itemId}`);
}
}
await writeManifest(workspacePath, manifest);
await appendTimelineEvent(workspacePath, itemId, "inbox_unarchive", `Unarchived ${recordKind} "${recordName}" in inbox`, {
itemId,
recordKind
});
return { id: itemId, status: "imported" };
}
export async function getInboxRecommendations(workspacePath, itemId) {
const items = await getInboxItems(workspacePath);
const matched = items.find(item => item.id === itemId);
if (!matched) throw new AppError("record_not_found", `Record not found in inbox: ${itemId}`);
return {
itemId,
recommendedActions: matched.recommendedActions,
warnings: matched.warnings
};
}
