import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { pdfBufferToMarkdown } from "./pdfMarkdownConverter.js";
import { analyzePdfSemanticLoss, detectPdfLayoutExtractor, extractPdfWithLayout } from "./pdfLayoutExtractor.js";
import { detectPdfOcrAdapter, extractPdfWithOcr } from "./pdfOcrExtractor.js";
import { detectPdfMarkerExtractor, extractPdfWithMarker } from "./pdfMarkerExtractor.js";
const execFileAsync = promisify(execFile);
function pdfBodyText(markdown) {
let skippedDocumentTitle = false;
return markdown
.split(/\r?\n/)
.filter((line) => {
if (!skippedDocumentTitle && line.startsWith("# ")) {
skippedDocumentTitle = true;
return false;
}
return !line.startsWith("> Source:") && !line.startsWith("> Converted by:");
})
.join("\n")
.trim();
}
export function hasLowReadableText(markdown) {
const text = pdfBodyText(markdown);
if (!text) return true;
const escapeNoise = (text.match(/\\(?:[0-7]{2,3}|x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|[nrt()\\])/g) ?? []).length;
const longHexRuns = (text.match(/(?:[0-9A-Fa-f]{2}\s*){12,}/g) ?? []).length;
const printable = text.replace(/\s/g, "");
const readable = text.match(/[\p{L}\p{N}]/gu) ?? [];
const readabilityRatio = printable.length === 0 ? 0 : readable.length / printable.length;
const mojibake = text.match(/[\ufffd\u25a1]|[\u00c0-\u024f]/g) ?? [];
const mojibakeRatio = printable.length === 0 ? 0 : mojibake.length / printable.length;
const escapeNoiseRatio = printable.length === 0 ? 0 : escapeNoise / printable.length;

const cjkChars = text.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) ?? [];
if (cjkChars.length > 0) {
const commonChinese = text.match(/[\u7684\u4e86\u662f\u6709\u6211\u5728\u4e00\u4e2a\u8fd9\u4e2d\u4ed6\u4f1a\u4e0e\u53ca\u4ee5\u548c\u8981\u56fd\u4eba]/g) ?? [];
const commonRatio = commonChinese.length / cjkChars.length;
if (cjkChars.length >= 10 && commonRatio < 0.015) {
return true;
}
}

const replacementCharCount = (text.match(/\ufffd/g) ?? []).length;
if (printable.length > 10 && (replacementCharCount / printable.length) > 0.05) {
return true;
}

