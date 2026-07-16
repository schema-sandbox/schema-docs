import test from "node:test";
import assert from "node:assert";
import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { openOrCreateWorkspace } from "../src/core/manifest.js";
import { compileWorkspaceManifest } from "../src/core/workspaceManifest.js";
import { createAppService } from "../src/core/appService.js";
import { appendTimelineEvent } from "../src/core/timeline.js";
import { appendEvidenceRecord } from "../src/core/evidence.js";
import { createQualityReport } from "../src/core/qualityReport.js";
async function tempDir(prefix = "schema-docs-manifest-") {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}
test("Workspace Manifest Compilation", async () => {
  const workspacePath = await tempDir();
  await openOrCreateWorkspace(workspacePath);
  const importsDir = path.join(workspacePath, "imports");
  await mkdir(importsDir, { recursive: true });
  await writeFile(path.join(importsDir, "test.docx"), "dummy docx content");
  const service = createAppService(workspacePath);
  await service.updateWorkspaceSettings("defaultApiBaseUrl", "https://api.example.com/v1?token=sk-12345");
  await service.updateWorkspaceSettings("defaultAiModel", "test-model");
  await appendTimelineEvent(workspacePath, "doc_1", "import", "Imported doc_1");
  await appendTimelineEvent(workspacePath, "doc_1", "refresh", "Refreshed doc_1");
  await appendTimelineEvent(workspacePath, "doc_1", "ai_handoff_bundle", "Saved AI handoff bundle \"notes/doc_1-handoff.md\"", {
    evidenceId: "evidence_handoff_1",
    artifactPath: "notes/doc_1-handoff.md"
  });
  const outputsDir = path.join(workspacePath, "outputs");
  await mkdir(outputsDir, { recursive: true });
  await createQualityReport(
    workspacePath,
    "doc_1",
    "imports/test.docx",
    "docx",
    path.join(outputsDir, "test.md"),
    "Hello Markdown world",
    { confidence: "high" },
    []
  );
  await appendEvidenceRecord(workspacePath, {
    kind: "ai_preview",
    sourceRef: "doc_1",
    sendGateDecision: "review_recommended",
    sendGateSignals: ["email"],
    aiSent: false
  });
  await appendEvidenceRecord(workspacePath, {
    kind: "ai_context_chunk_selected",
    sourceRef: "doc_1",
    outputType: "ai_context_chunk",
    sendGateDecision: "allow",
    estimatedTokens: 1200,
    selectionRange: {
      kind: "chunk",
      chunkIndex: 2,
      startChunkIndex: 2,
      endChunkIndex: 2,
      totalChunkCount: 6
    },
    continuation: {
      canContinue: true,
      completedChunks: 2,
      remainingChunks: 4,
      totalChunkCount: 6,
      remainingRangeCount: 2,
      nextChunkIndex: 3,
      nextRangeStartChunkIndex: 3,
      nextRangeEndChunkIndex: 5,
      nextRangeCommand: "ai-context <workspace> range doc_1 3 5 9000"
    },
    aiSent: false
  });
  await appendEvidenceRecord(workspacePath, {
    kind: "ai_query_context_selected",
    sourceRef: "query_context",
    outputType: "ai_query_context",
    sendGateDecision: "local_query_context_selected",
    sendGateSignals: ["truncated_rows"],
    estimatedTokens: 300,
    queryShape: {
      tableCount: 2,
      primaryTable: "people",
      joinedTable: "departments",
      hasJoin: true,
      hasWhere: false,
      hasGroupBy: false,
      hasOrderBy: true,
      selectedColumnCount: 2,
      hasAggregates: false,
      limit: null
    },
    aiSent: false
  });
  await service.saveExchangePackage("packages/manifest-demo", {
    title: "Manifest Demo",
    body: "Manifest package body.",
    exportFormats: ["docx"]
  });
  await service.writeExchangePackageReceiverReport("packages/manifest-demo");
  const summary = await compileWorkspaceManifest(workspacePath);
  assert.ok(summary.workspaceId);
  assert.ok(summary.createdAt);
  assert.ok(summary.updatedAt);
  assert.deepEqual(summary.sourceFiles, ["imports/test.docx"]);
  assert.strictEqual(summary.refreshHistory.length, 2);
  assert.strictEqual(summary.refreshHistory[0].recordId, "doc_1");
  assert.strictEqual(summary.refreshHistory[0].type, "import");
  assert.strictEqual(summary.qualityReports.length, 1);
  assert.strictEqual(summary.qualityReports[0].recordId, "doc_1");
  assert.strictEqual(summary.qualityReports[0].confidence, "high");
  assert.strictEqual(summary.aiSendGateDecisions.length, 1);
  assert.strictEqual(summary.aiSendGateDecisions[0].decision, "review_recommended");
  assert.deepEqual(summary.aiSendGateDecisions[0].signals, ["email"]);
  assert.strictEqual(summary.aiContextSelections.length, 2);
  assert.deepEqual(summary.aiContextSelections.map((selection) => selection.type).sort(), [
    "ai_context_chunk_selected",
    "ai_query_context_selected"
  ]);
  assert.ok(summary.aiContextSelections.every((selection) => selection.aiSent === false));
  const chunkSelection = summary.aiContextSelections.find((selection) => selection.type === "ai_context_chunk_selected");
  assert.strictEqual(chunkSelection.selectionRange.kind, "chunk");
  assert.strictEqual(chunkSelection.selectionRange.chunkIndex, 2);
  assert.strictEqual(chunkSelection.continuation.canContinue, true);
  assert.strictEqual(chunkSelection.continuation.remainingRangeCount, 2);
  assert.ok(chunkSelection.continuation.nextRangeCommand.includes("ai-context <workspace> range doc_1 3"));
  const querySelection = summary.aiContextSelections.find((selection) => selection.type === "ai_query_context_selected");
  assert.strictEqual(querySelection.queryShape.hasJoin, true);
  assert.strictEqual(querySelection.queryShape.tableCount, 2);
  assert.strictEqual(querySelection.queryShape.joinedTable, "departments");
  assert.strictEqual(querySelection.queryShape.hasOrderBy, true);
  assert.strictEqual(summary.aiHandoffBundles.length, 1);
  assert.strictEqual(summary.aiHandoffBundles[0].recordId, "doc_1");
  assert.strictEqual(summary.aiHandoffBundles[0].relativePath, "notes/doc_1-handoff.md");
  assert.strictEqual(summary.aiHandoffBundles[0].evidenceId, "evidence_handoff_1");
  assert.strictEqual(summary.settingsSnapshot.defaultAiModel, "test-model");
  assert.strictEqual(summary.settingsSnapshot.defaultApiBaseUrl, "https://api.example.com/v1?token=[REDACTED_SECRET]");
  assert.strictEqual(summary.exchangePackages.length, 1);
  assert.strictEqual(summary.exchangePackages[0].receiverReport.exists, true);
  assert.strictEqual(summary.exchangePackages[0].receiverReport.path, "receiver-report.md");
  assert.ok(summary.exchangePackages[0].receiverReport.bytes > 0);
  assert.strictEqual(summary.exchangePackages[0].trustReport.exists, true);
  assert.strictEqual(summary.exchangePackages[0].trustReport.path, "trust-report.json");
  assert.ok(summary.exchangePackages[0].trustReport.bytes > 0);
});