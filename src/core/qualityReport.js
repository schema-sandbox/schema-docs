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
if (inputType !== "pdf" || (!flags.scannedLikely && !flags.imageOnlyLikely)) {
return [];
}
const capabilities = await detectAdapterCapabilities();
const tesseract = adapterSnapshot("tesseract", capabilities.tesseract);
return tesseract ? [{
...tesseract,
neededFor: "ocr_text_extraction",
missingWarning: tesseract.available ? "" : "ocr_adapter_missing"
}] : [];
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
const possibleMojibake = resultQuality?.possibleMojibake ?? markdown.includes("\ufffd");
const unsupportedFeatures = Array.isArray(resultQuality?.unsupportedFeatures) ? resultQuality.unsupportedFeatures : [];
const imageOnlyLikely = !textLayerDetected || charCount === 0 || markdown.trim() === `<!-- conversion-note: no simple text layer was detected -->`;
const requiredAdapters = await requiredAdaptersForQuality(inputType, { scannedLikely, imageOnlyLikely });
const missingAdapters = requiredAdapters.filter((adapter) => !adapter.available);
let confidence = "high";
if (possibleMojibake || tableSimplified) {
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
} else if (possibleMojibake) {
recommendedNextAction = "Verify text encoding or check missing CJK CID fonts.";
} else if (tableSimplified) {
recommendedNextAction = "Inspect merged table cells manually in the output.";
}
const activeWarnings = [];
if (scannedLikely || imageOnlyLikely) activeWarnings.push("scannedLikely");
for (const adapter of missingAdapters) {
if (adapter.missingWarning) activeWarnings.push(adapter.missingWarning);
}
if (tableSimplified) activeWarnings.push("tableSimplified");
if (possibleMojibake) activeWarnings.push("possibleMojibake");
const matchedKnownLimits = [];
if (scannedLikely || imageOnlyLikely) matchedKnownLimits.push("ocr_unsupported");
if (missingAdapters.some((adapter) => adapter.key === "tesseract")) matchedKnownLimits.push("ocr_adapter_missing");
if (inputType === "pdf" && (tableSimplified || layoutSimplified)) matchedKnownLimits.push("complex_pdf_layout");
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
if (missingAdapters.some((adapter) => adapter.key === "tesseract")) {
suggestedActions.push("Install Tesseract OCR or provide a text-layer PDF before AI Send Gate.");
}
if (scannedLikely || imageOnlyLikely) {
suggestedActions.push("OCR is required. Use a text-layer PDF or run OCR enhancement before sending to AI.");
}
if (tableSimplified) {
suggestedActions.push("Review simplified tables manually, or export them to CSV for cleanup.");
}
if (possibleMojibake) {
suggestedActions.push("Check the file encoding, source language settings, or missing CJK font mappings.");
}
if (suggestedActions.length === 0) {
suggestedActions.push("Document quality looks ready. You can create an exchange package or run a local SQL query next.");
}
const whetherAiSendGateBlocked = confidence === "low";
const whetherUserCanOverride = true;
const recommendedNextStep = suggestedActions[0] || "None. Document extraction is ready for AI exchange.";

let qualityState = "clean_readable";
if (scannedLikely || imageOnlyLikely) {
 qualityState = "ocr_required";
} else if (confidence === "medium" || possibleMojibake || tableSimplified) {
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
imageOnlyLikely,
possibleMojibake,
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