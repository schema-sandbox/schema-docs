import test from "node:test";
import assert from "node:assert/strict";
import { buildDocumentIr } from "../src/adapters/documentIr.js";
import { validateDocumentIr } from "../src/core/documentIr.js";

test("builds a logical DocumentIR for DOCX without fake page numbers", () => {
  const ir = buildDocumentIr({
    documentId: "docx-1",
    sourcePath: "sample.docx",
    sourceType: "docx",
    sourceHash: "sha256:source",
    markdown: "# Heading\n\nA paragraph.\n\n| A | B |\n| - | - |\n| 1 | 2 |"
  });
  validateDocumentIr(ir, { requireSourceHash: true });
  assert.equal(ir.pages.length, 1);
  assert.equal(ir.pages[0].pageNumber, null);
  assert.equal(ir.quality.logicalPartOnly, true);
  assert.ok(ir.blocks.some(block => ["title", "heading"].includes(block.type)));
  assert.ok(ir.blocks.some(block => block.type === "table"));
});

test("preserves referenced image assets in TXT/Markdown-compatible input", () => {
  const ir = buildDocumentIr({ sourcePath: "sample.txt", sourceType: "txt", markdown: "![figure](assets/figure.png)" });
  assert.equal(ir.assets.length, 1);
  assert.equal(ir.assets[0].path, "assets/figure.png");
  assert.equal(ir.blocks[0].assetId, ir.assets[0].id);
});

test("reuses one DocumentIR asset for repeated image references", () => {
  const ir = buildDocumentIr({
    sourcePath: "sample.md",
    sourceType: "md",
    markdown: "![figure](assets/figure.png)\n\n![same figure](assets/figure.png)"
  });
  assert.equal(ir.assets.length, 1);
  assert.equal(ir.blocks[0].assetId, ir.blocks[1].assetId);
});

test("parses image targets with angle brackets and parentheses without merging assets", () => {
  const ir = buildDocumentIr({
    sourcePath: "讲义.txt",
    sourceType: "txt",
    markdown: [
      "![one](<assets/讲义(完整版).docx/image1.png>)",
      "![two](<assets/讲义(完整版).docx/image2.png>)",
      "![one again](<assets/讲义(完整版).docx/image1.png>)"
    ].join("\n")
  });
  assert.deepEqual(ir.assets.map((asset) => asset.path), [
    "assets/讲义(完整版).docx/image1.png",
    "assets/讲义(完整版).docx/image2.png"
  ]);
  assert.equal(ir.blocks[0].assetId, ir.blocks[2].assetId);
  assert.notEqual(ir.blocks[0].assetId, ir.blocks[1].assetId);
});

test("indexes every inline image while ignoring fenced code examples", () => {
  const ir = buildDocumentIr({
    sourcePath: "inline.md",
    sourceType: "md",
    markdown: [
      "Text ![one](<assets/one (1).png>) and ![two](assets/two.png)",
      "```md",
      "![example](assets/example.png)",
      "```"
    ].join("\n")
  });
  assert.deepEqual(ir.assets.map((asset) => asset.path), ["assets/one (1).png", "assets/two.png"]);
  assert.equal(ir.blocks[0].assetIds.length, 2);
  assert.equal(ir.blocks[0].assetId, ir.blocks[0].assetIds[0]);
  assert.equal(ir.blocks[1].assetIds.length, 0);
});

test("strips Markdown image titles without altering a spaced target", () => {
  const ir = buildDocumentIr({
    sourcePath: "titles.md",
    sourceType: "md",
    markdown: "![one](<assets/one image.png> \"A title\") ![two](assets/two.png 'Second')"
  });
  assert.deepEqual(ir.assets.map((asset) => asset.path), ["assets/one image.png", "assets/two.png"]);
});

test("builds large logical text documents with indexed block relationships", () => {
  const markdown = Array.from({ length: 12000 }, (_, index) => `Paragraph ${index}`).join("\n");
  const ir = buildDocumentIr({ sourcePath: "large.txt", sourceType: "txt", markdown });
  assert.equal(ir.blocks.length, 12000);
  assert.equal(ir.pages[0].blocks.length, 12000);
});
