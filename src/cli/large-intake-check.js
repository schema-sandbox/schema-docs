import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openOrCreateWorkspace, readManifest, writeManifest } from "../core/manifest.js";
import { compileAiIntakeManifest, resolveAiContextChunkRange } from "../core/aiContext.js";
import { compileAiFeedRunbook } from "../core/aiFeedRunbook.js";

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildSyntheticLargeMarkdown(targetPages = 7900) {
  const sentinel = "SCHEMA_DOCS_LARGE_INTAKE_SENTINEL";
  const paragraph = [
    "This synthetic page stands in for dense PDF textbook content before AI intake.",
    "Schema Docs should plan the feed without storing body text in manifests or runbooks.",
    "Each batch must be pulled, reviewed in Send Gate, and only then sent by the operator.",
    sentinel
  ].join(" ");
  const pages = Array.from({ length: targetPages }, (_, index) => [
    `## Page ${index + 1}`,
    `${paragraph} Page=${index + 1}.`,
    ""
  ].join("\n"));
  return {
    sentinel,
    markdown: ["# Synthetic 7900 Page AI Intake Fixture", "", ...pages].join("\n")
  };
}

async function createSyntheticRecord(workspacePath, markdown, targetPages) {
  await openOrCreateWorkspace(workspacePath);
  const notesDir = path.join(workspacePath, "notes");
  await mkdir(notesDir, { recursive: true });
  const outputMarkdownPath = path.join(notesDir, "synthetic-7900-page-fixture.md");
  await writeFile(outputMarkdownPath, markdown, "utf8");

  const manifest = await readManifest(workspacePath);
  const recordId = "doc_synthetic_7900_page_ai_intake";
  manifest.documents.push({
    id: recordId,
    sourcePath: path.join(workspacePath, "imports", "synthetic-7900-page-fixture.pdf"),
    sourceType: "pdf",
    title: "Synthetic 7900 Page AI Intake Fixture",
    status: "ready",
    outputMarkdownPath,
    sourceSize: 96 * 1024 * 1024,
    pageEstimate: targetPages,
    createdAt: new Date().toISOString()
  });
  await writeManifest(workspacePath, manifest);
  return recordId;
}

async function main() {
  const startedAt = Date.now();
  const targetPages = Number(process.argv[process.argv.indexOf("--pages") + 1]) || 7900;
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "schema-docs-large-intake-"));
  const { markdown, sentinel } = buildSyntheticLargeMarkdown(targetPages);
  const recordId = await createSyntheticRecord(workspacePath, markdown, targetPages);

  const intakeManifest = await compileAiIntakeManifest(workspacePath, recordId);
  const runbook = await compileAiFeedRunbook(workspacePath, recordId, { tokenBudget: 12_000 });
  const firstRange = await resolveAiContextChunkRange(workspacePath, recordId, 1, 4, 12_000);
  const runbookJson = await readFile(runbook.jsonPath, "utf8");
  const runbookMarkdown = await readFile(runbook.markdownPath, "utf8");
  const manifestJson = JSON.stringify(intakeManifest);
  const elapsedMs = Date.now() - startedAt;

  assertCondition(intakeManifest.safety.sendsContent === false, "intake manifest must not send content");
  assertCondition(intakeManifest.safety.requiresReviewBeforeSend === true, "Send Gate review must be required");
  assertCondition(intakeManifest.aiIntakePlan.feedingPlan.mode === "background_range_feeding", "ultra-large intake should use background range feeding");
  assertCondition(intakeManifest.aiIntakePlan.feedingPlan.priority === "ultra_large", "ultra-large intake priority was not set");
  assertCondition(intakeManifest.aiIntakePlan.feedingPlan.suitableForContinuousAgentLoop === true, "continuous agent loop should be allowed for clean ultra-large intake");
  assertCondition(intakeManifest.aiIntakePlan.chunkCount >= 80, "synthetic fixture did not create enough AI context chunks");
  assertCondition(intakeManifest.batchPlanPreview.previewBatchCount === 5, "batch plan preview should stay bounded");
  assertCondition(intakeManifest.batchPlanPreview.truncated === true, "batch plan preview should be truncated for ultra-large fixtures");
  assertCondition(!manifestJson.includes(sentinel), "intake manifest leaked document body text");
  assertCondition(runbook.bodyFree === true, "runbook must be body-free");
  assertCondition(runbook.totalBatchCount === runbook.batches.length, "runbook batch count mismatch");
  assertCondition(runbook.batches.every((batch) => batch.requiresSendGateReview === true), "every batch must require Send Gate review");
  assertCondition(runbook.batches.every((batch) => batch.sendsContentAutomatically === false), "runbook batches must not send content automatically");
  assertCondition(!runbookJson.includes(sentinel), "runbook JSON leaked document body text");
  assertCondition(!runbookMarkdown.includes(sentinel), "runbook Markdown leaked document body text");
  assertCondition(firstRange.content.includes(sentinel), "range pull should return selected body content only on demand");
  assertCondition(firstRange.sendGateDecision === "allow", "range pull must preserve Send Gate decision for later review");
  assertCondition(Boolean(firstRange.evidenceId), "range pull must write local evidence instead of sending automatically");

  const result = {
    ok: true,
    workspacePath,
    targetPages,
    recordId,
    elapsedMs,
    tokenEstimate: intakeManifest.tokenEstimate,
    chunkCount: intakeManifest.aiIntakePlan.chunkCount,
    previewChunkCount: intakeManifest.aiIntakePlan.previewChunkCount,
    intakeTotalBatchCount: intakeManifest.batchPlanPreview.totalBatchCount,
    runbookTotalBatchCount: runbook.totalBatchCount,
    previewBatchCount: intakeManifest.batchPlanPreview.previewBatchCount,
    omittedPreviewBatchCount: intakeManifest.batchPlanPreview.omittedBatchCount,
    mode: intakeManifest.aiIntakePlan.feedingPlan.mode,
    priority: intakeManifest.aiIntakePlan.feedingPlan.priority,
    bodyFreeManifest: !manifestJson.includes(sentinel),
    bodyFreeRunbook: !runbookJson.includes(sentinel) && !runbookMarkdown.includes(sentinel),
    sendGateRequiredPerBatch: runbook.batches.every((batch) => batch.requiresSendGateReview === true),
    sendsContentAutomatically: false,
    firstRangePulledOnDemand: firstRange.content.includes(sentinel)
  };
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message
  }, null, 2));
  process.exit(1);
});
