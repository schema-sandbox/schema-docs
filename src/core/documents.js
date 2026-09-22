import path from "node:path";
import { mkdir, readdir, rm, writeFile, readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readManifest, writeManifest } from "./manifest.js";
import { AppError } from "./errors.js";
import { createId } from "./ids.js";
import { pdfBodyText, runPdfExtractionPipeline } from "../adapters/pdfExtractorPipeline.js";
import { buildPdfDocumentIr } from "../adapters/pdfDocumentIr.js";
import { buildDocumentIr } from "../adapters/documentIr.js";
import { writeDocumentIr } from "./documentIrStore.js";
import { prepareSafeWritePath } from "./pathGuard.js";
export function calculateTextMetrics(markdown) {
const charsExtracted = markdown.length;
const replacementCharCount = (markdown.match(/\ufffd/g) || []).length;
const nonPrintableCount = (markdown.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g) || []).length;
const cjkCount = (markdown.match(/[\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
const asciiCount = (markdown.match(/[\x00-\x7F]/g) || []).length;
return {
charsExtracted,
replacementCharCount,
nonPrintableRatio: charsExtracted === 0 ? 0 : nonPrintableCount / charsExtracted,
cjkRatio: charsExtracted === 0 ? 0 : cjkCount / charsExtracted,
asciiRatio: charsExtracted === 0 ? 0 : asciiCount / charsExtracted
};
}
function documentOutputBaseName(document) {
return safeFileName(document.title || path.parse(path.basename(document.sourcePath || "document")).name);
}
function extractionRevisionId({ sourceHash, converter, extractorName, markdown, pageLedger, visualMap, options }) {
 const identity = JSON.stringify({
  sourceHash,
  converter: converter?.name || "",
  converterVersion: String(converter?.cacheVersion || "1"),
  extractorName: extractorName || "",
  options: options || {},
  sourcePageCount: pageLedger?.sourcePageCount ?? null,
  visualSummary: visualMap?.summary || null,
  markdown
 });
 return `extract-${computeBufferHash(Buffer.from(identity, "utf8")).slice(0, 24)}`;
}
export async function writePdfDiagnostics(workspacePath, recordId, data) {
const dir = path.join(workspacePath, "outputs", "diagnostics");
await mkdir(dir, { recursive: true });
const diagnosticsPath = path.join(dir, `${recordId}.pdf-diagnostics.json`);
await writeFile(diagnosticsPath, JSON.stringify(data, null, 2), "utf8");
return diagnosticsPath;
}
async function writePdfVisualMap(outputRoot, baseName, sourcePath, result) {
const dir = path.join(outputRoot, "assets", `${baseName}.pdf`);
await mkdir(dir, { recursive: true });
const semanticLoss = result.stats?.semanticLoss || {};
const visualMap = result.visualMap || {
schema: "schema-docs.pdf-visual-map.v1",
sourceFile: path.basename(sourcePath),
pageCount: null,
pagesAnalyzed: 0,
status: "visual_adapter_required",
summary: {
formulaRegions: null,
imageRegions: null,
tableRegions: null,
formulaEncodingArtifacts: semanticLoss.octalArtifacts || 0,
cidArtifacts: semanticLoss.cidArtifacts || 0
},
pages: []
};
visualMap.status = result.visualMap ? "mapped" : "visual_adapter_required";
visualMap.sourceFile = path.basename(sourcePath);
const jsonPath = path.join(dir, "visual-map.json");
await writeFile(jsonPath, JSON.stringify(visualMap, null, 2), "utf8");
const referencedAssets = new Set(
(visualMap.pages || []).flatMap((pageEntry) => (pageEntry.regions || []).map((region) => region.assetFile).filter(Boolean))
);
for (const entry of await readdir(dir, { withFileTypes: true })) {
if (entry.isFile() && /^page-\d+-(?:figure|formula|table)-\d+(?:-[a-f0-9]{8})?\.png$/i.test(entry.name) && !referencedAssets.has(entry.name)) {
await rm(path.join(dir, entry.name), { force: true });
}
}
const summary = visualMap.summary || {};
const indexLines = [
`# PDF visual content map`,
"",
`- Source: ${path.basename(sourcePath)}`,
`- Status: ${visualMap.status}`,
`- Pages: ${visualMap.pageCount ?? "unknown"}`,
`- Formula regions: ${summary.formulaRegions ?? "not mapped"}`,
`- Table regions: ${summary.tableRegions ?? "not mapped"}`,
`- Image regions: ${summary.imageRegions ?? "not mapped"}`,
`- Formula encoding artifacts: ${summary.formulaEncodingArtifacts ?? semanticLoss.octalArtifacts ?? 0}`,
""
];
if (visualMap.status !== "mapped") {
indexLines.push("> Body text was preserved, but formulas, tables, and images require the optional layout-aware PDF adapter before they can be mapped or rendered.", "");
} else {
indexLines.push("> Regions remain linked to the original PDF page and bounding box. Low-confidence formulas should use visual fallback instead of guessed text.", "", "## Pages with visual regions", "");
for (const pageEntry of (visualMap.pages || []).slice(0, 1000)) {
const counts = (pageEntry.regions || []).reduce((acc, region) => {
acc[region.type] = (acc[region.type] || 0) + 1;
return acc;
}, {});
indexLines.push(`- Page ${pageEntry.page}: ${counts.formula || 0} formulas, ${counts.table || 0} tables, ${counts.image || 0} images`);
}
if ((visualMap.pages || []).length > 1000) indexLines.push(`- ${(visualMap.pages || []).length - 1000} additional mapped pages are recorded in visual-map.json.`);
}
const indexPath = path.join(dir, "visual-assets.md");
await writeFile(indexPath, indexLines.join("\n").trimEnd() + "\n", "utf8");
return { visualMapPath: jsonPath, visualAssetsIndexPath: indexPath, summary: visualMap.summary, status: visualMap.status };
}

export function attachPdfImagesToMarkdown(markdown, baseName, readable = false) {
const root = readable ? "../assets" : "assets";
const attached = String(markdown || "").replace(
/<!-- pdf-(image|formula|table): page=(\d+) index=(\d+) file=([^\s>]+)(?: mode=(inline|block))? -->/g,
(_match, kind, pageNumber, _index, fileName, formulaMode) => {
const relativePath = `${root}/${baseName}.pdf/${fileName}`.split("\\").join("/");
const label = kind === "formula"
  ? (formulaMode === "inline" ? "Inline formula" : "Formula")
  : (kind === "table" ? "Table" : "Figure");
return `![${label} preserved from PDF page ${pageNumber}](<${relativePath}>)`;
}
);
const blockImages = normalizeGeneratedPdfInlineImageLines(attached).replace(
/!\[(?:Formula|Figure|Table) preserved from PDF page \d+\]\(<[^>\n]+>\)/g,
(match, offset, source) => {
const before = offset > 0 ? source[offset - 1] : "";
const after = source[offset + match.length] || "";
const prefix = before && !/[\r\n]/.test(before) ? "\n\n" : "";
const suffix = after && !/[\r\n]/.test(after) ? "\n\n" : "";
return `${prefix}${match}${suffix}`;
}
);
return blockImages.replace(/^[ \t]+$/gm, "").replace(
/^[ \t]+(!\[(?:Formula|Figure|Table) preserved from PDF page \d+\]\(<[^>]+>\))[ \t]*$/gm,
"$1"
);
}
const execFileAsync = promisify(execFile);
async function checkCommand(cmd, args = ["--version"]) {
try {
const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 3000 });
const versionStr = stdout.trim() || stderr.trim() || "unknown";
return { available: true, version: versionStr.split("\n")[0] || "unknown" };
} catch (err) {
if (err.code !== "ENOENT" && err.code !== 127) return { available: true, version: "present" };
return { available: false, version: null };
}
}
import { runJob } from "./jobs.js";
import { safeFileName, computeBufferHash } from "./records.js";
import { createQualityReport } from "./qualityReport.js";
import { reflowPdfTables } from "../processing/tableStructure.js";
import { appendTimelineEvent } from "./timeline.js";
import { addMarkdownVersion } from "./versions.js";
import { appendConversionAudit } from "./conversionAudits.js";
import { appendEvidenceRecord, hashFile } from "./evidence.js";
import {
createReadableMarkdown,
reflowPdfParagraphs,
createReadableMarkdownSegmentIndex,
normalizeGeneratedPdfInlineImageLines,
readableMarkdownStats,
splitReadableMarkdown
} from "./readableMarkdown.js";
export function findDocument(manifest, documentId) {
return manifest.documents.find((document) => document.id === documentId);
}
function markdownExtractionCapability(sourceType) {
if (sourceType === "md") return { mode: "direct", quality: "copy", limits: [] };
if (sourceType === "pdf") return { mode: "direct", quality: "basic-text-layer", limits: ["ocr", "layout", "tables"] };
if (sourceType === "docx") return { mode: "direct", quality: "basic", limits: ["styles", "annotations", "revisions"] };
return { mode: "direct", quality: "basic", limits: ["layout"] };
}
function requestedPdfExtractorSucceeded(result, preferredExtractor) {
const preferred = String(preferredExtractor || "").trim().toLowerCase();
if (!preferred || preferred === "auto" || preferred === "built-in") return true;
const expectedExtractor = preferred === "ocr" ? "tesseract-ocr" : preferred;
return result?.extractorName === expectedExtractor
&& result?.textLayerDetected !== false
&& result?.lowReadableText !== true;
}
async function reusableMarkdownExtraction(document, converter) {
const converterVersion = String(converter.cacheVersion || "1");
if (
document.status !== "ready"
|| !document.outputMarkdownPath
|| !document.readableMarkdownPath
|| !document.lastExtractedHash
|| document.extractionConverterName !== converter.name
|| document.extractionConverterVersion !== converterVersion
|| document.extractionQuality?.lowReadableText
|| (document.sourceType === "pdf" && (document.extractionQuality?.partial
  || document.extractionQuality?.pendingOcrPages > 0 || document.extractionQuality?.unresolvedPages > 0
  || document.extractionQuality?.reviewPages > 0 || document.extractionQuality?.ocrReviewRegions > 0
  || document.extractionQuality?.validation?.passed === false))
|| (document.sourceType === "pdf" && document.extractionQuality?.textLayerDetected === false)
|| document.quality?.hasOcrMissing
|| (document.warnings && document.warnings.some((w) => w.includes("Low-readable")))
) {
return null;
}
try {
const [markdown, readableMarkdown, currentSourceHash] = await Promise.all([
readFile(document.outputMarkdownPath, "utf8"),
readFile(document.readableMarkdownPath, "utf8"),
hashFile(document.sourcePath)
]);
const markdownHash = computeBufferHash(Buffer.from(markdown, "utf8"));
const readableMarkdownHash = computeBufferHash(Buffer.from(readableMarkdown, "utf8"));
const expectedSourceHash = document.sourceHash ? `sha256:${document.sourceHash}` : "";
if (
(document.sourceType !== "pdf" || Boolean(pdfBodyText(markdown)))
&& markdownHash === document.lastExtractedHash
&& (!document.lastReadableExtractedHash || readableMarkdownHash === document.lastReadableExtractedHash)
&& (!expectedSourceHash || currentSourceHash === expectedSourceHash)
) {
return {
documentId: document.id,
conversionMode: "cache",
outputMarkdownPath: document.outputMarkdownPath,
warnings: document.warnings ?? [],
qualityReportId: document.qualityReportId ?? "",
markdownOutputs: document.markdownOutputs,
readableMarkdownPath: document.readableMarkdownPath,
evidenceId: "",
auditId: "",
cached: true
};
}
} catch {
return null;
}
return null;
}
function toWorkspaceRelative(workspacePath, absolutePath) {
return path.relative(workspacePath, absolutePath).split(path.sep).join("/");
}
async function writeReadableMarkdownSegments({
workspacePath,
readablePath,
aiReadyPath,
markdown,
baseFileName,
sourceType,
sourceName,
recordId
}) {
const split = splitReadableMarkdown(markdown);
if (!split.segmented) return {
segmented: false,
segmentCount: 0,
indexPath: "",
indexRelativePath: "",
segments: []
};
const directory = path.dirname(readablePath);
await mkdir(directory, { recursive: true });
const segments = [];
for (const segment of split.segments) {
const segmentPath = path.join(directory, `${baseFileName}_${segment.index}.md`);
await writeFile(segmentPath, segment.markdown, "utf8");
segments.push({
index: segment.index,
title: segment.title,
startLine: segment.startLine,
endLine: segment.endLine,
headingCount: segment.headingCount,
characters: segment.characters,
path: segmentPath,
relativePath: toWorkspaceRelative(workspacePath, segmentPath)
});
}
const indexPath = path.join(directory, `${baseFileName}.index.md`);
const indexMarkdown = createReadableMarkdownSegmentIndex({
title: path.parse(sourceName || baseFileName).name,
sourceName,
sourceType,
baseFileName,
segments
});
await writeFile(indexPath, indexMarkdown, "utf8");
const sourceMapPath = path.join(directory, `${baseFileName}.source-map.json`);
const sourceMap = {
schema: "schema-docs.readable-segment-map.v1",
recordId: recordId || "",
sourceName: sourceName || "source",
sourceType: sourceType || "document",
readablePath,
readableRelativePath: toWorkspaceRelative(workspacePath, readablePath),
aiReadyPath: aiReadyPath || "",
aiReadyRelativePath: aiReadyPath ? toWorkspaceRelative(workspacePath, aiReadyPath) : "",
indexPath,
indexRelativePath: toWorkspaceRelative(workspacePath, indexPath),
segmentCount: segments.length,
maxCharacters: split.maxCharacters,
createdAt: new Date().toISOString(),
segments: segments.map((segment) => ({
index: segment.index,
title: segment.title,
startLine: segment.startLine,
endLine: segment.endLine,
headingCount: segment.headingCount,
characters: segment.characters,
relativePath: segment.relativePath
}))
};
await writeFile(sourceMapPath, JSON.stringify(sourceMap, null, 2), "utf8");
return {
segmented: true,
segmentCount: segments.length,
indexPath,
indexRelativePath: toWorkspaceRelative(workspacePath, indexPath),
sourceMapPath,
sourceMapRelativePath: toWorkspaceRelative(workspacePath, sourceMapPath),
segments
};
}
function createLowReadableMarkdownNotice({ sourceType, sourceName, warnings, attempts, detectedEncoding }) {
if (sourceType === "txt") {
return `# Text file needs another encoding path\n\n> **Status**: This TXT file could not be converted into reliable human-readable Markdown. AI-ready raw extraction is preserved, but the human reading view is blocked because the decoded text appears unreadable.\n\nSource file: ${sourceName || "document.txt"}\n\n## Likely causes\n- The TXT file uses an unsupported or unusual character encoding.\n- The file extension is .txt, but the content is actually binary, compressed, or otherwise not plain text.\n- The text was already corrupted before import.\n\n## What Schema Docs tried\n- Encoding detection: ${detectedEncoding || "auto"}\n\n## What you can do\n- Re-save the file as UTF-8 text from a trusted editor, then re-import.\n- If this is a Chinese Windows TXT, try opening it in a text editor and saving explicitly as UTF-8.\n- If the file is compressed or an ebook/export package, extract or export the real text file first.\n\n## Warnings\n${(warnings || []).map(w => `- ${w}`).join("\n") || "- Text decoding confidence is low."}\n`;
}
const tried = (attempts || []).map(a => `- ${a.name}: ${a.status}`).join("\n");
return `# PDF extraction needs another path\n\n> **Status**: This PDF could not be converted into human-readable Markdown. AI-ready raw extraction is preserved, but the human reading view is blocked because the extracted text is low readability.\n\nSource file: ${sourceName || "document.pdf"}\n\n## Likely causes\n- The PDF may be image-only or scanned, with no searchable text layer.\n- The PDF may have a broken or missing Unicode/CMap font mapping. This is common in some Chinese PDFs: the page looks correct in a reader, but text extraction returns encoded glyph data.\n\n## What Schema Docs tried\n${tried || "- None"}\n\n## What you can do\n- Run OCR externally with Adobe Acrobat Pro, ABBYY FineReader, or another OCR tool, then re-import a searchable PDF or DOCX.\n- Install Poppler (\`pdftotext\`) or MuPDF (\`mutool\`) and retry extraction if the PDF has a recoverable text layer.\n- Continue with AI Send Gate warning only if you intentionally want to inspect the preserved raw extraction.\n\n## Warnings\n${(warnings || []).map(w => `- ${w}`).join("\n") || "- Recommended using OCR."}\n`;
}
function hasHighMojibakeRatio(markdown) {
const text = String(markdown ?? "");
const printable = text.replace(/\s/g, "");
if (printable.length < 80) return false;
const replacementCount = (printable.match(/\ufffd/g) || []).length;
return replacementCount >= 20 && replacementCount / printable.length > 0.04;
}
export async function convertDocumentToMarkdown(workspacePath, documentId, converter, options = {}) {
const manifest = await readManifest(workspacePath);
const document = findDocument(manifest, documentId);
if (!document) throw new AppError("document_not_found", `Document not found: ${documentId}`, {
documentId
});
if (!converter.canHandle(document)) {
throw new AppError("document_converter_mismatch", "Converter cannot handl...", {
documentId,
converter: converter.name
});
}
if (document.sourceType === "md") {
const markdown = await readFile(document.sourcePath, "utf8");
const warnings = [];
const now = new Date().toISOString();
const finalWritePath = document.sourcePath;
const relativeOutput = toWorkspaceRelative(workspacePath, finalWritePath);
const quality = {
hasTextLayer: true,
hasTablesSimplified: false,
hasOcrMissing: false,
confidence: "high"
};
document.status = "ready";
document.updatedAt = now;
document.lastExtractedAt = now;
document.outputMarkdownPath = finalWritePath;
document.readableMarkdownPath = finalWritePath;
document.lastExtractedHash = computeBufferHash(Buffer.from(markdown, "utf8"));
document.lastReadableExtractedHash = document.lastExtractedHash;
document.refreshedMarkdownPath = undefined;
document.refreshedReadableMarkdownPath = undefined;
document.lastRefreshedExtractedHash = undefined;
document.quality = quality;
document.extractorName = "native-markdown-open";
document.extractionConverterName = converter.name;
document.extractionConverterVersion = String(converter.cacheVersion || "1");
document.extractorFallbacksTried = [];
document.extractionQuality = {
textLayerDetected: true,
scannedLikely: false,
tableSimplified: false,
layoutSimplified: false,
possibleMojibake: false,
lowReadableText: false,
unsupportedFeatures: [],
confidence: "high",
readabilityState: "native_markdown",
qualityState: "clean_readable"
};
const qualityReport = await createQualityReport(
workspacePath,
document.id,
document.sourcePath,
document.sourceType,
finalWritePath,
markdown,
document.extractionQuality,
warnings
);
document.qualityReportId = qualityReport.id;
document.quality.qualityState = qualityReport.qualityState;
document.extractionQuality.qualityState = qualityReport.qualityState;
document.warnings = warnings;
document.markdownOutputs = {
aiReady: finalWritePath,
readable: finalWritePath,
defaultForHumans: finalWritePath,
defaultForAi: finalWritePath,
readableStats: readableMarkdownStats(markdown),
readableSegments: {
segmented: false,
segmentCount: 0,
indexPath: "",
indexRelativePath: "",
segments: []
}
};
manifest.markdownVersions = manifest.markdownVersions || [];
const ver = await addMarkdownVersion(workspacePath, relativeOutput, "native_markdown_open", documentId, markdown);
manifest.markdownVersions.push(ver);
await writeManifest(workspacePath, manifest);
const evidence = await appendEvidenceRecord(workspacePath, {
kind: "document_extraction",
sourceRef: document.id,
inputFileHash: await hashFile(document.sourcePath),
inputFileType: document.sourceType,
outputArtifactHash: await hashFile(finalWritePath),
outputType: "md",
converter: "native-markdown-open",
aiSent: false,
policyDecision: "local_only",
userConfirmed: false
});
const audit = await appendConversionAudit(workspacePath, {
documentId: document.id,
sourceType: document.sourceType,
targetFormat: "md",
mode: "direct",
quality: "native-markdown",
sourcePath: document.sourcePath,
intermediateMarkdownPath: finalWritePath,
outputPath: finalWritePath,
warnings,
limits: [],
evidenceId: evidence.id,
qualityReportId: qualityReport.id
});
await appendTimelineEvent(workspacePath, document.id, "open", `Opened native Markdown "${document.title}"`, {
evidenceId: evidence.id,
auditId: audit.id,
artifactPath: finalWritePath,
artifactHash: evidence.outputArtifactHash
});
return {
document,
warnings,
qualityReport,
evidenceId: evidence.id,
auditId: audit.id
};
}
const baseName = documentOutputBaseName(document);
const originalDocument = structuredClone(document);
const revisionSourceHash = await hashFile(document.sourcePath);
const revision = createId("conversion");
const outputRoot = path.join(workspacePath, "outputs", "revisions", document.id, revision);
if (!/^[A-Za-z0-9_-]+$/.test(document.id)) throw new AppError("document_revision_invalid", "Invalid document storage identity.");
await prepareSafeWritePath(path.join(outputRoot, "revision.json"), workspacePath, [".json"]);
await mkdir(outputRoot, { recursive: true });
let result;
if (document.sourceType === "pdf" && converter.name === "pdf-text-layer-converter") {
let progressQueue = Promise.resolve();
let lastProgress = 40;
result = await runPdfExtractionPipeline(document.sourcePath, {
converter,
  preferredExtractor: options.preferredExtractor,
  pythonPath: options.pythonPath,
  layoutStartPage: options.layoutStartPage,
layoutMaxPages: options.layoutMaxPages,
pageWindowSize: options.pageWindowSize,
layoutTimeoutMs: options.layoutTimeoutMs,
ocrTimeoutMs: options.ocrTimeoutMs,
ocrPageTimeoutMs: options.ocrPageTimeoutMs,
ocrRegionTimeoutMs: options.ocrRegionTimeoutMs,
maxResidentBytes: options.maxResidentBytes,
maxWorkerResidentBytes: options.maxWorkerResidentBytes,
maxTemporaryBytes: options.maxTemporaryBytes,
layoutCacheDir: options.checkpoint === false ? undefined : path.join(workspacePath, ".ai-doc-exchange", "cache", "pdf-layout", document.id),
ocrCacheDir: options.checkpoint === false ? undefined : path.join(workspacePath, ".ai-doc-exchange", "cache", "pdf-ocr", document.id),
allowLargePageWindow: options.allowLargePageWindow ?? (options.maxInputBytes === undefined && converter.preferPageBackend === true),
onLayoutPage: async (page) => {
 await options.assertNotCancelled?.();
 await options.updateCheckpointPage?.({
  ...page,
  status: page.requiresOcr ? "partial" : (page.artifactPath ? "completed" : "failed"),
  qualityStatus: page.requiresOcr ? "ocr_required" : "native_text"
 });
 await options.update?.({ progress: Math.min(85, 30 + Math.round(55 * page.pageNumber / page.pageCount)),
  message: `PDF page ${page.pageNumber} of ${page.pageCount}${page.reused ? " (verified cache)" : ""}` });
},
markerOutputDir: path.join(outputRoot, "assets", `${document.id}-marker`),
markerMarkdownBaseDir: outputRoot,
markerForceOcr: options.markerForceOcr,
ocrLanguages: options.ocrLanguages,
maxDecompressedBytes: options.maxDecompressedBytes,
maxInputBytes: options.maxInputBytes,
assertNotCancelled: options.assertNotCancelled,
layoutAssetDir: path.join(outputRoot, "assets", `${baseName}.pdf`),
onProgress: (msg, percent) => {
if (options && typeof options.update === "function") {
if (Number.isFinite(percent)) lastProgress = percent;
progressQueue = progressQueue.then(() =>
options.update({ progress: lastProgress, message: msg }).catch(() => {})
);
}
const ocrPage = String(msg || "").match(/^OCR page (\d+) of /i);
if (ocrPage && typeof options.updateCheckpointPage === "function") {
 progressQueue = progressQueue.then(() => options.updateCheckpointPage({ pageNumber: Number(ocrPage[1]), status: "processing", qualityStatus: "ocr_processing" }).catch(() => {}));
}
const ocrFailedPage = String(msg || "").match(/^OCR failed page (\d+) of /i);
if (ocrFailedPage && typeof options.updateCheckpointPage === "function") {
 progressQueue = progressQueue.then(() => options.updateCheckpointPage({
  pageNumber: Number(ocrFailedPage[1]),
  status: "failed",
  error: "OCR failed for source page"
 }).catch(() => {}));
}
}
});
await progressQueue;
} else {
result = await converter.convert({
sourcePath: document.sourcePath,
sourceName: `${baseName}.${document.sourceType}`,
assetDir: path.join(outputRoot, "assets", `${baseName}.${document.sourceType}`),
assetRelativeBase: `assets/${baseName}.${document.sourceType}`,
assertNotCancelled: options.assertNotCancelled
});
}
// Conversion output is still a candidate until all cancellation checks pass.
// This check is deliberately inside the document writer so a converter that
// observes cancellation before returning cannot commit a replacement.
await options.assertNotCancelled?.();
const outputName = `${baseName}.md`;
const outputPath = path.join(outputRoot, outputName);
const versionHistoryPath = document.markdownVersionPath || path.relative(workspacePath, document.outputMarkdownPath || outputPath).split(path.sep).join("/");
document.markdownVersionPath = versionHistoryPath;
const readablePath = path.join(outputRoot, "readable", `${baseName}.readable.md`);
const readableSegmentBaseName = `${baseName}.readable`;
const existingContent = document.outputMarkdownPath ? await readFile(document.outputMarkdownPath, "utf8").catch(() => "") : "";
if (options.force === true
&& options.preferredExtractor
&& (typeof result.markdown !== "string" || (document.sourceType === "pdf"
? !pdfBodyText(result.markdown) || result.textLayerDetected === false
: !result.markdown.trim()))) {
throw new AppError(
"document_extraction_empty",
"The requested extractor did not produce usable Markdown. The previous extraction was kept unchanged.",
{ documentId, preferredExtractor: options.preferredExtractor }
);
}
if (options.force === true
&& document.sourceType === "pdf"
&& pdfBodyText(existingContent)
&& !requestedPdfExtractorSucceeded(result, options.preferredExtractor)) {
throw new AppError(
"document_extraction_fallback_preserved",
`The requested ${options.preferredExtractor} extractor did not produce usable Markdown. The previous extraction was kept unchanged.`,
{
documentId,
  preferredExtractor: options.preferredExtractor,
previousExtractor: document.extractorName || "",
fallbackExtractor: result.extractorName || ""
}
);
}
let userEdited = false;
if (existingContent && document.lastExtractedHash) {
const existingHash = computeBufferHash(Buffer.from(existingContent, "utf8"));
if (existingHash !== document.lastExtractedHash) {
userEdited = true;
}
}
const currentVersionSnapshot = userEdited ? {
 quality: structuredClone(document.quality || {}),
 extractionQuality: structuredClone(document.extractionQuality || {}),
 qualityReportId: document.qualityReportId || "",
 warnings: Array.isArray(document.warnings) ? [...document.warnings] : [],
 markdownOutputs: document.markdownOutputs ? structuredClone(document.markdownOutputs) : null,
 extractorName: document.extractorName || "",
 extractionConverterName: document.extractionConverterName || "",
 extractionConverterVersion: document.extractionConverterVersion || "",
 pdfVisualMapPath: document.pdfVisualMapPath || "",
 pdfVisualAssetsIndexPath: document.pdfVisualAssetsIndexPath || "",
 pdfRichAssetsPath: document.pdfRichAssetsPath || "",
 pdfDiagnosticsPath: document.pdfDiagnosticsPath || ""
} : null;
let readabilityState = "readable";
if (document.sourceType === "pdf") {
 const textLayerDetected = result.textLayerDetected !== undefined
  ? result.textLayerDetected
  : (result.extractionQuality?.textLayerDetected ?? result.quality?.hasTextLayer ?? true);
 const lowReadableText = result.lowReadableText !== undefined
  ? result.lowReadableText
  : (result.extractionQuality?.lowReadableText ?? result.quality?.hasOcrMissing ?? false);

 if (!textLayerDetected) {
  readabilityState = "ocr_required";
 } else if (lowReadableText) {
  const [pdftotextDet, mutoolDet] = await Promise.all([
   checkCommand("pdftotext", ["-v"]),
   checkCommand("mutool", [])
  ]);
  const fallbackCommandsAvailable = pdftotextDet.available || mutoolDet.available;
  const fallbacksTried = result.stats?.fallbacksTried || [];
  const hasTriedFallbacks = fallbacksTried.includes("pdftotext") || fallbacksTried.includes("mutool");
  if (fallbackCommandsAvailable && !hasTriedFallbacks) {
   readabilityState = "low_readable_retry_available";
  } else {
   readabilityState = "low_readable_all_extractors_failed";
  }
 }
 if (readabilityState === "readable" && result.stats?.semanticLoss?.formulaDamageLikely) {
  readabilityState = "formula_reconstruction_required";
 }
} else if (result.extractionQuality?.lowReadableText || result.quality?.hasOcrMissing || (document.sourceType === "txt" && hasHighMojibakeRatio(result.markdown))) {
 readabilityState = "low_readable_all_extractors_failed";
}
const warnings = result.warnings ?? [];
let pdfVisualArtifacts = null;
if (document.sourceType === "pdf") {
 await options.assertNotCancelled?.();
 try {
pdfVisualArtifacts = await writePdfVisualMap(outputRoot, baseName, document.sourcePath, result);
result.markdown = attachPdfImagesToMarkdown(result.markdown, baseName, false);
} catch (error) {
throw new AppError("document_revision_failed", `PDF visual content could not be stored: ${error.message}`);
}
}
if (document.sourceType === "txt" && hasHighMojibakeRatio(result.markdown) && !warnings.some((warning) => warning.includes("replacement characters"))) {
warnings.push("Decoded TXT output contains too many replacement characters. The human reading view was blocked to avoid showing corrupted text.");
}
let finalWritePath = outputPath;
let finalReadablePath = readablePath;
let readableSegmentOutput = null;
const lowReadable = readabilityState === "ocr_required" || readabilityState.startsWith("low_readable_");
const extractorName = result.extractorName || (document.sourceType === "pdf" ? "built-in" : converter.name);
const extractorFallbacksTried = result.stats?.fallbacksTried || [];
let readableMarkdown = lowReadable
? (createLowReadableMarkdownNotice({ sourceType: document.sourceType, sourceName: document.title || path.basename(document.sourcePath), warnings, attempts: result.attempts, detectedEncoding: result.extractionQuality?.detectedEncoding }) + "\n")
: createReadableMarkdown(result.markdown, {
sourceType: document.sourceType,
visualMap: result.visualMap,
sourceName: document.title || path.basename(document.sourcePath)
});
if (!lowReadable) {
readableMarkdown = readableMarkdown.replace(/\]\(<assets\//g, "](<../assets/");
}
const aiReadyContent = lowReadable
? result.markdown
: result.markdown;
await mkdir(path.dirname(readablePath), { recursive: true });
manifest.markdownVersions = manifest.markdownVersions || [];
if (userEdited) {
const refreshedName = `${documentOutputBaseName(document)}.refreshed.md`;
const refreshedReadableName = `${documentOutputBaseName(document)}.refreshed.readable.md`;
finalWritePath = path.join(outputRoot, refreshedName);
finalReadablePath = path.join(outputRoot, "readable", refreshedReadableName);
 await options.assertNotCancelled?.();
 await writeFile(finalWritePath, aiReadyContent, "utf8");
 await options.assertNotCancelled?.();
 await writeFile(finalReadablePath, readableMarkdown, "utf8");
readableSegmentOutput = await writeReadableMarkdownSegments({
workspacePath,
readablePath: finalReadablePath,
aiReadyPath: finalWritePath,
markdown: readableMarkdown,
baseFileName: `${documentOutputBaseName(document)}.refreshed.readable`,
sourceType: document.sourceType,
sourceName: document.title || path.basename(document.sourcePath),
recordId: document.id
});
document.refreshedMarkdownPath = finalWritePath;
document.refreshedReadableMarkdownPath = finalReadablePath;
document.lastRefreshedExtractedHash = computeBufferHash(Buffer.from(aiReadyContent, "utf8"));
const relativeRefreshed = path.relative(workspacePath, finalWritePath).split(path.sep).join("/");
const ver = await addMarkdownVersion(workspacePath, relativeRefreshed, "refresh_extract", documentId, result.markdown, { deferCommit: true });
manifest.markdownVersions.push(ver);
warnings.push(`Local Markdown edits were detected. To avoid overwriting your work, the latest extraction was written to ${relativeRefreshed}.`);
} else {
let backupPath = null;
const relativeOutput = versionHistoryPath;
if (existingContent && existingContent.trim() !== aiReadyContent.trim()) {
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupName = `${documentOutputBaseName(document)}.backup-${timestamp}.md`;
backupPath = path.join(outputRoot, backupName);
await writeFile(backupPath, existingContent, "utf8");
const relativeBackup = path.relative(workspacePath, backupPath).split(path.sep).join("/");
const ver = await addMarkdownVersion(workspacePath, relativeOutput, "pre_refresh_backup", documentId, existingContent, { deferCommit: true, pendingVersions: manifest.markdownVersions });
manifest.markdownVersions.push(ver);
warnings.push(`Local file changes were detected. The previous version was backed up to ${relativeBackup} and registered in version history for ${relativeOutput}.`);
}
 await options.assertNotCancelled?.();
 await writeFile(outputPath, aiReadyContent, "utf8");
 await options.assertNotCancelled?.();
 await writeFile(readablePath, readableMarkdown, "utf8");
readableSegmentOutput = await writeReadableMarkdownSegments({
workspacePath,
readablePath,
aiReadyPath: outputPath,
markdown: readableMarkdown,
baseFileName: readableSegmentBaseName,
sourceType: document.sourceType,
sourceName: document.title || path.basename(document.sourcePath),
recordId: document.id
});
document.outputMarkdownPath = outputPath;
document.readableMarkdownPath = readablePath;
document.lastExtractedHash = computeBufferHash(Buffer.from(aiReadyContent, "utf8"));
document.lastReadableExtractedHash = computeBufferHash(Buffer.from(readableMarkdown, "utf8"));
document.refreshedMarkdownPath = undefined;
document.refreshedReadableMarkdownPath = undefined;
document.lastRefreshedExtractedHash = undefined;
const ver = await addMarkdownVersion(workspacePath, relativeOutput, "initial_extract", documentId, result.markdown, { deferCommit: true, pendingVersions: manifest.markdownVersions });
manifest.markdownVersions.push(ver);
}
document.status = "ready";
document.updatedAt = new Date().toISOString();
document.lastExtractedAt = document.updatedAt;
const quality = result.quality || {
hasTextLayer: true,
hasTablesSimplified: false,
hasOcrMissing: false,
confidence: "high"
};
document.quality = quality;
document.extractorName = extractorName;
document.extractionConverterName = converter.name;
document.extractionConverterVersion = String(converter.cacheVersion || "1");
document.extractorFallbacksTried = extractorFallbacksTried;
const resolvedLowReadableText = result.lowReadableText ?? result.extractionQuality?.lowReadableText ?? false;
const resolvedTextLayerDetected = result.textLayerDetected ?? result.extractionQuality?.textLayerDetected ?? quality.hasTextLayer ?? true;
document.extractionQuality = {
textLayerDetected: resolvedTextLayerDetected,
scannedLikely: document.sourceType === "pdf" ? (resolvedLowReadableText || !resolvedTextLayerDetected) : false,
tableSimplified: result.extractionQuality?.tableSimplified ?? quality.hasTablesSimplified ?? false,
layoutSimplified: result.extractionQuality?.layoutSimplified ?? true,
possibleMojibake: result.markdown.includes("\ufffd") || resolvedLowReadableText || (result.extractionQuality?.possibleMojibake ?? false),
  lowReadableText: resolvedLowReadableText,
  partial: Boolean(result.partial),
  unsupportedFeatures: result.extractionQuality?.unsupportedFeatures || ["tables", "multi-column layouts", "images", "formulas", "annotations", "embedded_objects"],
confidence: result.extractionQuality?.confidence || (resolvedTextLayerDetected && !resolvedLowReadableText ? "medium" : "low"),
readabilityState: readabilityState,
 detectedEncoding: result.extractionQuality?.detectedEncoding
};
document.pdfVisualMapPath = pdfVisualArtifacts?.visualMapPath;
document.pdfVisualAssetsIndexPath = pdfVisualArtifacts?.visualAssetsIndexPath;
document.pdfRichAssetsPath = result.richAssetRoot || undefined;
document.extractionQuality.semanticLoss = result.stats?.semanticLoss || null;
document.extractionQuality.validation = result.validation || null;
document.extractionQuality.backendFailures = result.backendFailures || [];
document.extractionQuality.assetValidation = result.assetValidation || null;
document.extractionQuality.formulaDamageLikely = Boolean(result.stats?.semanticLoss?.formulaDamageLikely);
document.extractionQuality.formulaEncodingArtifacts = result.stats?.semanticLoss?.octalArtifacts || 0;
document.extractionQuality.cidArtifacts = result.stats?.semanticLoss?.cidArtifacts || 0;
document.extractionQuality.privateUseArtifacts = result.stats?.semanticLoss?.privateUseArtifacts || 0;
document.extractionQuality.visualFallbackRegions = result.visualMap?.summary?.visualFallbackRegions ?? result.extractionQuality?.visualFallbackRegions ?? 0;
document.extractionQuality.failedVisualRegions = result.visualMap?.summary?.failedVisualRegions ?? result.extractionQuality?.failedVisualRegions ?? 0;
document.extractionQuality.pendingOcrPages = result.visualMap?.summary?.pendingOcrPages || result.extractionQuality?.pendingOcrPages || 0;
document.extractionQuality.ocrPages = result.visualMap?.summary?.ocrPages || result.extractionQuality?.ocrPages || result.stats?.ocr?.pagesProcessed || 0;
document.extractionQuality.pageStatusCounts = result.extractionQuality?.pageStatusCounts || {};
document.extractionQuality.unresolvedPages = Number(result.extractionQuality?.unresolvedPages || 0);
document.extractionQuality.pageCount = Number(result.visualMap?.pageCount || result.pageCount || 0);
document.extractionQuality.pagesAnalyzed = Number(result.visualMap?.pagesAnalyzed || 0);
document.extractionQuality.reviewPages = Number(
  result.extractionQuality?.reviewPages
  ?? result.visualMap?.summary?.ocrReviewPages
  ?? document.extractionQuality.pageStatusCounts.ocr_review_required
  ?? 0
);
document.extractionQuality.ocrReviewRegions = Number(
  result.extractionQuality?.ocrReviewRegions
  ?? result.visualMap?.summary?.ocrReviewRegions
  ?? 0
);
document.extractionQuality.ocrReviewRegionRefs = (result.visualMap?.pages || []).flatMap((page) =>
  (page.ocrReviewRegions || []).map((region) => ({
    page: Number(page.page),
    id: region.id || "",
    bbox: Array.isArray(region.bbox) ? region.bbox : null,
    reason: region.reason || region.candidateReason || "",
    status: region.status || ""
  }))
);
// `partial` describes an incomplete page window. OCR review regions and visual
// fallbacks can require human review after every page has been processed, but
// they must not make the report tell the user to resume pages that do not exist.
document.extractionQuality.partial ||= document.extractionQuality.failedVisualRegions > 0
  || document.extractionQuality.pendingOcrPages > 0 || document.extractionQuality.unresolvedPages > 0;
document.extractionQuality.visualContentStatus = pdfVisualArtifacts?.status;
if (document.sourceType === "pdf") {
 document.extractionQuality.continuationDecisions = [
  ...reflowPdfTables(result.markdown, result.visualMap).decisions,
  ...reflowPdfParagraphs(result.markdown, result.visualMap).decisions
 ];
 document.extractionQuality.readingOrderConflicts = (result.visualMap?.pages || [])
  .filter(page => page.readingOrder?.conflict).map(page => page.page);
}
const qualityReport = await createQualityReport(
workspacePath,
document.id,
document.sourcePath,
document.sourceType,
finalWritePath,
result.markdown,
document.extractionQuality,
warnings
);
document.qualityReportId = qualityReport.id;
document.quality.qualityState = qualityReport.qualityState;
document.extractionQuality.qualityState = qualityReport.qualityState;
document.warnings = warnings;
document.markdownOutputs = {
aiReady: finalWritePath,
readable: finalReadablePath,
defaultForHumans: readableSegmentOutput?.indexPath || finalReadablePath,
defaultForAi: finalWritePath,
readableStats: readableMarkdownStats(readableMarkdown),
readableSegments: readableSegmentOutput,
visualMap: pdfVisualArtifacts?.visualMapPath,
visualAssetsIndex: pdfVisualArtifacts?.visualAssetsIndexPath,
visualSummary: pdfVisualArtifacts?.summary
};
if (userEdited && currentVersionSnapshot) {
 document.refreshedQualityReportId = qualityReport.id;
 document.refreshedQuality = structuredClone(quality);
 document.refreshedExtractionQuality = structuredClone(document.extractionQuality);
 document.refreshedExtractorName = extractorName;
 document.refreshedExtractionConverterName = converter.name;
 document.refreshedExtractionConverterVersion = String(converter.cacheVersion || "1");
 document.refreshedMarkdownOutputs = structuredClone(document.markdownOutputs);
 document.quality = currentVersionSnapshot.quality;
 document.extractionQuality = currentVersionSnapshot.extractionQuality;
 document.qualityReportId = currentVersionSnapshot.qualityReportId;
 document.warnings = [...currentVersionSnapshot.warnings, ...warnings.filter((warning) => !currentVersionSnapshot.warnings.includes(warning))];
 document.extractorName = currentVersionSnapshot.extractorName;
 document.extractionConverterName = currentVersionSnapshot.extractionConverterName;
 document.extractionConverterVersion = currentVersionSnapshot.extractionConverterVersion;
 document.refreshedPdfVisualMapPath = document.pdfVisualMapPath || "";
 document.refreshedPdfVisualAssetsIndexPath = document.pdfVisualAssetsIndexPath || "";
 document.refreshedPdfRichAssetsPath = document.pdfRichAssetsPath || "";
 document.refreshedPdfDiagnosticsPath = document.pdfDiagnosticsPath || "";
 document.pdfVisualMapPath = currentVersionSnapshot.pdfVisualMapPath;
 document.pdfVisualAssetsIndexPath = currentVersionSnapshot.pdfVisualAssetsIndexPath;
 document.pdfRichAssetsPath = currentVersionSnapshot.pdfRichAssetsPath;
 document.pdfDiagnosticsPath = currentVersionSnapshot.pdfDiagnosticsPath;
 document.markdownOutputs = {
  ...(currentVersionSnapshot.markdownOutputs || {}),
  refreshed: structuredClone(document.refreshedMarkdownOutputs)
 };
}
if (document.sourceType === "pdf") {
const sourceHash = await hashFile(document.sourcePath);
const statRes = await stat(document.sourcePath);
const diagData = {
sourcePath: document.sourcePath,
sourceSize: statRes.size,
hash: sourceHash,
extractorAttempts: result.attempts || [],
extractorStatus: readabilityState === "ocr_required"
? "failed"
: (readabilityState === "readable" ? "success" : "low_readable"),
...calculateTextMetrics(result.markdown),
warningList: result.warnings || [],
chosenExtractor: result.extractorName || "built-in",
semanticLoss: result.stats?.semanticLoss || null,
visualContent: pdfVisualArtifacts ? {
status: pdfVisualArtifacts.status,
visualMapPath: pdfVisualArtifacts.visualMapPath,
visualAssetsIndexPath: pdfVisualArtifacts.visualAssetsIndexPath,
summary: pdfVisualArtifacts.summary
} : null
};
const pdfDiagnosticsPath = path.join(outputRoot, "pdf-diagnostics.json");
await writeFile(pdfDiagnosticsPath, JSON.stringify(diagData, null, 2), "utf8");
if (userEdited) document.refreshedPdfDiagnosticsPath = pdfDiagnosticsPath;
else document.pdfDiagnosticsPath = pdfDiagnosticsPath;
try {
const documentIr = buildPdfDocumentIr({
documentId: document.id,
 revisionId: extractionRevisionId({ sourceHash, converter, extractorName, markdown: result.markdown, pageLedger: result.pageLedger, visualMap: result.visualMap, options }),
sourcePath: document.sourcePath,
sourceHash,
sourceSize: statRes.size,
 pageCount: result.pageCount || result.stats?.ocr?.pageCount || null,
 pageLedger: result.pageLedger || null,
extractorName: extractorName,
extractorVersion: String(converter.cacheVersion || "1"),
markdown: result.markdown,
visualMap: result.visualMap,
warnings,
lowReadableText: resolvedLowReadableText,
quality: userEdited ? document.refreshedExtractionQuality : document.extractionQuality
});
const storedIr = await writeDocumentIr(workspacePath, documentIr);
const irFields = {
 documentIrSchema: documentIr.schema,
 documentIrVersion: documentIr.version,
 documentIrRevisionId: documentIr.revisionId,
 documentIrPath: storedIr.indexPath,
 documentIrPageCount: storedIr.pageCount,
 documentIrBlockCount: storedIr.blockCount,
 documentIrSourceHash: sourceHash,
 documentIrMarkdownHash: `sha256:${computeBufferHash(Buffer.from(result.markdown, "utf8"))}`
};
if (userEdited) {
 Object.assign(document, Object.fromEntries(Object.entries(irFields).map(([key, value]) => [`refreshed${key[0].toUpperCase()}${key.slice(1)}`, value])));
} else {
 Object.assign(document, irFields);
}
 if (typeof options.updateCheckpointPage === "function") {
  for (const page of documentIr.pages) {
   const pageArtifact = storedIr.pages?.find((entry) => entry.id === page.id);
   await options.updateCheckpointPage({
    pageNumber: page.pageNumber,
    status: page.status,
    artifactPath: pageArtifact?.relativePath || "",
    contentHash: pageArtifact?.contentHash || "",
    error: page.warnings?.join("; ") || ""
   }).catch(() => {});
 }
}
} catch (error) {
throw new AppError("document_revision_failed", `Structured representation could not be stored: ${error.message}`);
}
} else if (["docx", "pptx", "txt", "md"].includes(document.sourceType)) {
try {
const sourceHash = await hashFile(document.sourcePath);
const statRes = await stat(document.sourcePath);
const documentIr = buildDocumentIr({
documentId: document.id,
 revisionId: extractionRevisionId({ sourceHash, converter, extractorName, markdown: result.markdown, pageLedger: result.pageLedger, visualMap: result.visualMap, options }),
sourcePath: document.sourcePath,
sourceType: document.sourceType,
sourceHash,
sourceSize: statRes.size,
title: document.title,
extractorName,
extractorVersion: document.extractionConverterVersion,
markdown: result.markdown,
warnings,
quality: userEdited ? document.refreshedExtractionQuality : document.extractionQuality
});
const storedIr = await writeDocumentIr(workspacePath, documentIr);
const irFields = {
 documentIrSchema: documentIr.schema,
 documentIrVersion: documentIr.version,
 documentIrRevisionId: documentIr.revisionId,
 documentIrPath: storedIr.indexPath,
 documentIrPageCount: storedIr.pageCount,
 documentIrBlockCount: storedIr.blockCount,
 documentIrSourceHash: sourceHash,
 documentIrMarkdownHash: `sha256:${computeBufferHash(Buffer.from(result.markdown, "utf8"))}`
};
if (userEdited) {
 Object.assign(document, Object.fromEntries(Object.entries(irFields).map(([key, value]) => [`refreshed${key[0].toUpperCase()}${key.slice(1)}`, value])));
} else {
 Object.assign(document, irFields);
}
} catch (error) {
throw new AppError("document_revision_failed", `Structured representation could not be stored: ${error.message}`);
}
}
await options.assertNotCancelled?.();
document.error = undefined;
const artifactFiles = [];
for (const entry of await readdir(outputRoot, { recursive: true, withFileTypes: true })) {
 if (!entry.isFile()) continue;
 const absolute = path.join(entry.parentPath, entry.name);
 artifactFiles.push({ path: path.relative(outputRoot, absolute).split(path.sep).join("/"), hash: await hashFile(absolute) });
}
const revisionPath = path.join(outputRoot, "revision.json");
await writeFile(revisionPath, JSON.stringify({ schema: "schema-docs.conversion-revision.v1", revision,
 documentId, sourceHash: revisionSourceHash, markdownPath: finalWritePath,
 irPath: userEdited ? document.refreshedDocumentIrPath : document.documentIrPath,
 qualityReportId: qualityReport.id, files: artifactFiles }, null, 2), "utf8");
if (userEdited) {
 document.refreshedArtifactRevisionId = revision;
 document.refreshedArtifactRevisionPath = revisionPath;
} else {
 document.artifactRevisionId = revision;
 document.artifactRevisionPath = revisionPath;
}
await writeManifest(workspacePath, manifest, { beforeCommit: async (next, latest) => {
 const current = latest?.documents?.find(entry => entry.id === documentId);
 const job = latest?.jobs?.find(entry => entry.id === options.jobId);
 if (job?.status === "cancelled") throw new AppError("job_cancelled", job.cancelReason || "Job was cancelled.");
 if (JSON.stringify(current) !== JSON.stringify(originalDocument)) {
  throw new AppError("document_revision_conflict", "The document changed during conversion; its current revision was preserved.");
 }
 if (current.outputMarkdownPath && await readFile(current.outputMarkdownPath, "utf8") !== existingContent) {
  throw new AppError("document_revision_conflict", "Markdown was edited during conversion; the edits were preserved.");
 }
 if (await hashFile(document.sourcePath) !== revisionSourceHash) {
  throw new AppError("document_revision_conflict", "Source changed during conversion; retry with the new source.");
 }
 const mergedJobs = next.jobs;
 Object.assign(next, latest, { jobs: mergedJobs, updatedAt: next.updatedAt });
 next.documents = latest.documents.map(entry => entry.id === documentId ? document : entry);
 // Candidate versions are provisional until this lock is held. A manual save
 // may have allocated the same number while extraction was running.
 next.markdownVersions = [...(latest.markdownVersions || [])];
 const versionIds = new Set(next.markdownVersions.map(entry => entry.id));
 for (const entry of manifest.markdownVersions || []) {
  if (versionIds.has(entry.id)) continue;
  const number = Math.max(0, ...next.markdownVersions.filter(item => item.path === entry.path).map(item => item.version)) + 1;
  next.markdownVersions.push({ ...entry, version: number });
  versionIds.add(entry.id);
 }
 const committingJob = next.jobs?.find(entry => entry.id === options.jobId);
 if (committingJob) {
  committingJob.commitCompletedAt = new Date().toISOString();
  committingJob.output = { documentId, outputMarkdownPath: document.outputMarkdownPath, artifactRevisionId: revision };
 }
} });
const capability = markdownExtractionCapability(document.sourceType);
const evidence = await appendEvidenceRecord(workspacePath, {
kind: "document_extraction",
sourceRef: document.id,
inputFileHash: await hashFile(document.sourcePath),
inputFileType: document.sourceType,
outputArtifactHash: await hashFile(finalWritePath),
outputType: "md",
converter: converter.name,
aiSent: false,
policyDecision: "local_only",
userConfirmed: false
});
const audit = await appendConversionAudit(workspacePath, {
documentId: document.id,
sourceType: document.sourceType,
targetFormat: "md",
mode: capability.mode,
quality: capability.quality,
sourcePath: document.sourcePath,
intermediateMarkdownPath: finalWritePath,
outputPath: finalWritePath,
warnings,
limits: capability.limits,
evidenceId: evidence.id,
qualityReportId: qualityReport.id
});
await appendTimelineEvent(workspacePath, document.id, "convert", `Converted document "${document.title}" to Markdown`, {
evidenceId: evidence.id,
auditId: audit.id,
artifactPath: finalWritePath,
readableArtifactPath: finalReadablePath,
artifactHash: evidence.outputArtifactHash
});
return {
document,
warnings,
qualityReport,
evidenceId: evidence.id,
auditId: audit.id
};
}
export async function convertDocumentToMarkdownAsJob(workspacePath, documentId, converter, options = {}) {
const jobType = converter.name.includes("pdf")
? "convert_pdf"
: converter.name.includes("docx")
? "convert_docx"
: "convert_docx";
return runJob(
workspacePath,
jobType,
{
documentId,
converter: converter.name,
checkpoint: options.checkpoint === false ? undefined : {
 defer: true,
 documentId,
 pipelineVersion: String(converter.cacheVersion || "1"),
  options: {
  converter: converter.name,
  preferredExtractor: options.preferredExtractor || "",
    pythonPath: options.pythonPath || "",
    layoutStartPage: options.layoutStartPage ?? null,
    layoutMaxPages: options.layoutMaxPages ?? null,
  force: options.force === true,
  maxDecompressedBytes: options.maxDecompressedBytes ?? null,
  maxInputBytes: options.maxInputBytes ?? null
 }
}
},
async ({ job, update, startCheckpoint, updateCheckpoint, updateCheckpointPage, assertNotCancelled }) => {
await update({
progress: 15,
message: "Checking existing extraction"
});
const manifest = await readManifest(workspacePath);
const document = findDocument(manifest, documentId);
if (!document) throw new AppError("document_not_found", `Document not found: ${documentId}`, {
documentId
});
if (!converter.canHandle(document)) {
throw new AppError("document_converter_mismatch", "Converter cannot handl...", {
documentId,
converter: converter.name
});
}
if (startCheckpoint) {
 await startCheckpoint({
  sourceHash: await hashFile(document.sourcePath),
  options: {
   converter: converter.name,
   preferredExtractor: options.preferredExtractor || "",
   pythonPath: options.pythonPath || "",
   layoutStartPage: options.layoutStartPage ?? null,
   layoutMaxPages: options.layoutMaxPages ?? null,
   force: options.force === true,
   maxDecompressedBytes: options.maxDecompressedBytes ?? null,
   maxInputBytes: options.maxInputBytes ?? null
  }
 });
 await updateCheckpoint?.({ stages: { source_validation: { status: "completed", updatedAt: new Date().toISOString() } } });
}
await assertNotCancelled?.();
if (!options.force) {
const cached = await reusableMarkdownExtraction(document, converter);
if (cached) {
  await updateCheckpoint?.({ stages: { markdown_extraction: { status: "reused", updatedAt: new Date().toISOString() } } });
  await update({
progress: 95,
message: "Reused existing Markdown extraction"
});
return cached;
}
}
await update({
progress: 25,
message: "Converting document"
});
await updateCheckpoint?.({ stages: { markdown_extraction: { status: "running", updatedAt: new Date().toISOString() } } });
await assertNotCancelled?.();
const result = await convertDocumentToMarkdown(workspacePath, documentId, converter, {
...options,
jobId: job.id,
update,
updateCheckpointPage,
assertNotCancelled,
checkpoint: options.checkpoint,
  preferredExtractor: options.preferredExtractor,
  pythonPath: options.pythonPath,
  layoutStartPage: options.layoutStartPage,
  layoutMaxPages: options.layoutMaxPages,
  force: options.force === true,
 ocrLanguages: options.ocrLanguages,
 maxDecompressedBytes: options.maxDecompressedBytes,
 maxInputBytes: options.maxInputBytes
});
await assertNotCancelled?.();
await updateCheckpoint?.({ stages: {
 markdown_extraction: {
  status: "completed",
  artifactPath: result.document.outputMarkdownPath || "",
  qualityReportId: result.qualityReport?.id || "",
  updatedAt: new Date().toISOString()
 }
} });
await update({
progress: 90,
message: "Markdown written"
});
return {
documentId: result.document.id,
cached: false,
conversionMode: "fresh",
outputMarkdownPath: result.document.outputMarkdownPath,
readableMarkdownPath: result.document.readableMarkdownPath,
markdownOutputs: result.document.markdownOutputs,
warnings: result.warnings,
qualityReportId: result.qualityReport.id,
evidenceId: result.evidenceId,
auditId: result.auditId
};
}
);
}
