import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { addIrBlock, addIrPage, createDocumentIr, validateDocumentIr } from "../src/core/documentIr.js";
import { readDocumentIr, writeDocumentIr } from "../src/core/documentIrStore.js";
import { buildPdfDocumentIr } from "../src/adapters/pdfDocumentIr.js";
import { summarizeDocumentQuality } from "../src/core/conversionQuality.js";

test("DocumentIR carries visual-only OCR regions into review quality", () => {
  const ir = buildPdfDocumentIr({
    sourcePath: "scan.pdf",
    sourceHash: "sha256:scan",
    markdown: "<!-- pdf-page: 1 -->\n<!-- pdf-image: page=1 index=1 file=page.png -->",
    visualMap: { pageCount: 1, pages: [{
      page: 1, regions: [{ type: "image", bbox: [0, 0, 100, 100], assetFile: "page.png", needsVisualFallback: true }],
      ocr: { status: "completed", regions: [{ id: "ocr-1", bbox: [0, 0, 100, 100], status: "visual_only", reason: "visual_fallback_unresolved" }] },
      ocrReviewRequired: true,
      ocrReviewRegions: [{ id: "ocr-1", bbox: [0, 0, 100, 100], status: "visual_only", reason: "visual_fallback_unresolved" }]
    }] }
  });
  assert.equal(ir.pages[0].status, "partial");
  assert.equal(ir.pages[0].quality.qualityStatus, "ocr_review_required");
  assert.equal(ir.quality.state, "review_required");
  assert.ok(ir.quality.signals.some(signal => signal.kind === "ocr_review_required"));
});

test("DocumentIR keeps page, block, and source relationships valid", () => {
  const ir = createDocumentIr({ documentId: "doc_test", revisionId: "rev_test", source: { type: "pdf", hash: "sha256:test" } });
  const page = addIrPage(ir, { pageNumber: 1, status: "completed" });
  addIrBlock(ir, { type: "heading", pageId: page.id, pageNumber: 1, text: "Heading", sourceRefs: [{ kind: "pdf", pageNumber: 1 }] });
  validateDocumentIr(ir, { requireSourceHash: true });
  assert.equal(ir.pages[0].blocks.length, 1);
  assert.equal(ir.blocks[0].sourceRefs[0].pageNumber, 1);
});

test("paged DocumentIR round-trips without loading page content into the index", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-ir-store-"));
  try {
    const ir = createDocumentIr({ documentId: "doc_store", revisionId: "rev_store", source: { type: "pdf", hash: "sha256:test" } });
    const page = addIrPage(ir, { pageNumber: 1, status: "completed" });
    addIrBlock(ir, { type: "paragraph", pageId: page.id, pageNumber: 1, text: "Stored page" });
    const written = await writeDocumentIr(workspace, ir);
    const indexText = await readFile(written.indexPath, "utf8");
    assert.doesNotMatch(indexText, /Stored page/);
    const restored = await readDocumentIr(workspace, "doc_store", "rev_store");
    assert.equal(restored.blocks[0].text, "Stored page");
    assert.equal(restored.pages[0].blocks[0], restored.blocks[0].id);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("paged DocumentIR rejects unsafe storage identifiers", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-ir-store-"));
  try {
    const ir = createDocumentIr({ documentId: "../outside", revisionId: "rev_store", source: { type: "pdf", hash: "sha256:test" } });
    await assert.rejects(() => writeDocumentIr(workspace, ir), /unsafe path characters/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("PDF adapter preserves visual regions and marks missing page mapping", () => {
  const ir = buildPdfDocumentIr({
    documentId: "doc_pdf",
    revisionId: "rev_pdf",
    sourcePath: "paper.pdf",
    sourceHash: "sha256:pdf",
    extractorName: "pdfplumber",
    markdown: "# Paper\n\n<!-- pdf-page: 1 -->\nBody before<!-- pdf-formula: page=1 index=0 file=page-1-formula-1.png -->after",
    visualMap: { pageCount: 1, pages: [{ page: 1, regions: [{ type: "formula", bbox: [1, 2, 3, 4], assetFile: "page-1-formula-1.png", needsVisualFallback: true }] }] }
  });
  validateDocumentIr(ir, { requireSourceHash: true });
  assert.equal(ir.pages.length, 1);
  assert.equal(ir.assets[0].status, "visual_preserved");
  assert.ok(ir.blocks.some((block) => block.type === "formula"));
  assert.ok(ir.blocks.some((block) => block.type === "paragraph" && block.text === "Body before after"));
  assert.equal(ir.quality.pageCoverage, 1);
});

test("PDF adapter reports missing pages against the source page count", () => {
  const ir = buildPdfDocumentIr({
    documentId: "doc_partial_pdf",
    revisionId: "rev_partial_pdf",
    sourcePath: "partial.pdf",
    sourceHash: "sha256:partial",
    pageCount: 3,
    markdown: "<!-- pdf-page: 1 -->\nOnly the first page was mapped"
  });
  assert.deepEqual(ir.pages.map((page) => [page.pageNumber, page.status]), [
    [1, "completed"],
    [2, "skipped"],
    [3, "skipped"]
  ]);
  assert.equal(ir.quality.sourcePageCount, 3);
  assert.equal(ir.quality.missingPages, 2);
  assert.equal(ir.quality.pageCoverage, 1 / 3);
  assert.equal(ir.quality.state, "partial_failed");
});

test("quality coverage stays unknown for logical content and counts unique physical pages", () => {
  const logical = summarizeDocumentQuality({ source: { pageCount: null }, pages: [{ pageNumber: null, status: "completed" }] });
  assert.equal(logical.pageCoverage, null);
  const physical = summarizeDocumentQuality({
    source: { pageCount: 2 },
    pages: [
      { pageNumber: 1, status: "completed" },
      { pageNumber: 1, status: "completed" },
      { pageNumber: 2, status: "pending" }
    ]
  });
  assert.equal(physical.pageCoverage, 0.5);
  assert.equal(physical.state, "partial_failed");
  assert.equal(physical.pendingPages, 1);
});

test("PDF adapter keeps source quality fields and flags unpaged content", () => {
  const ir = buildPdfDocumentIr({
    documentId: "doc_unpaged",
    revisionId: "rev_unpaged",
    sourcePath: "plain.pdf",
    sourceHash: "sha256:plain",
    markdown: "Body without page markers",
    quality: { unsupportedFeatures: ["images"] }
  });
  assert.deepEqual(ir.quality.unsupportedFeatures, ["images"]);
  assert.equal(ir.quality.hasUnpagedBlocks, true);
  assert.equal(ir.quality.state, "review_required");
});

test("PDF adapter preserves Markdown list and inline formula block types", () => {
  const ir = buildPdfDocumentIr({
    documentId: "doc_pdf_structures",
    revisionId: "rev_pdf_structures",
    sourcePath: "structures.pdf",
    sourceHash: "sha256:structures",
    markdown: [
      "<!-- pdf-page: 1 -->",
      "- first item",
      "2. second item",
      "\\(x^2 + y^2\\)",
      "```python",
      "print('ok')",
      "```"
    ].join("\n")
  });
  assert.deepEqual(ir.blocks.map((block) => block.type), ["list", "list", "formula", "code", "code", "code"]);
});
