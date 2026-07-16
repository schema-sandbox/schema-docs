import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openOrCreateWorkspace } from "../src/core/manifest.js";
import { saveMarkdown } from "../src/core/markdown.js";
import { exportMarkdownDocument } from "../src/core/documentExports.js";
import { isPptxSlideMarkdown, projectPptxSlidesForExport } from "../src/core/pptxMarkdownProjection.js";
import { readZipEntry } from "../src/core/zip.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l4QW2QAAAABJRU5ErkJggg==", "base64");

function deckMarkdown() {
  return [
    "# Learning deck",
    "",
    "## Slide 1: Opening",
    "",
    "![Slide 1 preview](<../assets/learning.pptx/slide-1-preview.png>)",
    "",
    "Presenter: semantic text for AI",
    "",
    "## Slide 2: Contents",
    "",
    "![Slide 2 preview](<../assets/learning.pptx/slide-2-preview.png>)",
    "",
    "01. Duplicate extracted text",
    "02. More duplicate extracted text",
    ""
  ].join("\n");
}

test("PPTX export projection keeps slide previews and removes duplicate semantic text", () => {
  const source = deckMarkdown();
  assert.equal(isPptxSlideMarkdown(source), true);
  const projected = projectPptxSlidesForExport(source);
  assert.match(projected, /^# Learning deck/m);
  assert.match(projected, /^## Slide 1: Opening/m);
  assert.match(projected, /slide-1-preview\.png/);
  assert.match(projected, /slide-2-preview\.png/);
  assert.doesNotMatch(projected, /semantic text|Duplicate extracted text|More duplicate/);
});

test("PPTX export projection retains semantic text when a slide preview is missing", () => {
  const source = deckMarkdown().replace(
    "![Slide 2 preview](<../assets/learning.pptx/slide-2-preview.png>)",
    ""
  );
  const projected = projectPptxSlidesForExport(source);
  assert.doesNotMatch(projected, /semantic text for AI/);
  assert.match(projected, /Duplicate extracted text/);
});

test("PPTX standard exports use the visual slide layer without mutating the internal note", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-pptx-projection-"));
  await openOrCreateWorkspace(workspace);
  const relativeSource = path.join("outputs", "readable", "learning.md");
  const assetDir = path.join(workspace, "outputs", "assets", "learning.pptx");
  await mkdir(assetDir, { recursive: true });
  await writeFile(path.join(assetDir, "slide-1-preview.png"), png);
  await writeFile(path.join(assetDir, "slide-2-preview.png"), png);
  await saveMarkdown(workspace, relativeSource, deckMarkdown());

  const mdPath = await exportMarkdownDocument(workspace, relativeSource, "exports/learning.md", "md");
  const htmlPath = await exportMarkdownDocument(workspace, relativeSource, "exports/learning.html", "html");
  const docxPath = await exportMarkdownDocument(workspace, relativeSource, "exports/learning.docx", "docx");
  const pdfPath = await exportMarkdownDocument(workspace, relativeSource, "exports/learning.pdf", "pdf");

  const exportedMarkdown = await readFile(mdPath, "utf8");
  const exportedHtml = await readFile(htmlPath, "utf8");
  const documentXml = readZipEntry(await readFile(docxPath), "word/document.xml").toString("utf8");
  const pdf = await readFile(pdfPath);
  const internalMarkdown = await readFile(path.join(workspace, relativeSource), "utf8");

  for (const output of [exportedMarkdown, exportedHtml, documentXml]) {
    assert.doesNotMatch(output, /semantic text for AI|Duplicate extracted text|More duplicate/);
  }
  assert.match(exportedMarkdown, /learning\.assets\/slide-1-preview\.png/);
  assert.match(exportedHtml, /data:image\/png;base64,/);
  assert.match(documentXml, /<w:drawing>/);
  assert.match(pdf.toString("latin1"), /%PDF-1\.4/);
  assert.doesNotMatch(pdf.toString("latin1"), /semantic text for AI|Duplicate extracted text|More duplicate/);
  assert.match(internalMarkdown, /semantic text for AI/);
});
