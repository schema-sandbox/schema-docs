import path from "node:path";
import { appendFile, writeFile } from "node:fs/promises";
import { createId, nowIso } from "./ids.js";
import { computeBufferHash } from "./records.js";
import { detectAdapterCapabilities } from "./adapterCapabilities.js";
function adapterSnapshot(key, adapter) {
if (!adapter) return null;
return {
key,
name: adapter.name,
command: adapter.command,
required: adapter.required,
mode: adapter.mode,
available: adapter.available,
version: adapter.version,
fallback: adapter.fallback,
sendGateImpact: adapter.sendGateImpact
};
}
async function requiredAdaptersForQuality(inputType, flags) {
if (inputType !== "pdf" || (!flags.scannedLikely && !flags.imageOnlyLikely && !flags.formulaDamageLikely)) {
return [];
}
const capabilities = await detectAdapterCapabilities();
const tesseract = adapterSnapshot("tesseract", capabilities.tesseract);
const marker = adapterSnapshot("marker", capabilities.marker);
const adapters = [];
if (flags.scannedLikely || flags.imageOnlyLikely) {
if (tesseract) adapters.push({
...tesseract,
neededFor: "ocr_text_extraction",
missingWarning: tesseract.available ? "" : "ocr_adapter_missing"
});
}
if (flags.formulaDamageLikely && marker) {
adapters.push({
...marker,
neededFor: "mathematical_layout_reconstruction",
missingWarning: marker.available ? "" : "marker_adapter_missing"
});
}
return adapters;
}
export function estimateTables(markdown) {
const matches = markdown.match(/\|[^\r\n]*\|\r?\n\|[\s-|-:\s]*\|/g);
return matches ? matches.length : 0;
}
export async function createQualityReport(workspacePath, recordId, inputPath, inputType, outputMarkdownPath, markdown, resultQuality, resultWarnings) {
const charCount = markdown.length;
const estimatedPages = Math.max(1, Math.ceil(charCount / 2000));
const estimatedTables = estimateTables(markdown);
const textLayerDetected = resultQuality?.textLayerDetected ?? resultQuality?.hasTextLayer ?? true;
const scannedLikely = resultQuality?.scannedLikely ?? resultQuality?.hasOcrMissing ?? false;
const tableSimplified = resultQuality?.tableSimplified ?? resultQuality?.hasTablesSimplified ?? false;
const layoutSimplified = resultQuality?.layoutSimplified ?? false;
const expectedPdfPages = Number(resultQuality?.pageCount ?? resultQuality?.sourcePageCount ?? resultQuality?.visualMap?.pageCount ?? 0);
const analyzedPdfPages = Number(resultQuality?.pagesAnalyzed ?? resultQuality?.visualMap?.pagesAnalyzed ?? 0);
const pageWindowComplete = inputType === "pdf"
  && Number.isFinite(expectedPdfPages) && expectedPdfPages > 0
  && Number.isFinite(analyzedPdfPages) && analyzedPdfPages >= expectedPdfPages;
const partialExtraction = resultQuality?.partial === true && !pageWindowComplete;
const visualFallbackRegions = Number(resultQuality?.visualFallbackRegions || 0);
const failedVisualRegions = Number(resultQuality?.failedVisualRegions || 0);
const pendingOcrPages = Number(resultQuality?.pendingOcrPages || 0);
const ocrPages = Number(resultQuality?.ocrPages || 0);
const pageStatusCounts = resultQuality?.pageStatusCounts && typeof resultQuality.pageStatusCounts === "object"
 ? resultQuality.pageStatusCounts : {};
const unresolvedPages = Number(resultQuality?.unresolvedPages || pageStatusCounts.unresolved || 0);
const reviewPages = Number(resultQuality?.reviewPages || pageStatusCounts.ocr_review_required || 0);
const ocrReviewRegions = Number(resultQuality?.ocrReviewRegions || 0);
const continuationDecisions = resultQuality?.continuationDecisions || [];
const continuationCandidates = continuationDecisions.filter(item => item.status === "candidate").length;
const readingOrderConflicts = resultQuality?.readingOrderConflicts || [];
const possibleMojibake = resultQuality?.possibleMojibake ?? markdown.includes("\ufffd");
const semanticLoss = resultQuality?.semanticLoss || {};
const formulaDamageLikely = resultQuality?.formulaDamageLikely ?? Boolean(semanticLoss.formulaDamageLikely);
const formulaEncodingArtifacts = Number(resultQuality?.formulaEncodingArtifacts ?? semanticLoss.octalArtifacts ?? 0);
const cidArtifacts = Number(resultQuality?.cidArtifacts ?? semanticLoss.cidArtifacts ?? 0);
const privateUseArtifacts = Number(resultQuality?.privateUseArtifacts ?? semanticLoss.privateUseArtifacts ?? 0);
const unsupportedFeatures = Array.isArray(resultQuality?.unsupportedFeatures) ? resultQuality.unsupportedFeatures : [];
const imageOnlyLikely = !textLayerDetected || charCount === 0 || markdown.trim() === `<!-- conversion-note: no simple text layer was detected -->`;
const requiredAdapters = await requiredAdaptersForQuality(inputType, { scannedLikely, imageOnlyLikely, formulaDamageLikely });
const missingAdapters = requiredAdapters.filter((adapter) => !adapter.available);
let confidence = "high";
if (possibleMojibake || tableSimplified || partialExtraction) {
confidence = "medium";
}
if (scannedLikely || imageOnlyLikely || charCount < 100) {
confidence = "low";
}
if (resultQuality?.confidence) {
confidence = resultQuality.confidence;
}
let recommendedNextAction = "None. Document extraction is ready for AI exchange.";
if (scannedLikely || imageOnlyLikely) {
recommendedNextAction = "Run OCR enhancement on this scanned document.";
} else if (formulaDamageLikely) {
recommendedNextAction = "Mathematical notation was damaged during extraction. Retry with local Marker full-page reconstruction before relying on formulas or sending this document to AI.";
} else if (possibleMojibake) {
recommendedNextAction = "Verify text encoding or check missing CJK CID fonts.";
} else if (tableSimplified) {
recommendedNextAction = "Inspect merged table cells manually in the output.";
}
const activeWarnings = [];
if (continuationCandidates) activeWarnings.push("continuationReview");
if (readingOrderConflicts.length) activeWarnings.push("readingOrderReview");
if (scannedLikely || imageOnlyLikely) activeWarnings.push("scannedLikely");
for (const adapter of missingAdapters) {
if (adapter.missingWarning) activeWarnings.push(adapter.missingWarning);
}
if (tableSimplified) activeWarnings.push("tableSimplified");
if (partialExtraction) activeWarnings.push("partialExtraction");
if (visualFallbackRegions) activeWarnings.push("visualFallbackReview");
if (failedVisualRegions) activeWarnings.push("visualRenderFailed");
if (pendingOcrPages) activeWarnings.push("pagesNeedOcr");
if (ocrPages) activeWarnings.push("ocrReview");
if (unresolvedPages) activeWarnings.push("unresolvedPages");
if (reviewPages || ocrReviewRegions) activeWarnings.push("ocrRegionReview");
if (possibleMojibake) activeWarnings.push("possibleMojibake");
if (formulaDamageLikely) activeWarnings.push("formulaDamageLikely");
const matchedKnownLimits = [];
if (scannedLikely || imageOnlyLikely) matchedKnownLimits.push("ocr_unsupported");
if (missingAdapters.some((adapter) => adapter.key === "tesseract")) matchedKnownLimits.push("ocr_adapter_missing");
if (inputType === "pdf" && (tableSimplified || layoutSimplified)) matchedKnownLimits.push("complex_pdf_layout");
if (inputType === "pdf" && partialExtraction) matchedKnownLimits.push("pdf_page_window_partial");
if (inputType === "pdf" && unresolvedPages) matchedKnownLimits.push("pdf_page_content_unresolved");
if (inputType === "pdf" && formulaDamageLikely) matchedKnownLimits.push("pdf_formula_semantic_loss");
if (inputType === "pdf" && unsupportedFeatures.some((feature) => ["images", "formulas", "embedded_objects"].includes(feature))) {
matchedKnownLimits.push("pdf_rich_objects_unsupported");
}
if (inputType === "docx" && unsupportedFeatures.some((feature) => ["images", "formulas", "smartart", "embedded_objects"].includes(feature))) {
matchedKnownLimits.push("docx_rich_layout_unsupported");
}
if (inputType === "docx" && unsupportedFeatures.some((feature) => ["macros", "vba"].includes(feature))) {
matchedKnownLimits.push("docx_macros_vba_unsupported");
}
const suggestedActions = [];
if (continuationCandidates) suggestedActions.push("Review uncertain page-break continuations against the source; their text remains separate.");
if (readingOrderConflicts.length) suggestedActions.push("Review pages with conflicting reading-order evidence; their source order was preserved.");
if (pendingOcrPages) suggestedActions.push("Some source pages still require OCR; review the retained PDF before using the full document.");
if (ocrPages) suggestedActions.push("Review OCR text, numbers, formulas, and reading order against the source pages.");
if (visualFallbackRegions || failedVisualRegions) {
 suggestedActions.push("Review source-linked regions against the original document; preserved images are not verified editable text.");
}
if (missingAdapters.some((adapter) => adapter.key === "tesseract")) {
suggestedActions.push("Install Tesseract OCR or provide a text-layer PDF before AI Send Gate.");
}
if (scannedLikely || imageOnlyLikely) {
suggestedActions.push("OCR is required. Use a text-layer PDF or run OCR enhancement before sending to AI.");
}
if (formulaDamageLikely) {
const marker = requiredAdapters.find((adapter) => adapter.key === "marker");
suggestedActions.push(marker?.available
? "Retry with Marker full-page reconstruction. Its local math model can rebuild reading order and editable LaTeX."
 : "Install the optional local Marker adapter, then retry with Marker full-page reconstruction for editable mathematical notation.");
}
if (tableSimplified) {
suggestedActions.push("Review simplified tables manually, or export them to CSV for cleanup.");
}
if (partialExtraction) {
 suggestedActions.push("Resume the remaining PDF page window before treating the document as complete.");
}
if (unresolvedPages) {
 suggestedActions.push(`${unresolvedPages} PDF pages contain unresolved regions or failed visual preservation; review or retry those pages before using the document.`);
}
if (reviewPages || ocrReviewRegions) {
 suggestedActions.push(`${ocrReviewRegions || "Some"} OCR region(s) retain visual content without verified editable text; review those source-linked regions before relying on the text.`);
}
if (possibleMojibake) {
suggestedActions.push("Check the file encoding, source language settings, or missing CJK font mappings.");
}
if (suggestedActions.length === 0) {
 suggestedActions.push("Document quality looks ready. You can create an exchange package or run a local SQL query next.");
}
recommendedNextAction = suggestedActions[0] || recommendedNextAction;
const whetherAiSendGateBlocked = confidence === "low" || formulaDamageLikely || visualFallbackRegions > 0 || failedVisualRegions > 0 || pendingOcrPages > 0 || unresolvedPages > 0 || reviewPages > 0 || ocrReviewRegions > 0;
const whetherUserCanOverride = true;
const recommendedNextStep = suggestedActions[0] || "None. Document extraction is ready for AI exchange.";

let qualityState = "clean_readable";
if (scannedLikely || imageOnlyLikely || pendingOcrPages) {
 qualityState = "ocr_required";
} else if (unresolvedPages || reviewPages || ocrReviewRegions) {
 qualityState = "review_required";
} else if (formulaDamageLikely) {
 qualityState = "formula_reconstruction_required";
} else if (confidence === "medium" || possibleMojibake || tableSimplified || partialExtraction || visualFallbackRegions || failedVisualRegions || ocrPages || continuationCandidates || readingOrderConflicts.length) {
 qualityState = "review_required";
} else if (confidence === "low") {
 qualityState = "blocked_untrusted";
}

const report = {
id: createId("quality"),
recordId,
inputPath,
inputType,
outputMarkdownPath,
textLayerDetected,
scannedLikely,
extractedCharCount: charCount,
pageCountEstimate: estimatedPages,
tableCountEstimate: estimatedTables,
tableSimplified,
layoutSimplified,
partialExtraction,
visualFallbackRegions,
failedVisualRegions,
pendingOcrPages,
reviewPages,
ocrReviewRegions,
ocrPages,
pageStatusCounts,
unresolvedPages,
continuationCandidates,
continuationDecisions,
readingOrderConflicts,
sourceMarkdownHash: computeBufferHash(Buffer.from(markdown, "utf8")),
imageOnlyLikely,
possibleMojibake,
formulaDamageLikely,
formulaEncodingArtifacts,
cidArtifacts,
privateUseArtifacts,
unsupportedFeatures,
requiredAdapters,
missingAdapters,
adapterGuidance: missingAdapters.map((adapter) => ({
adapter: adapter.key,
action: adapter.fallback,
sendGateImpact: adapter.sendGateImpact
})),
warnings: resultWarnings ?? [],
activeWarnings,
confidence,
qualityState,
recommendedNextAction,
matchedKnownLimits,
suggestedActions,
whetherAiSendGateBlocked,
whetherUserCanOverride,
recommendedNextStep,
createdAt: nowIso()
};
const qualityLogPath = path.join(workspacePath, ".ai-doc-exchange", "logs", "conversion-quality.jsonl");
await appendFile(qualityLogPath, JSON.stringify(report) + "\n", "utf8");
const qualityPath = outputMarkdownPath.replace(/\.md$/, ".quality.json");
await writeFile(qualityPath, JSON.stringify(report, null, 2), "utf8");
return report;
}
