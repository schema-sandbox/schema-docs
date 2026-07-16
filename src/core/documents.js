import path from "node:path";
import { mkdir, readdir, rm, writeFile, readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readManifest, writeManifest } from "./manifest.js";
import { AppError } from "./errors.js";
import { runPdfExtractionPipeline } from "../adapters/pdfExtractorPipeline.js";
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
export async function writePdfDiagnostics(workspacePath, recordId, data) {
const dir = path.join(workspacePath, "outputs", "diagnostics");
await mkdir(dir, { recursive: true });
const diagnosticsPath = path.join(dir, `${recordId}.pdf-diagnostics.json`);
await writeFile(diagnosticsPath, JSON.stringify(data, null, 2), "utf8");
return diagnosticsPath;
}
async function writePdfVisualMap(workspacePath, baseName, sourcePath, result) {
const dir = path.join(workspacePath, "outputs", "assets", `${baseName}.pdf`);
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
/<!-- pdf-(image|formula|table): page=(\d+) index=(\d+) file=([^\s>]+) -->/g,
(_match, kind, pageNumber, _index, fileName) => {
const relativePath = `${root}/${baseName}.pdf/${fileName}`.split("\\").join("/");
const label = kind === "formula" ? "Formula" : (kind === "table" ? "Table" : "Figure");
return `![${label} preserved from PDF page ${pageNumber}](<${relativePath}>)`;
}
);
const blockImages = attached.replace(
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
import { appendTimelineEvent } from "./timeline.js";
import { addMarkdownVersion } from "./versions.js";
import { appendConversionAudit } from "./conversionAudits.js";
import { appendEvidenceRecord, hashFile } from "./evidence.js";
import {
createReadableMarkdown,
createReadableMarkdownSegmentIndex,
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
markdownHash === document.lastExtractedHash
&& (!document.lastReadableExtractedHash || readableMarkdownHash === document.lastReadableExtractedHash)
&& (!expectedSourceHash || currentSourceHash === expectedSourceHash)
) {
return {
documentId: document.id,
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
let result;
if (document.sourceType === "pdf" && converter.name === "pdf-text-layer-converter") {
let progressQueue = Promise.resolve();
result = await runPdfExtractionPipeline(document.sourcePath, {
converter,
preferredExtractor: options.preferredExtractor,
markerOutputDir: path.join(workspacePath, "outputs", "assets", `${document.id}-marker`),
markerMarkdownBaseDir: path.join(workspacePath, "outputs"),
markerForceOcr: options.markerForceOcr,
layoutAssetDir: path.join(workspacePath, "outputs", "assets", `${baseName}.pdf`),
onProgress: (msg, percent) => {
if (options && typeof options.update === "function") {
progressQueue = progressQueue.then(() =>
options.update({ progress: percent || 40, message: msg }).catch(() => {})
);
}
}
});
await progressQueue;
} else {
result = await converter.convert({
sourcePath: document.sourcePath,
sourceName: `${baseName}.${document.sourceType}`,
assetDir: path.join(workspacePath, "outputs", "assets", `${baseName}.${document.sourceType}`),
assetRelativeBase: `assets/${baseName}.${document.sourceType}`
});
}
const outputName = `${baseName}.md`;
const outputPath = path.join(workspacePath, "outputs", outputName);
const readablePath = path.join(workspacePath, "outputs", "readable", `${baseName}.readable.md`);
const readableSegmentBaseName = `${baseName}.readable`;
const existingContent = await readFile(outputPath, "utf8").catch(() => "");
let userEdited = false;
if (existingContent && document.lastExtractedHash) {
const existingHash = computeBufferHash(Buffer.from(existingContent, "utf8"));
if (existingHash !== document.lastExtractedHash) {
userEdited = true;
}
}
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
} else if (result.extractionQuality?.lowReadableText || result.quality?.hasOcrMissing || (document.sourceType === "txt" && hasHighMojibakeRatio(result.markdown))) {
 readabilityState = "low_readable_all_extractors_failed";
}
const warnings = result.warnings ?? [];
let pdfVisualArtifacts = null;
if (document.sourceType === "pdf") {
try {
pdfVisualArtifacts = await writePdfVisualMap(workspacePath, baseName, document.sourcePath, result);
result.markdown = attachPdfImagesToMarkdown(result.markdown, baseName, false);
} catch (error) {
warnings.push(`PDF visual content map could not be written: ${error.message}`);
}
}
if (document.sourceType === "txt" && hasHighMojibakeRatio(result.markdown) && !warnings.some((warning) => warning.includes("replacement characters"))) {
warnings.push("Decoded TXT output contains too many replacement characters. The human reading view was blocked to avoid showing corrupted text.");
}
let finalWritePath = outputPath;
let finalReadablePath = readablePath;
let readableSegmentOutput = null;
const lowReadable = readabilityState === "ocr_required" || readabilityState === "low_readable_all_extractors_failed";
const extractorName = result.extractorName || (document.sourceType === "pdf" ? "built-in" : converter.name);
const extractorFallbacksTried = result.stats?.fallbacksTried || [];
let readableMarkdown = lowReadable
? (createLowReadableMarkdownNotice({ sourceType: document.sourceType, sourceName: document.title || path.basename(document.sourcePath), warnings, attempts: result.attempts, detectedEncoding: result.extractionQuality?.detectedEncoding }) + "\n")
: createReadableMarkdown(result.markdown, {
sourceType: document.sourceType,
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
finalWritePath = path.join(workspacePath, "outputs", refreshedName);
finalReadablePath = path.join(workspacePath, "outputs", "readable", refreshedReadableName);
await writeFile(finalWritePath, aiReadyContent, "utf8");
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
const ver = await addMarkdownVersion(workspacePath, relativeRefreshed, "refresh_extract", documentId, result.markdown);
manifest.markdownVersions.push(ver);
warnings.push(`Local Markdown edits were detected. To avoid overwriting your work, the latest extraction was written to ${relativeRefreshed}.`);
} else {
let backupPath = null;
const relativeOutput = path.relative(workspacePath, outputPath).split(path.sep).join("/");
if (existingContent && existingContent.trim() !== aiReadyContent.trim()) {
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupName = `${documentOutputBaseName(document)}.backup-${timestamp}.md`;
backupPath = path.join(workspacePath, "outputs", backupName);
await writeFile(backupPath, existingContent, "utf8");
const relativeBackup = path.relative(workspacePath, backupPath).split(path.sep).join("/");
const ver = await addMarkdownVersion(workspacePath, relativeOutput, "pre_refresh_backup", documentId, existingContent);
manifest.markdownVersions.push(ver);
warnings.push(`Local file changes were detected. The previous version was backed up to ${relativeBackup} and registered in version history for ${relativeOutput}.`);
}
await writeFile(outputPath, aiReadyContent, "utf8");
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
const ver = await addMarkdownVersion(workspacePath, relativeOutput, "initial_extract", documentId, result.markdown);
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
unsupportedFeatures: result.extractionQuality?.unsupportedFeatures || ["tables", "multi-column layouts", "images", "formulas", "annotations", "embedded_objects"],
confidence: result.extractionQuality?.confidence || (resolvedTextLayerDetected && !resolvedLowReadableText ? "medium" : "low"),
readabilityState: readabilityState,
detectedEncoding: result.extractionQuality?.detectedEncoding
};
document.pdfVisualMapPath = pdfVisualArtifacts?.visualMapPath;
document.pdfVisualAssetsIndexPath = pdfVisualArtifacts?.visualAssetsIndexPath;
document.pdfRichAssetsPath = result.richAssetRoot || undefined;
document.extractionQuality.formulaEncodingArtifacts = result.stats?.semanticLoss?.octalArtifacts || 0;
document.extractionQuality.cidArtifacts = result.stats?.semanticLoss?.cidArtifacts || 0;
document.extractionQuality.visualContentStatus = pdfVisualArtifacts?.status;
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
const pdfDiagnosticsPath = await writePdfDiagnostics(workspacePath, document.id, diagData);
document.pdfDiagnosticsPath = pdfDiagnosticsPath;
}
document.error = undefined;
await writeManifest(workspacePath, manifest);
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
converter: converter.name
},
async ({ update }) => {
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
if (!options.force) {
const cached = await reusableMarkdownExtraction(document, converter);
if (cached) {
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
const result = await convertDocumentToMarkdown(workspacePath, documentId, converter, {
update,
preferredExtractor: options.preferredExtractor
});
await update({
progress: 90,
message: "Markdown written"
});
return {
documentId: result.document.id,
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
