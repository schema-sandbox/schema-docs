import assert from "node:assert/strict";
import { docxDocumentXmlToMarkdown } from "../src/adapters/docxMarkdownConverter.js";
import { buildDocumentIr } from "../src/adapters/documentIr.js";
import { exportMarkdownToDocx, exportMarkdownToHtml } from "../src/core/markdownExportPipeline.js";
import { readZipEntry } from "../src/core/zip.js";
import { readTableMarker, validateTableGeometry } from "../public/tableGeometry.js";
import test from "node:test";
import { buildPdfDocumentIr } from "../src/adapters/pdfDocumentIr.js";
import { annotateMarkdownTableBlocks, parseMarkdownTable, summarizeVisualTableRegion } from "../src/processing/tableStructure.js";

test("Markdown table parser keeps escaped pipes and reports row structure", () => {
  const parsed = parseMarkdownTable([
    "| Name | Note |",
    "| --- | :---: |",
    "| A | left \\| right |",
    "| B | done |"
  ].join("\n"));
  assert.equal(parsed.status, "structured");
  assert.equal(parsed.columnCount, 2);
  assert.equal(parsed.rowCount, 3);
  assert.deepEqual(parsed.headers, ["Name", "Note"]);
  assert.equal(parsed.rows[1][1], "left | right");
});

test("table blocks receive stable row roles and headers", () => {
  const blocks = [
    { id: "h", type: "table", text: "| Name | Value |", qualitySignals: {} },
    { id: "s", type: "table", text: "| --- | --- |", qualitySignals: {} },
    { id: "r", type: "table", text: "| A | 1 |", qualitySignals: {} }
  ];
  annotateMarkdownTableBlocks(blocks, { prefix: "page_1" });
  assert.equal(blocks[0].tableStructure.rowRole, "header");
  assert.equal(blocks[1].tableStructure.rowRole, "separator");
  assert.equal(blocks[2].tableStructure.rowIndex, 1);
  assert.equal(blocks[0].tableStructure.tableId, blocks[2].tableStructure.tableId);
  assert.deepEqual(blocks[0].tableStructure.headers, ["Name", "Value"]);
  assert.deepEqual(blocks[0].tableStructure.cells, ["Name", "Value"]);
  assert.deepEqual(blocks[2].tableStructure.cells, ["A", "1"]);
  assert.deepEqual(blocks[2].tableStructure.cellRefs, [[], []]);
});

test("table cell refs retain the row source location and cell index", () => {
  const blocks = [
    {
      type: "table",
      text: "| Name | Value |",
      sourceRefs: [{ kind: "pdf", pageNumber: 4, lineNumber: 12 }]
    },
    {
      type: "table",
      text: "| --- | --- |",
      sourceRefs: [{ kind: "pdf", pageNumber: 4, lineNumber: 13 }]
    },
    {
      type: "table",
      text: "| A | 1 |",
      sourceRefs: [{ kind: "pdf", pageNumber: 4, lineNumber: 14 }]
    }
  ];
  annotateMarkdownTableBlocks(blocks, { prefix: "page_4" });
  assert.deepEqual(blocks[2].tableStructure.cellRefs, [
    [{ kind: "pdf", pageNumber: 4, lineNumber: 14, cellIndex: 0 }],
    [{ kind: "pdf", pageNumber: 4, lineNumber: 14, cellIndex: 1 }]
  ]);
});

test("visual tables without a grid stay unresolved", () => {
  assert.deepEqual(summarizeVisualTableRegion({ type: "table", bbox: [0, 0, 100, 100] }), {
    status: "unknown",
    rowCount: 0,
    columnCount: 0,
    headers: [],
    spans: [],
    warnings: ["visual_table_grid_unresolved"]
  });
});

test("PDF DocumentIR records table structure for Markdown table rows", () => {
  const ir = buildPdfDocumentIr({
    documentId: "doc_table",
    revisionId: "rev_table",
    sourcePath: "table.pdf",
    sourceHash: "sha256:table",
    markdown: [
      "<!-- pdf-page: 1 -->",
      "| Name | Value |",
      "| --- | --- |",
      "| A | 1 |"
    ].join("\n")
  });
  const tableBlocks = ir.blocks.filter((block) => block.type === "table");
  assert.equal(tableBlocks.length, 3);
  assert.ok(tableBlocks.every((block) => block.tableStructure?.columnCount === 2));
  assert.equal(tableBlocks[0].tableStructure.rowRole, "header");
});
test("Word horizontal and vertical merges survive Markdown, IR, HTML and Word export", async () => {
  const cell = (text, properties = "") => `<w:tc><w:tcPr>${properties}</w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const span = '<w:gridSpan w:val="2"/>';
  const xml = `<w:document><w:body><w:tbl>
  <w:tr>${cell("Merged", span + '<w:vMerge w:val="restart"/>')}${cell("Top")}</w:tr>
  <w:tr>${cell("", span + '<w:vMerge/>')}${cell("Second")}</w:tr>
  <w:tr>${cell("A")}${cell("B")}${cell("C")}</w:tr>
  </w:tbl></w:body></w:document>`;
  const markdown = docxDocumentXmlToMarkdown(xml, "merged.docx");
  assert.match(markdown, /"spans":\[\[0,0,2,2\]\]/);
  assert.doesNotMatch(markdown, /Column \d/);
  const ir = buildDocumentIr({ sourceType: "docx", markdown });
  const table = ir.blocks.find(block => block.type === "table");
  assert.deepEqual(table.tableStructure.spans, [[0,0,2,2]]);
  assert.equal(table.tableStructure.cellGeometry[0].rowSpan, 2);
  const html = await exportMarkdownToHtml(markdown);
  assert.match(html, /<th rowspan="2" colspan="2">Merged<\/th>/);
  assert.equal((html.match(/<t[dh](?:\s|>)/g) || []).length, 6);
  assert.doesNotMatch(html, /schema-table/);
  assert.doesNotMatch(html, /<thead>/);
  const documentXml = readZipEntry(await exportMarkdownToDocx(markdown), "word/document.xml").toString();
  assert.match(documentXml, /w:gridSpan w:val="2"/);
  assert.match(documentXml, /w:vMerge w:val="restart"/);
  assert.match(documentXml, /w:vMerge w:val="continue"/);
  assert.equal((documentXml.match(/>Merged<\/w:t>/g) || []).length, 1);
  assert.match(documentXml, />Second<\/w:t>/);

  // A new value in a covered cell invalidates old geometry, preserving edits.
  const edited = markdown.replace('| Merged |  | Top |', '| Merged | User edit | Top |');
  const editedHtml = await exportMarkdownToHtml(edited);
  assert.match(editedHtml, /User edit/);
  assert.doesNotMatch(editedHtml, /rowspan|colspan/);
});

test("table span metadata rejects overlap, hidden values and unbounded grids", () => {
  const rows = [["A", ""], ["", "B"]];
  assert.equal(validateTableGeometry({v:1,rows:2,cols:2,spans:[[0,0,2,2]]}, rows), null);
  assert.equal(validateTableGeometry({v:1,rows:2,cols:2,spans:[[0,0,1,2],[0,1,1,1]]}, rows), null);
  assert.equal(validateTableGeometry({v:1,rows:2,cols:2,spans:[[0,0,10000000,1]]}, rows), null);
  assert.equal(readTableMarker('<!-- schema-table: {"v":2,"spans":[]} -->'), null);
});
