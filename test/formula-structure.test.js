import assert from "node:assert/strict";
import test from "node:test";
import { buildPdfDocumentIr } from "../src/adapters/pdfDocumentIr.js";
import { annotateFormulaBlocks, classifyFormulaText } from "../src/processing/formulaStructure.js";

test("formula classifier distinguishes editable candidates from unresolved text", () => {
  assert.equal(classifyFormulaText("$$\\frac{a}{b}$$").status, "editable_candidate");
  assert.equal(classifyFormulaText("x^2 + y^2").kind, "math_candidate");
  assert.equal(classifyFormulaText("").status, "unresolved");
});

test("formula annotation preserves visual fallback status", () => {
  const blocks = [
    { type: "formula", text: "", status: "visual_preserved" },
    { type: "formula", text: "\\int_0^1 x dx", status: "extracted" }
  ];
  annotateFormulaBlocks(blocks);
  assert.equal(blocks[0].formulaStructure.status, "visual_preserved");
  assert.equal(blocks[1].formulaStructure.status, "editable_candidate");
  assert.equal(blocks[1].qualitySignals.formulaStructure.mode, "inline");
});

test("PDF DocumentIR records formula candidate and visual preservation states", () => {
  const ir = buildPdfDocumentIr({
    documentId: "doc_formula",
    revisionId: "rev_formula",
    sourcePath: "formula.pdf",
    sourceHash: "sha256:formula",
    markdown: "<!-- pdf-page: 1 -->\n$$\\frac{a}{b}$$",
    visualMap: {
      pageCount: 1,
      pages: [{
        page: 1,
        regions: [{ type: "formula", bbox: [10, 10, 80, 30], latex: "\\frac{a}{b}", assetFile: "formula.png", needsVisualFallback: false }]
      }]
    }
  });
  const formula = ir.blocks.find((block) => block.type === "formula");
  assert.equal(formula.formulaStructure.status, "editable_candidate");
  assert.equal(formula.formulaStructure.kind, "latex_candidate");
  const fallbackIr = buildPdfDocumentIr({
    documentId: "doc_formula_fallback",
    revisionId: "rev_formula_fallback",
    sourcePath: "fallback.pdf",
    sourceHash: "sha256:fallback",
    visualMap: {
      pageCount: 1,
      pages: [{ page: 1, regions: [{ type: "formula", bbox: [10, 10, 80, 30], assetFile: "fallback.png", needsVisualFallback: true }] }]
    }
  });
  assert.equal(fallbackIr.blocks[0].formulaStructure.status, "visual_preserved");
});

