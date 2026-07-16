import test from "node:test";
import assert from "node:assert";
import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { openOrCreateWorkspace } from "../src/core/manifest.js";
import { compileAiContextPreview, compileAiIntakeManifest, resolveAiContextChunk, resolveAiContextChunkRange } from "../src/core/aiContext.js";
import { compileAiFeedRunbook, readAiFeedRunbook, updateAiFeedRunbookBatch } from "../src/core/aiFeedRunbook.js";
import { createQualityReport } from "../src/core/qualityReport.js";
import { writeExchangePackage } from "../src/core/exchangePackage.js";
import { listEvidenceRecords } from "../src/core/evidence.js";
import { getTimelineEvents } from "../src/core/timeline.js";
async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), "schema-docs-aicontext-"));
}
test("AI Context Preview Test", async () => {
  const workspacePath = await tempDir();
  await openOrCreateWorkspace(workspacePath);
  const manifestFile = path.join(workspacePath, ".ai-doc-exchange", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  const docId = "doc_test123";
  const mdPath = path.join(workspacePath, "notes", "test-doc.md");
  await mkdir(path.dirname(mdPath), { recursive: true });
  await writeFile(mdPath, "# Test Heading\nThis is a mock doc with an email: [MASK_EMAIL_1] and legacy token: [MASKED_SECRET_1].\n## Subsection\nSome text.", "utf8");
  manifest.documents.push({
    id: docId,
    sourcePath: "imports/test.docx",
    sourceType: "docx",
    title: "Test Doc",
    outputMarkdownPath: mdPath,
    status: "ready",
    createdAt: new Date().toISOString()
  });
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2), "utf8");
  await createQualityReport(
    workspacePath,
    docId,
    "imports/test.docx",
    "docx",
    mdPath,
    "# Test Heading\nThis is a mock doc with an email: [MASK_EMAIL_1] and legacy token: [MASKED_SECRET_1].\n## Subsection\nSome text.",
    { confidence: "high" },
    []
  );
  const preview = await compileAiContextPreview(workspacePath, docId);
  assert.strictEqual(preview.isPackage, false);
  assert.deepEqual(preview.markdownSections, ["# Test Heading", "## Subsection"]);
  assert.deepEqual(preview.excludedOrSanitized, ["[MASK_EMAIL_1]", "[MASKED_SECRET_1]"]);
  assert.strictEqual(preview.sendGateDecision, "allow");
  assert.ok(!preview.knownLimits.includes("complex_pdf_layout"));
  assert.ok(preview.tokenEstimate > 0);
  assert.strictEqual(preview.aiIntakePlan.mode, "single_context");
  assert.strictEqual(preview.aiIntakePlan.chunkCount, 1);
  const datasetId = "dataset_test123";
  manifest.datasets.push({
    id: datasetId,
    sourcePath: "imports/table.csv",
    sourceType: "csv",
    name: "Revenue Table",
    status: "ready",
    createdAt: new Date().toISOString(),
    sheets: [{
      sheetId: "sheet_1",
      name: "Sheet1",
      columns: ["region", "revenue"],
      previewRows: [
        { region: "north", revenue: "100" },
        { region: "south", revenue: "200" }
      ]
    }]
  });
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2), "utf8");
  const datasetPreview = await compileAiContextPreview(workspacePath, datasetId);
  assert.strictEqual(datasetPreview.isPackage, false);
  assert.deepEqual(datasetPreview.markdownSections, ["# Revenue Table", "## Sheet1"]);
  assert.strictEqual(datasetPreview.metadata.sourceType, "csv");
  assert.strictEqual(datasetPreview.sendGateDecision, "allow");
  assert.ok(datasetPreview.tokenEstimate > 0);
  assert.strictEqual(datasetPreview.aiIntakePlan.recommendedSendStrategy, "Send as one reviewed context after masking.");
  const lowDocId = "doc_lowq";
  const lowMdPath = path.join(workspacePath, "notes", "lowq.md");
  await writeFile(lowMdPath, "short", "utf8");
  manifest.documents.push({
    id: lowDocId,
    sourcePath: "imports/lowq.docx",
    sourceType: "docx",
    title: "Low Quality Doc",
    outputMarkdownPath: lowMdPath,
    status: "ready",
    createdAt: new Date().toISOString()
  });
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2), "utf8");
  await createQualityReport(
    workspacePath,
    lowDocId,
    "imports/lowq.docx",
    "docx",
    lowMdPath,
    "short",
    { confidence: "low", scannedLikely: true },
    ["scannedLikely"]
  );
  const lowPreview = await compileAiContextPreview(workspacePath, lowDocId);
  assert.strictEqual(lowPreview.sendGateDecision, "blocked");
  assert.ok(lowPreview.recommendedNextAction.includes("Low quality document detected."));
  const lowIntakeManifest = await compileAiIntakeManifest(workspacePath, lowDocId);
  assert.strictEqual(lowIntakeManifest.safety.canPreviewChunks, true);
  assert.strictEqual(lowIntakeManifest.safety.sendAllowedAfterReview, false);
  assert.ok(lowIntakeManifest.safety.blockingWarnings.includes("scannedLikely"));
  const packageDir = "packages/test-pkg";
  await writeExchangePackage(workspacePath, packageDir, {
    title: "Test Exchange Package",
    body: "# Package Heading\nHello package.",
    exportFormats: ["docx"]
  });
  const pkgPreview = await compileAiContextPreview(workspacePath, packageDir);
  assert.strictEqual(pkgPreview.isPackage, true);
  assert.deepEqual(pkgPreview.markdownSections, ["# Test Exchange Package", "# Package Heading"]);
  assert.strictEqual(pkgPreview.metadata.title, "Test Exchange Package");
});
test("AI Context Preview includes chunked intake plan for long documents", async () => {
  const workspacePath = await tempDir();
  await openOrCreateWorkspace(workspacePath);
  const manifestFile = path.join(workspacePath, ".ai-doc-exchange", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  const docId = "doc_long";
  const mdPath = path.join(workspacePath, "notes", "long.md");
  const sections = Array.from({ length: 80 }, (_, index) => [
    `## Chapter ${index + 1}`,
    "This paragraph is designed to simulate a long technical PDF converted into Markdown for AI intake.",
    "The preview should expose chunk metadata instead of trying to send the whole document blindly.",
    ""
  ].join("\n"));
  const markdown = ["# Long Document", "", ...sections].join("\n");
  await mkdir(path.dirname(mdPath), { recursive: true });
  await writeFile(mdPath, markdown, "utf8");
  manifest.documents.push({
    id: docId,
    sourcePath: "imports/long.pdf",
    sourceType: "pdf",
    title: "Long Document",
    outputMarkdownPath: mdPath,
    status: "ready",
    sourceSize: 30 * 1024 * 1024,
    createdAt: new Date().toISOString()
  });
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2), "utf8");
  const preview = await compileAiContextPreview(workspacePath, docId);
  assert.strictEqual(preview.aiIntakePlan.mode, "chunked_large_document");
  assert.ok(preview.aiIntakePlan.chunkCount > 1);
  assert.ok(preview.aiIntakePlan.chunks.length > 0);
  assert.strictEqual(preview.aiIntakePlan.defaultRangeTokenBudget, 9000);
  assert.ok(preview.aiIntakePlan.suggestedRangeChunkCount >= 1);
  assert.ok(preview.aiIntakePlan.estimatedRangeCount >= 1);
  assert.strictEqual(preview.aiIntakePlan.feedingPlan.mode, "reviewed_range_feeding");
  assert.strictEqual(preview.aiIntakePlan.feedingPlan.requiresSendGatePerBatch, true);
  assert.strictEqual(preview.aiIntakePlan.feedingPlan.sendsContentAutomatically, false);
  assert.strictEqual(preview.aiIntakePlan.feedingPlan.estimatedBatchCount, preview.aiIntakePlan.estimatedRangeCount);
  assert.ok(preview.aiIntakePlan.feedingPlan.reasons.includes("chunked_context_required"));
  assert.ok(preview.aiIntakePlan.warnings.includes("context_should_be_sent_in_chunks"));
  assert.ok(preview.aiIntakePlan.warnings.includes("large_source_file_use_progressive_extraction"));
  assert.ok(preview.recommendedNextAction.includes("Use chunked intake"));
  const secondChunk = await resolveAiContextChunk(workspacePath, docId, 2);
  assert.strictEqual(secondChunk.chunk.index, 2);
  assert.ok(secondChunk.content.length > 0);
  assert.ok(secondChunk.evidenceId.startsWith("evidence_"));
  assert.ok(secondChunk.tokenEstimate <= secondChunk.chunk.estimatedTokens);
  assert.strictEqual(secondChunk.totalChunkCount, preview.aiIntakePlan.chunkCount);
  assert.strictEqual(secondChunk.progress.completedChunks, 2);
  assert.strictEqual(secondChunk.progress.remainingChunks, preview.aiIntakePlan.chunkCount - 2);
  assert.ok(secondChunk.progress.percentComplete > 0);
  assert.strictEqual(secondChunk.continuation.currentChunkIndex, 2);
  assert.strictEqual(secondChunk.continuation.currentRange.startChunkIndex, 2);
  assert.strictEqual(secondChunk.continuation.completedChunks, 2);
  assert.strictEqual(secondChunk.continuation.remainingChunks, preview.aiIntakePlan.chunkCount - 2);
  assert.strictEqual(secondChunk.continuation.canContinue, preview.aiIntakePlan.chunkCount > 2);
  assert.strictEqual(secondChunk.hasMoreChunks, preview.aiIntakePlan.chunkCount > 2);
  assert.strictEqual(secondChunk.nextChunkIndex, preview.aiIntakePlan.chunkCount > 2 ? 3 : null);
  if (secondChunk.hasMoreChunks) {
    assert.ok(secondChunk.nextChunkCommand.includes(`ai-context <workspace> chunk ${docId} 3`));
    assert.ok(secondChunk.nextRangeCommand.includes(`ai-context <workspace> range ${docId} 3`));
  } else {
    assert.strictEqual(secondChunk.nextChunkCommand, "");
  }
  const intakeManifest = await compileAiIntakeManifest(workspacePath, docId);
  assert.strictEqual(intakeManifest.recordIdOrPackagePath, docId);
  assert.strictEqual(intakeManifest.aiIntakePlan.chunkCount, preview.aiIntakePlan.chunkCount);
  assert.strictEqual(intakeManifest.aiIntakePlan.feedingPlan.bodyFree, true);
  assert.strictEqual(intakeManifest.aiIntakePlan.feedingPlan.recommendedBatchTokenBudget, 9000);
  assert.strictEqual(intakeManifest.batchPlanPreview.totalBatchCount, preview.aiIntakePlan.estimatedRangeCount);
  assert.ok(intakeManifest.batchPlanPreview.batches[0].command.includes(`ai-context <workspace> range ${docId} 1`));
  assert.strictEqual(intakeManifest.batchPlanPreview.batches[0].startChunkIndex, 1);
  assert.strictEqual(intakeManifest.safety.sendsContent, false);
  assert.strictEqual(intakeManifest.safety.canPreviewChunks, true);
  assert.strictEqual(intakeManifest.safety.sendAllowedAfterReview, true);
  assert.deepEqual(intakeManifest.safety.blockingWarnings, []);
  assert.strictEqual(intakeManifest.safety.chunkRangeEndpoint, "/api/ai/context-range");
  assert.ok(intakeManifest.nextChunkCommand.includes(`ai-context <workspace> chunk ${docId} 1`));
  assert.ok(intakeManifest.nextRangeCommand.includes(`ai-context <workspace> range ${docId} 1`));
  assert.ok(intakeManifest.nextRangeCommand.endsWith("9000"));
  assert.strictEqual(intakeManifest.continuation.canContinue, true);
  assert.strictEqual(intakeManifest.continuation.completedChunks, 0);
  assert.strictEqual(intakeManifest.continuation.remainingChunks, preview.aiIntakePlan.chunkCount);
  assert.strictEqual(intakeManifest.continuation.remainingRangeCount, preview.aiIntakePlan.estimatedRangeCount);
  assert.strictEqual(intakeManifest.continuation.recommendedMode, "range_then_confirm");
  assert.ok(!JSON.stringify(intakeManifest).includes("This paragraph is designed to simulate"));
  const runbook = await compileAiFeedRunbook(workspacePath, docId, { tokenBudget: 6500 });
  assert.strictEqual(runbook.kind, "ai_feed_runbook");
  assert.strictEqual(runbook.bodyFree, true);
  assert.strictEqual(runbook.recordIdOrPackagePath, docId);
  assert.strictEqual(runbook.tokenBudget, 6500);
  assert.strictEqual(runbook.totalChunkCount, preview.aiIntakePlan.chunkCount);
  assert.strictEqual(runbook.totalBatchCount, runbook.batches.length);
  assert.strictEqual(runbook.statusSummary.remainingBatches, runbook.totalBatchCount);
  assert.strictEqual(runbook.statusSummary.pulledBatches, 0);
  assert.strictEqual(runbook.statusSummary.readyToSendBatches, 0);
  assert.strictEqual(runbook.statusSummary.sentBatches, 0);
  assert.strictEqual(runbook.statusSummary.nextPulledBatchIndex, null);
  assert.strictEqual(runbook.statusSummary.nextReviewedBatchIndex, null);
  assert.strictEqual(runbook.statusSummary.nextBlockedBatchIndex, null);
  assert.ok(runbook.batches.length >= 1);
  assert.strictEqual(runbook.batches[0].requiresSendGateReview, true);
  assert.strictEqual(runbook.batches[0].sendsContentAutomatically, false);
  assert.strictEqual(runbook.batches[0].api.path, "/api/ai/context-range");
  assert.ok(runbook.batches[0].command.includes(`ai-context <workspace> range ${docId} 1`));
  assert.ok(runbook.markdownRelativePath.endsWith(".md"));
  assert.ok(runbook.jsonRelativePath.endsWith(".json"));
  const runbookMarkdown = await readFile(runbook.markdownPath, "utf8");
  const runbookJson = await readFile(runbook.jsonPath, "utf8");
  assert.match(runbookMarkdown, /AI Feed Runbook/);
  assert.match(runbookMarkdown, /Send Gate per batch: yes/);
  assert.match(runbookMarkdown, /Ready-to-send batches: 0/);
  assert.match(runbookMarkdown, /Next blocked batch: none/);
  assert.match(runbookJson, /"kind": "ai_feed_runbook"/);
  assert.ok(!runbookMarkdown.includes("This paragraph is designed to simulate"));
  assert.ok(!runbookJson.includes("This paragraph is designed to simulate"));
  const updatedRunbook = await updateAiFeedRunbookBatch(workspacePath, runbook.jsonRelativePath, 1, "reviewed", "batch reviewed in Send Gate");
  assert.strictEqual(updatedRunbook.updatedBatch.status, "reviewed");
  assert.strictEqual(updatedRunbook.updatedBatch.note, "batch reviewed in Send Gate");
  assert.strictEqual(updatedRunbook.statusSummary.completedBatches, 1);
  assert.strictEqual(updatedRunbook.statusSummary.readyToSendBatches, 1);
  assert.strictEqual(updatedRunbook.statusSummary.nextReviewedBatchIndex, 1);
  assert.strictEqual(updatedRunbook.statusSummary.blockedBatches, 0);
  assert.strictEqual(updatedRunbook.statusSummary.remainingBatches, Math.max(0, runbook.totalBatchCount - 1));
  const readRunbook = await readAiFeedRunbook(workspacePath, runbook.jsonRelativePath);
  assert.strictEqual(readRunbook.batches[0].status, "reviewed");
  assert.strictEqual(readRunbook.statusSummary.completedBatches, 1);
  assert.strictEqual(readRunbook.statusSummary.remainingBatches, Math.max(0, runbook.totalBatchCount - 1));
  const updatedRunbookMarkdown = await readFile(updatedRunbook.markdownPath, "utf8");
  assert.match(updatedRunbookMarkdown, /Completed batches: 1/);
  assert.match(updatedRunbookMarkdown, /\| 1 \| reviewed \|/);
  assert.ok(!updatedRunbookMarkdown.includes("This paragraph is designed to simulate"));
  const chunkRange = await resolveAiContextChunkRange(workspacePath, docId, 1, 3, 6500);
  assert.strictEqual(chunkRange.includedRange.startChunkIndex, 1);
  assert.ok(chunkRange.includedChunks.length >= 1);
  assert.ok(chunkRange.includedChunks.length <= 3);
  assert.ok(chunkRange.evidenceId.startsWith("evidence_"));
  assert.ok(chunkRange.content.includes("AI_CONTEXT_CHUNK 1/"));
  assert.ok(chunkRange.ledger.includes("chunks 1"));
  assert.ok(chunkRange.tokenEstimate <= 6500 || chunkRange.includedChunks.length === 1);
  assert.strictEqual(chunkRange.progress.completedChunks, chunkRange.includedRange.endChunkIndex);
  assert.strictEqual(chunkRange.progress.remainingChunks, preview.aiIntakePlan.chunkCount - chunkRange.includedRange.endChunkIndex);
  assert.deepEqual(chunkRange.continuation.currentRange, chunkRange.includedRange);
  assert.strictEqual(chunkRange.continuation.completedChunks, chunkRange.includedRange.endChunkIndex);
  assert.strictEqual(chunkRange.continuation.remainingChunks, preview.aiIntakePlan.chunkCount - chunkRange.includedRange.endChunkIndex);
  assert.strictEqual(chunkRange.hasMoreChunks, chunkRange.includedRange.endChunkIndex < preview.aiIntakePlan.chunkCount);
  if (chunkRange.hasMoreChunks) {
    assert.strictEqual(chunkRange.nextChunkIndex, chunkRange.includedRange.endChunkIndex + 1);
    assert.strictEqual(chunkRange.continuation.canContinue, true);
    assert.strictEqual(chunkRange.continuation.nextChunkIndex, chunkRange.nextChunkIndex);
    assert.ok(chunkRange.nextChunkCommand.includes(`ai-context <workspace> chunk ${docId} ${chunkRange.nextChunkIndex}`));
    assert.ok(chunkRange.nextRangeCommand.includes(`ai-context <workspace> range ${docId} ${chunkRange.nextChunkIndex}`));
  } else {
    assert.strictEqual(chunkRange.nextChunkIndex, null);
    assert.strictEqual(chunkRange.nextChunkCommand, "");
    assert.strictEqual(chunkRange.nextRangeCommand, "");
    assert.strictEqual(chunkRange.continuation.canContinue, false);
  }
  const evidence = await listEvidenceRecords(workspacePath);
  const chunkEvidence = evidence.find((record) => record.id === secondChunk.evidenceId);
  const rangeEvidence = evidence.find((record) => record.id === chunkRange.evidenceId);
  assert.strictEqual(chunkEvidence.kind, "ai_context_chunk_selected");
  assert.strictEqual(chunkEvidence.outputType, "ai_context_chunk");
  assert.strictEqual(chunkEvidence.sourceRef, docId);
  assert.strictEqual(chunkEvidence.aiSent, false);
  assert.strictEqual(chunkEvidence.storeRawPrompt, false);
  assert.ok(chunkEvidence.sentContentHash.startsWith("sha256:"));
  assert.strictEqual(chunkEvidence.selectionRange.kind, "chunk");
  assert.strictEqual(chunkEvidence.selectionRange.chunkIndex, 2);
  assert.strictEqual(chunkEvidence.selectionRange.totalChunkCount, preview.aiIntakePlan.chunkCount);
  assert.strictEqual(chunkEvidence.continuation.completedChunks, 2);
  assert.strictEqual(chunkEvidence.continuation.remainingChunks, preview.aiIntakePlan.chunkCount - 2);
  assert.ok(!JSON.stringify(chunkEvidence).includes("This paragraph is designed to simulate"));
  assert.strictEqual(rangeEvidence.kind, "ai_context_range_selected");
  assert.strictEqual(rangeEvidence.outputType, "ai_context_range");
  assert.strictEqual(rangeEvidence.selectionRange.kind, "range");
  assert.strictEqual(rangeEvidence.selectionRange.startChunkIndex, chunkRange.includedRange.startChunkIndex);
  assert.strictEqual(rangeEvidence.selectionRange.endChunkIndex, chunkRange.includedRange.endChunkIndex);
  assert.deepEqual(rangeEvidence.selectionRange.chunkIndexes, chunkRange.includedChunks.map((chunk) => chunk.index));
  assert.strictEqual(rangeEvidence.continuation.remainingRangeCount, chunkRange.continuation.remainingRangeCount);
  assert.ok(!JSON.stringify(rangeEvidence).includes("AI_CONTEXT_CHUNK"));
  const timeline = await getTimelineEvents(workspacePath, docId);
  const chunkTimeline = timeline.find((event) => event.type === "ai_context_chunk_selected" && event.evidenceId === secondChunk.evidenceId);
  const rangeTimeline = timeline.find((event) => event.type === "ai_context_range_selected" && event.evidenceId === chunkRange.evidenceId);
  assert.ok(chunkTimeline);
  assert.ok(rangeTimeline);
  assert.strictEqual(chunkTimeline.selectionRange.chunkIndex, 2);
  assert.strictEqual(chunkTimeline.continuation.completedChunks, 2);
  assert.strictEqual(rangeTimeline.selectionRange.startChunkIndex, chunkRange.includedRange.startChunkIndex);
  assert.strictEqual(rangeTimeline.continuation.remainingRangeCount, chunkRange.continuation.remainingRangeCount);
  assert.ok(!JSON.stringify(rangeTimeline).includes("AI_CONTEXT_CHUNK"));
});
test("AI context chunk resolver can pull chunks beyond the preview manifest window", async () => {
  const workspacePath = await tempDir();
  await openOrCreateWorkspace(workspacePath);
  const manifestFile = path.join(workspacePath, ".ai-doc-exchange", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  const docId = "doc_very_long";
  const mdPath = path.join(workspacePath, "notes", "very-long.md");
  const sections = Array.from({ length: 1800 }, (_, index) => [
    `## Long Section ${index + 1}`,
    `Paragraph ${index + 1} keeps enough body text to force many AI context chunks for progressive intake testing.`,
    "The resolver must be able to fetch later chunks without listing every chunk in the content-free manifest.",
    ""
  ].join("\n"));
  const markdown = ["# Very Long Document", "", ...sections].join("\n");
  await mkdir(path.dirname(mdPath), { recursive: true });
  await writeFile(mdPath, markdown, "utf8");
  manifest.documents.push({
    id: docId,
    sourcePath: "imports/very-long.pdf",
    sourceType: "pdf",
    title: "Very Long Document",
    outputMarkdownPath: mdPath,
    status: "ready",
    sourceSize: 60 * 1024 * 1024,
    createdAt: new Date().toISOString()
  });
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2), "utf8");
  const preview = await compileAiContextPreview(workspacePath, docId);
  assert.ok(preview.aiIntakePlan.chunkCount > preview.aiIntakePlan.previewChunkCount);
  assert.strictEqual(preview.aiIntakePlan.previewChunkCount, 20);
  assert.strictEqual(preview.aiIntakePlan.truncated, true);
  assert.strictEqual(preview.aiIntakePlan.feedingPlan.mode, "background_range_feeding");
  assert.strictEqual(preview.aiIntakePlan.feedingPlan.priority, "ultra_large");
  assert.strictEqual(preview.aiIntakePlan.feedingPlan.suitableForContinuousAgentLoop, true);
  assert.ok(preview.aiIntakePlan.feedingPlan.reasons.includes("ultra_large_document"));
  assert.ok(preview.aiIntakePlan.feedingPlan.estimatedBatchCount >= 1);
  const veryLongManifest = await compileAiIntakeManifest(workspacePath, docId);
  assert.strictEqual(veryLongManifest.batchPlanPreview.previewBatchCount, 5);
  assert.strictEqual(veryLongManifest.batchPlanPreview.truncated, veryLongManifest.batchPlanPreview.totalBatchCount > 5);
  if (veryLongManifest.batchPlanPreview.finalBatch) {
    assert.ok(veryLongManifest.batchPlanPreview.finalBatch.command.includes(`ai-context <workspace> range ${docId}`));
  }
  assert.ok(!JSON.stringify(veryLongManifest.batchPlanPreview).includes("Long Section"));
  const laterChunk = await resolveAiContextChunk(workspacePath, docId, 25);
  assert.strictEqual(laterChunk.chunk.index, 25);
  assert.ok(laterChunk.content.includes("Long Section"));
  assert.strictEqual(laterChunk.totalChunkCount, preview.aiIntakePlan.chunkCount);
  assert.strictEqual(laterChunk.progress.completedChunks, 25);
  assert.strictEqual(laterChunk.continuation.currentCommand, `ai-context <workspace> chunk ${docId} 25`);
  assert.strictEqual(laterChunk.truncatedPlan, true);
  const laterRange = await resolveAiContextChunkRange(workspacePath, docId, 22, 25, 12000);
  assert.strictEqual(laterRange.includedRange.startChunkIndex, 22);
  assert.ok(laterRange.includedRange.endChunkIndex >= 22);
  assert.ok(laterRange.includedChunks.every((chunk) => chunk.index > 20));
  assert.ok(laterRange.content.includes("AI_CONTEXT_CHUNK 22/"));
  assert.strictEqual(laterRange.hasMoreChunks, true);
  assert.strictEqual(laterRange.progress.completedChunks, laterRange.includedRange.endChunkIndex);
  assert.ok(laterRange.nextRangeCommand.includes(`ai-context <workspace> range ${docId}`));
  const finalChunk = await resolveAiContextChunk(workspacePath, docId, preview.aiIntakePlan.chunkCount);
  assert.strictEqual(finalChunk.hasMoreChunks, false);
  assert.strictEqual(finalChunk.nextChunkIndex, null);
  assert.strictEqual(finalChunk.nextChunkCommand, "");
  assert.strictEqual(finalChunk.continuation.canContinue, false);
  assert.strictEqual(finalChunk.continuation.remainingRangeCount, 0);
});