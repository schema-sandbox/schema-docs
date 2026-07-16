import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { markdownToDocxBuffer } from "../src/adapters/markdownDocxExporter.js";
import { createSchemaDocsLocalClient, SchemaDocsApiError } from "../src/sdk/localApiClient.js";
import { getJson, getToken, post, withServer } from "./helpers/serverHarness.js";
test("creates and imports a sample docx through API", async () => {
  await withServer(async (baseUrl) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "lft-server-sample-docx-"));
    await post(baseUrl, "/api/workspace/open", { workspacePath });
    const sample = await post(baseUrl, "/api/samples/docx", { workspacePath });
    const extracted = await post(baseUrl, "/api/document/convert", {
      workspacePath,
      documentId: sample.data.document.id
    });
    const manifest = await post(baseUrl, "/api/manifest", { workspacePath });
    assert.equal(sample.ok, true);
    assert.match(sample.data.sourcePath, /sample-word\.docx$/);
    assert.equal(sample.data.document.sourceType, "docx");
    assert.match(sample.data.document.id, /^doc_/);
    assert.equal(extracted.ok, true);
    assert.equal(extracted.data.status, "succeeded");
    assert.match(extracted.data.output.outputMarkdownPath, /sample-word\.md$/);
    assert.equal(manifest.data.documents.length, 1);
    assert.equal(manifest.data.documents[0].id, sample.data.document.id);
  });
});
test("exports markdown to docx, pdf and html through API", async () => {
  await withServer(async (baseUrl) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "lft-server-export-"));
    await post(baseUrl, "/api/workspace/open", { workspacePath });
    await post(baseUrl, "/api/markdown/save", {
      workspacePath,
      relativePath: path.join("notes", "server.md"),
      content: "# 标题\n\n测试导出。\n\n| 列A | 列B |\n| --- | --- |\n| 1 | 2 |\n"
    });
    const docx = await post(baseUrl, "/api/markdown/export", {
      workspacePath,
      relativePath: path.join("notes", "server.md"),
      outputRelativePath: path.join("exports", "server.docx"),
      format: "docx"
    });
    const pdf = await post(baseUrl, "/api/markdown/export", {
      workspacePath,
      relativePath: path.join("notes", "server.md"),
      outputRelativePath: path.join("exports", "server.pdf"),
      format: "pdf"
    });
    const html = await post(baseUrl, "/api/markdown/export", {
      workspacePath,
      relativePath: path.join("notes", "server.md"),
      outputRelativePath: path.join("exports", "server.html"),
      format: "html"
    });
    assert.equal(docx.ok, true);
    assert.equal(pdf.ok, true);
    assert.equal(html.ok, true);
    assert.match(docx.data, /server\.docx$/);
    assert.match(pdf.data, /server\.pdf$/);
    assert.match(html.data, /server\.html$/);

    const { readFile } = await import("node:fs/promises");
    const htmlContent = await readFile(path.join(workspacePath, "exports", "server.html"), "utf8");
    assert.match(htmlContent, /<!DOCTYPE html>/i);
    assert.match(htmlContent, /<style>/i);
    assert.match(htmlContent, /<table/i);
    assert.match(htmlContent, /测试导出/i);
  });
});
test("exports imported document to target format through API", async () => {
  await withServer(async (baseUrl) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "lft-server-document-export-"));
    const docxPath = path.join(workspacePath, "input.docx");
    await writeFile(docxPath, markdownToDocxBuffer("# Input\n\nAPI direct export."));
    await post(baseUrl, "/api/workspace/open", { workspacePath });
    const imported = await post(baseUrl, "/api/import", {
      workspacePath,
      sourcePath: docxPath
    });
    const exported = await post(baseUrl, "/api/document/export", {
      workspacePath,
      documentId: imported.data.id,
      outputRelativePath: path.join("exports", "input.pdf"),
      format: "pdf"
    });
    assert.equal(exported.ok, true);
    assert.equal(exported.data.format, "pdf");
    assert.equal(exported.data.capability.mode, "via-md");
    assert.equal(exported.data.capability.quality, "basic");
    assert.ok(exported.data.auditId.startsWith("conversion_"));
    assert.ok(exported.data.evidenceId.startsWith("evidence_"));
    assert.match(exported.data.outputPath, /input\.pdf$/);
    assert.match(exported.data.intermediateMarkdownPath, /input\.readable\.md$/);
    const conversions = await post(baseUrl, "/api/conversions/list", { workspacePath });
    const evidence = await post(baseUrl, "/api/evidence/list", { workspacePath });
    const evidenceByPost = await post(baseUrl, "/api/evidence/get", {
      workspacePath,
      evidenceId: exported.data.evidenceId
    });
    const evidenceByGet = await getJson(baseUrl, `/api/evidence/${encodeURIComponent(exported.data.evidenceId)}`, {
      workspacePath
    });
    const deletedEvidence = await post(baseUrl, "/api/evidence/delete", {
      workspacePath,
      evidenceId: exported.data.evidenceId
    });
    const deleted = await post(baseUrl, "/api/conversions/delete", {
      workspacePath,
      auditId: exported.data.auditId
    });
    const afterDelete = await post(baseUrl, "/api/conversions/list", { workspacePath });
    assert.equal(conversions.data.length, 2);
    assert.ok(conversions.data.some((audit) => audit.targetFormat === "md" && audit.mode === "direct"));
    assert.ok(conversions.data.some((audit) => audit.targetFormat === "pdf" && audit.mode === "via-md"));
    assert.ok(conversions.data.every((audit) => audit.limits.length > 0));
    assert.equal(evidence.data.length, 2);
    assert.ok(evidence.data.some((record) => record.kind === "document_extraction"));
    assert.ok(evidence.data.some((record) => record.id === exported.data.evidenceId));
    assert.equal(evidenceByPost.data.id, exported.data.evidenceId);
    assert.equal(evidenceByGet.data.id, exported.data.evidenceId);
    assert.equal(deletedEvidence.data.id, exported.data.evidenceId);
    assert.equal(deleted.data.id, exported.data.auditId);
    assert.equal(afterDelete.data.length, 1);
    assert.equal(afterDelete.data[0].targetFormat, "md");
  });
});
test("serves API-first document exchange aliases", async () => {
  await withServer(async (baseUrl) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "lft-server-semantic-api-"));
    const docxPath = path.join(workspacePath, "semantic.docx");
    await writeFile(docxPath, markdownToDocxBuffer("# Semantic\n\nAPI aliases."));
    await post(baseUrl, "/api/workspace/open", { workspacePath });
    const ingested = await post(baseUrl, "/api/ingest", {
      workspacePath,
      sourcePath: docxPath
    });
    const extracted = await post(baseUrl, "/api/extract", {
      workspacePath,
      documentId: ingested.data.id
    });
    const exported = await post(baseUrl, "/api/export/pdf", {
      workspacePath,
      documentId: ingested.data.id,
      outputRelativePath: path.join("exports", "semantic.pdf")
    });
    const normalized = await post(baseUrl, "/api/normalize", {
      workspacePath,
      relativePath: path.join("notes", "semantic-exchange.md"),
      input: {
        title: "Semantic Exchange",
        body: "Markdown exchange package."
      }
    });
    assert.equal(ingested.ok, true);
    assert.equal(ingested.data.sourceType, "docx");
    assert.equal(extracted.ok, true);
    assert.equal(extracted.data.status, "succeeded");
    assert.match(extracted.data.output.outputMarkdownPath, /semantic\.md$/);
    assert.equal(exported.ok, true);
    assert.equal(exported.data.format, "pdf");
    assert.ok(exported.data.evidenceId.startsWith("evidence_"));
    assert.equal(normalized.ok, true);
    assert.match(normalized.data, /semantic-exchange\.md$/);
  });
});
test("local API SDK wraps semantic document exchange workflow", async () => {
  await withServer(async (baseUrl) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "schema-docs-sdk-"));
    const token = await getToken(baseUrl);
    const docxPath = path.join(workspacePath, "sdk.docx");
    await writeFile(docxPath, markdownToDocxBuffer("# SDK\n\nAPI-first workflow."));
    const client = createSchemaDocsLocalClient({ baseUrl, token, workspacePath });
    await client.openWorkspace();
    const adapters = await client.adapterCapabilities();
    const ingested = await client.ingest(docxPath);
    const prepared = await client.prepareRecordForAi(ingested.id);
    const intakePlan = await client.compileAiIntakeManifest(ingested.id);
    const feedRunbook = await client.compileAiFeedRunbook(ingested.id, { tokenBudget: 4000 });
    const updatedFeedRunbook = await client.updateAiFeedRunbookBatch(feedRunbook.jsonRelativePath, 1, "reviewed", "sdk reviewed");
    const readFeedRunbook = await client.readAiFeedRunbook(feedRunbook.jsonRelativePath);
    const firstAiChunk = await client.resolveAiContextChunk(ingested.id, 1);
    const aiChunkRange = await client.resolveAiContextChunkRange(ingested.id, 1, 1, 4000);
    const aiHandoffBundle = await client.saveAiHandoffBundle(path.join("notes", "sdk-ai-handoff.md"), {
      recordIdOrPackagePath: ingested.id,
      startChunkIndex: 1,
      endChunkIndex: 1,
      tokenBudget: 4000,
      operation: "handoff"
    });
    const recordPackage = await client.createPackageFromRecord(
      ingested.id,
      path.join("packages", "sdk-from-record"),
      { exportFormats: ["docx", "pdf"] }
    );
    const publicRecordPackage = await client.createExchangePackageFromRecord(
      ingested.id,
      path.join("packages", "sdk-public-from-record"),
      { title: "SDK Public Package", exportFormats: ["docx"] }
    );
    const recordPackageReadBack = await client.readPackage(path.join("packages", "sdk-from-record"));
    const recordReceiverReport = await client.writeReceiverReport(path.join("packages", "sdk-from-record"));
    const extracted = await client.extract({ documentId: ingested.id });
    const exported = await client.exportDocument("pdf", {
      documentId: ingested.id,
      outputRelativePath: path.join("exports", "sdk.pdf")
    });
    const normalized = await client.normalize({
      packageRelativePath: path.join("packages", "sdk"),
      input: {
        title: "SDK Package",
        body: "Created through the semantic SDK.",
        evidenceId: exported.evidenceId,
        exportFormats: ["docx"]
      }
    });
    const publicPackage = await client.writePackage(path.join("packages", "sdk-public"), {
      title: "SDK Public Write",
      body: "Created through the public plural package route.",
      exportFormats: ["pdf"]
    });
    const readPackage = await client.readPackage(path.join("packages", "sdk"));
    const publicPackageExplanation = await client.explainPackage(path.join("packages", "sdk-public"));
    const publicPackageVerification = await client.verifyPackage(path.join("packages", "sdk-public"));
    const evidence = await client.getEvidence(exported.evidenceId);
    const chunkEvidence = await client.getEvidence(firstAiChunk.evidenceId);
    const workspaceSummary = await client.compileWorkspaceManifest();
    assert.equal(adapters.soffice.required, false);
    assert.equal(adapters.pandoc.mode, "optional-system-adapter");
    assert.equal(typeof adapters.tesseract.available, "boolean");
    assert.equal(ingested.sourceType, "docx");
    assert.equal(prepared.kind, "document");
    assert.equal(prepared.preview.sendGateDecision, "allow");
    assert.ok(prepared.preview.markdownSections.includes("# SDK"));
    assert.equal(intakePlan.recordIdOrPackagePath, ingested.id);
    assert.equal(intakePlan.safety.sendsContent, false);
    assert.equal(intakePlan.safety.canPreviewChunks, true);
    assert.equal(intakePlan.safety.sendAllowedAfterReview, true);
    assert.deepEqual(intakePlan.safety.blockingWarnings, []);
    assert.equal(intakePlan.safety.chunkEndpoint, "/api/ai/context-chunk");
    assert.ok(intakePlan.nextChunkCommand.includes(`ai-context <workspace> chunk ${ingested.id} 1`));
    assert.ok(intakePlan.nextRangeCommand.includes(`ai-context <workspace> range ${ingested.id} 1`));
    assert.equal(intakePlan.continuation.canContinue, true);
    assert.equal(intakePlan.continuation.remainingChunks, 1);
    assert.equal(intakePlan.continuation.remainingRangeCount, 1);
    assert.ok(!JSON.stringify(intakePlan).includes("API-first workflow"));
    assert.equal(feedRunbook.kind, "ai_feed_runbook");
    assert.equal(feedRunbook.bodyFree, true);
    assert.equal(feedRunbook.tokenBudget, 4000);
    assert.equal(feedRunbook.totalBatchCount, 1);
    assert.match(feedRunbook.markdownRelativePath, /ai-feed/);
    assert.match(feedRunbook.jsonRelativePath, /ai-feed/);
    assert.ok(feedRunbook.batches[0].command.includes(`ai-context <workspace> range ${ingested.id} 1`));
    assert.equal(feedRunbook.batches[0].api.path, "/api/ai/context-range");
    assert.equal(JSON.stringify(feedRunbook).includes("API-first workflow"), false);
    assert.equal(updatedFeedRunbook.updatedBatch.status, "reviewed");
    assert.equal(updatedFeedRunbook.updatedBatch.note, "sdk reviewed");
    assert.equal(updatedFeedRunbook.statusSummary.completedBatches, 1);
    assert.equal(readFeedRunbook.batches[0].status, "reviewed");
    assert.equal(readFeedRunbook.statusSummary.completedBatches, 1);
    assert.equal(firstAiChunk.chunk.index, 1);
    assert.match(firstAiChunk.content, /# SDK/);
    assert.equal(firstAiChunk.sendGateDecision, "allow");
    assert.equal(firstAiChunk.progress.percentComplete, 100);
    assert.equal(firstAiChunk.continuation.canContinue, false);
    assert.equal(firstAiChunk.continuation.remainingRangeCount, 0);
    assert.ok(firstAiChunk.evidenceId.startsWith("evidence_"));
    assert.equal(aiChunkRange.includedRange.startChunkIndex, 1);
    assert.equal(aiChunkRange.includedRange.endChunkIndex, 1);
    assert.equal(aiHandoffBundle.relativePath, path.join("notes", "sdk-ai-handoff.md"));
    assert.ok(aiHandoffBundle.evidenceId.startsWith("evidence_"));
    assert.equal(aiHandoffBundle.selectionRange.startChunkIndex, 1);
    assert.match(aiHandoffBundle.body, /## AI Handoff Bundle/);
    assert.match(aiHandoffBundle.body, /### Operator Prompt/);
    assert.match(aiHandoffBundle.body, /# SDK/);
    assert.match(aiChunkRange.content, /AI_CONTEXT_CHUNK 1\/1/);
    assert.equal(aiChunkRange.sendGateDecision, "allow");
    assert.equal(aiChunkRange.progress.percentComplete, 100);
    assert.equal(aiChunkRange.continuation.canContinue, false);
    assert.equal(aiChunkRange.continuation.currentRange.endChunkIndex, 1);
    assert.ok(aiChunkRange.evidenceId.startsWith("evidence_"));
    assert.equal(recordPackage.kind, "document");
    assert.match(recordPackage.documentPath, /document\.md$/);
    assert.equal(recordPackage.packageExports.length, 2);
    assert.ok(recordPackage.preparedPreview.markdownSections.includes("# SDK"));
    assert.equal(publicRecordPackage.kind, "document");
    assert.equal(publicRecordPackage.packageExports.length, 1);
    assert.match(publicRecordPackage.packageRoot, /sdk-public-from-record$/);
    assert.equal(recordPackageReadBack.manifest.sourceRecords[0].id, ingested.id);
    assert.equal(recordPackageReadBack.manifest.sourceRecords[0].kind, "document");
    assert.equal(recordPackageReadBack.manifest.aiSendGateSummaries[0].decision, "allow");
    assert.ok(recordPackageReadBack.manifest.conversionQuality.length >= 1);
    assert.match(recordReceiverReport.markdownPath, /receiver-report\.md$/);
    assert.match(recordReceiverReport.jsonPath, /trust-report\.json$/);
    assert.equal(recordReceiverReport.verdict, "trusted_with_warnings");
    assert.equal(extracted.status, "succeeded");
    assert.match(extracted.output.outputMarkdownPath, /sdk\.md$/);
    assert.equal(exported.format, "pdf");
    assert.match(normalized.packageRoot, /sdk$/);
    assert.match(normalized.documentSchemaPath, /document\.schema\.json$/);
    assert.match(publicPackage.packageRoot, /sdk-public$/);
    assert.match(publicPackage.documentSchemaPath, /document\.schema\.json$/);
    assert.equal(readPackage.valid, true);
    assert.equal(readPackage.manifest.title, "SDK Package");
    assert.equal(readPackage.document.frontmatter.title, "SDK Package");
    assert.ok(readPackage.files.some((file) => file.path === "document.md"));
    assert.equal(publicPackageExplanation.title, "SDK Public Write");
    assert.equal(publicPackageExplanation.suitableForAi, true);
    assert.equal(publicPackageVerification.ok, true);
    assert.equal(publicPackageVerification.apiConsumptionReady, true);
    assert.equal(evidence.id, exported.evidenceId);
    assert.equal(chunkEvidence.id, firstAiChunk.evidenceId);
    assert.equal(chunkEvidence.kind, "ai_context_chunk_selected");
    assert.equal(chunkEvidence.sourceRef, ingested.id);
    assert.equal(chunkEvidence.aiSent, false);
    assert.equal(chunkEvidence.storeRawPrompt, false);
    assert.equal(chunkEvidence.selectionRange.kind, "chunk");
    assert.equal(chunkEvidence.selectionRange.chunkIndex, 1);
    assert.equal(chunkEvidence.continuation.canContinue, false);
    assert.ok(workspaceSummary.aiContextSelections.some((selection) => (
      selection.id === firstAiChunk.evidenceId
      && selection.selectionRange?.kind === "chunk"
      && selection.continuation?.canContinue === false
    )));
    assert.ok(workspaceSummary.aiHandoffBundles.some((bundle) => (
      bundle.relativePath === path.join("notes", "sdk-ai-handoff.md").replace(/\\/g, "/")
      && bundle.evidenceId === aiHandoffBundle.evidenceId
    )));
  });
});
test("local API SDK exposes guided structured errors", async () => {
  await withServer(async (baseUrl) => {
    const token = await getToken(baseUrl);
    const client = createSchemaDocsLocalClient({ baseUrl, token });
    await assert.rejects(
      () => client.openWorkspace(),
      (error) => (
        error instanceof SchemaDocsApiError
        && error.code === "workspace_required"
        && error.status === 400
        && /workspace path/i.test(error.guidance)
      )
    );
  });
});
test("local API SDK wraps non-JSON API responses as structured errors", async () => {
  const client = createSchemaDocsLocalClient({
    baseUrl: "http://127.0.0.1:4177",
    fetchImpl: async () => new Response("not json", {
      status: 502,
      headers: {
        "content-type": "text/plain"
      }
    })
  });
  await assert.rejects(
    () => client.openWorkspace(),
    (error) => (
      error instanceof SchemaDocsApiError
      && error.code === "schema_docs_api_non_json_response"
      && error.status === 502
      && /local Schema Docs API runtime/i.test(error.guidance)
    )
  );
});
test("returns document exchange capabilities through API", async () => {
  await withServer(async (baseUrl) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "lft-server-capabilities-"));
    await post(baseUrl, "/api/workspace/open", { workspacePath });
    const response = await post(baseUrl, "/api/document/capabilities", { workspacePath });
    const adapterResponse = await getJson(baseUrl, "/api/adapter/capabilities", { workspacePath });
    const manifest = await post(baseUrl, "/api/capability/manifest", { workspacePath });
    assert.equal(response.ok, true);
    assert.deepEqual(response.data.formats, ["md", "docx", "pdf", "html"]);
    assert.equal(response.data.conversions.length, 16);
    assert.ok(response.data.conversions.some((conversion) => conversion.from === "pdf" && conversion.to === "docx"));
    assert.equal(adapterResponse.ok, true);
    assert.equal(adapterResponse.data.soffice.required, false);
    assert.equal(adapterResponse.data.pandoc.mode, "optional-system-adapter");
    assert.equal(typeof adapterResponse.data.tesseract.available, "boolean");
    assert.equal(manifest.ok, true);
    assert.equal(manifest.data.capability_type, "document.exchange");
    assert.equal(manifest.data.output_contract.canonical_format, "markdown");
    assert.equal(manifest.data.validation.stores_api_key, false);
    assert.ok(manifest.data.api_contract.semantic_routes.includes("POST /api/export/pdf"));
    assert.ok(manifest.data.api_contract.semantic_routes.includes("POST /api/exchange/package/read"));
    assert.ok(manifest.data.api_contract.semantic_routes.includes("GET /api/adapter/capabilities"));
    assert.ok(manifest.data.api_contract.routes.some((route) => route.path === "/api/normalize" && route.required.includes("input")));
  });
});
