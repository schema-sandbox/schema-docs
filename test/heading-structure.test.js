import test from "node:test";
import assert from "node:assert/strict";
import { buildDocumentIr } from "../src/adapters/documentIr.js";

test("DocumentIR records heading ancestry and line-level source references", () => {
  const ir = buildDocumentIr({
    sourcePath: "report.docx",
    sourceType: "docx",
    sourceHash: "sha256:report",
    markdown: "# Report\n\n## Findings\n\nA finding."
  });
  const title = ir.blocks.find(block => block.type === "title");
  const heading = ir.blocks.find(block => block.type === "heading");
  const paragraph = ir.blocks.find(block => block.type === "paragraph");
  assert.deepEqual(heading.qualitySignals.headingPath, ["Report", "Findings"]);
  assert.equal(heading.parentId, title.id);
  assert.deepEqual(paragraph.qualitySignals.headingPath, ["Report", "Findings"]);
  assert.equal(paragraph.sourceRefs[0].lineNumber, 5);
});