if (readabilityRatio >= 0.65 && escapeNoiseRatio < 0.05) return false;
return escapeNoise >= 3 || longHexRuns > 0 || (printable.length >= 24 && readabilityRatio < 0.35) || (printable.length >= 80 && mojibakeRatio > 0.12);
}
async function checkCommand(cmd, args = ["--version"]) {
try {
const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 3000 });
const versionStr = stdout.trim() || stderr.trim() || "unknown";
return {
available: true,
version: versionStr.split("\n")[0] || "unknown"
};
} catch (err) {
if (err.code !== "ENOENT" && err.code !== 127) return {
available: true,
version: "present"
};
return {
available: false,
version: null
};
}
}
export async function runPdfExtractionPipeline(sourcePath, options = {}) {
const preferred = options.preferredExtractor || "auto";
const result = {
markdown: "",
extractorName: "built-in",
textLayerDetected: true,
lowReadableText: false,
warnings: [],
stats: {
characters: 0,
readabilityRatio: 1.0,
fallbacksTried: [],
semanticLoss: null
},
attempts: [],
visualMap: null
};
const buffer = await readFile(sourcePath);
const baseName = path.basename(sourcePath);
if (options.onProgress) {
options.onProgress("Detecting PDF text layer", 10);
}
const builtInStart = Date.now();
let builtInMarkdown = "";
let builtInError = "";
let hasText = false;
let lowReadable = false;
let builtInRan = false;
let builtInSemanticLoss = analyzePdfSemanticLoss("");
if (preferred === "auto" || preferred === "built-in" || preferred === "marker" || preferred === "scientific") {
builtInRan = true;
if (options.onProgress) {
options.onProgress("Trying built-in extractor", 25);
}
try {
if (options.converter && typeof options.converter.convert === "function") {
const convResult = await options.converter.convert({ sourcePath });
builtInMarkdown = convResult.markdown;
if (convResult.warnings) {
result.warnings.push(...convResult.warnings);
}
} else {
builtInMarkdown = await pdfBufferToMarkdown(buffer, baseName);
}
hasText = !builtInMarkdown.includes("no simple text layer");
lowReadable = hasText && hasLowReadableText(builtInMarkdown);
builtInSemanticLoss = analyzePdfSemanticLoss(builtInMarkdown);
result.stats.semanticLoss = builtInSemanticLoss;
} catch (e) {
builtInError = e.message;
hasText = false;
lowReadable = true;
}
const duration = Date.now() - builtInStart;
const status = hasText ? (lowReadable ? "low_readable" : "success") : "failed";
result.attempts.push({
name: "built-in",
available: true,
status,
durationMs: duration,
extractedCharacters: builtInMarkdown.length,
lowReadableText: lowReadable,
warning: builtInError || (status === "low_readable" ? "Low-readable text detected" : "")
});
if (hasText && !lowReadable && !builtInSemanticLoss.formulaDamageLikely && preferred !== "marker" && preferred !== "scientific") {
result.markdown = builtInMarkdown;
result.extractorName = "built-in";
result.textLayerDetected = true;
result.lowReadableText = false;
result.stats.characters = builtInMarkdown.length;
if (options.onProgress) {
options.onProgress("Readable Markdown generated by built-in", 100);
}
return result;
}
if (hasText && !lowReadable && builtInSemanticLoss.formulaDamageLikely) {
result.warnings.push(`Formula font encoding artifacts detected (${builtInSemanticLoss.octalArtifacts} octal escapes, ${builtInSemanticLoss.cidArtifacts} CID markers). Trying a layout-aware extractor before accepting the Markdown.`);
}
} else {
result.attempts.push({
name: "built-in",
available: true,
status: "unavailable",
durationMs: 0,
extractedCharacters: 0,
lowReadableText: false,
warning: "Skipped via preferred extractor"
});
}
result.stats.fallbacksTried.push("built-in");
if (builtInRan && options.onProgress) {
options.onProgress(lowReadable ? "Built-in output is low-readable" : "Built-in output has formula encoding loss", 45);
}
const markerRequested = preferred === "marker" || (preferred === "auto" && process.env.SCHEMA_DOCS_PDF_RICH_AUTO === "1");
if (markerRequested) {
const markerStart = Date.now();
const markerDetection = options.mockMarkerAvailable !== undefined
? { available: options.mockMarkerAvailable, command: options.markerCommand || "marker_single", version: "mock" }
: await detectPdfMarkerExtractor({ markerCommand: options.markerCommand });
if (markerDetection.available) {
if (options.onProgress) options.onProgress("Running high-fidelity PDF to Markdown extraction", 48);
try {
const markerResult = options.mockMarkerMarkdown !== undefined
? {
markdown: options.mockMarkerMarkdown,
equationCount: options.mockMarkerEquationCount || 0,
tableCount: options.mockMarkerTableCount || 0,
imageCount: options.mockMarkerImageCount || 0,
outputDir: options.markerOutputDir || ""
}
: await extractPdfWithMarker(sourcePath, {
detection: markerDetection,
outputDir: options.markerOutputDir,
markdownBaseDir: options.markerMarkdownBaseDir,
forceOcr: options.markerForceOcr,
timeoutMs: options.markerTimeoutMs
});
const markerLowReadable = hasLowReadableText(markerResult.markdown);
const markerSuccess = markerResult.markdown.trim() && !markerLowReadable;
result.attempts.push({
name: "marker",
available: true,
status: markerSuccess ? "success" : "low_readable",
durationMs: Date.now() - markerStart,
extractedCharacters: markerResult.markdown.length,
lowReadableText: markerLowReadable,
equationCount: markerResult.equationCount,
tableCount: markerResult.tableCount,
imageCount: markerResult.imageCount,
warning: markerSuccess ? "" : "Marker output is low-readable"
});
result.stats.fallbacksTried.push("marker");
if (markerSuccess) {
result.markdown = markerResult.markdown;
result.extractorName = "marker";
result.textLayerDetected = true;
result.lowReadableText = false;
result.stats.characters = markerResult.markdown.length;
result.stats.semanticLoss = analyzePdfSemanticLoss(markerResult.markdown);
result.stats.richContent = {
equations: markerResult.equationCount,
tables: markerResult.tableCount,
images: markerResult.imageCount,
assetRoot: markerResult.outputDir
};
result.richAssetRoot = markerResult.outputDir;
result.warnings.push("High-fidelity local PDF extraction produced Markdown with LaTeX equations, tables, and linked image assets. Review complex pages against the retained source PDF.");
if (options.onProgress) options.onProgress("High-fidelity Markdown generated", 100);
return result;
}
} catch (error) {
result.attempts.push({
name: "marker",
available: true,
status: "failed",
durationMs: Date.now() - markerStart,
extractedCharacters: 0,
lowReadableText: false,
warning: error.message
});
result.stats.fallbacksTried.push("marker");
result.warnings.push(`High-fidelity Marker extraction failed: ${error.message}`);
}
} else {
result.attempts.push({
name: "marker",
available: false,
status: "unavailable",
durationMs: 0,
extractedCharacters: 0,
lowReadableText: false,
warning: "Install the optional marker-pdf adapter for editable LaTeX equations, tables, and images"
});
result.warnings.push("Marker is not installed. The existing text extraction is preserved; editable LaTeX equations, formatted tables, and extracted images were not generated.");
}
}
const layoutStart = Date.now();
const layoutDetection = options.mockPdfLayoutAvailable !== undefined
? { available: options.mockPdfLayoutAvailable, command: options.pythonPath || "python", args: [], version: "mock" }
: await detectPdfLayoutExtractor({ pythonPath: options.pythonPath });
if ((preferred === "auto" || preferred === "pdfplumber" || preferred === "scientific") && layoutDetection.available) {
if (options.onProgress) options.onProgress("Trying layout-aware PDF extraction", 52);
try {
const layoutResult = options.mockPdfLayout !== undefined
? { markdown: options.mockPdfLayout, visualMap: options.mockPdfVisualMap || null, adapterVersion: "mock" }
: await extractPdfWithLayout(sourcePath, {
detection: layoutDetection,
timeoutMs: options.layoutTimeoutMs,
assetDir: options.layoutAssetDir,
formulaOcr: preferred === "scientific",
formulaOcrPython: options.formulaOcrPython,
formulaOcrBatchSize: options.formulaOcrBatchSize,
formulaOcrTimeoutMs: options.formulaOcrTimeoutMs
});
const layoutLowReadable = hasLowReadableText(layoutResult.markdown);
const layoutSemanticLoss = analyzePdfSemanticLoss(layoutResult.markdown);
const layoutBetter = !layoutLowReadable
&& layoutResult.markdown.trim()
&& (preferred === "scientific" || !hasText || lowReadable || layoutSemanticLoss.score < builtInSemanticLoss.score);
result.attempts.push({
name: "pdfplumber",
available: true,
status: layoutBetter ? "success" : (layoutLowReadable ? "low_readable" : "not_better"),
durationMs: Date.now() - layoutStart,
extractedCharacters: layoutResult.markdown.length,
lowReadableText: layoutLowReadable,
semanticLoss: layoutSemanticLoss,
warning: layoutBetter ? "" : "Layout-aware output did not improve the built-in result."
});
result.stats.fallbacksTried.push("pdfplumber");
if (layoutBetter) {
result.markdown = layoutResult.markdown;
result.extractorName = preferred === "scientific" ? "scientific" : "pdfplumber";
result.textLayerDetected = true;
result.lowReadableText = false;
result.stats.characters = layoutResult.markdown.length;
result.stats.semanticLoss = layoutSemanticLoss;
result.visualMap = layoutResult.visualMap;
result.warnings.push("Layout-aware PDF extraction preserved page markers and recovered mathematical glyphs that were damaged in the built-in text stream.");
if (preferred === "scientific") {
const recognized = layoutResult.visualMap?.summary?.formulaOcrRecognized || 0;
const candidates = layoutResult.visualMap?.summary?.formulaOcrCandidates || 0;
result.warnings.push(`Scientific refinement converted ${recognized} of ${candidates} uncertain formula regions into editable LaTeX; unrecognized regions retain source-page visual fallback.`);
}
if (layoutResult.visualMap?.summary?.formulaRegions) {
result.warnings.push(`${layoutResult.visualMap.summary.formulaRegions} formula regions were mapped. Intact formulas were promoted to Markdown math; damaged formula encodings use source-page visual fallback.`);
}
if (layoutResult.visualMap?.summary?.imageRegions) {
const renderedImages = layoutResult.visualMap.summary.renderedImages || 0;
result.warnings.push(`${layoutResult.visualMap.summary.imageRegions} image and vector-figure regions were mapped; ${renderedImages} were rendered and linked in the main Markdown.`);
}
if (layoutResult.visualMap?.summary?.tableRegions) {
result.warnings.push(`${layoutResult.visualMap.summary.tableRegions} table regions were mapped and emitted as Markdown tables with source coordinates retained.`);
}
if (options.onProgress) options.onProgress("Layout-aware Markdown generated", 100);
return result;
}
} catch (error) {
result.attempts.push({
name: "pdfplumber",
available: true,
status: "failed",
durationMs: Date.now() - layoutStart,
extractedCharacters: 0,
lowReadableText: false,
warning: error.message
});
result.stats.fallbacksTried.push("pdfplumber");
result.warnings.push(`Layout-aware PDF extraction failed: ${error.message}`);
}
} else {
result.attempts.push({
name: "pdfplumber",
available: false,
status: "unavailable",
durationMs: 0,
extractedCharacters: 0,
lowReadableText: false,
warning: preferred === "pdfplumber" || preferred === "auto" ? "Python pdfplumber adapter is not available" : "Skipped via preferred extractor"
});
}
const pdftotextStart = Date.now();
let pdftotextRan = false;
let pdftotextMarkdown = "";
const isPdftotextPreferred = preferred === "pdftotext";
const shouldTryPdftotext = preferred === "auto" || isPdftotextPreferred;
const pdftotextAvailable = shouldTryPdftotext && (options.mockPdftotextAvailable ?? (await checkCommand("pdftotext", ["-v"])).available);
if (pdftotextAvailable) {
pdftotextRan = true;
if (options.onProgress) {
options.onProgress("Trying pdftotext", 60);
}
try {
let extractedText;
if (options.mockPdftotext !== undefined) {
extractedText = options.mockPdftotext;
} else {
const { stdout } = await execFileAsync("pdftotext", ["-layout", sourcePath, "-"], { maxBuffer: 30 * 1024 * 1024 });
extractedText = stdout;
}
const title = path.parse(baseName).name || "Untitled";
pdftotextMarkdown = [
`# ${title}`,
"",
extractedText
].join("\n");
const isLow = hasLowReadableText(pdftotextMarkdown);
const isSuccess = extractedText.trim() && !isLow;
const status = isSuccess ? "success" : "low_readable";
result.attempts.push({
name: "pdftotext",
available: true,
status,
durationMs: Date.now() - pdftotextStart,
extractedCharacters: pdftotextMarkdown.length,
lowReadableText: isLow,
warning: isSuccess ? "" : "Low-readable text detected"
});
if (isSuccess) {
result.markdown = pdftotextMarkdown;
result.extractorName = "pdftotext";
result.textLayerDetected = true;
result.lowReadableText = false;
result.stats.characters = pdftotextMarkdown.length;
if (options.onProgress) {
options.onProgress("Readable Markdown generated by pdftotext.", 100);
}
return result;
}
} catch (e) {
result.warnings.push(`pdftotext failed: ${e.message}`);
result.attempts.push({
name: "pdftotext",
available: true,
status: "failed",
durationMs: Date.now() - pdftotextStart,
extractedCharacters: 0,
lowReadableText: false,
warning: e.message
});
}
result.stats.fallbacksTried.push("pdftotext");
} else {
result.attempts.push({
name: "pdftotext",
available: false,
status: "unavailable",
durationMs: 0,
extractedCharacters: 0,
lowReadableText: false,
warning: shouldTryPdftotext ? "Command not available" : "Skipped via preferred extractor"
});
}
const mutoolStart = Date.now();
let mutoolRan = false;
let mutoolMarkdown = "";
const isMutoolPreferred = preferred === "mutool";
const shouldTryMutool = preferred === "auto" || isMutoolPreferred;
const mutoolAvailable = shouldTryMutool && (options.mockMutoolAvailable ?? (await checkCommand("mutool", [])).available);
if (mutoolAvailable) {
mutoolRan = true;
if (options.onProgress) {
options.onProgress("Trying mutool", 70);
}
try {
let extractedText;
if (options.mockMutool !== undefined) {
extractedText = options.mockMutool;
} else {
const { stdout } = await execFileAsync("mutool", ["draw", "-F", "text", "-o", "-", sourcePath], { maxBuffer: 30 * 1024 * 1024 });
extractedText = stdout;
}
const title = path.parse(baseName).name || "Untitled";
mutoolMarkdown = [
`# ${title}`,
"",
extractedText
].join("\n");
const isLow = hasLowReadableText(mutoolMarkdown);
const isSuccess = extractedText.trim() && !isLow;
const status = isSuccess ? "success" : "low_readable";
result.attempts.push({
name: "mutool",
available: true,
status,
durationMs: Date.now() - mutoolStart,
extractedCharacters: mutoolMarkdown.length,
lowReadableText: isLow,
warning: isSuccess ? "" : "Low-readable text detected"
});
if (isSuccess) {
result.markdown = mutoolMarkdown;
result.extractorName = "mutool";
result.textLayerDetected = true;
result.lowReadableText = false;
result.stats.characters = mutoolMarkdown.length;
if (options.onProgress) {
options.onProgress("Readable Markdown generated by mutool.", 100);
}
return result;
}
} catch (e) {
result.warnings.push(`mutool failed: ${e.message}`);
result.attempts.push({
name: "mutool",
available: true,
status: "failed",
durationMs: Date.now() - mutoolStart,
extractedCharacters: 0,
lowReadableText: false,
warning: e.message
});
}
result.stats.fallbacksTried.push("mutool");
} else {
result.attempts.push({
name: "mutool",
available: false,
status: "unavailable",
durationMs: 0,
extractedCharacters: 0,
lowReadableText: false,
warning: shouldTryMutool ? "Command not available" : "Skipped via preferred extractor"
});
}
const pandocStart = Date.now();
let pandocRan = false;
let pandocMarkdown = "";
const isPandocPreferred = preferred === "pandoc";
const shouldTryPandoc = preferred === "auto" || isPandocPreferred;
const pandocAvailable = shouldTryPandoc && (options.mockPandocAvailable ?? (await checkCommand("pandoc", ["--version"])).available);
if (pandocAvailable) {
pandocRan = true;
if (options.onProgress) {
options.onProgress("Trying pandoc", 80);
}
try {
let extractedText;
if (options.mockPandoc !== undefined) {
extractedText = options.mockPandoc;
} else {
const { stdout } = await execFileAsync("pandoc", [sourcePath, "-t", "markdown"], { maxBuffer: 30 * 1024 * 1024 });
extractedText = stdout;
}
const title = path.parse(baseName).name || "Untitled";
pandocMarkdown = [
`# ${title}`,
"",
extractedText
].join("\n");
const isLow = hasLowReadableText(pandocMarkdown);
const isSuccess = extractedText.trim() && !isLow;
const status = isSuccess ? "success" : "low_readable";
result.attempts.push({
name: "pandoc",
available: true,
status,
durationMs: Date.now() - pandocStart,
extractedCharacters: pandocMarkdown.length,
lowReadableText: isLow,
warning: isSuccess ? "" : "Low-readable text detected"
});
if (isSuccess) {
result.markdown = pandocMarkdown;
result.extractorName = "pandoc";
result.textLayerDetected = true;
result.lowReadableText = false;
result.stats.characters = pandocMarkdown.length;
if (options.onProgress) {
options.onProgress("Readable Markdown generated by pandoc.", 100);
}
return result;
}
} catch (e) {
result.warnings.push(`pandoc failed: ${e.message}`);
result.attempts.push({
name: "pandoc",
available: true,
status: "failed",
durationMs: Date.now() - pandocStart,
extractedCharacters: 0,
lowReadableText: false,
warning: e.message
});
}
result.stats.fallbacksTried.push("pandoc");
} else {
result.attempts.push({
name: "pandoc",
available: false,
status: "unavailable",
durationMs: 0,
extractedCharacters: 0,
lowReadableText: false,
warning: shouldTryPandoc ? "Command not available" : "Skipped via preferred extractor"
});
}
const shouldTryOcr = (preferred === "auto" || preferred === "ocr") && (!hasText || lowReadable);
if (shouldTryOcr) {
const ocrStart = Date.now();
const ocrDetection = options.mockOcrAvailable !== undefined
? { available: options.mockOcrAvailable }
: await detectPdfOcrAdapter(options);
if (ocrDetection.available) {
if (options.onProgress) options.onProgress("Running local OCR on PDF pages", 85);
try {
const ocrResult = options.mockOcrMarkdown !== undefined
? {
markdown: options.mockOcrMarkdown,
pageCount: options.mockOcrPageCount || 1,
pagesProcessed: options.mockOcrPageCount || 1,
failedPages: []
}
: await extractPdfWithOcr(sourcePath, {
detection: ocrDetection,
languages: options.ocrLanguages,
dpi: options.ocrDpi,
pageTimeoutMs: options.ocrPageTimeoutMs,
onProgress: ({ percent, page, endPage }) => {
if (options.onProgress) options.onProgress(`OCR page ${page} of ${endPage}`, 85 + Math.round(percent * 0.14));
}
});
const ocrLowReadable = hasLowReadableText(ocrResult.markdown);
const ocrSuccess = ocrResult.markdown.trim() && !ocrLowReadable;
result.attempts.push({
name: "tesseract-ocr",
available: true,
status: ocrSuccess ? "success" : "low_readable",
durationMs: Date.now() - ocrStart,
extractedCharacters: ocrResult.markdown.length,
lowReadableText: ocrLowReadable,
pagesProcessed: ocrResult.pagesProcessed,
failedPages: ocrResult.failedPages?.length || 0,
warning: ocrSuccess ? "" : "OCR output is still low-readable"
});
result.stats.fallbacksTried.push("tesseract-ocr");
if (ocrSuccess) {
result.markdown = ocrResult.markdown;
result.extractorName = "tesseract-ocr";
result.textLayerDetected = true;
result.lowReadableText = false;
result.stats.characters = ocrResult.markdown.length;
result.stats.semanticLoss = analyzePdfSemanticLoss(ocrResult.markdown);
result.stats.ocr = {
pageCount: ocrResult.pageCount,
pagesProcessed: ocrResult.pagesProcessed,
failedPages: ocrResult.failedPages?.length || 0,
languages: ocrResult.languages || options.ocrLanguages || "auto"
};
result.warnings.push("Text was recovered with local OCR. Formula notation, tables, handwriting, and reading order still require visual review against the original PDF.");
if (ocrResult.failedPages?.length) result.warnings.push(`${ocrResult.failedPages.length} PDF pages could not be OCR-processed and remain explicitly marked in Markdown.`);
if (options.onProgress) options.onProgress("OCR Markdown generated", 100);
return result;
}
} catch (error) {
result.attempts.push({
name: "tesseract-ocr",
available: true,
status: "failed",
durationMs: Date.now() - ocrStart,
extractedCharacters: 0,
lowReadableText: true,
warning: error.message
});
result.stats.fallbacksTried.push("tesseract-ocr");
result.warnings.push(`Local OCR failed: ${error.message}`);
}
} else {
result.attempts.push({
name: "tesseract-ocr",
available: false,
status: "unavailable",
durationMs: 0,
extractedCharacters: 0,
lowReadableText: true,
warning: "Tesseract, pdftoppm, and pdfinfo are required for local PDF OCR"
});
}
}
if (options.onProgress) {
options.onProgress("Building readable Markdown", 95);
}
if (preferred !== "auto" && preferred !== "built-in") {
if (preferred === "pdftotext" && pdftotextRan) {
const preferredAttempt = result.attempts.find(a => a.name === "pdftotext");
if (preferredAttempt && preferredAttempt.status !== "failed") {
result.markdown = pdftotextMarkdown;
result.extractorName = "pdftotext";
result.textLayerDetected = true;
result.lowReadableText = preferredAttempt.lowReadableText;
}
} else if (preferred === "mutool" && mutoolRan) {
const preferredAttempt = result.attempts.find(a => a.name === "mutool");
if (preferredAttempt && preferredAttempt.status !== "failed") {
result.markdown = mutoolMarkdown;
result.extractorName = "mutool";
result.textLayerDetected = true;
result.lowReadableText = preferredAttempt.lowReadableText;
}
} else if (preferred === "pandoc" && pandocRan) {
const preferredAttempt = result.attempts.find(a => a.name === "pandoc");
if (preferredAttempt && preferredAttempt.status !== "failed") {
result.markdown = pandocMarkdown;
result.extractorName = "pandoc";
result.textLayerDetected = true;
result.lowReadableText = preferredAttempt.lowReadableText;
}
} else {
result.markdown = builtInMarkdown;
result.extractorName = "built-in";
result.textLayerDetected = hasText;
result.lowReadableText = lowReadable;
}
} else {
result.markdown = builtInMarkdown;
result.extractorName = "built-in";
result.textLayerDetected = hasText;
result.lowReadableText = lowReadable;
}
result.stats.characters = result.markdown.length;
result.stats.semanticLoss = analyzePdfSemanticLoss(result.markdown);
if (result.stats.semanticLoss.formulaDamageLikely) {
result.warnings.push("Body text is readable, but mathematical formulas contain damaged font encoding. Install the optional pdfplumber adapter or use formula-region visual recovery before relying on formulas.");
}
if (!result.textLayerDetected) {
result.warnings.push("No readable text layer detected. OCR required.");
} else if (result.lowReadableText) {
result.warnings.push("All extraction fallbacks produced low-readable text. OCR recommended.");
}
if (options.onProgress) {
options.onProgress("Done", 100);
}
return result;
}
