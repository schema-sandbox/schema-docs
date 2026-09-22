import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { assertPdfInputSize, DEFAULT_MAX_INPUT_BYTES, detectPdfPageCount, pdfBufferToMarkdown } from "./pdfMarkdownConverter.js";
import { analyzePdfSemanticLoss, detectPdfLayoutExtractor, extractPdfWithLayout, hasBundledPdfRuntime } from "./pdfLayoutExtractor.js";
import { detectPdfOcrAdapter, extractPdfWithOcr } from "./pdfOcrExtractor.js";
import { detectPdfMarkerExtractor, extractPdfWithMarker } from "./pdfMarkerExtractor.js";
import { createPdfPageLedgerFromMarkdown } from "./pdfPageBackend.js";
import { mergeOcrPages } from "./pdfOcrMerge.js";
import { validatePdfConversion, validatePdfAssets } from "./pdfConversionValidation.js";
import { assertMemoryBudget } from "./pdfPageStream.js";
const execFileAsync = promisify(execFile);
function isCancellationError(error) {
 return ["job_cancelled", "ABORT_ERR", "resource_limit", "TIMEOUT", "ETIMEDOUT"].includes(error?.code) || error?.name === "AbortError";
}
async function detectPdfInfoPageCount(sourcePath) {
 try {
  const { stdout } = await execFileAsync("pdfinfo", [sourcePath], { timeout: 5000, maxBuffer: 256 * 1024 });
  const match = /^(?:Pages|Page count):\s*(\d+)\s*$/im.exec(stdout);
  return match ? Number(match[1]) : null;
 } catch {
  return null;
 }
}
export function pdfBodyText(markdown) {
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

export function derivePdfPageQuality(page = {}) {
 const pendingOcr = page.requiresOcr === true || ["partial", "failed"].includes(page.ocr?.status);
 const reviewRegions = Array.isArray(page.ocrReviewRegions)
  ? page.ocrReviewRegions
  : (page.ocr?.regions || []).filter(region => ["visual_only", "unresolved", "failed"].includes(region.status));
 const ocrReviewRequired = page.ocrReviewRequired === true || reviewRegions.length > 0;
 const ocrCompleted = page.ocr?.status === "completed"
  && String(page.ocr?.text || "").trim()
  && (page.ocr?.regions || []).every(region => ["completed", "non_text", "visual_only"].includes(region.status));
 const failedVisual = (page.regions || []).some(region => region.assetStatus === "failed") || Boolean(page.backendFailure);
 const visualPreserved = (page.regions || []).some(region => region.needsVisualFallback || region.assetFile);
 const qualityStatus = pendingOcr ? (ocrCompleted ? "ocr_completed" : "ocr_required")
   : (failedVisual ? "unresolved" : (ocrReviewRequired ? "ocr_review_required" : (visualPreserved ? "visual_preserved" : "native_text")));
 return {
  qualityStatus,
  pendingOcr,
  ocrCompleted: Boolean(ocrCompleted),
  ocrReviewRequired,
  ocrReviewRegions: reviewRegions,
  failedVisual,
  visualPreserved,
  issues: [pendingOcr && !ocrCompleted ? "ocr_required" : null, failedVisual ? "visual_render_failed" : null].filter(Boolean)
 };
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
const pageBackendFirst = preferred === "auto"
 && (options.converter?.preferPageBackend === true || hasBundledPdfRuntime());
const resourceTracker = { peakNodeRssBytes: process.memoryUsage().rss, heartbeatCount: 0, phases: {} };
const observeHeartbeat = (phase, heartbeat = {}) => {
 assertMemoryBudget(options.maxResidentBytes);
 resourceTracker.heartbeatCount += 1;
 const rss = Number(heartbeat.nodeRssBytes || process.memoryUsage().rss);
 resourceTracker.peakNodeRssBytes = Math.max(resourceTracker.peakNodeRssBytes, rss);
 const phaseRecord = resourceTracker.phases[phase] || { peakNodeRssBytes: 0, samples: 0 };
 phaseRecord.samples += 1;
 phaseRecord.peakNodeRssBytes = Math.max(phaseRecord.peakNodeRssBytes, rss);
 resourceTracker.phases[phase] = phaseRecord;
 return options.onHeartbeat?.({ ...heartbeat, phase, nodeRssBytes: rss });
};
const attachResources = () => {
 assertMemoryBudget(options.maxResidentBytes);
 resourceTracker.finalNodeRssBytes = process.memoryUsage().rss;
 resourceTracker.peakNodeRssBytes = Math.max(resourceTracker.peakNodeRssBytes, resourceTracker.finalNodeRssBytes);
 result.stats.resources = resourceTracker;
 resourceTracker.layoutWorker = result.visualMap?.resources || null;
 resourceTracker.ocrWorker = result.stats.ocr?.resources || null;
 result.backendFailures = result.attempts.filter(attempt => attempt.status === "failed")
  .map(attempt => ({ backend: attempt.name, message: attempt.warning }));
 result.validation = validatePdfConversion(result, {
  startPage: result.visualMap?.pageRange?.start || 1,
  endPage: result.visualMap?.pageRange?.end || result.pageCount
 });
 if (!result.validation.passed || result.extractionQuality?.pendingOcrPages > 0
  || result.extractionQuality?.unresolvedPages > 0 || result.extractionQuality?.failedVisualRegions > 0
  || result.stats.ocr?.failedPages?.length > 0) result.partial = true;
};
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
const inputStat = await stat(sourcePath);
const maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
// Validate the configured budget, but allow oversized PDFs to use the page
// window backend when explicitly requested. Full-buffer fallbacks still refuse
// the input below, so a large file can never silently be loaded into memory.
let largeInput = false;
try {
  assertPdfInputSize({ ...inputStat, size: 0 }, maxInputBytes);
  largeInput = Number(inputStat.size) > Number(maxInputBytes);
  if (largeInput && !options.allowLargePageWindow) assertPdfInputSize(inputStat, maxInputBytes);
} catch (error) {
  if (!largeInput || !options.allowLargePageWindow) throw error;
}
if (largeInput) {
  result.stats.resourceBudget = {
    inputBytes: Number(inputStat.size),
    maxInputBytes: Number(maxInputBytes),
    mode: "page_window",
    reason: "full_buffer_limit_bypassed_for_page_window"
  };
}
result.pageCount = await detectPdfInfoPageCount(sourcePath);
let buffer = null;
const readSourceBuffer = async () => {
 if (buffer) return buffer;
 buffer = await readFile(sourcePath);
 return buffer;
};
const baseName = path.basename(sourcePath);
if (options.onProgress) {
options.onProgress("Detecting PDF text layer", 10);
}
let builtInStart = 0;
let builtInMarkdown = "";
let builtInError = "";
let hasText = false;
let lowReadable = false;
let builtInRan = false;
let builtInSemanticLoss = analyzePdfSemanticLoss("");
const recordBuiltInAttempt = (attempt) => {
const existingIndex = result.attempts.findIndex((entry) => entry.name === "built-in");
if (existingIndex >= 0) {
result.attempts[existingIndex] = attempt;
} else {
result.attempts.push(attempt);
}
};
const runBuiltInExtraction = async ({ lateFallback = false } = {}) => {
if (builtInRan) return;
builtInRan = true;
if (largeInput && options.allowLargePageWindow) {
 const error = new Error("Large PDF requires the page-window layout backend; full-buffer extraction is disabled for this input.");
 error.code = "PDF_INPUT_LIMIT";
 throw error;
}
builtInStart = Date.now();
if (options.onProgress) {
options.onProgress(
lateFallback ? "Preferred extractor unavailable; preserving built-in extraction" : "Trying built-in extractor",
lateFallback ? 94 : 25
);
}
try {
if (options.assertNotCancelled) await options.assertNotCancelled();
 const sourceBuffer = await readSourceBuffer();
if (options.converter && typeof options.converter.convert === "function") {
const convResult = await options.converter.convert({
 sourcePath,
 inputStat,
  buffer: sourceBuffer,
 maxDecompressedBytes: options.maxDecompressedBytes,
 maxInputBytes: options.maxInputBytes,
 assertNotCancelled: options.assertNotCancelled
});
 builtInMarkdown = convResult.markdown;
  result.pageCount = convResult.pageCount || result.pageCount;
  result.pageLedger = convResult.pageLedger || result.pageLedger || null;
  if (result.pageLedger && result.pageLedger.sourcePageCount === null && Number.isInteger(result.pageCount) && result.pageCount > 0) {
   result.pageLedger = { ...result.pageLedger, sourcePageCount: result.pageCount, pageCountKnown: true };
  }
if (convResult.warnings) {
result.warnings.push(...convResult.warnings);
}
} else {
  builtInMarkdown = await pdfBufferToMarkdown(sourceBuffer, baseName, {
  maxDecompressedBytes: options.maxDecompressedBytes,
  assertNotCancelled: options.assertNotCancelled
 });
  result.pageCount = detectPdfPageCount(sourceBuffer);
}
hasText = Boolean(pdfBodyText(builtInMarkdown)) && !builtInMarkdown.includes("no simple text layer");
lowReadable = hasText && hasLowReadableText(builtInMarkdown);
builtInSemanticLoss = analyzePdfSemanticLoss(builtInMarkdown);
result.stats.semanticLoss = builtInSemanticLoss;
 } catch (e) {
 if (isCancellationError(e) || e?.code === "PDF_BUDGET_INVALID") throw e;
 builtInError = e.message;
 if (e?.code === "PDF_DECOMPRESSION_LIMIT" || e?.code === "PDF_INPUT_LIMIT") {
 // A document that exceeds the bounded decompression budget is deliberately
 // stopped before layout/OCR fallbacks can allocate another full copy.
 throw e;
}
hasText = false;
lowReadable = true;
}
const duration = Date.now() - builtInStart;
const status = hasText ? (lowReadable ? "low_readable" : "success") : "failed";
recordBuiltInAttempt({
name: "built-in",
available: true,
status,
durationMs: duration,
extractedCharacters: builtInMarkdown.length,
lowReadableText: lowReadable,
warning: builtInError || (status === "low_readable" ? "Low-readable text detected" : "")
});
};
if ((preferred === "auto" && !pageBackendFirst) || preferred === "built-in" || preferred === "marker" || preferred === "scientific") {
await runBuiltInExtraction();
if (hasText && !lowReadable && !builtInSemanticLoss.formulaDamageLikely && preferred !== "marker" && preferred !== "scientific") {
result.markdown = builtInMarkdown;
result.extractorName = "built-in";
result.textLayerDetected = true;
result.lowReadableText = false;
result.stats.characters = builtInMarkdown.length;
if (options.onProgress) {
options.onProgress("Readable Markdown generated by built-in", 100);
}
if (options.assertNotCancelled) await options.assertNotCancelled();
attachResources();
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
if (options.assertNotCancelled) await options.assertNotCancelled();
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
                    forceOcr: options.markerForceOcr === true,
                    // Marker leaves inline mathematics as plain text unless its
                    // inline-math pass is enabled. A mathematics textbook is
                    // exactly the case this channel exists for, so the pass is
                    // on by default and can still be turned off explicitly.
                    inlineMath: options.markerInlineMath !== false,
                    timeoutMs: options.markerTimeoutMs,
                    onProgress: (message) => options.onProgress?.(message, 48)
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
attachResources();
return result;
}
} catch (error) {
if (isCancellationError(error)) throw error;
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
result.warnings.push("The optional developer-only Marker reconstruction runtime is unavailable. The Office workflow keeps the existing extraction and source-linked visual fallbacks; editable formula reconstruction was not attempted.");
}
}
const layoutStart = Date.now();
const configuredPageWindowSize = Number(options.pageWindowSize || process.env.SCHEMA_DOCS_PDF_PAGE_WINDOW || 0);
const pageWindowSize = configuredPageWindowSize > 0
 ? Math.max(1, Math.min(32, configuredPageWindowSize))
 : (largeInput || Number(result.pageCount || 0) > 1200 || Number(inputStat.size) > 180 * 1024 * 1024 ? 4
   : (Number(inputStat.size) > 80 * 1024 * 1024 ? 8 : 16));
const layoutDetection = options.mockPdfLayoutAvailable !== undefined
? { available: options.mockPdfLayoutAvailable, command: options.pythonPath || "python", args: [], version: "mock" }
: await detectPdfLayoutExtractor({ pythonPath: options.pythonPath });
if ((preferred === "auto" || preferred === "pdfplumber" || preferred === "scientific") && layoutDetection.available) {
if (options.assertNotCancelled) await options.assertNotCancelled();
if (options.onProgress) options.onProgress("Trying layout-aware PDF extraction", 52);
try {
const layoutResult = options.mockPdfLayout !== undefined
? { markdown: options.mockPdfLayout, visualMap: options.mockPdfVisualMap || null, adapterVersion: "mock" }
: await extractPdfWithLayout(sourcePath, {
detection: layoutDetection,
timeoutMs: options.layoutTimeoutMs,
maxResidentBytes: options.maxResidentBytes,
maxWorkerResidentBytes: options.maxWorkerResidentBytes,
maxTemporaryBytes: options.maxTemporaryBytes,
pageTimeoutMs: options.ocrPageTimeoutMs,
regionTimeoutMs: options.ocrRegionTimeoutMs,
assetDir: options.layoutAssetDir,
cacheDir: options.layoutCacheDir,
assertNotCancelled: options.assertNotCancelled,
onPageComplete: options.onLayoutPage,
onHeartbeat: heartbeat => observeHeartbeat("layout", heartbeat),
heartbeatMs: options.heartbeatMs,
startPage: options.layoutStartPage,
maxPages: options.layoutMaxPages,
pageWindowSize,
formulaOcr: preferred === "scientific",
formulaOcrPython: options.formulaOcrPython,
formulaOcrBatchSize: options.formulaOcrBatchSize,
formulaOcrTimeoutMs: options.formulaOcrTimeoutMs
});
const scanPages = (layoutResult.visualMap?.pages || []).filter(page => page.requiresOcr).map(page => page.page);
if (scanPages.length) {
 const detection = await detectPdfOcrAdapter({ pythonPath: options.pythonPath });
 if (detection.native) {
  try {
   const ocr = await extractPdfWithOcr(sourcePath, { detection, pageNumbers: scanPages,
    pageRegions: Object.fromEntries(layoutResult.visualMap.pages.filter(p=>scanPages.includes(p.page)).map(p=>[p.page,{coordinateOrigin:p.coordinateOrigin || [0,0],regions:p.ocrRegions}])),
    languages: options.ocrLanguages, cacheDir: options.ocrCacheDir, dpi: options.ocrDpi,
    regionBatchSize: options.ocrRegionBatchSize,
    timeoutMs: options.ocrTimeoutMs,
    maxResidentBytes: options.maxResidentBytes,
maxWorkerResidentBytes: options.maxWorkerResidentBytes,
maxTemporaryBytes: options.maxTemporaryBytes,
pageTimeoutMs: options.ocrPageTimeoutMs,
regionTimeoutMs: options.ocrRegionTimeoutMs, omitMarkdown: true,
    assertNotCancelled: options.assertNotCancelled,
    onProgress: progress => options.onProgress?.(`OCR page ${progress.page} of ${progress.totalPages}`,
      75 + Math.round(20 * (progress.pagesProcessed || 0) / Math.max(1, progress.pagesRequested || 1)), progress),
    onHeartbeat: heartbeat => observeHeartbeat("ocr", heartbeat) });
   mergeOcrPages(layoutResult, ocr);
  } catch (error) {
   if (isCancellationError(error)) throw error;
   result.warnings.push(`Scanned pages need OCR: ${error.message}`);
  }
 }
 const pending = layoutResult.visualMap.pages.filter(page => page.requiresOcr).length;
 layoutResult.visualMap.summary.pendingOcrPages = pending;
 if (pending) result.warnings.push(`${pending} pages still have OCR regions pending; native text and source images were retained.`);
}
const layoutLowReadable = hasLowReadableText(layoutResult.markdown);
const layoutSemanticLoss = analyzePdfSemanticLoss(layoutResult.markdown);
const layoutHasPageStructure = Number(layoutResult.visualMap?.pagesAnalyzed || 0) > 0
&& Array.isArray(layoutResult.visualMap?.pages);
const layoutBetter = !layoutLowReadable
&& layoutResult.markdown.trim()
&& (preferred === "scientific" || !hasText || lowReadable || layoutSemanticLoss.score < builtInSemanticLoss.score || layoutHasPageStructure);
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
result.stats.layoutCache = layoutResult.visualMap?.cache || null;
result.stats.ocr = layoutResult.ocr || null;
if (layoutResult.visualMap?.summary?.visualFallbackRegions) {
 result.warnings.push(`${layoutResult.visualMap.summary.visualFallbackRegions} regions require source-image review; visual preservation is not editable recognition.`);
}
if (layoutResult.visualMap?.summary?.failedVisualRegions) {
 result.warnings.push(`${layoutResult.visualMap.summary.failedVisualRegions} source-region images could not be rendered.`);
}
result.visualMap = layoutResult.visualMap;
if (options.mockPdfLayout === undefined) result.assetValidation = await validatePdfAssets(result, options.layoutAssetDir, layoutDetection);
result.pageCount = layoutResult.visualMap?.pageCount || result.pageCount;
const qualityStatusByPage = new Map((layoutResult.visualMap?.pages || []).map((page) => {
 const pageNumber = Number(page.page);
 const quality = derivePdfPageQuality(page);
 return [pageNumber, quality.qualityStatus];
}));
const pageStatusCounts = [...qualityStatusByPage.values()].reduce((counts, status) => {
 counts[status] = (counts[status] || 0) + 1;
 return counts;
}, {});
const unresolvedPages = [...qualityStatusByPage.values()].filter((status) => status === "unresolved").length;
const reviewPages = [...qualityStatusByPage.values()].filter((status) => status === "ocr_review_required").length;
result.extractionQuality = {
 ...(result.extractionQuality || {}),
 pageStatusCounts,
 unresolvedPages,
 reviewPages,
 ocrReviewRegions: Number(layoutResult.visualMap?.summary?.ocrReviewRegions || 0),
 pendingOcrPages: Number(layoutResult.visualMap?.summary?.pendingOcrPages || 0),
 ocrPages: Number(layoutResult.visualMap?.summary?.ocrPages || pageStatusCounts.ocr_completed || 0)
};
result.extractionQuality.failedVisualRegions = Number(layoutResult.visualMap?.summary?.failedVisualRegions || 0);
result.extractionQuality.failedVisualPages = (layoutResult.visualMap?.pages || [])
 .filter(page => (page.regions || []).some(region => region.assetStatus === "failed"))
 .map(page => Number(page.page));
result.pageLedger = createPdfPageLedgerFromMarkdown(
 layoutResult.markdown,
 Number.isInteger(result.pageCount) ? result.pageCount : null,
 { qualityStatusByPage }
);
if (Number.isInteger(result.pageCount)
 && Number.isInteger(layoutResult.visualMap?.pagesAnalyzed)
 && layoutResult.visualMap.pagesAnalyzed < result.pageCount) {
 result.partial = true;
 result.warnings.push(`Only PDF pages ${layoutResult.visualMap.pageRange?.start || 1}-${layoutResult.visualMap.pageRange?.end || layoutResult.visualMap.pagesAnalyzed} were processed; remaining pages require a resumed page-window job.`);
}
 result.warnings.push(layoutSemanticLoss.formulaDamageLikely
 ? "Layout-aware PDF extraction improved the text layout, but mathematical font encoding is still damaged. Do not rely on formulas until a high-fidelity reconstruction is used."
 : "Layout-aware PDF extraction preserved page markers and recovered mathematical glyphs that were damaged in the built-in text stream.");
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
attachResources();
return result;
}
} catch (error) {
if (isCancellationError(error)) throw error;
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
// Unexpected parser/worker failures must be visible to the task. Falling
// through here used to discard all committed graphics and OCR the whole book.
throw Object.assign(error, { code: error.code || "PDF_LAYOUT_FAILED", backend: "pdfplumber",
 attempts: result.attempts, resources: resourceTracker });
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
attachResources();
return result;
}
} catch (e) {
if (isCancellationError(e)) throw e;
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
attachResources();
return result;
}
} catch (e) {
if (isCancellationError(e)) throw e;
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
attachResources();
return result;
}
} catch (e) {
if (isCancellationError(e)) throw e;
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
if (options.assertNotCancelled) await options.assertNotCancelled();
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
 failedPages: Array.isArray(options.mockOcrFailedPages)
 ? options.mockOcrFailedPages.map((page) => ({ page: Number(page), error: "mock OCR failure" }))
 : []
}
: await extractPdfWithOcr(sourcePath, {
detection: ocrDetection,
cacheDir: options.ocrCacheDir,
assertNotCancelled: options.assertNotCancelled,
languages: options.ocrLanguages,
dpi: options.ocrDpi,
pageTimeoutMs: options.ocrPageTimeoutMs,
timeoutMs: options.ocrTimeoutMs,
maxResidentBytes: options.maxResidentBytes,
maxWorkerResidentBytes: options.maxWorkerResidentBytes,
maxTemporaryBytes: options.maxTemporaryBytes,
pageTimeoutMs: options.ocrPageTimeoutMs,
regionTimeoutMs: options.ocrRegionTimeoutMs,
onHeartbeat: heartbeat => observeHeartbeat("ocr", heartbeat),
onProgress: ({ percent, page, totalPages, endPage }) => {
if (options.onProgress) options.onProgress(`OCR page ${page} of ${totalPages || endPage}`, 85 + Math.round(percent * 0.14));
}
});
if (options.onProgress && ocrResult.failedPages?.length) {
for (const failedPage of ocrResult.failedPages) {
options.onProgress(`OCR failed page ${failedPage.page} of ${ocrResult.pageCount}`, 85);
}
}
const ocrLowReadable = hasLowReadableText(ocrResult.markdown);
const ocrSuccess = ocrResult.markdown.trim() && !ocrLowReadable && ocrResult.extractedCharacters !== 0;
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
resources: ocrResult.resources,
pageCount: ocrResult.pageCount,
pagesProcessed: ocrResult.pagesProcessed,
failedPages: ocrResult.failedPages?.length || 0,
languages: ocrResult.languages || options.ocrLanguages || "auto"
};
result.pageCount = ocrResult.pageCount || result.pageCount;
const ocrQualityStatusByPage = new Map((ocrResult.pages || []).map((page) => [
 Number(page.page),
 page.status === "completed" && String(page.text || "").trim() ? "ocr_completed" : "ocr_required"
]));
result.extractionQuality = {
 ...(result.extractionQuality || {}),
 pageStatusCounts: [...ocrQualityStatusByPage.values()].reduce((counts, status) => {
  counts[status] = (counts[status] || 0) + 1;
  return counts;
 }, {}),
 pendingOcrPages: [...ocrQualityStatusByPage.values()].filter((status) => status === "ocr_required").length,
 ocrPages: [...ocrQualityStatusByPage.values()].filter((status) => status === "ocr_completed").length
};
result.pageLedger = createPdfPageLedgerFromMarkdown(result.markdown, result.pageCount, {
 qualityStatusByPage: ocrQualityStatusByPage
});
if (ocrResult.pages) result.visualMap = {
 schema: "schema-docs.pdf-visual-map.v2", pageCount: result.pageCount, pagesAnalyzed: ocrResult.pagesProcessed,
 pageRange: ocrResult.pageRange,
 summary: { ocrPages: ocrResult.pages.filter(p => p.status === "completed" && p.text.trim()).length,
  pendingOcrPages: ocrResult.pages.filter(p => p.status !== "completed" || !p.text.trim()).length },
 pages: ocrResult.pages.map(p => ({ page: p.page, width: p.width, height: p.height, regions: [],
  ocr: p, requiresOcr: p.status !== "completed" || !p.text.trim() }))
};
result.warnings.push("Text was recovered with local OCR. Formula notation, tables, handwriting, and reading order still require visual review against the original PDF.");
if (ocrResult.failedPages?.length) result.warnings.push(`${ocrResult.failedPages.length} PDF pages could not be OCR-processed and remain explicitly marked in Markdown.`);
if (options.onProgress) options.onProgress("OCR Markdown generated", 100);
attachResources();
return result;
}
} catch (error) {
if (isCancellationError(error)) throw error;
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
const preferredTextAttempt = preferred === "pdftotext"
? { ran: pdftotextRan, markdown: pdftotextMarkdown, name: "pdftotext" }
: preferred === "mutool"
? { ran: mutoolRan, markdown: mutoolMarkdown, name: "mutool" }
: preferred === "pandoc"
? { ran: pandocRan, markdown: pandocMarkdown, name: "pandoc" }
: null;
const preferredTextRecord = preferredTextAttempt
? result.attempts.find((attempt) => attempt.name === preferredTextAttempt.name)
: null;
const preferredTextHasOutput = Boolean(
preferredTextAttempt?.ran
&& pdfBodyText(preferredTextAttempt.markdown)
&& preferredTextRecord?.status !== "failed"
&& preferredTextRecord?.status !== "unavailable"
);
if (preferred !== "auto"
&& preferred !== "built-in"
&& !builtInRan
&& !result.markdown.trim()
&& !preferredTextHasOutput) {
await runBuiltInExtraction({ lateFallback: true });
const requestedAttemptName = preferred === "ocr"
? "tesseract-ocr"
: (preferred === "scientific" ? "pdfplumber" : preferred);
const requestedStatus = result.attempts.find((attempt) => attempt.name === requestedAttemptName)?.status || "no usable output";
result.warnings.push(`Requested ${preferred} extractor did not produce usable Markdown (${requestedStatus}). Built-in extraction was preserved instead.`);
}
if (options.onProgress) {
options.onProgress("Building readable Markdown", 95);
}
if (preferred !== "auto" && preferred !== "built-in") {
let preferredTextSelected = false;
if (preferredTextHasOutput) {
result.markdown = preferredTextAttempt.markdown;
result.extractorName = preferredTextAttempt.name;
result.textLayerDetected = true;
result.lowReadableText = preferredTextRecord.lowReadableText;
preferredTextSelected = true;
}
if (!preferredTextSelected) {
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
result.warnings.push("Body text is readable, but mathematical formulas contain damaged font encoding. The Office workflow preserves mapped formula regions as source-linked visuals; review them before relying on the document or sending it to AI.");
}
if (!result.textLayerDetected) {
result.warnings.push("No readable text layer detected. OCR required.");
} else if (result.lowReadableText) {
result.warnings.push("All extraction fallbacks produced low-readable text. OCR recommended.");
}
if (options.onProgress) {
options.onProgress("Done", 100);
}
if (largeInput && !String(result.markdown || "").trim()) {
 const error = new Error("Large PDF could not be processed by the page-window backend; no full-buffer fallback was attempted.");
 error.code = "PDF_LAYOUT_ADAPTER_UNAVAILABLE";
 throw error;
}
attachResources();
return result;
}
