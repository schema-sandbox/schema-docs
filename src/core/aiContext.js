import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readManifest } from "./manifest.js";
import { readExchangePackage } from "./exchangePackage.js";
import { appendEvidenceRecord } from "./evidence.js";
import { appendTimelineEvent } from "./timeline.js";
export function renderDatasetMarkdown(dataset) {
const lines = [
`# ${dataset.name}`,
"",
`Source type: ${dataset.sourceType}`,
`Status: ${dataset.status}`,
""
];
const sheets = dataset.sheets ?? [];
if (sheets.length === 0) {
lines.push("No table preview is available yet. Inspect the spreadsheet before sending it to AI.");
return lines.join("\n");
}
for (const sheet of sheets) {
lines.push(`## ${sheet.name || sheet.sheetId}`);
lines.push("");
const columnNames = (sheet.columns ?? []).map((column) => {
if (typeof column === "string") return column;
return column?.name ?? column?.id ?? "";
}).filter(Boolean);
lines.push(`Columns: ${columnNames.join(", ") || "none"}`);
lines.push(`Preview rows: ${(sheet.previewRows ?? []).length}`);
lines.push("");
const previewRows = (sheet.previewRows ?? []).slice(0, 8);
if (previewRows.length > 0 && columnNames.length > 0) {
const columns = columnNames.slice(0, 12);
lines.push(`| ${columns.join(" | ")} |`);
lines.push(`| ${columns.map(() => "---").join(" | ")} |`);
for (const row of previewRows) {
lines.push(`| ${columns.map((column) => String(row[column] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`);
}
lines.push("");
}
}
return lines.join("\n");
}
const DEFAULT_CHUNK_TOKEN_BUDGET = 3000;
const DEFAULT_CHUNK_OVERLAP_TOKENS = 200;
const DEFAULT_BUNDLE_TOKEN_BUDGET = 9000;
const TOKEN_CHAR_RATIO = 4;
const MAX_PREVIEW_CHUNKS = 20;
function estimateTokens(text) {
return Math.ceil(String(text ?? "").length / TOKEN_CHAR_RATIO);
}
function hashText(text) {
return `sha256:${createHash("sha256").update(String(text ?? ""), "utf8").digest("hex")}`;
}
async function recordAiContextEvidence(workspacePath, input) {
const evidence = await appendEvidenceRecord(workspacePath, {
kind: input.kind,
sourceRef: input.recordIdOrPackagePath,
outputType: input.outputType,
converter: "ai_context_resolver",
aiSent: false,
sentContentHash: hashText(input.content),
storeRawPrompt: false,
policyDecision: "local_ai_context_selected",
sendGateDecision: input.sendGateDecision,
sendGateSignals: input.qualityWarnings ?? [],
estimatedTokens: input.tokenEstimate,
selectionRange: input.selectionRange,
continuation: input.continuation,
userConfirmed: false
});
const timeline = await appendTimelineEvent(
workspacePath,
input.recordIdOrPackagePath,
input.timelineType,
input.summary,
{
evidenceId: evidence.id,
policyDecision: "local_ai_context_selected",
selectionRange: input.selectionRange,
continuation: input.continuation
}
);
return { evidence, timeline };
}
function getChunkGeometry(text) {
const chunkTokenBudget = DEFAULT_CHUNK_TOKEN_BUDGET;
const overlapTokens = DEFAULT_CHUNK_OVERLAP_TOKENS;
const chunkCharBudget = chunkTokenBudget * TOKEN_CHAR_RATIO;
const overlapChars = overlapTokens * TOKEN_CHAR_RATIO;
const stride = Math.max(1, chunkCharBudget - overlapChars);
const chunkCount = text.length === 0 ? 0 : Math.ceil(Math.max(1, text.length - overlapChars) / stride);
return {
chunkTokenBudget,
overlapTokens,
chunkCharBudget,
overlapChars,
stride,
chunkCount
};
}
function buildChunkDescriptor(text, index, geometry = getChunkGeometry(text)) {
if (index < 1 || index > geometry.chunkCount) return null;
const startChar = (index - 1) * geometry.stride;
const endChar = Math.min(text.length, startChar + geometry.chunkCharBudget);
const slice = text.slice(startChar, endChar);
const headingMatch = slice.match(/^#{1,6}\s+(.+)$/m);
return {
id: `chunk_${String(index).padStart(4, "0")}`,
index,
startChar,
endChar,
estimatedTokens: estimateTokens(slice),
headingHint: headingMatch ? headingMatch[0] : ""
};
}
function suggestedRangeChunkCount(chunkTokenBudget = DEFAULT_CHUNK_TOKEN_BUDGET, tokenBudget = DEFAULT_BUNDLE_TOKEN_BUDGET) {
return Math.max(1, Math.floor(Number(tokenBudget) / Math.max(1, Number(chunkTokenBudget))));
}
function hasQualityBlocker(qualityWarnings = []) {
return qualityWarnings.includes("scannedLikely") || qualityWarnings.includes("ocr_adapter_missing");
}
function isExchangePackageRef(recordIdOrPackagePath) {
const value = String(recordIdOrPackagePath ?? "");
return value.startsWith("packages/")
|| value.includes("packages\\")
  || (!value.startsWith("doc_") && !value.startsWith("dataset_"));
}
function chunkCommand(recordIdOrPackagePath, chunkIndex) {
 return chunkIndex ? `ai-context <workspace> chunk ${recordIdOrPackagePath} ${chunkIndex}` : "";
}
function rangeCommand(recordIdOrPackagePath, startChunkIndex, endChunkIndex, tokenBudget) {
 return startChunkIndex
  ? `ai-context <workspace> range ${recordIdOrPackagePath} ${startChunkIndex} ${endChunkIndex} ${tokenBudget}`
  : "";
}
function buildBatchPlanPreview(recordIdOrPackagePath, plan, tokenBudget = DEFAULT_BUNDLE_TOKEN_BUDGET) {
 const totalChunkCount = Math.max(0, Number(plan?.chunkCount) || 0);
 const rangeWidth = Math.max(1, suggestedRangeChunkCount(plan?.chunkTokenBudget, tokenBudget));
 const totalBatchCount = totalChunkCount > 0 ? Math.ceil(totalChunkCount / rangeWidth) : 0;
 const previewLimit = 5;
 const batchForIndex = (batchIndex) => {
  const startChunkIndex = ((batchIndex - 1) * rangeWidth) + 1;
  const endChunkIndex = Math.min(totalChunkCount, startChunkIndex + rangeWidth - 1);
  return {
   batchIndex,
   startChunkIndex,
   endChunkIndex,
   tokenBudget,
   command: rangeCommand(recordIdOrPackagePath, startChunkIndex, endChunkIndex, tokenBudget)
  };
 };
 const previewBatchCount = Math.min(totalBatchCount, previewLimit);
 const batches = Array.from({ length: previewBatchCount }, (_, index) => batchForIndex(index + 1));
 const finalBatch = totalBatchCount > previewBatchCount ? batchForIndex(totalBatchCount) : null;
 return {
  totalBatchCount,
  previewBatchCount,
  truncated: totalBatchCount > previewBatchCount,
  omittedBatchCount: Math.max(0, totalBatchCount - previewBatchCount - (finalBatch ? 1 : 0)),
  rangeWidth,
  tokenBudget,
  batches,
  finalBatch
 };
}
function chunkProgress(completedChunks, totalChunkCount) {
 const total = Math.max(0, Number(totalChunkCount) || 0);
 const completed = Math.min(total, Math.max(0, Number(completedChunks) || 0));
 return {
  completedChunks: completed,
  remainingChunks: Math.max(0, total - completed),
  percentComplete: total > 0 ? Math.round((completed / total) * 100) : 100
 };
}
function continuationState(recordIdOrPackagePath, plan, completedChunks = 0, options = {}) {
 const totalChunkCount = Math.max(0, Number(plan?.chunkCount) || 0);
 const completed = Math.min(totalChunkCount, Math.max(0, Number(completedChunks) || 0));
 const tokenBudget = Math.max(1, Number(options.tokenBudget ?? plan?.defaultRangeTokenBudget ?? DEFAULT_BUNDLE_TOKEN_BUDGET));
 const rangeWidth = Math.max(1, Number(options.rangeWidth) || suggestedRangeChunkCount(plan?.chunkTokenBudget, tokenBudget));
 const nextChunkIndex = completed < totalChunkCount ? completed + 1 : null;
 const nextRangeEnd = nextChunkIndex
  ? Math.min(totalChunkCount, nextChunkIndex + rangeWidth - 1)
  : null;
 return {
  canContinue: Boolean(nextChunkIndex),
  completedChunks: completed,
  remainingChunks: Math.max(0, totalChunkCount - completed),
  totalChunkCount,
  remainingRangeCount: nextChunkIndex
   ? Math.ceil((totalChunkCount - nextChunkIndex + 1) / rangeWidth)
   : 0,
  currentChunkIndex: options.currentChunkIndex ?? null,
  currentRange: options.currentRange ?? null,
  currentCommand: options.currentCommand ?? "",
  nextChunkIndex,
  nextRangeStartChunkIndex: nextChunkIndex,
  nextRangeEndChunkIndex: nextRangeEnd,
  nextChunkCommand: chunkCommand(recordIdOrPackagePath, nextChunkIndex),
  nextRangeCommand: rangeCommand(recordIdOrPackagePath, nextChunkIndex, nextRangeEnd, tokenBudget),
  recommendedMode: totalChunkCount > 1 ? "range_then_confirm" : "single_reviewed_context"
 };
}
function buildFeedingPlan(plan, qualityWarnings = [], sourceSize = 0) {
 const tokenEstimate = Math.max(0, Number(plan?.tokenEstimate) || 0);
 const chunkCount = Math.max(0, Number(plan?.chunkCount) || 0);
 const estimatedRangeCount = Math.max(0, Number(plan?.estimatedRangeCount) || 0);
 const sourceBytes = Math.max(0, Number(sourceSize) || 0);
 const isUltraLarge = tokenEstimate >= 250_000 || chunkCount >= 80 || sourceBytes >= 50 * 1024 * 1024;
 const isLarge = isUltraLarge || chunkCount > 1 || tokenEstimate > DEFAULT_CHUNK_TOKEN_BUDGET * 2;
 const qualityBlocked = hasQualityBlocker(qualityWarnings);
 const mode = !isLarge
  ? "single_review"
  : (isUltraLarge ? "background_range_feeding" : "reviewed_range_feeding");
 const reasons = [];
 if (chunkCount > 1) {
  reasons.push("chunked_context_required");
 }
 if (isUltraLarge) {
  reasons.push("ultra_large_document");
 }
 if (sourceBytes >= 25 * 1024 * 1024) {
  reasons.push("large_source_file");
 }
 if (qualityBlocked) {
  reasons.push("quality_review_required");
 }
 return {
  mode,
  priority: isUltraLarge ? "ultra_large" : (isLarge ? "large" : "normal"),
  bodyFree: true,
  sendsContentAutomatically: false,
  requiresSendGatePerBatch: true,
  recommendedBatchTokenBudget: plan?.defaultRangeTokenBudget ?? DEFAULT_BUNDLE_TOKEN_BUDGET,
  recommendedChunksPerBatch: plan?.suggestedRangeChunkCount ?? 1,
  estimatedBatchCount: estimatedRangeCount,
  estimatedTotalTokens: tokenEstimate,
  estimatedTotalChunks: chunkCount,
  suitableForContinuousAgentLoop: isLarge && !qualityBlocked,
  expectedOperatorAction: isLarge
   ? "Review each generated range in Send Gate, then confirm or continue."
   : "Review the prepared context once in Send Gate, then confirm.",
  reasons
 };
}
export function buildAiIntakePlan(markdown, metadata = {}, qualityWarnings = []) {
 const text = String(markdown ?? "");
 const tokenEstimate = estimateTokens(text);
 const sourceSize = Number(metadata.sourceSize ?? 0);
 const geometry = getChunkGeometry(text);
 const { chunkTokenBudget, overlapTokens, chunkCount } = geometry;
 const isLargeByTokens = tokenEstimate > chunkTokenBudget * 2;
 const isLargeByBytes = sourceSize > 25 * 1024 * 1024;
 const hasOcrRisk = hasQualityBlocker(qualityWarnings);
 const rangeChunkCount = suggestedRangeChunkCount(chunkTokenBudget, DEFAULT_BUNDLE_TOKEN_BUDGET);
 const estimatedRangeCount = chunkCount > 0 ? Math.ceil(chunkCount / rangeChunkCount) : 0;
 const mode = chunkCount <= 1
  ? "single_context"
  : (isLargeByTokens || isLargeByBytes ? "chunked_large_document" : "chunked_context");
 const chunks = [];
 for (let index = 0; index < Math.min(chunkCount, MAX_PREVIEW_CHUNKS); index += 1) {
  chunks.push(buildChunkDescriptor(text, index + 1, geometry));
 }
 const warnings = [];
 if (chunkCount > 1) {
  warnings.push("context_should_be_sent_in_chunks");
 }
 if (isLargeByBytes) {
  warnings.push("large_source_file_use_progressive_extraction");
 }
 if (hasOcrRisk) {
  warnings.push("quality_must_be_resolved_before_chunk_send");
 }
 return {
  mode,
  tokenEstimate,
  chunkTokenBudget,
  overlapTokens,
  defaultRangeTokenBudget: DEFAULT_BUNDLE_TOKEN_BUDGET,
  suggestedRangeChunkCount: rangeChunkCount,
  estimatedRangeCount,
  chunkCount,
  previewChunkCount: chunks.length,
  truncated: chunkCount > chunks.length,
  chunks,
  warnings,
  recommendedSendStrategy: chunkCount <= 1
   ? "Send as one reviewed context after masking."
   : "Send selected chunks or chapter ranges after local filtering; do not send the whole document blindly.",
  firstChunkRange: chunks[0]
   ? { startChar: chunks[0].startChar, endChar: chunks[0].endChar, estimatedTokens: chunks[0].estimatedTokens }
   : null,
  feedingPlan: buildFeedingPlan({
   tokenEstimate,
   chunkCount,
   estimatedRangeCount,
   defaultRangeTokenBudget: DEFAULT_BUNDLE_TOKEN_BUDGET,
   suggestedRangeChunkCount: rangeChunkCount
  }, qualityWarnings, sourceSize)
 };
}
export async function compileAiContextPreview(workspacePath, recordIdOrPackagePath) {
 let markdown = "";
 let metadata = {};
 let qualityWarnings = [];
 let knownLimits = [];
 let sendGateDecision = "allow";
 let recommendedNextAction = "Proceed with AI exchange.";
 let tokenEstimate = 0;
 let isPackage = false;
 if (isExchangePackageRef(recordIdOrPackagePath)) {
  try {
   const pkg = await readExchangePackage(workspacePath, recordIdOrPackagePath);
   isPackage = true;
   const docMdFile = pkg.files.find(f => f.path === "document.md");
   if (docMdFile) {
    markdown = await readFile(docMdFile.absolutePath, "utf8");
   } else {
    markdown = pkg.manifest.body || "";
   }
   metadata = {
    title: pkg.manifest.title,
    packageVersion: pkg.manifest.packageVersion,
    createdAt: pkg.manifest.createdAt,
    model: pkg.manifest.model,
    apiBaseUrl: pkg.manifest.apiBaseUrl,
    sourceSize: markdown.length
   };
   qualityWarnings = (pkg.manifest.conversionQuality || []).flatMap(q => q.warnings || []);
   knownLimits = pkg.manifest.knownLimits || [];
   sendGateDecision = pkg.manifest.evidence?.sendGateDecision || "allow";
   recommendedNextAction = "Exchange package is verified. Ready for external sharing.";
   tokenEstimate = estimateTokens(markdown);
  } catch (err) {
   throw new Error(`Failed to read exchange package at ${recordIdOrPackagePath}: ${err.message}`);
  }
 } else {
  const manifest = await readManifest(workspacePath);
  const doc = manifest.documents.find(d => d.id === recordIdOrPackagePath);
  const dataset = manifest.datasets.find(d => d.id === recordIdOrPackagePath);
  if (!doc && !dataset) throw new Error(`Record not found in workspace: ${recordIdOrPackagePath}`);
  if (dataset) {
   markdown = renderDatasetMarkdown(dataset);
   metadata = {
    id: dataset.id,
    title: dataset.name,
    sourceType: dataset.sourceType,
    createdAt: dataset.createdAt,
    sourceSize: dataset.sourceSize ?? 0,
    sheets: (dataset.sheets ?? []).map((sheet) => ({
     sheetId: sheet.sheetId,
     name: sheet.name,
     columns: sheet.columns?.length ?? 0,
     previewRows: sheet.previewRows?.length ?? 0
    }))
   };
   qualityWarnings = dataset.status === "ready" ? [] : ["dataset_not_inspected"];
   knownLimits = dataset.sourceType === "xlsx" ? ["xlsx_formula_macro_semantics_not_executed"] : [];
   sendGateDecision = dataset.status === "ready" ? "allow" : "blocked";
   recommendedNextAction = dataset.status === "ready"
    ? "Dataset preview is ready for AI exchange. Verify sensitive columns before sending."
    : "Inspect this spreadsheet before sending it to AI.";
   tokenEstimate = estimateTokens(markdown);
  } else {
   if (doc.outputMarkdownPath) {
    try {
     markdown = await readFile(doc.outputMarkdownPath, "utf8");
    } catch {
     markdown = "";
    }
   }
   metadata = {
    id: doc.id,
    title: doc.title,
    sourceType: doc.sourceType,
    createdAt: doc.createdAt,
    sourceSize: doc.sourceSize ?? 0
   };
   try {
    const qualityPath = doc.outputMarkdownPath.replace(/\.md$/, ".quality.json");
    const quality = JSON.parse(await readFile(qualityPath, "utf8"));
    qualityWarnings = quality.warnings || [];
    knownLimits = quality.matchedKnownLimits || [];
    sendGateDecision = quality.whetherAiSendGateBlocked ? "blocked" : "allow";
    recommendedNextAction = quality.recommendedNextStep || "Document extraction is ready for AI exchange.";
   } catch {
    qualityWarnings = doc.warnings || [];
    knownLimits = [];
    sendGateDecision = "allow";
    recommendedNextAction = "Proceed with exchange.";
   }
   tokenEstimate = estimateTokens(markdown);
  }
 }
 const headings = [];
 const lines = markdown.split("\n");
 for (const line of lines) {
  const match = /^#{1,6}\s+(.*)$/.exec(line.trim());
  if (match) {
   headings.push(match[0]);
  }
 }
 const maskedMatches = markdown.match(/\[(?:MASK|MASKED)_[A-Z0-9_]+\]/g) || [];
 const excludedOrSanitized = [...new Set(maskedMatches)];
 const isLowQuality = sendGateDecision === "blocked" || qualityWarnings.includes("scannedLikely") || markdown.length < 100;
 if (isLowQuality && !isPackage) {
  recommendedNextAction = `Low quality document detected. ${recommendedNextAction}`;
 }
 const aiIntakePlan = buildAiIntakePlan(markdown, metadata, qualityWarnings);
 if (aiIntakePlan.chunkCount > 1 && sendGateDecision !== "blocked") {
  recommendedNextAction = `${recommendedNextAction} Use chunked intake: ${aiIntakePlan.recommendedSendStrategy}`;
 }
 return {
  isPackage,
  markdownSections: headings,
  excludedOrSanitized,
  metadata,
  qualityWarnings,
  knownLimits,
  tokenEstimate,
  aiIntakePlan,
  sendGateDecision,
  recommendedNextAction
 };
}
export async function compileAiIntakeManifest(workspacePath, recordIdOrPackagePath) {
 const preview = await compileAiContextPreview(workspacePath, recordIdOrPackagePath);
 const continuation = continuationState(recordIdOrPackagePath, preview.aiIntakePlan, 0);
 const batchPlanPreview = buildBatchPlanPreview(
  recordIdOrPackagePath,
  preview.aiIntakePlan,
  preview.aiIntakePlan.defaultRangeTokenBudget
 );
 return {
  recordIdOrPackagePath,
  isPackage: preview.isPackage,
  metadata: preview.metadata,
  sendGateDecision: preview.sendGateDecision,
  tokenEstimate: preview.tokenEstimate,
  qualityWarnings: preview.qualityWarnings,
  knownLimits: preview.knownLimits,
  recommendedNextAction: preview.recommendedNextAction,
  aiIntakePlan: preview.aiIntakePlan,
  batchPlanPreview,
  continuation,
  nextChunkCommand: continuation.nextChunkCommand,
  nextRangeCommand: continuation.nextRangeCommand,
  safety: {
   requiresReviewBeforeSend: true,
   requiresMaskingReview: true,
   sendsContent: false,
   canPreviewChunks: true,
   sendAllowedAfterReview: preview.sendGateDecision !== "blocked",
   blockingWarnings: preview.sendGateDecision === "blocked" ? preview.qualityWarnings : [],
   chunkEndpoint: "/api/ai/context-chunk",
   chunkRangeEndpoint: "/api/ai/context-range"
  }
 };
}
async function readAiContextMarkdown(workspacePath, recordIdOrPackagePath) {
 if (isExchangePackageRef(recordIdOrPackagePath)) {
  const pkg = await readExchangePackage(workspacePath, recordIdOrPackagePath);
  const docMdFile = pkg.files.find((file) => file.path === "document.md");
  if (docMdFile) return readFile(docMdFile.absolutePath, "utf8");
  return pkg.manifest.body || "";
 }
 const manifest = await readManifest(workspacePath);
 const doc = manifest.documents.find((candidate) => candidate.id === recordIdOrPackagePath);
 if (doc) {
  if (!doc.outputMarkdownPath) return "";
  try {
   return await readFile(doc.outputMarkdownPath, "utf8");
  } catch {
   return "";
  }
 }
 const dataset = manifest.datasets.find((candidate) => candidate.id === recordIdOrPackagePath);
 if (dataset) return renderDatasetMarkdown(dataset);
 throw new Error(`Record not found in workspace: ${recordIdOrPackagePath}`);
}
export async function resolveAiContextChunk(workspacePath, recordIdOrPackagePath, chunkIndex = 1) {
 const preview = await compileAiContextPreview(workspacePath, recordIdOrPackagePath);
 const requestedIndex = Math.max(1, Number(chunkIndex) || 1);
 const markdown = await readAiContextMarkdown(workspacePath, recordIdOrPackagePath);
 const chunk = buildChunkDescriptor(markdown, requestedIndex);
 if (!chunk) throw new Error(`AI context chunk not found: ${requestedIndex}`);
 const content = markdown.slice(chunk.startChar, chunk.endChar);
 const continuation = continuationState(recordIdOrPackagePath, preview.aiIntakePlan, requestedIndex, {
  currentChunkIndex: requestedIndex,
  currentRange: { startChunkIndex: requestedIndex, endChunkIndex: requestedIndex },
  currentCommand: chunkCommand(recordIdOrPackagePath, requestedIndex)
 });
 const { evidence, timeline } = await recordAiContextEvidence(workspacePath, {
  kind: "ai_context_chunk_selected",
  outputType: "ai_context_chunk",
  recordIdOrPackagePath,
  content,
  tokenEstimate: estimateTokens(content),
  sendGateDecision: preview.sendGateDecision,
  qualityWarnings: preview.qualityWarnings,
  selectionRange: {
   kind: "chunk",
   chunkIndex: requestedIndex,
   startChunkIndex: requestedIndex,
   endChunkIndex: requestedIndex,
   totalChunkCount: preview.aiIntakePlan.chunkCount,
   startChar: chunk.startChar,
   endChar: chunk.endChar
  },
  continuation,
  timelineType: "ai_context_chunk_selected",
  summary: `Selected AI context chunk ${requestedIndex}/${preview.aiIntakePlan.chunkCount}`
 });
 return {
  recordIdOrPackagePath,
  chunk,
  content,
  contentLength: content.length,
  tokenEstimate: estimateTokens(content),
  evidenceId: evidence.id,
  timelineEventId: timeline?.id ?? "",
  totalChunkCount: preview.aiIntakePlan.chunkCount,
  progress: chunkProgress(requestedIndex, preview.aiIntakePlan.chunkCount),
  truncatedPlan: preview.aiIntakePlan.truncated,
  continuation,
  hasMoreChunks: continuation.canContinue,
  nextChunkIndex: continuation.nextChunkIndex,
  nextChunkCommand: continuation.nextChunkCommand,
  nextRangeCommand: continuation.nextRangeCommand,
  sendGateDecision: preview.sendGateDecision,
  qualityWarnings: preview.qualityWarnings,
  knownLimits: preview.knownLimits,
  recommendedSendStrategy: preview.aiIntakePlan.recommendedSendStrategy
 };
}
export async function resolveAiContextChunkRange(workspacePath, recordIdOrPackagePath, startChunkIndex = 1, endChunkIndex = startChunkIndex, tokenBudget = DEFAULT_BUNDLE_TOKEN_BUDGET) {
 const preview = await compileAiContextPreview(workspacePath, recordIdOrPackagePath);
 const plan = preview.aiIntakePlan;
 const startIndex = Math.max(1, Number(startChunkIndex) || 1);
 const requestedEndIndex = Math.max(startIndex, Number(endChunkIndex) || startIndex);
 const maxTokenBudget = Math.max(1, Number(tokenBudget) || DEFAULT_BUNDLE_TOKEN_BUDGET);
 const markdown = await readAiContextMarkdown(workspacePath, recordIdOrPackagePath);
 const geometry = getChunkGeometry(markdown);
 const selectedChunks = [];
 const boundedEndIndex = Math.min(requestedEndIndex, geometry.chunkCount);
 for (let index = startIndex; index <= boundedEndIndex; index += 1) {
  const chunk = buildChunkDescriptor(markdown, index, geometry);
  if (chunk) {
   selectedChunks.push(chunk);
  }
 }
 if (selectedChunks.length === 0) throw new Error(`AI context chunk range not found: ${startIndex}-${requestedEndIndex}`);
 const bundleParts = [];
 const includedChunks = [];
 let totalTokens = 0;
 let truncatedByTokenBudget = false;
 for (const chunk of selectedChunks) {
  const content = markdown.slice(chunk.startChar, chunk.endChar);
  const chunkTokens = estimateTokens(content);
  if (includedChunks.length > 0 && totalTokens + chunkTokens > maxTokenBudget) {
   truncatedByTokenBudget = true;
   break;
  }
  if (includedChunks.length === 0 && chunkTokens > maxTokenBudget) {
   truncatedByTokenBudget = true;
  }
  includedChunks.push({
   id: chunk.id,
   index: chunk.index,
   startChar: chunk.startChar,
   endChar: chunk.endChar,
   estimatedTokens: chunkTokens,
   headingHint: chunk.headingHint
  });
  totalTokens += chunkTokens;
  bundleParts.push(`<!-- AI_CONTEXT_CHUNK ${chunk.index}/${plan.chunkCount} ${chunk.id} -->\n\n${content}`);
  if (totalTokens >= maxTokenBudget) {
   truncatedByTokenBudget = chunk.index < requestedEndIndex;
   break;
  }
 }
 const content = bundleParts.join("\n\n---\n\n");
 const nextChunkIndex = includedChunks.at(-1)?.index < plan.chunkCount
  ? includedChunks.at(-1).index + 1
  : null;
 const includedStart = includedChunks[0]?.index ?? 0;
 const includedEnd = includedChunks.at(-1)?.index ?? 0;
 const requestedWidth = Math.max(1, requestedEndIndex - startIndex + 1);
 const continuation = continuationState(recordIdOrPackagePath, plan, includedEnd, {
  tokenBudget: maxTokenBudget,
  rangeWidth: requestedWidth,
  currentRange: { startChunkIndex: includedStart, endChunkIndex: includedEnd },
  currentCommand: rangeCommand(recordIdOrPackagePath, startIndex, requestedEndIndex, maxTokenBudget)
 });
 const { evidence, timeline } = await recordAiContextEvidence(workspacePath, {
  kind: "ai_context_range_selected",
  outputType: "ai_context_range",
  recordIdOrPackagePath,
  content,
  tokenEstimate: totalTokens,
  sendGateDecision: preview.sendGateDecision,
  qualityWarnings: preview.qualityWarnings,
  selectionRange: {
   kind: "range",
   startChunkIndex: includedStart,
   endChunkIndex: includedEnd,
   requestedStartChunkIndex: startIndex,
   requestedEndChunkIndex: requestedEndIndex,
   totalChunkCount: plan.chunkCount,
   tokenBudget: maxTokenBudget,
   chunkIndexes: includedChunks.map((chunk) => chunk.index)
  },
  continuation,
  timelineType: "ai_context_range_selected",
  summary: `Selected AI context chunks ${includedStart}-${includedEnd}/${plan.chunkCount}`
 });
 return {
  recordIdOrPackagePath,
  requestedRange: {
   startChunkIndex: startIndex,
   endChunkIndex: requestedEndIndex
  },
  includedRange: {
   startChunkIndex: includedStart,
   endChunkIndex: includedEnd
  },
  includedChunks,
  content,
  contentLength: content.length,
  tokenEstimate: totalTokens,
  evidenceId: evidence.id,
  timelineEventId: timeline?.id ?? "",
  tokenBudget: maxTokenBudget,
  truncatedByTokenBudget,
  totalChunkCount: plan.chunkCount,
  progress: chunkProgress(includedEnd, plan.chunkCount),
  continuation,
  hasMoreChunks: continuation.canContinue,
  nextChunkIndex,
  nextChunkCommand: continuation.nextChunkCommand,
  nextRangeCommand: continuation.nextRangeCommand,
  sendGateDecision: preview.sendGateDecision,
  qualityWarnings: preview.qualityWarnings,
  knownLimits: preview.knownLimits,
  recommendedSendStrategy: plan.recommendedSendStrategy,
  ledger: `chunks ${includedChunks.map((chunk) => chunk.index).join(", ")} / ${plan.chunkCount} | tokens~${totalTokens}${truncatedByTokenBudget ? " | truncated by token budget" : ""}`
 };
}