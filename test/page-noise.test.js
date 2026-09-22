import test from "node:test";
import assert from "node:assert/strict";
import { addIrBlock, addIrPage, createDocumentIr } from "../src/core/documentIr.js";
import { buildPdfDocumentIr } from "../src/adapters/pdfDocumentIr.js";
import { annotateRepeatedPageText } from "../src/processing/pageNoise.js";

test("repeated page text is marked for review while body content remains intact", () => {
  const ir = createDocumentIr({ documentId: "noise-doc", source: { type: "pdf", hash: "sha256:x" } });
  const page1 = addIrPage(ir, { pageNumber: 1, status: "completed" });
  const page2 = addIrPage(ir, { pageNumber: 2, status: "completed" });
  addIrBlock(ir, { pageId: page1.id, pageNumber: 1, ordinal: 0, type: "paragraph", text: "Company Report" });
  addIrBlock(ir, { pageId: page1.id, pageNumber: 1, ordinal: 1, type: "paragraph", text: "Unique page one" });
  addIrBlock(ir, { pageId: page2.id, pageNumber: 2, ordinal: 0, type: "paragraph", text: "Company Report" });
  addIrBlock(ir, { pageId: page2.id, pageNumber: 2, ordinal: 1, type: "paragraph", text: "Unique page two" });
  const result = annotateRepeatedPageText(ir);
  assert.equal(result.repeatedTextCount, 1);
  const repeated = ir.blocks.filter(block => block.text === "Company Report");
  assert.equal(repeated.length, 2);
  assert.ok(repeated.every(block => block.qualitySignals.noiseCandidate));
  assert.equal(ir.blocks.filter(block => block.text.startsWith("Unique")).length, 2);
});

test("PDF adapter exposes repeated page text as a document quality signal", () => {
  const ir = buildPdfDocumentIr({
    documentId: "noise-pdf",
    revisionId: "rev-noise-pdf",
    sourcePath: "noise.pdf",
    sourceHash: "sha256:noise",
    markdown: [
      "<!-- pdf-page: 1 -->",
      "Company Report",
      "Unique page one",
      "<!-- pdf-page: 2 -->",
      "Company Report",
      "Unique page two"
    ].join("\n")
  });
  assert.equal(ir.quality.state, "review_required");
  assert.ok(ir.quality.signals.some((signal) => signal.kind === "page_noise_candidate"));
  assert.equal(ir.blocks.filter((block) => block.text === "Company Report").length, 2);
});

test("PDF adapter marks OCR failure page markers as failed", () => {
  const ir = buildPdfDocumentIr({
    documentId: "ocr-failed-page",
    revisionId: "rev-ocr-failed-page",
    sourcePath: "scan.pdf",
    sourceHash: "sha256:scan",
    markdown: [
      "<!-- pdf-page: 1; extraction: ocr -->",
      "Readable page",
      "<!-- pdf-page: 2; extraction: ocr_failed -->",
      "> OCR failed for source page 2."
    ].join("\n")
  });
  assert.equal(ir.pages.map((page) => page.status).join(","), "completed,failed");
  assert.equal(ir.quality.state, "partial_failed");
  assert.ok(ir.pages[1].warnings.includes("OCR failed for source page"));
  assert.ok(ir.quality.signals.some((signal) => signal.kind === "page_failed" && signal.pageNumber === 2));
});
