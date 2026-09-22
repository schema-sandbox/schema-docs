import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openOrCreateWorkspace, writeManifest } from "../src/core/manifest.js";
import { addIrBlock, addIrPage, createDocumentIr } from "../src/core/documentIr.js";
import { writeDocumentIr } from "../src/core/documentIrStore.js";
import { buildConversionQualityReport, runConversionQualityCheck } from "../src/cli/conversion-quality-check.js";

test("conversion quality report summarizes DocumentIR without body content", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-quality-report-"));
  try {
    await openOrCreateWorkspace(workspace);
    const ir = createDocumentIr({
      documentId: "doc_quality",
      revisionId: "rev_quality",
      source: { type: "pdf", hash: "sha256:quality", size: 42 },
      quality: { state: "review_required", unresolvedCount: 1 }
    });
    const page = addIrPage(ir, {
      pageNumber: 1,
      status: "completed",
      quality: { readingOrder: { strategy: "column_major", confidence: "medium" } }
    });
    addIrBlock(ir, { pageId: page.id, pageNumber: 1, type: "paragraph", text: "PRIVATE_BODY_SENTINEL" });
    await writeDocumentIr(workspace, ir);
    const manifest = JSON.parse(await readFile(path.join(workspace, ".ai-doc-exchange", "manifest.json"), "utf8"));
    manifest.documents.push({
      id: "doc_quality",
      title: "Quality fixture",
      sourceType: "pdf",
      status: "ready",
      documentIrRevisionId: "rev_quality",
      sourceSize: 42
    });
    await writeManifest(workspace, manifest);
    const report = await buildConversionQualityReport(workspace);
    assert.equal(report.summary.irDocumentCount, 1);
    assert.equal(report.summary.pageCount, 1);
    assert.equal(report.summary.qualityStates.review_required, 1);
    assert.equal(report.documents[0].documentIr.headingCount, 0);
    assert.equal(report.documents[0].documentIr.structuredTableCount, 0);
    assert.deepEqual(report.documents[0].documentIr.readingOrderStrategies, { column_major: 1 });
    assert.equal(report.documents[0].documentIr.unknownReadingOrderPageCount, 0);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_BODY_SENTINEL/);
    const output = [];
    const code = await runConversionQualityCheck([workspace, "--json", "--strict"], { log: (value) => output.push(value) });
    assert.equal(code, 0);
    assert.match(output[0], /schema-docs\.conversion-quality-report/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("strict quality check gates ready documents for every supported DocumentIR format", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-quality-strict-"));
  try {
    await openOrCreateWorkspace(workspace);
    const manifest = JSON.parse(await readFile(path.join(workspace, ".ai-doc-exchange", "manifest.json"), "utf8"));
    manifest.documents.push({ id: "doc_docx", title: "DOCX", sourceType: "docx", status: "ready" });
    await writeManifest(workspace, manifest);
    const output = [];
    const docxCode = await runConversionQualityCheck([workspace, "--json", "--strict"], { log: (value) => output.push(value) });
    assert.equal(docxCode, 1);
    manifest.documents.push({ id: "doc_pdf", title: "PDF", sourceType: "pdf", status: "ready" });
    await writeManifest(workspace, manifest);
    const pdfCode = await runConversionQualityCheck([workspace, "--json", "--strict"], { log: (value) => output.push(value) });
    assert.equal(pdfCode, 1);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
