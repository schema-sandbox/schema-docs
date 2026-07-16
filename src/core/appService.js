import path from "node:path";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { openOrCreateWorkspace, readManifest, writeManifest } from "./manifest.js";
import { saveMarkdown, readMarkdown, deleteMarkdown } from "./markdown.js";
import { importFileToWorkspace, importFileBufferToWorkspace, checkWorkspaceUpdates, refreshWorkspaceRecord, getRecordStatuses, previewRecordRefresh } from "./records.js";
import { inspectDatasetAsJob } from "./datasets.js";
import { convertDocumentToMarkdownAsJob } from "./documents.js";
import { listJobs } from "./jobs.js";
import { listQueryTables, prepareQueryResultForAi, runQueryAsJob } from "./queries.js";
import { previewAiPayloadAsJob, sendAiRequestAsJob } from "./ai.js";
import { csvImporter } from "../adapters/csvImporter.js";
import { xlsxImporter } from "../adapters/xlsxImporter.js";
import { textMarkdownConverter } from "../adapters/textMarkdownConverter.js";
import { docxMarkdownConverter } from "../adapters/docxMarkdownConverter.js";
import { pdfMarkdownConverter } from "../adapters/pdfMarkdownConverter.js";
import { pptxMarkdownConverter } from "../adapters/pptxMarkdownConverter.js";
import { createMemoryQueryEngine } from "../adapters/memoryQueryEngine.js";
import { createOpenAiCompatibleClient } from "../adapters/openAiCompatibleClient.js";
import { AppError } from "./errors.js";
import { createExchangeMarkdown, readExchangePackage, writeExchangePackage, explainExchangePackage, verifyExchangePackage, generateTrustReport, writeExchangePackageReceiverReport } from "./exchangePackage.js";
import { exportMarkdownDocument, readMarkdownFile, writeRenderedDocument } from "./documentExports.js";
import {
getDocumentExchangeCapability,
listDocumentExchangeCapabilities,
normalizeDocumentFormat
} from "./documentExchangeMatrix.js";
import { deleteApiProfile, listApiProfiles, saveApiProfile } from "./apiProfiles.js";
import { deleteExchangeAudit, listExchangeAudits } from "./exchangeAudits.js";
import { appendConversionAudit, deleteConversionAudit, listConversionAudits } from "./conversionAudits.js";
import { appendEvidenceRecord, deleteEvidenceRecord, getEvidenceRecord, hashFile, listEvidenceRecords } from "./evidence.js";
import { createDocumentCapabilityManifest } from "./capabilityManifest.js";
import { searchWorkspace } from "./workspaceSearch.js";
import { maskSensitiveData, unmaskSensitiveData } from "./masking.js";
import { appendTimelineEvent, getTimelineEvents } from "./timeline.js";
import { getInboxItems, archiveInboxItem, unarchiveInboxItem, getInboxRecommendations } from "./inbox.js";
import { addMarkdownVersion, listMarkdownVersions, promoteMarkdownVersion, diffMarkdownVersions } from "./versions.js";
import { getWorkspaceSettings, updateWorkspaceSettings } from "./settings.js";
import { getRealSampleSummary, exportRealSampleReportMd, writeRealSampleReportMd } from "./realSamples.js";
import { detectAdapterCapabilities } from "./adapterCapabilities.js";
import { estimateTables } from "./qualityReport.js";
import { materializePdfVisualAssets, renderPdfVisualRegion } from "../adapters/pdfVisualRenderer.js";
import { assertSafeWritePath } from "./pathGuard.js";
import {
compileAiContextPreview,
compileAiIntakeManifest,
renderDatasetMarkdown,
resolveAiContextChunk,
resolveAiContextChunkRange
} from "./aiContext.js";
import { compileAiFeedRunbook, readAiFeedRunbook, updateAiFeedRunbookBatch } from "./aiFeedRunbook.js";
import { datasetSheetsToMarkdown } from "./markdownFormatting.js";
function datasetImporterForType(sourceType) {
if (sourceType === "csv") return csvImporter;
if (sourceType === "xlsx") return xlsxImporter;
throw new AppError("dataset_importer_not_found", `No importer for dataset type: ${sourceType}`, {
sourceType
});
}
function documentConverterForType(sourceType) {
if (sourceType === "txt" || sourceType === "md") return textMarkdownConverter;
if (sourceType === "docx") return docxMarkdownConverter;
if (sourceType === "pdf") return pdfMarkdownConverter;
if (sourceType === "pptx") return pptxMarkdownConverter;
throw new AppError("document_converter_not_found", `No converter for document type: ${sourceType}`, {
sourceType
});
}
function findDocument(manifest, documentId) {
return manifest.documents.find((candidate) => candidate.id === documentId);
}
function findDataset(manifest, datasetId) {
return manifest.datasets.find((candidate) => candidate.id === datasetId);
}
function findRecord(manifest, recordId) {
const document = findDocument(manifest, recordId);
const dataset = findDataset(manifest, recordId);
return {
document,
dataset,
kind: document ? "document" : dataset ? "dataset" : ""
};
}
async function loadFullDatasetForMarkdown(dataset) {
const importer = datasetImporterForType(dataset.sourceType);
const imported = await importer.import({
sourcePath: dataset.sourcePath,
limit: Number.MAX_SAFE_INTEGER
});
return {
...dataset,
sheets: imported.sheets ?? [],
rowCountEstimate: imported.rowCountEstimate ?? dataset.rowCountEstimate ?? 0
};
}
const emptyRefreshState = {
headingsCount: 0,
tableCount: 0,
charCount: 0,
confidence: "unknown",
knownLimits: [],
sendGateDecision: "unknown"
};
async function readDocumentRefreshState(doc) {
if (!doc?.outputMarkdownPath) return emptyRefreshState;
let markdown = "";
try {
markdown = await readFile(doc.outputMarkdownPath, "utf8");
} catch {
return emptyRefreshState;
}
let quality = null;
try {
quality = JSON.parse(await readFile(doc.outputMarkdownPath.replace(/\.md$/, ".quality.json"), "utf8"));
} catch {
}
return {
headingsCount: (markdown.match(/^#{1,6}\s+/gm) || []).length,
tableCount: estimateTables(markdown),
charCount: markdown.length,
confidence: quality?.confidence || "unknown",
knownLimits: quality?.matchedKnownLimits || [],
sendGateDecision: quality?.whetherAiSendGateBlocked ? "blocked" : "allow"
};
}
function compareKnownLimits(before, after) {
return [...before].sort().join("\n") !== [...after].sort().join("\n");
}
async function resolveAuditEvidence(workspacePath, input) {
const audits = input.auditId ? await listExchangeAudits(workspacePath) : [];
const audit = input.auditId ? audits.find((candidate) => candidate.id === input.auditId) : input.audit;
const evidenceId = input.evidenceId ?? audit?.evidenceId ?? "";
const evidenceRecords = evidenceId ? await listEvidenceRecords(workspacePath) : [];
const evidence = evidenceId
? evidenceRecords.find((candidate) => candidate.id === evidenceId)
: input.evidence;
return { audit, evidence };
}
export function createAppService(workspacePath) {
const fwd = fn => (...args) => fn(workspacePath, ...args);
return {
workspacePath,
openWorkspace: () => openOrCreateWorkspace(workspacePath),
getManifest: () => readManifest(workspacePath),
saveMarkdown: fwd(saveMarkdown),
readMarkdown: fwd(readMarkdown),
deleteMarkdown: fwd(deleteMarkdown),
exportMarkdownDocument: fwd(exportMarkdownDocument),
listDocumentExchangeCapabilities() {
return listDocumentExchangeCapabilities();
},
detectAdapterCapabilities() {
return detectAdapterCapabilities();
},
getDocumentCapabilityManifest() {
return createDocumentCapabilityManifest();
},
async importFile(sourcePath) {
const record = await importFileToWorkspace(workspacePath, sourcePath);
if (record.sourceType === "csv" || record.sourceType === "xlsx") {
const autoInspectJob = await inspectDatasetAsJob(
workspacePath,
record.id,
datasetImporterForType(record.sourceType)
);
return { ...record, kind: "dataset", autoInspectJob };
}
return record;
},
importFileBuffer(buffer, originalName) {
return importFileBufferToWorkspace(workspacePath, buffer, originalName);
},
async createSampleDocx() {
await openOrCreateWorkspace(workspacePath);
const markdown = [
"# Schema Docs Sample Word",
"",
"This DOCX is generated inside the current workspace as an Office-first sample.",
"",
"- Word, PDF, and spreadsheets are the visible user entry.",
"- Markdown is the exchange layer for AI preview, audit, API access, and packages.",
"- Word and PDF exports use the same local conversion pipeline.",
"- No external service is called for this sample workflow.",
""
].join("\n");
const sourcePath = await writeRenderedDocument(
workspacePath,
markdown,
path.join("samples", "sample-word.docx"),
"docx"
);
const document = await importFileToWorkspace(workspacePath, sourcePath);
return {
sourcePath,
document
};
},
async inspectDataset(datasetId) {
const manifest = await readManifest(workspacePath);
const dataset = findDataset(manifest, datasetId);
if (!dataset) throw new AppError("dataset_not_found", `Dataset not found: ${datasetId}`, { datasetId });
return inspectDatasetAsJob(workspacePath, datasetId, datasetImporterForType(dataset.sourceType));
},
async convertDocument(documentId) {
const manifest = await readManifest(workspacePath);
const document = findDocument(manifest, documentId);
if (!document) throw new AppError("document_not_found", `Document not found: ${documentId}`, { documentId });
return convertDocumentToMarkdownAsJob(workspacePath, documentId, documentConverterForType(document.sourceType));
},
async retryDocumentExtraction(documentId, preferredExtractor = "auto") {
const manifest = await readManifest(workspacePath);
const document = findDocument(manifest, documentId);
if (!document) throw new AppError("document_not_found", `Document not found: ${documentId}`, { documentId });
return convertDocumentToMarkdownAsJob(
workspacePath,
documentId,
documentConverterForType(document.sourceType),
{ force: true, preferredExtractor }
);
},
async renderPdfVisualRegion(documentId, pageNumber, regionIndex = null, outputRelativePath = "", dpi = 180) {
const manifest = await readManifest(workspacePath);
const document = findDocument(manifest, documentId);
if (!document) throw new AppError("document_not_found", `Document not found: ${documentId}`, { documentId });
if (document.sourceType !== "pdf") throw new AppError("unsupported_source_type", "Visual region rendering is available only for PDF documents.", { sourceType: document.sourceType });
if (!document.pdfVisualMapPath) throw new AppError("pdf_visual_map_missing", "Re-extract the PDF with the layout-aware adapter before rendering visual regions.", { documentId });
const safeName = `${document.id}-page-${Number(pageNumber)}${regionIndex === null || regionIndex === undefined ? "" : `-region-${Number(regionIndex)}`}.png`;
const requestedPath = outputRelativePath || path.join("outputs", "assets", "rendered", safeName);
const outputPath = await assertSafeWritePath(path.join(workspacePath, requestedPath), workspacePath, [".png"]);
return renderPdfVisualRegion({
sourcePath: document.sourcePath,
visualMapPath: document.pdfVisualMapPath,
pageNumber,
regionIndex,
outputPath,
dpi
});
},
async preservePdfVisualAssets(documentId, mode = "fallback", dpi = 220) {
const manifest = await readManifest(workspacePath);
const document = findDocument(manifest, documentId);
if (!document) throw new AppError("document_not_found", `Document not found: ${documentId}`, { documentId });
if (document.sourceType !== "pdf") throw new AppError("unsupported_source_type", "Visual asset preservation is available only for PDF documents.", { sourceType: document.sourceType });
if (!document.pdfVisualMapPath) throw new AppError("pdf_visual_map_missing", "Retry extraction with pdfplumber before preserving formula, table, and image regions.", { documentId });
const outputDir = path.join(workspacePath, "outputs", "assets", `${document.id}-visual`);
const result = await materializePdfVisualAssets({
sourcePath: document.sourcePath,
visualMapPath: document.pdfVisualMapPath,
outputDir,
mode: mode === "all" ? "all" : "fallback",
dpi
});
document.pdfVisualContentPath = result.indexPath;
document.pdfVisualAssets = {
mode: result.mode,
requested: result.requested,
rendered: result.rendered,
failed: result.failed.length,
indexPath: result.indexPath,
updatedAt: new Date().toISOString()
};
await writeManifest(workspacePath, manifest);
return result;
},
async convertAllDocuments() {
await openOrCreateWorkspace(workspacePath);
const manifest = await readManifest(workspacePath);
const unconverted = manifest.documents.filter((doc) => doc.status === "imported");
const jobs = [];
for (const doc of unconverted) {
try {
const job = await convertDocumentToMarkdownAsJob(workspacePath, doc.id, documentConverterForType(doc.sourceType));
jobs.push(job);
} catch {
}
}
return jobs;
},
async convertDocumentToFormat(documentId, outputRelativePath, format) {
const normalizedFormat = normalizeDocumentFormat(format);
const manifest = await readManifest(workspacePath);
const document = findDocument(manifest, documentId);
if (!document) throw new AppError("document_not_found", `Document not found: ${documentId}`, { documentId });
const capability = getDocumentExchangeCapability(document.sourceType, normalizedFormat);
let markdownPath = document.markdownOutputs?.defaultForHumans || document.readableMarkdownPath || document.outputMarkdownPath;
let warnings = [];
if (document.sourceType === "md") {
markdownPath = document.sourcePath;
} else if (!markdownPath) {
const conversion = await this.convertDocument(documentId);
markdownPath = conversion.output.readableMarkdownPath || conversion.output.outputMarkdownPath;
warnings = conversion.output.warnings ?? [];
const freshManifest = await readManifest(workspacePath);
const freshDoc = findDocument(freshManifest, documentId);
if (freshDoc) {
document.qualityReportId = freshDoc.qualityReportId;
markdownPath = freshDoc.markdownOutputs?.defaultForHumans || freshDoc.readableMarkdownPath || freshDoc.outputMarkdownPath || markdownPath;
}
}
const markdown = await readMarkdownFile(markdownPath);
const outputPath = await writeRenderedDocument(workspacePath, markdown, outputRelativePath, normalizedFormat, {
stripProcessMetadata: document.sourceType !== "md",
baseDir: path.dirname(markdownPath),
assetRoot: workspacePath
});
const evidence = await appendEvidenceRecord(workspacePath, {
kind: "document_conversion",
sourceRef: documentId,
inputFileHash: await hashFile(document.sourcePath),
inputFileType: document.sourceType,
outputArtifactHash: await hashFile(outputPath),
outputType: normalizedFormat,
converter: `${capability.from}_to_${capability.to}`,
aiSent: false,
policyDecision: "local_only",
userConfirmed: false
});
const audit = await appendConversionAudit(workspacePath, {
documentId,
sourceType: document.sourceType,
targetFormat: normalizedFormat,
mode: capability.mode,
quality: capability.quality,
sourcePath: document.sourcePath,
intermediateMarkdownPath: markdownPath,
outputPath,
warnings,
limits: capability.limits,
evidenceId: evidence.id,
qualityReportId: document.qualityReportId ?? ""
});
await appendTimelineEvent(workspacePath, documentId, "export", `Exported document "${document.title}" to ${normalizedFormat.toUpperCase()}`, {
evidenceId: evidence.id,
artifactPath: outputPath,
artifactHash: evidence.outputArtifactHash
});
return {
documentId,
outputPath,
format: normalizedFormat,
intermediateMarkdownPath: markdownPath,
warnings,
capability,
evidenceId: evidence.id,
auditId: audit.id
};
},
async exportRecordToMarkdown(recordId, outputRelativePath) {
const manifest = await readManifest(workspacePath);
const { document, dataset, kind } = findRecord(manifest, recordId);
if (document) return this.convertDocumentToFormat(recordId, outputRelativePath, "md");
if (!dataset || kind !== "dataset") throw new AppError("record_not_found", `Record not found: ${recordId}`, { recordId });
let sourceDataset = dataset;
let warnings = [];
if (!Array.isArray(sourceDataset.sheets) || sourceDataset.sheets.length === 0) {
const inspectJob = await this.inspectDataset(recordId);
warnings = inspectJob.output?.warnings ?? [];
const updatedManifest = await readManifest(workspacePath);
sourceDataset = findDataset(updatedManifest, recordId) || sourceDataset;
}
const fullDataset = await loadFullDatasetForMarkdown(sourceDataset);
if ((fullDataset.rowCountEstimate ?? 0) > (sourceDataset.sheets || [])
.reduce((sum, sheet) => sum + (sheet.previewRows?.length ?? 0), 0)) {
warnings.push("Markdown export used the original dataset file to include all available rows, not only the workspace preview rows.");
}
const markdown = datasetSheetsToMarkdown({
title: fullDataset.name || fullDataset.title,
sourceName: path.basename(fullDataset.sourcePath),
sourceType: fullDataset.sourceType,
sheets: fullDataset.sheets || []
});
const outputPath = await writeRenderedDocument(workspacePath, markdown, outputRelativePath, "md");
const evidence = await appendEvidenceRecord(workspacePath, {
kind: "document_conversion",
sourceRef: recordId,
inputFileHash: await hashFile(fullDataset.sourcePath),
inputFileType: fullDataset.sourceType,
outputArtifactHash: await hashFile(outputPath),
outputType: "md",
converter: `${fullDataset.sourceType}_to_md`,
aiSent: false,
policyDecision: "local_only",
userConfirmed: false
});
const audit = await appendConversionAudit(workspacePath, {
documentId: recordId,
sourceType: fullDataset.sourceType,
targetFormat: "md",
mode: "direct",
quality: "structured-table",
sourcePath: fullDataset.sourcePath,
intermediateMarkdownPath: outputPath,
outputPath,
warnings,
limits: ["formulas", "charts", "pivot_tables", "cell_styles"],
evidenceId: evidence.id,
qualityReportId: ""
});
await appendTimelineEvent(workspacePath, recordId, "export", `Exported dataset "${fullDataset.name}" to Markdown`, {
evidenceId: evidence.id,
artifactPath: outputPath,
artifactHash: evidence.outputArtifactHash
});
return {
documentId: recordId,
outputPath,
format: "md",
intermediateMarkdownPath: outputPath,
warnings,
capability: {
from: fullDataset.sourceType,
to: "md",
mode: "direct",
quality: "structured-table",
limits: ["formulas", "charts", "pivot_tables", "cell_styles"]
},
evidenceId: evidence.id,
auditId: audit.id
};
},
listConversionAudits: fwd(listConversionAudits),
deleteConversionAudit: fwd(deleteConversionAudit),
listEvidenceRecords: fwd(listEvidenceRecords),
getEvidenceRecord: fwd(getEvidenceRecord),
deleteEvidenceRecord: fwd(deleteEvidenceRecord),
listJobs: fwd(listJobs),
listTables() {
return listQueryTables(workspacePath, createMemoryQueryEngine);
},
runQuery(sql) {
return runQueryAsJob(workspacePath, sql, createMemoryQueryEngine);
},
prepareQueryForAi(sql, options = {}) {
return prepareQueryResultForAi(workspacePath, sql, createMemoryQueryEngine, options);
},
async saveQueryAiHandoffBundle(relativePath, sql, options = {}) {
const queryContext = await this.prepareQueryForAi(sql, options.queryOptions ?? {});
const handoffBundle = await this.saveAiHandoffBundle(relativePath, {
...(options.input ?? {}),
title: "Filtered Table AI Handoff Bundle",
source: options.input?.source ?? "query-ai-handoff",
sourceRef: "query_context",
operation: "query_handoff",
content: queryContext.contextMarkdown,
evidenceId: queryContext.evidenceId,
sendGateSummary: "Send Gate: local_query_context_selected",
chunkLedger: `AI chunk ledger: filtered table context, rows ${queryContext.includedRowCount}/${queryContext.rowCount}, tokens~${queryContext.tokenEstimate}`
});
return { queryContext, handoffBundle };
},
previewAiPayload: fwd(previewAiPayloadAsJob),
sendAiRequest: (input, client = createOpenAiCompatibleClient()) => sendAiRequestAsJob(workspacePath, input, client),
listApiProfiles: fwd(listApiProfiles),
saveApiProfile: fwd(saveApiProfile),
deleteApiProfile: fwd(deleteApiProfile),
listExchangeAudits: fwd(listExchangeAudits),
deleteExchangeAudit: fwd(deleteExchangeAudit),
async createExchangeMarkdown(input) {
const { audit, evidence } = await resolveAuditEvidence(workspacePath, input);
return createExchangeMarkdown({
...input,
audit,
evidence
});
},
async saveExchangeMarkdown(relativePath, input) {
const markdown = await this.createExchangeMarkdown(input);
return saveMarkdown(workspacePath, relativePath, markdown);
},
async writeBackAiResult(relativePath, input = {}) {
const aiResult = typeof input.aiResult === "string" ? input.aiResult : "";
if (!aiResult.trim()) {
throw new AppError("ai_result_empty", "AI result write-back r...");
}
const outputRelativePath = relativePath || `notes/ai-result-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
const savedPath = await this.saveExchangeMarkdown(outputRelativePath, {
title: input.title || "AI Result Write-back",
source: input.source || input.sourceRef || "ai-result-writeback",
body: input.body || "",
aiResult,
apiBaseUrl: input.apiBaseUrl || "",
model: input.model || "",
auditId: input.auditId,
evidenceId: input.evidenceId,
createdAt: input.createdAt
});
await appendTimelineEvent(workspacePath, input.sourceRef || input.auditId || outputRelativePath, "ai_result_writeback", `Wrote AI result back to "${outputRelativePath}"`, {
auditId: input.auditId || "",
evidenceId: input.evidenceId || ""
});
return {
relativePath: outputRelativePath,
path: savedPath,
auditId: input.auditId || "",
evidenceId: input.evidenceId || ""
};
},
async saveAiHandoffBundle(relativePath, input = {}) {
const { saveAiHandoffBundle } = await import("./aiHandoffBundle.js");
return saveAiHandoffBundle(workspacePath, relativePath, input, {
saveExchangeMarkdown: (outputRelativePath, exchangeInput) => this.saveExchangeMarkdown(outputRelativePath, exchangeInput),
resolveAiContextChunk: (recordIdOrPackagePath, chunkIndex) => this.resolveAiContextChunk(recordIdOrPackagePath, chunkIndex),
resolveAiContextChunkRange: (recordIdOrPackagePath, startChunkIndex, endChunkIndex, tokenBudget) => {
return this.resolveAiContextChunkRange(recordIdOrPackagePath, startChunkIndex, endChunkIndex, tokenBudget);
}
});
},
async saveExchangePackage(packageRelativePath, input) {
const settings = await getWorkspaceSettings(workspacePath);
const { audit, evidence } = await resolveAuditEvidence(workspacePath, input);
return writeExchangePackage(workspacePath, packageRelativePath, {
...input,
policyMode: input.policyMode ?? settings.policyMode,
audit,
evidence
});
},
async saveExchangePackageFromRecord(recordId, packageRelativePath, input = {}) {
const prepared = await this.prepareRecordForAi(recordId);
const freshManifest = await readManifest(workspacePath);
const { document, dataset } = findRecord(freshManifest, recordId);
let title = input.title ?? "";
let body = "";
let sourceType = "";
if (document) {
title = title || document.title || recordId;
sourceType = document.sourceType;
const markdownPath = document.sourceType === "md"
? document.sourcePath
: document.outputMarkdownPath;
if (!markdownPath) throw new AppError("record_markdown_missing", `Prepared document has no Markdown output: ${recordId}`, { recordId });
body = await readMarkdownFile(markdownPath);
} else if (dataset) {
title = title || dataset.name || recordId;
sourceType = dataset.sourceType;
body = renderDatasetMarkdown(dataset);
} else {
throw new AppError("record_not_found", `Record not found: ${recordId}`, { recordId });
}
const evidenceRecords = await listEvidenceRecords(workspacePath);
const evidence = [...evidenceRecords]
.reverse()
.find((candidate) => candidate.sourceRef === recordId);
const exportFormats = input.exportFormats ?? (document ? ["docx", "pdf"] : []);
let qualityReport = null;
if (document?.outputMarkdownPath) {
try {
qualityReport = JSON.parse(await readFile(document.outputMarkdownPath.replace(/\.md$/, ".quality.json"), "utf8"));
} catch {
qualityReport = null;
}
}
const sourceRecord = {
id: recordId,
kind: prepared.kind,
title,
sourceType,
sourcePath: document?.sourcePath ?? dataset?.sourcePath ?? "",
originalSourcePath: document?.originalSourcePath ?? dataset?.originalSourcePath ?? "",
status: document?.status ?? dataset?.status ?? "",
outputMarkdownPath: document?.outputMarkdownPath ?? "",
rowCountEstimate: dataset?.rowCountEstimate ?? null
};
const settings = await getWorkspaceSettings(workspacePath);
const packageResult = await writeExchangePackage(workspacePath, packageRelativePath, {
...input,
policyMode: input.policyMode ?? settings.policyMode,
title,
body,
source: input.source ?? `record:${recordId}`,
exportFormats,
evidence,
sourceRecords: input.sourceRecords ?? [sourceRecord],
conversionQuality: input.conversionQuality ?? (qualityReport ? [qualityReport] : []),
aiSendGateSummaries: input.aiSendGateSummaries ?? [{
recordId,
decision: prepared.preview?.sendGateDecision ?? "",
estimatedTokens: prepared.preview?.tokenEstimate ?? 0,
qualityWarnings: prepared.preview?.qualityWarnings ?? [],
recommendedNextAction: prepared.preview?.recommendedNextAction ?? ""
}],
knownLimits: input.knownLimits ?? (prepared.preview?.knownLimits ?? [])
});
return {
...packageResult,
recordId,
kind: prepared.kind,
sourceType,
preparedPreview: prepared.preview
};
},
readExchangePackage(packageRelativePath) {
return readExchangePackage(workspacePath, packageRelativePath);
},
async explainExchangePackage(packageRelativePath) {
const detailed = await explainExchangePackage(workspacePath, packageRelativePath);
const tablesCount = detailed.tables?.length ?? 0;
const qualityReportsCount = detailed.qualityRisks?.length ?? 0;
return {
...detailed,
tablesCount,
exportsCount: detailed.exportsCount ?? 0,
knownLimitsCount: detailed.knownLimitsCount ?? 0,
qualityReportsCount,
hasEvidence: Boolean(detailed.includes?.evidence),
filesCount: detailed.files?.length ?? 0,
explanation: `Exchange Package "${detailed.title}" created on ${detailed.createdAt} with model ${detailed.model || "none"}. It contains ${tablesCount} tables, ${detailed.exportsCount ?? 0} exports, and ${qualityReportsCount} quality reports.`
};
},
async generateTrustReport(packageRelativePath) {
return generateTrustReport(workspacePath, packageRelativePath);
},
async writeExchangePackageReceiverReport(packageRelativePath) {
return writeExchangePackageReceiverReport(workspacePath, packageRelativePath);
},
searchWorkspace(keyword) {
return searchWorkspace(workspacePath, keyword);
},
maskSensitiveData(text) {
return maskSensitiveData(text);
},
unmaskSensitiveData(text, mapping) {
return unmaskSensitiveData(text, mapping);
},
checkUpdates() {
return checkWorkspaceUpdates(workspacePath);
},
async previewRecordRefresh(recordId) {
return previewRecordRefresh(workspacePath, recordId);
},
async refreshRecord(recordId) {
const manifestBefore = await readManifest(workspacePath);
const docBefore = findDocument(manifestBefore, recordId);
const beforeState = await readDocumentRefreshState(docBefore);
const result = await refreshWorkspaceRecord(workspacePath, recordId);
let job = null;
if (result.kind === "document") {
job = await convertDocumentToMarkdownAsJob(workspacePath, result.record.id, documentConverterForType(result.record.sourceType));
} else if (result.kind === "dataset") {
job = await inspectDatasetAsJob(workspacePath, result.record.id, datasetImporterForType(result.record.sourceType));
}
const manifestAfter = await readManifest(workspacePath);
const docAfter = findDocument(manifestAfter, recordId);
const afterState = await readDocumentRefreshState(docAfter);
let diff = null;
if (result.kind === "document") {
diff = {
headingsDelta: afterState.headingsCount - beforeState.headingsCount,
tableCountDelta: afterState.tableCount - beforeState.tableCount,
charCountDelta: afterState.charCount - beforeState.charCount,
qualityScoreChanged: afterState.confidence !== beforeState.confidence,
knownLimitsChanged: compareKnownLimits(beforeState.knownLimits, afterState.knownLimits),
sendGateDecisionChanged: afterState.sendGateDecision !== beforeState.sendGateDecision
};
}
return { ...result, job, diff };
},
refreshImportSource(recordId) {
return this.refreshRecord(recordId);
},
detectSourceChanges() {
return this.checkUpdates();
},
getRecordStatuses() {
return getRecordStatuses(workspacePath);
},
async refreshAll({ write = false } = {}) {
const statuses = await this.getRecordStatuses();
const changed = statuses.filter(s => s.sourceChanged);
if (write) {
const results = [];
for (const record of changed) {
const res = await this.refreshRecord(record.id);
results.push(res);
}
return results;
}
return changed;
},
getInbox: fwd(getInboxItems),
archiveInbox: fwd(archiveInboxItem),
unarchiveInbox: fwd(unarchiveInboxItem),
getInboxRecommendations: fwd(getInboxRecommendations),
getTimeline: fwd(getTimelineEvents),
addMarkdownVersion: fwd(addMarkdownVersion),
listMarkdownVersions: fwd(listMarkdownVersions),
promoteMarkdownVersion: fwd(promoteMarkdownVersion),
diffMarkdownVersions: fwd(diffMarkdownVersions),
verifyExchangePackage: fwd(verifyExchangePackage),
getWorkspaceSettings: fwd(getWorkspaceSettings),
updateWorkspaceSettings: fwd(updateWorkspaceSettings),
getRealSampleSummary: fwd(getRealSampleSummary),
exportRealSampleReportMd: fwd(exportRealSampleReportMd),
writeRealSampleReportMd: fwd(writeRealSampleReportMd),
async getKnownLimits(filter = {}) {
const { getKnownLimits } = await import("./knownLimits.js");
return getKnownLimits(filter);
},
async getActionSuggestions(warnings = []) {
const { getActionSuggestions } = await import("./actionSuggestions.js");
return getActionSuggestions(warnings);
},
async generateFeedbackBundle(outDir = null, redact = true) {
const { generateFeedbackBundle } = await import("./feedback.js");
return generateFeedbackBundle(workspacePath, outDir, redact);
},
async generateReproductionScript(recordIdOrOptions, outPath = null) {
const { generateReproductionScript } = await import("./repro.js");
return generateReproductionScript(workspacePath, recordIdOrOptions, outPath);
},
async runSecuritySecretsAudit() {
const { runSecuritySecretsAudit } = await import("./secretsAudit.js");
return runSecuritySecretsAudit(workspacePath);
},
async compileWorkspaceManifest() {
const { compileWorkspaceManifest } = await import("./workspaceManifest.js");
return compileWorkspaceManifest(workspacePath);
},
compileAiContextPreview: fwd(compileAiContextPreview),
compileAiIntakeManifest: fwd(compileAiIntakeManifest),
compileAiFeedRunbook: fwd(compileAiFeedRunbook),
readAiFeedRunbook: fwd(readAiFeedRunbook),
updateAiFeedRunbookBatch: fwd(updateAiFeedRunbookBatch),
resolveAiContextChunk: fwd(resolveAiContextChunk),
resolveAiContextChunkRange: fwd(resolveAiContextChunkRange),
async prepareRecordForAi(recordId) {
const manifest = await readManifest(workspacePath);
const { document, dataset } = findRecord(manifest, recordId);
let preparationJob = null;
let kind = "";
if (document) {
kind = "document";
if (document.status !== "ready" || !document.outputMarkdownPath) {
preparationJob = await convertDocumentToMarkdownAsJob(
workspacePath,
recordId,
documentConverterForType(document.sourceType)
);
}
} else if (dataset) {
kind = "dataset";
if (dataset.status !== "ready" || !dataset.sheets?.length) {
preparationJob = await inspectDatasetAsJob(
workspacePath,
recordId,
datasetImporterForType(dataset.sourceType)
);
}
} else {
throw new AppError("record_not_found", `Record not found: ${recordId}`, { recordId });
}
const preview = await compileAiContextPreview(workspacePath, recordId);
return {
recordId,
kind,
prepared: true,
preparationJob,
preview
};
}
};
}
async function scanFolderRecursive(dir, rootDir, filesList = [], skippedList = []) {
const fs = await import("node:fs/promises");
const path = await import("node:path");
for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
const full = path.resolve(dir, entry.name);
if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
if (entry.isDirectory()) await scanFolderRecursive(full, rootDir, filesList, skippedList);
else if (entry.isFile()) {
const ext = path.extname(entry.name).toLowerCase().slice(1);
const rel = path.relative(rootDir, full).replace(/\\/g, "/");
if (["docx", "pptx", "pdf", "md", "txt", "xlsx", "csv"].includes(ext)) filesList.push({ absolutePath: full, relativePath: rel, ext });
else skippedList.push({ absolutePath: full, relativePath: rel, ext, reason: "unsupported format" });
}
}
return { filesList, skippedList };
}
function sanitizedPathSegment(value) {
const masked = maskSensitiveData(String(value ?? "")).maskedText;
return masked
.replace(/\[MASK_([A-Z]+)_(\d+)\]/g, "MASK-$1-$2")
.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]+/g, "-")
.replace(/^-+|-+$/g, "") || "sanitized";
}
function sanitizedRelativeFilePath(relativePath) {
const normalized = String(relativePath ?? "").replace(/\\/g, "/");
const parsed = path.posix.parse(normalized);
const safeDir = parsed.dir
? parsed.dir.split("/").filter(Boolean).map(sanitizedPathSegment).join("/")
: "";
const safeName = `${sanitizedPathSegment(parsed.name)}-AI-safe.md`;
return safeDir ? `${safeDir}/${safeName}` : safeName;
}
function sanitizationSourceRef(relativePath) {
return `sha256:${createHash("sha256").update(String(relativePath ?? ""), "utf8").digest("hex")}`;
}
export async function sanitizeFolderForAi(sourceFolderPath, options = {}) {
const fs = await import("node:fs/promises");
const dns = await import("node:fs");
const path = await import("node:path");
const os = await import("node:os");
const absoluteSource = path.resolve(sourceFolderPath);
if (!dns.existsSync(absoluteSource)) {
throw new Error(`Source folder path does not exist: ${sourceFolderPath}`);
}
const stat = await fs.lstat(absoluteSource);
if (!stat.isDirectory()) {
throw new Error(`Source path is not a directory: ${sourceFolderPath}`);
}
const outputFolder = options.outputFolderPath
? path.resolve(options.outputFolderPath)
: path.resolve(absoluteSource + "-sanitized-for-ai");
await fs.mkdir(outputFolder, { recursive: true });
const { filesList, skippedList } = await scanFolderRecursive(absoluteSource, absoluteSource);
const tempWorkspace = path.join(os.tmpdir(), `lft-folder-sanitize-${Date.now()}`);
await openOrCreateWorkspace(tempWorkspace);
const appService = createAppService(tempWorkspace);
const items = [];
let processedCount = 0;
let skippedCount = skippedList.length;
for (const skip of skippedList) {
items.push({
originalPath: skip.absolutePath,
relativePath: skip.relativePath,
type: skip.ext,
status: "skipped",
reason: skip.reason
});
}
for (const file of filesList) {
try {
const record = await importFileToWorkspace(tempWorkspace, file.absolutePath);
const tempOutRelative = `temp-exports/${record.id}.md`;
await appService.exportRecordToMarkdown(record.id, tempOutRelative);
const tempOutAbs = path.join(tempWorkspace, tempOutRelative);
const markdownContent = await fs.readFile(tempOutAbs, "utf8");
const { maskedText, mapping } = maskSensitiveData(markdownContent);
const maskedCount = Object.keys(mapping).length;
const outputRelPath = sanitizedRelativeFilePath(file.relativePath);
const outputAbsPath = path.join(outputFolder, ...outputRelPath.split("/"));
await fs.mkdir(path.dirname(outputAbsPath), { recursive: true });
await fs.writeFile(outputAbsPath, maskedText, "utf8");
processedCount++;
items.push({
originalPath: file.absolutePath,
relativePath: file.relativePath,
outputRelativePath: outputRelPath,
type: file.ext,
status: "succeeded",
maskedCount
});
} catch (err) {
items.push({
originalPath: file.absolutePath,
relativePath: file.relativePath,
type: file.ext,
status: "failed",
error: err.message
});
}
}
const sanitizedItems = items.map(it => ({
sourceRef: sanitizationSourceRef(it.relativePath),
inputLabel: sanitizedPathSegment(path.posix.parse(String(it.relativePath ?? "").replace(/\\/g, "/")).base),
outputRelativePath: it.outputRelativePath,
type: it.type,
status: it.status,
maskedCount: it.maskedCount,
reason: it.reason ? maskSensitiveData(String(it.reason)).maskedText : undefined,
error: it.error ? maskSensitiveData(String(it.error)).maskedText : undefined
}));
const reportJson = {
processedCount,
skippedCount,
items: sanitizedItems
};
const reportJsonPath = path.join(outputFolder, "sanitization-report.json");
await fs.writeFile(reportJsonPath, JSON.stringify(reportJson, null, 2), "utf8");
const mdRows = sanitizedItems.map(it => {
const statusText = it.status === "succeeded" ? "Succeeded" : it.status === "skipped" ? "Skipped" : "Failed";
const details = it.status === "succeeded"
? `Redacted: ${it.maskedCount} items | Saved to: ${it.outputRelativePath}`
: it.status === "skipped" ? `Reason: ${it.reason}` : `Error: ${it.error}`;
return `| ${it.sourceRef} | ${it.inputLabel} | ${it.type.toUpperCase()} | ${statusText} | ${details} |`;
});
const reportMd = `# Folder Sanitization Report\n\n- **Source Folder**: omitted from the portable report\n- **Sanitized Output Folder**: \`.\`\n- **Files Processed Successfully**: ${processedCount}\n- **Files Skipped/Failed**: ${items.length - processedCount}\n\n## Detailed Audit Log\n\n| Source Reference | Sanitized Label | Format | Status | Details |\n| :--- | :--- | :--- | :--- | :--- |\n` + mdRows.join("\n") + "\n\n> [!NOTE]\n> Content, output names, and portable audit metadata have been redacted. Original local paths are intentionally omitted.";
const reportMdPath = path.join(outputFolder, "sanitization-report.md");
await fs.writeFile(reportMdPath, reportMd, "utf8");
try {
await fs.rm(tempWorkspace, { recursive: true, force: true });
} catch {}
return {
ok: true,
processedCount,
skippedCount,
outputFolderPath: outputFolder,
reportPath: reportMdPath,
items
};
}
