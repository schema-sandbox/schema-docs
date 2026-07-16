import { test } from "node:test";
import assert from "node:assert";
import path from "node:path";
import os from "node:os";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { markdownToDocxBuffer } from "../src/adapters/markdownDocxExporter.js";
import { docxMarkdownConverter } from "../src/adapters/docxMarkdownConverter.js";
import { markdownToPdfBuffer } from "../src/adapters/pdfMarkdownConverter.js";
import { pdfMarkdownConverter } from "../src/adapters/pdfMarkdownConverter.js";
async function tempDir(prefix) {
  return await mkdtemp(path.join(os.tmpdir(), prefix));
}
test("docx round-trip regression: converts complex markdown structure to DOCX and back", async () => {
  const markdown = [
    "# Document Title",
    "",
    "# Section 1",
    "",
    "This is normal paragraph text.",
    "",
    "## Subsection 1.1",
    "",
    "- First bullet point item",
    "",
    "- Second bullet point item",
    "",
    "### Sub-subsection 1.1.1",
    "",
    "| Header A | Header B |",
    "| --- | --- |",
    "| Cell A1 | Cell B1 |",
    "| Cell A2 | Cell B2 |"
  ].join("\n") + "\n";
  const tmp = await tempDir("sdoc-reg-docx-");
  const docxPath = path.join(tmp, "test.docx");
  const docxBuffer = markdownToDocxBuffer(markdown);
  await writeFile(docxPath, docxBuffer);
  const conversion = await docxMarkdownConverter.convert({ sourcePath: docxPath });
  const resultMarkdown = conversion.markdown;

  assert.match(resultMarkdown, /# Document Title/);
  assert.doesNotMatch(resultMarkdown, /> Source:/);
  assert.doesNotMatch(resultMarkdown, /> Converted by:/);
  assert.match(resultMarkdown, /# Section 1/);
  assert.match(resultMarkdown, /This is normal paragraph text/);
  assert.match(resultMarkdown, /## Subsection 1\.1/);
  assert.match(resultMarkdown, /- First bullet point item/);
  assert.match(resultMarkdown, /- Second bullet point item/);
  assert.match(resultMarkdown, /### Sub-subsection 1\.1\.1/);
  assert.match(resultMarkdown, /\| Header A \| Header B \|/);
  assert.match(resultMarkdown, /\| Cell A1 \| Cell B1 \|/);
  assert.match(resultMarkdown, /\| Cell A2 \| Cell B2 \|/);
  await rm(tmp, { recursive: true, force: true });
});
test("pdf round-trip regression: converts multiline markdown to PDF and back", async () => {
  const markdown = [
    "# Simple Document",
    "",
    "Line one of test output",
    "Line two of test output",
    "Line three of test output"
  ].join("\n") + "\n";
  const tmp = await tempDir("sdoc-reg-pdf-");
  const pdfPath = path.join(tmp, "sample.pdf");
  const pdfBuffer = markdownToPdfBuffer(markdown);
  await writeFile(pdfPath, pdfBuffer);
  const conversion = await pdfMarkdownConverter.convert({ sourcePath: pdfPath });
  const resultMarkdown = conversion.markdown;
  assert.match(resultMarkdown, /# Simple Document/);
  assert.doesNotMatch(resultMarkdown, /> Source:/);
  assert.doesNotMatch(resultMarkdown, /> Converted by:/);
  assert.match(resultMarkdown, /Line one of test output/);
  assert.match(resultMarkdown, /Line two of test output/);
  assert.match(resultMarkdown, /Line three of test output/);
  await rm(tmp, { recursive: true, force: true });
});
