import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openOrCreateWorkspace, readManifest } from "../src/core/manifest.js";
import { saveMarkdown } from "../src/core/markdown.js";
import { importFileToWorkspace } from "../src/core/records.js";
import { attachPdfImagesToMarkdown, convertDocumentToMarkdownAsJob } from "../src/core/documents.js";
import { decodeTextBuffer, textMarkdownConverter, textToMarkdown } from "../src/adapters/textMarkdownConverter.js";
import { docxDocumentXmlToMarkdown, docxMarkdownConverter } from "../src/adapters/docxMarkdownConverter.js";
import { markdownToDocxBuffer } from "../src/adapters/markdownDocxExporter.js";
import { markdownToPdfBuffer, pdfBufferToMarkdown, pdfMarkdownConverter } from "../src/adapters/pdfMarkdownConverter.js";
import { runPdfExtractionPipeline } from "../src/adapters/pdfExtractorPipeline.js";
import { rewriteMarkerLocalAssets } from "../src/adapters/pdfMarkerExtractor.js";
import { createAppService } from "../src/core/appService.js";
import { deleteConversionAudit, listConversionAudits } from "../src/core/conversionAudits.js";
import { exportMarkdownDocument } from "../src/core/documentExports.js";
import {
  getDocumentExchangeCapability,
  listDocumentExchangeCapabilities,
  normalizeDocumentExchangeSourceType,
  normalizeDocumentFormat
} from "../src/core/documentExchangeMatrix.js";
import { getEvidenceLogPath, getEvidenceRecord, listEvidenceRecords } from "../src/core/evidence.js";
import { createDocumentCapabilityManifest } from "../src/core/capabilityManifest.js";
import { createReadableMarkdown, splitReadableMarkdown } from "../src/core/readableMarkdown.js";
import { listZipEntries, readZipEntry } from "../src/core/zip.js";
import { buildZip } from "./helpers/zipBuilder.js";
async function tempDir(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}
test("converts plain text document through document job flow", async () => {
  const workspace = await tempDir("lft-text-doc-");
  await openOrCreateWorkspace(workspace);
  const textPath = path.join(workspace, "input.txt");
  await writeFile(textPath, "alpha\nbeta\n", "utf8");
  const record = await importFileToWorkspace(workspace, textPath);
  const job = await convertDocumentToMarkdownAsJob(workspace, record.id, textMarkdownConverter);
  const manifest = await readManifest(workspace);
  const document = manifest.documents.find((candidate) => candidate.id === record.id);
  assert.equal(job.status, "succeeded");
  assert.ok(job.output.evidenceId.startsWith("evidence_"));
  assert.ok(job.output.auditId.startsWith("conversion_"));
  assert.equal(job.output.qualityReportId.startsWith("quality_"), true);
  assert.equal(document.status, "ready");
  assert.ok(document.outputMarkdownPath.endsWith(".md"));
  const conversionAudits = await listConversionAudits(workspace);
  assert.equal(conversionAudits.length, 1);
  assert.equal(conversionAudits[0].targetFormat, "md");
  assert.equal(conversionAudits[0].evidenceId, job.output.evidenceId);
  const evidenceRecords = await listEvidenceRecords(workspace);
  assert.equal(evidenceRecords.length, 1);
  assert.equal(evidenceRecords[0].kind, "document_extraction");
  assert.equal(evidenceRecords[0].outputType, "md");
  assert.equal(evidenceRecords[0].policyMode, "open-core");
  assert.equal(evidenceRecords[0].policySnapshot.openCoreFree, true);
});
test("reimport restores a missing workspace source copy before conversion", async () => {
  const workspace = await tempDir("lft-restore-import-copy-");
  await openOrCreateWorkspace(workspace);
  const sourcePath = path.join(workspace, "source-outside-imports.txt");
  await writeFile(sourcePath, "restored source copy", "utf8");
  const first = await importFileToWorkspace(workspace, sourcePath);
  await unlink(first.sourcePath);
  const second = await importFileToWorkspace(workspace, sourcePath);
  assert.equal(second.id, first.id);
  assert.equal(second.reusedImport, true);
  assert.equal(second.restoredImportedCopy, true);
  assert.equal(second.status, "imported");
  assert.equal(await readFile(second.sourcePath, "utf8"), "restored source copy");
  const manifest = await readManifest(workspace);
  assert.equal(manifest.documents.length, 1);
  assert.equal(manifest.documents[0].status, "imported");
});
test("text to markdown does not add process metadata to content", () => {
  const markdown = textToMarkdown("hello", "sample.txt");
  assert.match(markdown, /^# sample/);
  assert.doesNotMatch(markdown, /> Source: sample\.txt/);
  assert.doesNotMatch(markdown, /> Converted by:/);
  assert.match(markdown, /hello/);
});
test("decodes Windows Chinese TXT encodings before Markdown conversion", async () => {
  const gb18030 = Buffer.from([0xb5, 0xe7, 0xd3, 0xb0, 0xbc, 0xb6, 0xb2, 0xa5, 0xbf, 0xcd]);
  const decoded = decodeTextBuffer(gb18030);
  assert.equal(decoded.encoding, "gb18030");
  assert.equal(decoded.text, "电影级播客");
  const workspace = await tempDir("lft-gb18030-txt-");
  await openOrCreateWorkspace(workspace);
  const textPath = path.join(workspace, "gb18030.txt");
  await writeFile(textPath, gb18030);
  const record = await importFileToWorkspace(workspace, textPath);
  const job = await convertDocumentToMarkdownAsJob(workspace, record.id, textMarkdownConverter);
  const manifest = await readManifest(workspace);
  const document = manifest.documents.find((candidate) => candidate.id === record.id);
  const markdown = await readFile(document.outputMarkdownPath, "utf8");
  assert.equal(job.status, "succeeded");
  assert.match(markdown, /电影级播客/);
  assert.doesNotMatch(markdown, /\ufffd/);
  assert.equal(document.extractionQuality.detectedEncoding, "gb18030");
});
test("decodes UTF-16 TXT files with BOM", async () => {
  const body = Buffer.from("标题\n内容", "utf16le");
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), body]);
  const decoded = decodeTextBuffer(utf16);
  assert.equal(decoded.encoding, "utf-16le-bom");
  assert.equal(decoded.text, "标题\n内容");
});
test("blocks unreadable TXT from readable Markdown instead of rendering mojibake", async () => {
  const workspace = await tempDir("lft-unreadable-txt-");
  await openOrCreateWorkspace(workspace);
  const textPath = path.join(workspace, "binary-looking.txt");
  const bytes = Buffer.alloc(4096);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = index % 17 === 0 ? 0 : (index * 31) % 256;
  }
  await writeFile(textPath, bytes);
  const record = await importFileToWorkspace(workspace, textPath);
  const job = await convertDocumentToMarkdownAsJob(workspace, record.id, textMarkdownConverter);
  const manifest = await readManifest(workspace);
  const document = manifest.documents.find((candidate) => candidate.id === record.id);
  const readable = await readFile(document.readableMarkdownPath, "utf8");
  assert.equal(job.status, "succeeded");
  assert.equal(document.extractionQuality.lowReadableText, true);
  assert.equal(document.extractionQuality.scannedLikely, false);
  assert.equal(document.markdownOutputs.readableSegments.segmented, false);
  assert.match(readable, /Text file needs another encoding path/);
  assert.match(readable, /could not be converted into reliable human-readable Markdown/);
  assert.doesNotMatch(readable, /\ufffd{3,}/);
});
test("native markdown document opens without rewriting content", async () => {
  const workspace = await tempDir("lft-native-md-");
  await openOrCreateWorkspace(workspace);
  const sourcePath = path.join(workspace, "native.md");
  const original = [
    "---",
    "title: Native Doc",
    "---",
    "",
    "> Source: this is user content, not process metadata",
    "",
    "| A | B |",
    "|---|---|",
    "| 1 | 2 |",
    "",
    "Final line with trailing spaces.  ",
    ""
  ].join("\n");
  await writeFile(sourcePath, original, "utf8");
  const record = await importFileToWorkspace(workspace, sourcePath);
  const job = await convertDocumentToMarkdownAsJob(workspace, record.id, textMarkdownConverter);
  const manifest = await readManifest(workspace);
  const document = manifest.documents.find((candidate) => candidate.id === record.id);
  assert.equal(job.status, "succeeded");
  assert.equal(document.sourceType, "md");
  assert.equal(document.extractorName, "native-markdown-open");
  assert.equal(document.outputMarkdownPath, document.sourcePath);
  assert.equal(document.markdownOutputs.defaultForHumans, document.sourcePath);
  assert.equal(await readFile(document.outputMarkdownPath, "utf8"), original);
});
test("reads entries from generated zip", () => {
  const zip = buildZip([
    {
      name: "hello.txt",
      content: "hello zip"
    }
  ]);
  assert.equal(readZipEntry(zip, "hello.txt").toString("utf8"), "hello zip");
});
test("converts docx document xml to markdown", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Report Title</w:t></w:r></w:p>
        <w:p><w:r><w:t>Hello &amp; welcome</w:t></w:r></w:p>
        <w:tbl>
          <w:tr><w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Value</w:t></w:r></w:p></w:tc></w:tr>
          <w:tr><w:tc><w:p><w:r><w:t>Alpha</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc></w:tr>
        </w:tbl>
      </w:body>
    </w:document>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
    </Relationships>`;
  const linkedXml = xml.replace(
    "</w:body>",
    `<w:p>
      <w:r><w:rPr><w:b/></w:rPr><w:t>Important</w:t></w:r>
      <w:r><w:t> and </w:t></w:r>
      <w:r><w:rPr><w:i/></w:rPr><w:t>emphasis</w:t></w:r>
      <w:r><w:t> with </w:t></w:r>
      <w:hyperlink r:id="rId5"><w:r><w:t>link</w:t></w:r></w:hyperlink>
    </w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="4"/></w:numPr></w:pPr><w:r><w:t>Nested list item</w:t></w:r></w:p>
    <w:p><w:r><w:drawing><wp:inline/></w:drawing></w:r></w:p>
    <w:p><w:r><w:t>Claim with footnote</w:t></w:r><w:r><w:footnoteReference w:id="2"/></w:r></w:p>
    <w:p><w:r><w:t>Appendix marker</w:t></w:r><w:r><w:endnoteReference w:id="3"/></w:r></w:p>
    <w:p><w:r><w:rPr><w:b w:val="false"/></w:rPr><w:t>Plain text in bold wrapper</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Whole paragraph bold should read as plain body.</w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Wide Header</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Value</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
    </w:body>`
  );
  const footnotesXml = `<?xml version="1.0" encoding="UTF-8"?>
    <w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:footnote w:id="2"><w:p><w:r><w:t>Footnote body</w:t></w:r></w:p></w:footnote>
    </w:footnotes>`;
  const endnotesXml = `<?xml version="1.0" encoding="UTF-8"?>
    <w:endnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:endnote w:id="3"><w:p><w:r><w:t>Endnote body</w:t></w:r></w:p></w:endnote>
    </w:endnotes>`;
  const markdown = docxDocumentXmlToMarkdown(linkedXml, "report.docx", rels, { footnotesXml, endnotesXml });
  assert.match(markdown, /# report/);
  assert.match(markdown, /# Report Title/);
  assert.match(markdown, /Hello & welcome/);
  assert.match(markdown, /\| Name \| Value \|/);
  assert.match(markdown, /\| Alpha \| 1 \|/);
  assert.match(markdown, /\*\*Important\*\* and \*emphasis\* with \[link\]\(https:\/\/example\.com\)/);
  assert.match(markdown, /^  - Nested list item$/m);
  assert.match(markdown, /!\[Embedded image omitted\]\(image\)/);
  assert.match(markdown, /Claim with footnote\[\^footnote-2\]/);
  assert.match(markdown, /Appendix marker\[\^endnote-3\]/);
  assert.match(markdown, /\[\^footnote-2\]: Footnote body/);
  assert.match(markdown, /\[\^endnote-3\]: Endnote body/);
  assert.match(markdown, /\| Wide Header \| Column 2 \| Value \|/);
  assert.match(markdown, /Plain text in bold wrapper/);
  assert.ok(!markdown.includes("**Plain text in bold wrapper**"));
  assert.match(markdown, /Whole paragraph bold should read as plain body\./);
  assert.ok(!markdown.includes("**Whole paragraph bold should read as plain body.**"));
});
test("converts generated docx through document job flow", async () => {
  const workspace = await tempDir("lft-docx-");
  await openOrCreateWorkspace(workspace);
  const docxPath = path.join(workspace, "report.docx");
  const documentXml = `<?xml version="1.0" encoding="UTF-8"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>Plain paragraph</w:t></w:r></w:p>
      </w:body>
    </w:document>`;
  await writeFile(docxPath, buildZip([
    {
      name: "word/document.xml",
      content: documentXml
    }
  ]));
  const record = await importFileToWorkspace(workspace, docxPath);
  const job = await convertDocumentToMarkdownAsJob(workspace, record.id, docxMarkdownConverter);
  const manifest = await readManifest(workspace);
  const document = manifest.documents.find((candidate) => candidate.id === record.id);
  assert.equal(job.status, "succeeded");
  assert.equal(document.status, "ready");
  assert.ok(document.outputMarkdownPath.endsWith("report.md"));
  assert.ok(!document.extractionQuality.unsupportedFeatures.includes("images"));
  assert.ok(document.extractionQuality.unsupportedFeatures.includes("smartart"));
  assert.ok(document.extractionQuality.unsupportedFeatures.includes("vba"));
  const qualityReport = JSON.parse(await readFile(document.outputMarkdownPath.replace(/\.md$/, ".quality.json"), "utf8"));
  assert.ok(qualityReport.matchedKnownLimits.includes("docx_rich_layout_unsupported"));
  assert.ok(qualityReport.matchedKnownLimits.includes("docx_macros_vba_unsupported"));
});
test("preserves DOCX and WPS images plus editable OMML formulas", async () => {
  const workspace = await tempDir("lft-docx-rich-");
  await openOrCreateWorkspace(workspace);
  const docxPath = path.join(workspace, "rich.docx");
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l4QW2QAAAABJRU5ErkJggg==", "base64");
  const documentXml = `<?xml version="1.0" encoding="UTF-8"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
      <w:body>
        <w:p><w:r><w:t>Image:</w:t></w:r><w:r><w:drawing><a:blip r:embed="rId7"/></w:drawing></w:r></w:p>
        <w:p><m:oMathPara><m:oMath><m:f>
          <m:num><m:r><m:t>x</m:t></m:r></m:num>
          <m:den><m:sSup><m:e><m:r><m:t>y</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:den>
        </m:f></m:oMath></m:oMathPara></w:p>
      </w:body>
    </w:document>`;
  const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
    </Relationships>`;
  await writeFile(docxPath, buildZip([
    { name: "word/document.xml", content: documentXml },
    { name: "word/_rels/document.xml.rels", content: relsXml },
    { name: "word/media/image1.png", content: image }
  ]));
  const record = await importFileToWorkspace(workspace, docxPath);
  const job = await convertDocumentToMarkdownAsJob(workspace, record.id, docxMarkdownConverter);
  const document = (await readManifest(workspace)).documents.find((candidate) => candidate.id === record.id);
  const markdown = await readFile(document.outputMarkdownPath, "utf8");
  const readableMarkdown = await readFile(document.readableMarkdownPath, "utf8");
  assert.equal(job.status, "succeeded");
  assert.match(markdown, /!\[Word image\]\(<assets\/rich\.docx\/image1\.png>\)/);
  assert.match(readableMarkdown, /!\[Word image\]\(<\.\.\/assets\/rich\.docx\/image1\.png>\)/);
  assert.match(markdown, /\\frac\{x\}\{\{y\}\^\{2\}\}/);
  assert.deepEqual(await readFile(path.join(workspace, "outputs", "assets", "rich.docx", "image1.png")), image);
  assert.ok(!document.extractionQuality.unsupportedFeatures.includes("images"));
  assert.ok(!document.extractionQuality.unsupportedFeatures.includes("formulas"));
  const markdownRelativePath = path.relative(workspace, document.outputMarkdownPath);
  const exportedDocx = await exportMarkdownDocument(workspace, markdownRelativePath, "exports/rich.docx", "docx");
  const exportedHtml = await exportMarkdownDocument(workspace, markdownRelativePath, "exports/rich.html", "html");
  const exportedPdf = await exportMarkdownDocument(workspace, markdownRelativePath, "exports/rich.pdf", "pdf");
  const docxBuffer = await readFile(exportedDocx);
  assert.ok(listZipEntries(docxBuffer).some((entry) => entry.fileName.startsWith("word/media/")));
  assert.match(readZipEntry(docxBuffer, "word/document.xml").toString("utf8"), /<m:oMath/);
  assert.match(await readFile(exportedHtml, "utf8"), /data:image\/png;base64,/);
  assert.match((await readFile(exportedPdf)).toString("latin1"), /%PDF-1\.4/);
});
test("preserves DOCX ordered numbering and OLE preview images", () => {
  const documentXml = `<w:document xmlns:w="word" xmlns:r="rels" xmlns:v="v" xmlns:o="o"><w:body>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="4"/></w:numPr></w:pPr><w:r><w:t>First note</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="4"/></w:numPr></w:pPr><w:r><w:t>Second note</w:t></w:r></w:p>
    <w:p><w:r><w:object><v:imagedata r:id="rId9"/><o:OLEObject/></w:object></w:r></w:p>
  </w:body></w:document>`;
  const numberingXml = `<w:numbering xmlns:w="word"><w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="4"><w:abstractNumId w:val="2"/></w:num></w:numbering>`;
  const markdown = docxDocumentXmlToMarkdown(documentXml, "clean-title.docx", "", {}, {
    numberingXml,
    mediaTargets: new Map([["rId9", "assets/formula.png"]])
  });
  assert.match(markdown, /^# clean-title$/m);
  assert.match(markdown, /^1\. First note$/m);
  assert.match(markdown, /^2\. Second note$/m);
  assert.match(markdown, /!\[Word image\]\(<assets\/formula\.png>\)/);
  assert.ok(!markdown.includes("Embedded object omitted"));
});
test("restores linear LaTeX command words stored in Word OMML runs", () => {
  const documentXml = `<w:document xmlns:w="word" xmlns:m="math"><w:body><w:p><m:oMath>
    <m:r><m:t>operatorname</m:t></m:r><m:r><m:t>tr</m:t></m:r><m:r><m:t>(</m:t></m:r>
    <m:sSup><m:e><m:r><m:t>rho</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>
    <m:r><m:t>) &lt; 1 Longrightarrow </m:t></m:r>
    <m:r><m:t>|Psi rangle otimes langle Psi|</m:t></m:r>
  </m:oMath></w:p></w:body></w:document>`;
  const markdown = docxDocumentXmlToMarkdown(documentXml, "math.docx");
  assert.match(markdown, /\\operatorname\{tr\}/);
  assert.match(markdown, /\{\\rho\}\^\{2\}/);
  assert.match(markdown, /< 1 \\Longrightarrow/);
  assert.match(markdown, /\|\\Psi \\rangle \\otimes \\langle \\Psi\|/);
});
test("exports markdown to docx and reads it back as markdown", () => {
  const docx = markdownToDocxBuffer([
    "# Title",
    "",
    "Hello from Markdown.",
    "",
    "中文段落。",
    "",
    "| Name | Value |",
    "| --- | --- |",
    "| Alpha | 1 |"
  ].join("\n"));
  const documentXml = readZipEntry(docx, "word/document.xml").toString("utf8");
  const markdown = docxDocumentXmlToMarkdown(documentXml, "roundtrip.docx");
  assert.match(documentXml, /Hello from Markdown/);
  assert.match(documentXml, /<w:tbl>/);
  assert.match(markdown, /# Title/);
  assert.match(markdown, /Hello from Markdown/);
  assert.match(markdown, /中文段落/);
  assert.match(markdown, /\| Name \| Value \|/);
  assert.match(markdown, /\| Alpha \| 1 \|/);
});
test("exports markdown to pdf and extracts simple text back", async () => {
  const pdf = markdownToPdfBuffer("# Title\n\nHello PDF.\n\n中文内容。");
  const markdown = await pdfBufferToMarkdown(pdf, "roundtrip.pdf");
  assert.match(pdf.toString("latin1"), /%PDF-1\.4/);
  assert.match(markdown, /# Title/);
  assert.match(markdown, /Hello PDF/);
  assert.match(markdown, /中文内容/);
});
test("pdf text layer extraction joins broken paragraphs and preserves table-like rows", async () => {
  const pdf = markdownToPdfBuffer([
    "# Extracted Report",
    "",
    "This paragraph is broken",
    "across two text operations",
    "and should read cleanly.",
    "",
    "The inter-",
    "national report should merge hyphenated words.",
    "",
    "Name  Value",
    "Alpha  1",
    "Beta  2"
  ].join("\n"));
  const markdown = await pdfBufferToMarkdown(pdf, "report.pdf");
  assert.match(markdown, /# Extracted Report/);
  assert.match(markdown, /This paragraph is broken across two text operations and should read cleanly\./);
  assert.match(markdown, /The international report should merge hyphenated words\./);
  assert.match(markdown, /\| Name \| Value \|/);
  assert.match(markdown, /\| Alpha \| 1 \|/);
});
test("pdf text layer extraction preserves lists and table-of-contents lines", async () => {
  const pdf = markdownToPdfBuffer([
    "Contents",
    "Chapter One ........ 3",
    "Appendix A ........ 12",
    "",
    "• first bullet",
    "• second bullet",
    "1. numbered item"
  ].join("\n"));
  const markdown = await pdfBufferToMarkdown(pdf, "toc.pdf");
  assert.match(markdown, /- Chapter One \(p\. 3\)/);
  assert.match(markdown, /- Appendix A \(p\. 12\)/);
  assert.match(markdown, /^- first bullet$/m);
  assert.match(markdown, /^- second bullet$/m);
  assert.match(markdown, /^1\. numbered item$/m);
});
test("pdf text layer extraction promotes only credible headings and decodes printable octal text", async () => {
  const pdf = Buffer.from([
    "%PDF-1.4",
    "stream",
    "(Chapter 12 Waves) Tj",
    "(47-5 The speed of sound) Tj",
    "(Why did we choose this result) Tj",
    "(It follows that @ ffl=@x = c) Tj",
    "(Parentheses \\050survive\\051 extraction.) Tj",
    "(Invalid control " + String.fromCharCode(7) + "is removed.) Tj",
    "endstream",
    "%%EOF"
  ].join("\n"), "latin1");
  const markdown = await pdfBufferToMarkdown(pdf, "headings.pdf");
  assert.match(markdown, /^## Chapter 12 Waves$/m);
  assert.match(markdown, /^## 47-5 The speed of sound$/m);
  assert.doesNotMatch(markdown, /^## Why did we choose this result$/m);
  assert.doesNotMatch(markdown, /^## It follows that/m);
  assert.match(markdown, /Parentheses \(survive\) extraction\./);
  assert.doesNotMatch(markdown, /\u0007/);
});
test("converts generated pdf through document job flow", async () => {
  const workspace = await tempDir("lft-pdf-");
  await openOrCreateWorkspace(workspace);
  const pdfPath = path.join(workspace, "report.pdf");
  await writeFile(pdfPath, markdownToPdfBuffer("# Report\n\nPlain PDF text."));
  const record = await importFileToWorkspace(workspace, pdfPath);
  const job = await convertDocumentToMarkdownAsJob(workspace, record.id, pdfMarkdownConverter);
  const manifest = await readManifest(workspace);
  const document = manifest.documents.find((candidate) => candidate.id === record.id);
  assert.equal(job.status, "succeeded");
  assert.equal(document.status, "ready");
  assert.ok(document.outputMarkdownPath.endsWith("report.md"));
  assert.ok(job.output.warnings.some((warning) => warning.includes("PDF rich objects require review")));
  assert.ok(document.extractionQuality.unsupportedFeatures.includes("images"));
  assert.ok(document.extractionQuality.unsupportedFeatures.includes("formulas"));
  const qualityReport = JSON.parse(await readFile(document.outputMarkdownPath.replace(/\.md$/, ".quality.json"), "utf8"));
  assert.ok(qualityReport.matchedKnownLimits.includes("pdf_rich_objects_unsupported"));
});
test("low-readable pdf extraction recommends OCR before AI send", async () => {
  const workspace = await tempDir("lft-garbled-pdf-");
  await openOrCreateWorkspace(workspace);
  const pdfPath = path.join(workspace, "garbled.pdf");
  await writeFile(pdfPath, Buffer.from("%PDF-1.4\nstream\n(\\376\\377\\000A\\000B\\000C\\000D) Tj\nendstream\n%%EOF\n", "latin1"));
  const record = await importFileToWorkspace(workspace, pdfPath);
  const job = await convertDocumentToMarkdownAsJob(workspace, record.id, pdfMarkdownConverter);
  const manifest = await readManifest(workspace);
  const document = manifest.documents.find((candidate) => candidate.id === record.id);
  const qualityReport = JSON.parse(await readFile(document.outputMarkdownPath.replace(/\.md$/, ".quality.json"), "utf8"));
  assert.equal(job.status, "succeeded");
  assert.ok(job.output.warnings.some((warning) => warning.includes("OCR recommended")));
  assert.ok(job.output.warnings.some((warning) => warning.includes("Low-readable PDF text")));
  assert.equal(document.extractionQuality.scannedLikely, true);
  assert.equal(document.extractionQuality.lowReadableText, true);
  const readable = await readFile(document.readableMarkdownPath, "utf8");
  assert.match(readable, /This PDF could not be converted into human-readable Markdown/);
  assert.match(readable, /image-only or scanned/);
  assert.match(readable, /Unicode\/CMap font mapping/);
  assert.match(readable, /Run OCR externally/);
  assert.doesNotMatch(readable, /Human-readable Markdown view/);
  assert.doesNotMatch(readable, /Converted by: pdf-text-layer-converter/);
  assert.doesNotMatch(readable, /ABCD/);
  assert.equal(qualityReport.confidence, "low");
  assert.ok(qualityReport.activeWarnings.includes("scannedLikely"));
  assert.ok(qualityReport.matchedKnownLimits.includes("ocr_unsupported"));
  assert.ok(qualityReport.suggestedActions.some((action) => action.includes("OCR")));
});
test("document extraction writes separate AI-ready and human-readable Markdown outputs", async () => {
  const workspace = await tempDir("lft-readable-md-");
  await openOrCreateWorkspace(workspace);
  const pdfPath = path.join(workspace, "long-report.pdf");
  await writeFile(pdfPath, markdownToPdfBuffer([
    "# Long Report",
    "",
    "This line is broken",
    "across extraction",
    "and should read as one paragraph.",
    "",
    "1",
    "",
    "Repeated Header",
    "",
    "Repeated Header",
    "",
    "Repeated Header",
    "",
    "Repeated Header"
  ].join("\n")));
  const record = await importFileToWorkspace(workspace, pdfPath);
  const job = await convertDocumentToMarkdownAsJob(workspace, record.id, pdfMarkdownConverter);
  const manifest = await readManifest(workspace);
  const document = manifest.documents.find((candidate) => candidate.id === record.id);
  assert.equal(job.status, "succeeded");
  assert.ok(document.outputMarkdownPath.endsWith("long-report.md"));
  assert.ok(document.readableMarkdownPath.endsWith("long-report.readable.md"));
  assert.equal(document.markdownOutputs.defaultForAi, document.outputMarkdownPath);
  assert.equal(document.markdownOutputs.defaultForHumans, document.readableMarkdownPath);
  assert.equal(job.output.readableMarkdownPath, document.readableMarkdownPath);
  const aiReady = await readFile(document.outputMarkdownPath, "utf8");
  const readable = await readFile(document.readableMarkdownPath, "utf8");
  assert.doesNotMatch(aiReady, /> Converted by: pdf-text-layer-converter/);
  assert.doesNotMatch(readable, /Human-readable Markdown view/);
  assert.doesNotMatch(readable, /> Source format:/);
  assert.match(readable, /This line is broken across extraction and should read as one paragraph\./);
  assert.ok(document.markdownOutputs.readableStats.characters > 0);
});
test("document output names preserve dots and closing parentheses in the source title", async () => {
  const workspace = await tempDir("lft-dotted-title-");
  await openOrCreateWorkspace(workspace);
  const source = path.join(workspace, "Physics Notes (z-lib.org).txt");
  await writeFile(source, "Readable physics notes.");
  const record = await importFileToWorkspace(workspace, source);
  await convertDocumentToMarkdownAsJob(workspace, record.id, textMarkdownConverter);
  const document = (await readManifest(workspace)).documents.find((item) => item.id === record.id);
  assert.match(path.basename(document.outputMarkdownPath), /^Physics Notes \(z-lib\.org\)\.md$/);
});
test("readable markdown post-processor removes page noise and keeps headings", () => {
  const readable = createReadableMarkdown([
    "# Source",
    "",
    "Page 1",
    "",
    "## Section",
    "",
    "A paragraph split",
    "over two lines",
    "",
    "- list item"
  ].join("\n"), {
    sourceType: "pdf",
    sourceName: "source.pdf"
  });
  assert.match(readable, /^# Source/m);
  assert.match(readable, /## Section/);
  assert.match(readable, /A paragraph split over two lines/);
  assert.doesNotMatch(readable, /^Page 1$/m);
  assert.match(readable, /- list item/);
});
test("readable PPTX markdown does not prepend a synthetic slide directory", () => {
  const readable = createReadableMarkdown([
    "# NotebookLM deck",
    "",
    "## Slide 1",
    "",
    "![Slide 1 image](<assets/deck.pptx/slide-1.png>)",
    "",
    "## Slide 2",
    "",
    "## Slide 3"
  ].join("\n"), {
    sourceType: "pptx",
    sourceName: "deck.pptx"
  });
  assert.doesNotMatch(readable, /^## Contents$/m);
  assert.match(readable, /^## Slide 1$/m);
});
test("readable PPTX markdown keeps repeated slide image references", () => {
  const markdown = ["# Deck", ""];
  for (let index = 1; index <= 6; index += 1) {
    markdown.push(`## Slide ${index}`, "", `![Slide ${index} image](<assets/deck.pptx/slide-${index}.png>)`, "");
  }
  const readable = createReadableMarkdown(markdown.join("\n"), {
    sourceType: "pptx",
    sourceName: "deck.pptx"
  });
  assert.equal((readable.match(/^!\[/gm) || []).length, 6);
  assert.match(readable, /slide-6\.png/);
});
test("readable markdown keeps PDF visuals, tables, and math as separate blocks", () => {
  const readable = createReadableMarkdown([
    "Body text before a preserved equation",
    "<!-- pdf-formula: page=7 index=1 file=page-000007-formula-001.png -->",
    "Body text after the equation.",
    "Table caption",
    "<!-- pdf-table: page=8 index=1 -->",
    "| A | B |",
    "| --- | --- |",
    "| 1 | 2 |",
    "$$",
    "x = y + z",
    "$$"
  ].join("\n"), {
    sourceType: "pdf",
    sourceName: "science.pdf"
  });
  assert.match(readable, /equation\n<!-- pdf-formula:/);
  assert.match(readable, /equation\.\nTable caption\n<!-- pdf-table:/);
  assert.match(readable, /<!-- pdf-table: page=8 index=1 -->\n\| A \| B \|/);
  assert.match(readable, /\| 1 \| 2 \|\n\$\$\nx = y \+ z\n\$\$/);
});
test("readable markdown splits dense PDF table-of-contents lines into entries", () => {
  const readable = createReadableMarkdown([
    "Chapter 5. Time and Distance 5-1 Motion . . . . . . . . . . 5-1 5-2 Time . . . . . . . . . . 5-2 5-3 Short times . . . . . . . . . . 5-3",
    "5-4 Long times . . . . . . . . . . 5-6 5-5 Units and standards of time . . . . . . . . . . 5-9"
  ].join("\n"), {
    sourceType: "pdf",
    sourceName: "physics.pdf"
  });
  assert.match(readable, /^\*\*Chapter 5\. Time and Distance\*\*$/m);
  assert.match(readable, /^- 5-1 Motion - 5-1$/m);
  assert.match(readable, /^- 5-3 Short times - 5-3$/m);
  assert.match(readable, /^- 5-5 Units and standards of time - 5-9$/m);
});
test("readable markdown post-processor removes repeated headers and page-footers", () => {
  const readable = createReadableMarkdown([
    "# Source",
    "",
    "Feynman Lectures Page 1",
    "This paragraph belongs to the document",
    "and should survive cleanup.",
    "",
    "Feynman Lectures Page 2",
    "## Chapter",
    "",
    "A second paragraph survives too.",
    "",
    "Feynman Lectures Page 3",
    "- structural list item",
    "",
    "Feynman Lectures Page 4"
  ].join("\n"), {
    sourceType: "pdf",
    sourceName: "source.pdf"
  });
  assert.match(readable, /^# Source/m);
  assert.match(readable, /## Chapter/);
  assert.match(readable, /This paragraph belongs to the document and should survive cleanup\./);
  assert.match(readable, /A second paragraph survives too\./);
  assert.match(readable, /- structural list item/);
  assert.doesNotMatch(readable, /Feynman Lectures Page/);
});
test("readable markdown post-processor promotes setext headings", () => {
  const readable = createReadableMarkdown([
    "Main Title",
    "===",
    "",
    "Section Title",
    "---",
    "",
    "Paragraph text."
  ].join("\n"), {
    sourceType: "pdf",
    sourceName: "note.pdf"
  });
  assert.match(readable, /^# Main Title$/m);
  assert.match(readable, /^## Section Title$/m);
  assert.match(readable, /Paragraph text\./);
});

test("readable markdown post-processor preserves native markdown content without PDF noise cleanup", () => {
  const source = [
    "# Native Markdown Book",
    "",
    ...Array.from({ length: 180 }, (_, index) => [
      `## Section ${index + 1}`,
      "",
      `This repeated template paragraph belongs to native markdown section ${index + 1}.`,
      "",
      `- Repeated list item ${index + 1}`
    ].join("\n"))
  ].join("\n");
  const readable = createReadableMarkdown(source, {
    sourceType: "md",
    sourceName: "native.md"
  });
  assert.match(readable, /## Section 1/);
  assert.match(readable, /## Section 180/);
  assert.match(readable, /This repeated template paragraph belongs to native markdown section 180\./);
  assert.match(readable, /- Repeated list item 180/);
});
test("readable markdown post-processor respects Chinese sentence punctuation", () => {
  const readable = createReadableMarkdown([
    "# \u4e2d\u6587\u6587\u6863",
    "",
    "\u7b2c\u4e00\u53e5\u5df2\u7ecf\u7ed3\u675f\u3002",
    "\u7b2c\u4e8c\u53e5\u5e94\u8be5\u7559\u5728\u65b0\u884c\u3002",
    "",
    "\u8fd9\u4e00\u884c\u6ca1\u6709\u7ed3\u675f",
    "\u5e94\u8be5\u5408\u5e76\u6210\u4e00\u4e2a\u6bb5\u843d\u3002"
  ].join("\n"), {
    sourceType: "pdf",
    sourceName: "chinese.pdf"
  });
  assert.match(readable, /^\u7b2c\u4e00\u53e5\u5df2\u7ecf\u7ed3\u675f\u3002$/m);
  assert.match(readable, /^\u7b2c\u4e8c\u53e5\u5e94\u8be5\u7559\u5728\u65b0\u884c\u3002$/m);
  assert.match(readable, /\u8fd9\u4e00\u884c\u6ca1\u6709\u7ed3\u675f\u5e94\u8be5\u5408\u5e76\u6210\u4e00\u4e2a\u6bb5\u843d\u3002/);
});
test("readable markdown post-processor preserves fenced code indentation", () => {
  const readable = createReadableMarkdown("```python\n" + "def hello(name):\n" + "  return name\n" + "```\n\nText\nsplit.", {
    sourceType: "md",
    sourceName: "code.md"
  });
  assert.match(readable, /^```python\n^def hello\(name\):\n^  return name\n^```$/m);
  assert.match(readable, /^Text\nsplit\.$/m);
});
test("readable markdown splitter creates numbered human reading parts", () => {
  const markdown = [
    "# Long Human Document",
    "",
    ...Array.from({ length: 24 }, (_, index) => [
      `## Chapter ${index + 1}`,
      "",
      `Paragraph ${index + 1} `.repeat(120)
    ].join("\n"))
  ].join("\n");
  const split = splitReadableMarkdown(markdown, {
    maxCharacters: 1400,
    minCharactersForSplit: 1600
  });
  assert.equal(split.segmented, true);
  assert.ok(split.segments.length > 2);
  assert.equal(split.segments[0].index, 1);
  assert.equal(split.segments[0].startLine, 1);
  assert.ok(split.segments[0].endLine >= split.segments[0].startLine);
  assert.ok(split.segments[0].headingCount > 0);
  assert.match(split.segments[0].markdown, /Human Markdown segment 1\//);
  assert.match(split.segments[0].markdown, /Source line range:/);
  assert.ok(split.segments.every((segment) => segment.title));
});
test("long document extraction writes readable index and numbered part files", async () => {
  const workspace = await tempDir("lft-readable-segments-");
  await openOrCreateWorkspace(workspace);
  const txtPath = path.join(workspace, "large-source.txt");
  await writeFile(txtPath, "placeholder", "utf8");
  const record = await importFileToWorkspace(workspace, txtPath);
  const longMarkdown = [
    "# Large Source",
    "",
    ...Array.from({ length: 3600 }, (_, index) => `## Section ${index + 1}\n\nThis paragraph belongs to section ${index + 1} and should be available in a numbered human-readable part file.`)
  ].join("\n\n");
  const largeConverter = {
    name: "test-large-readable-converter",
    canHandle() {
      return true;
    },
    async convert() {
      return {
        markdown: longMarkdown,
        warnings: [],
        quality: {
          hasTextLayer: true,
          hasTablesSimplified: false,
          hasOcrMissing: false,
          confidence: "high"
        },
        extractionQuality: {
          textLayerDetected: true,
          scannedLikely: false,
          tableSimplified: false,
          layoutSimplified: true,
          possibleMojibake: false,
          unsupportedFeatures: [],
          confidence: "high"
        }
      };
    }
  };
  const job = await convertDocumentToMarkdownAsJob(workspace, record.id, largeConverter);
  const manifest = await readManifest(workspace);
  const document = manifest.documents.find((candidate) => candidate.id === record.id);
  const segments = document.markdownOutputs.readableSegments;
  assert.equal(job.status, "succeeded");
  assert.equal(segments.segmented, true);
  assert.ok(segments.segmentCount > 1);
  assert.ok(document.markdownOutputs.defaultForHumans.endsWith(".readable.index.md"));
  assert.equal(job.output.markdownOutputs.defaultForHumans, document.markdownOutputs.defaultForHumans);
  const indexMarkdown = await readFile(segments.indexPath, "utf8");
  assert.match(indexMarkdown, /## Verification/);
  assert.match(indexMarkdown, /source-map\.json/);
  assert.match(indexMarkdown, /## Parts/);
  assert.match(indexMarkdown, /source lines \d+-\d+/);
  assert.match(await readFile(segments.segments[0].path, "utf8"), /Human Markdown segment 1\//);
  assert.match(await readFile(segments.segments[0].path, "utf8"), /Source line range:/);
  assert.match(segments.segments[0].relativePath, /large-source\.readable_1\.md$/);
  assert.match(segments.sourceMapRelativePath, /large-source\.readable\.source-map\.json$/);
  const sourceMap = JSON.parse(await readFile(segments.sourceMapPath, "utf8"));
  assert.equal(sourceMap.schema, "schema-docs.readable-segment-map.v1");
  assert.equal(sourceMap.recordId, record.id);
  assert.equal(sourceMap.segmentCount, segments.segmentCount);
  assert.equal(sourceMap.segments[0].relativePath, segments.segments[0].relativePath);
  assert.ok(sourceMap.segments[0].startLine >= 1);
});
test("reuses unchanged Markdown extraction instead of reconverting the same PDF", async () => {
  const workspace = await tempDir("lft-pdf-cache-");
  await openOrCreateWorkspace(workspace);
  const pdfPath = path.join(workspace, "cache-source.pdf");
  await writeFile(pdfPath, markdownToPdfBuffer("# Cache\n\nReuse this extraction."));
  const record = await importFileToWorkspace(workspace, pdfPath);
  const firstJob = await convertDocumentToMarkdownAsJob(workspace, record.id, pdfMarkdownConverter);
  const secondJob = await convertDocumentToMarkdownAsJob(workspace, record.id, pdfMarkdownConverter);
  const conversionAudits = await listConversionAudits(workspace);
  const evidenceRecords = await listEvidenceRecords(workspace);
  const manifest = await readManifest(workspace);
  assert.equal(firstJob.status, "succeeded");
  assert.equal(secondJob.status, "succeeded");
  assert.equal(secondJob.output.cached, true);
  assert.equal(secondJob.output.outputMarkdownPath, firstJob.output.outputMarkdownPath);
  assert.equal(conversionAudits.length, 1);
  assert.equal(evidenceRecords.length, 1);
  assert.equal(manifest.jobs.length, 2);
  assert.equal(manifest.jobs[1].message, "Succeeded");
  assert.equal(manifest.jobs[1].output.cached, true);
  await unlink(firstJob.output.readableMarkdownPath);
  const repairedJob = await convertDocumentToMarkdownAsJob(workspace, record.id, pdfMarkdownConverter);
  assert.equal(repairedJob.status, "succeeded");
  assert.notEqual(repairedJob.output.cached, true);
  assert.match(await readFile(repairedJob.output.readableMarkdownPath, "utf8"), /Cache/);
  const upgradedConverter = { ...pdfMarkdownConverter, cacheVersion: "2" };
  const thirdJob = await convertDocumentToMarkdownAsJob(workspace, record.id, upgradedConverter);
  assert.equal(thirdJob.status, "succeeded");
  assert.notEqual(thirdJob.output.cached, true);
  assert.equal((await listConversionAudits(workspace)).length, 3);
});
test("exports workspace markdown to docx and pdf files", async () => {
  const workspace = await tempDir("lft-doc-export-");
  await openOrCreateWorkspace(workspace);
  await saveMarkdown(workspace, path.join("notes", "source.md"), "# Source\n\nExport me.");
  const docxPath = await exportMarkdownDocument(workspace, path.join("notes", "source.md"), path.join("exports", "source.docx"), "docx");
  const pdfPath = await exportMarkdownDocument(workspace, path.join("notes", "source.md"), path.join("exports", "source.pdf"), "pdf");
  assert.match(readZipEntry(await readFile(docxPath), "word/document.xml").toString("utf8"), /Export me/);
  assert.match(await pdfBufferToMarkdown(await readFile(pdfPath), "source.pdf"), /Export me/);
});
test("external Markdown export copies local visual assets beside the document", async () => {
  const workspace = await tempDir("lft-md-assets-");
  const destination = await tempDir("lft-md-assets-out-");
  await openOrCreateWorkspace(workspace);
  const assetDir = path.join(workspace, "assets", "Physics Book.pdf");
  await mkdir(assetDir, { recursive: true });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l4QW2QAAAABJRU5ErkJggg==", "base64");
  await writeFile(path.join(assetDir, "formula.png"), png);
  await saveMarkdown(workspace, path.join("notes", "source.md"), [
    "# Source",
    "",
    "![Formula](<../assets/Physics Book.pdf/formula.png>)"
  ].join("\n"));
  const output = path.join(destination, "portable.md");
  await exportMarkdownDocument(workspace, path.join("notes", "source.md"), output, "md");
  const exported = await readFile(output, "utf8");
  assert.match(exported, /\.\/portable\.assets\/formula\.png/);
  assert.deepEqual(await readFile(path.join(destination, "portable.assets", "formula.png")), png);
});
test("merged export preserves existing files with numbered names", async () => {
  const workspace = await tempDir("lft-export-numbered-");
  await openOrCreateWorkspace(workspace);
  await saveMarkdown(workspace, "notes/source.md", "first");
  const output = path.join(workspace, "exports", "source.md");
  const first = await exportMarkdownDocument(workspace, "notes/source.md", output, "md", { avoidOverwrite: true });
  await saveMarkdown(workspace, "notes/source.md", "second");
  const second = await exportMarkdownDocument(workspace, "notes/source.md", output, "md", { avoidOverwrite: true });
  const third = await exportMarkdownDocument(workspace, "notes/source.md", output, "md", { avoidOverwrite: true });
  assert.equal(first, output);
  assert.equal(second, path.join(workspace, "exports", "source (2).md"));
  assert.equal(third, path.join(workspace, "exports", "source (3).md"));
  assert.equal(await readFile(first, "utf8"), "first");
  assert.equal(await readFile(second, "utf8"), "second");
});
test("external Markdown export rejects traversal and non-image asset reads", async () => {
  const container = await tempDir("lft-md-assets-boundary-");
  const workspace = path.join(container, "workspace");
  const destination = path.join(container, "destination");
  const outsidePng = path.join(container, "outside.png");
  await mkdir(destination, { recursive: true });
  await openOrCreateWorkspace(workspace);
  await writeFile(outsidePng, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l4QW2QAAAABJRU5ErkJggg==", "base64"));
  await mkdir(path.join(workspace, "assets"), { recursive: true });
  await writeFile(path.join(workspace, "assets", "not-image.png"), "not an image", "utf8");
  await saveMarkdown(workspace, path.join("notes", "source.md"), [
    "# Source",
    "",
    "![Traversal](../../outside.png)",
    "![Not image](../assets/not-image.png)"
  ].join("\n"));
  const output = path.join(destination, "portable.md");
  await exportMarkdownDocument(workspace, path.join("notes", "source.md"), output, "md");
  const exported = await readFile(output, "utf8");
  assert.doesNotMatch(exported, /portable\.assets/);
  await assert.rejects(readFile(path.join(destination, "portable.assets", "outside.png")));
  await assert.rejects(readFile(path.join(destination, "portable.assets", "not-image.png")));
});
test("reports and validates document exchange formats", () => {
  const capabilities = listDocumentExchangeCapabilities();
  const capabilityManifest = createDocumentCapabilityManifest();
  assert.deepEqual(capabilities.formats, ["md", "docx", "pdf", "html"]);
  assert.equal(capabilities.conversions.length, 16);
  assert.equal(capabilityManifest.capability_type, "document.exchange");
  assert.equal(capabilityManifest.output_contract.canonical_format, "markdown");
  assert.equal(capabilityManifest.output_contract.conversion_matrix.length, 16);
  assert.equal(capabilityManifest.validation.stores_api_key, false);
  assert.ok(capabilityManifest.api_contract.semantic_routes.includes("POST /api/normalize"));
  assert.ok(capabilityManifest.api_contract.semantic_routes.includes("POST /api/exchange/package/read"));
  assert.ok(capabilityManifest.permission_scope.tool_scope.includes("verify.exchange_package"));
  assert.ok(capabilityManifest.api_contract.semantic_routes.includes("GET /api/evidence/{id}"));
  assert.ok(capabilityManifest.api_contract.routes.some((route) => route.path === "/api/ai/preview" && route.intent.includes("Send Gate")));
  assert.ok(capabilityManifest.api_contract.routes.some((route) => route.path === "/api/ai/intake-plan" && route.intent.includes("content-free AI intake plan")));
  assert.ok(capabilityManifest.api_contract.routes.some((route) => route.path === "/api/ai/context-chunk" && route.intent.includes("selected Markdown/context chunk")));
  assert.ok(capabilityManifest.api_contract.routes.some((route) => route.path === "/api/exchange/package/read" && route.required.includes("packageRelativePath")));
  assert.equal(normalizeDocumentFormat(".PDF"), "pdf");
  assert.equal(normalizeDocumentExchangeSourceType("txt"), "md");
  assert.equal(getDocumentExchangeCapability("pdf", "docx").mode, "via-md");
  assert.equal(getDocumentExchangeCapability("pptx", "pdf").mode, "via-md");
  assert.ok(capabilities.conversions.some((conversion) => conversion.from === "pdf" && conversion.to === "docx"));
  assert.throws(() => normalizeDocumentFormat("exe"), {
    code: "document_exchange_format_unsupported"
  });
});
test("converts imported documents directly to target formats through app service", async () => {
  const workspace = await tempDir("lft-direct-doc-export-");
  const service = createAppService(workspace);
  await service.openWorkspace();
  const docxPath = path.join(workspace, "input.docx");
  await writeFile(docxPath, markdownToDocxBuffer("# Docx Source\n\nTo PDF."));
  const docxRecord = await service.importFile(docxPath);
  const pdfExport = await service.convertDocumentToFormat(docxRecord.id, path.join("exports", "from-docx.pdf"), "pdf");
  assert.match(pdfExport.outputPath, /from-docx\.pdf$/);
  assert.equal(pdfExport.capability.mode, "via-md");
  assert.equal(pdfExport.capability.quality, "basic");
  assert.ok(pdfExport.evidenceId.startsWith("evidence_"));
  assert.match(await pdfBufferToMarkdown(await readFile(pdfExport.outputPath), "from-docx.pdf"), /To PDF/);
  const pdfPath = path.join(workspace, "input.pdf");
  await writeFile(pdfPath, markdownToPdfBuffer("# Pdf Source\n\nTo Word."));
  const pdfRecord = await service.importFile(pdfPath);
  const mdExport = await service.convertDocumentToFormat(pdfRecord.id, path.join("exports", "from-pdf.md"), "md");
  const docxExport = await service.convertDocumentToFormat(pdfRecord.id, path.join("exports", "from-pdf.docx"), "docx");
  const docxMarkdown = docxDocumentXmlToMarkdown(
    readZipEntry(await readFile(docxExport.outputPath), "word/document.xml").toString("utf8"),
    "from-pdf.docx"
  );
  assert.match(mdExport.outputPath, /from-pdf\.md$/);
  assert.equal(mdExport.capability.mode, "direct");
  assert.equal(mdExport.capability.quality, "basic-text-layer");
  assert.match(await readFile(mdExport.outputPath, "utf8"), /To Word/);
  assert.match(docxExport.outputPath, /from-pdf\.docx$/);
  assert.equal(docxExport.capability.mode, "via-md");
  assert.equal(docxExport.capability.quality, "basic-text-layer");
  assert.match(docxMarkdown, /To Word/);
  assert.ok(pdfExport.auditId.startsWith("conversion_"));
  assert.ok(mdExport.auditId.startsWith("conversion_"));
  assert.ok(docxExport.auditId.startsWith("conversion_"));
  const conversionAudits = await listConversionAudits(workspace);
  assert.equal(conversionAudits.length, 5);
  assert.deepEqual(conversionAudits.map((audit) => audit.targetFormat).sort(), ["docx", "md", "md", "md", "pdf"]);
  assert.ok(conversionAudits.some((audit) => audit.sourceType === "docx" && audit.targetFormat === "pdf" && audit.mode === "via-md"));
  assert.ok(conversionAudits.some((audit) => audit.sourceType === "pdf" && audit.targetFormat === "md" && audit.mode === "direct"));
  assert.ok(conversionAudits.every((audit) => Array.isArray(audit.limits) && audit.limits.length > 0));
  assert.ok(conversionAudits.every((audit) => audit.evidenceId.startsWith("evidence_")));
  const evidenceRecords = await listEvidenceRecords(workspace);
  assert.equal(evidenceRecords.length, 5);
  assert.ok(evidenceRecords.some((record) => record.kind === "document_extraction"));
  assert.ok(evidenceRecords.some((record) => record.kind === "document_conversion"));
  assert.ok(evidenceRecords.every((record) => record.inputFileHash.startsWith("sha256:")));
  assert.ok(evidenceRecords.every((record) => record.outputArtifactHash.startsWith("sha256:")));
  const evidenceLog = await readFile(getEvidenceLogPath(workspace), "utf8");
  assert.equal(evidenceLog.trim().split("\n").length, 5);
  assert.match(evidenceLog, /"kind":"document_extraction"/);
  assert.match(evidenceLog, /"kind":"document_conversion"/);
  assert.equal((await getEvidenceRecord(workspace, pdfExport.evidenceId)).id, pdfExport.evidenceId);
  const deletedAudit = await deleteConversionAudit(workspace, conversionAudits[0].id);
  assert.equal(deletedAudit.id, conversionAudits[0].id);
  assert.equal((await listConversionAudits(workspace)).length, 4);
  await assert.rejects(() => service.convertDocumentToFormat(pdfRecord.id, path.join("exports", "bad.exe"), "exe"), {
    code: "document_exchange_format_unsupported"
  });
});

test("PDF Pipeline Phase 2: preferredExtractor, diagnostics JSON, and retry overwrite", async () => {
  const workspace = await tempDir("pdf-pipeline-p2-");
  await openOrCreateWorkspace(workspace);
  const pdfPath = path.join(workspace, "diagnose-test.pdf");
  await writeFile(pdfPath, markdownToPdfBuffer("# Diagnose Report\n\nPDF content."));

  const record = await importFileToWorkspace(workspace, pdfPath);

  const job = await convertDocumentToMarkdownAsJob(
    workspace,
    record.id,
    pdfMarkdownConverter,
    { preferredExtractor: "built-in", force: true }
  );

  assert.equal(job.status, "succeeded");
  const manifest = await readManifest(workspace);
  const doc = manifest.documents.find((d) => d.id === record.id);

  assert.ok(doc.pdfDiagnosticsPath);
  const diagnostics = JSON.parse(await readFile(doc.pdfDiagnosticsPath, "utf8"));
  assert.equal(diagnostics.sourcePath, doc.sourcePath);
  assert.equal(diagnostics.chosenExtractor, "built-in");
  assert.ok(Array.isArray(diagnostics.extractorAttempts));
  assert.ok(diagnostics.charsExtracted > 0);
  assert.ok(diagnostics.asciiRatio > 0.8);

  const builtInAtt = diagnostics.extractorAttempts.find(a => a.name === "built-in");
  assert.ok(builtInAtt);
  assert.equal(builtInAtt.status, "success");

  const service = createAppService(workspace);

  const retryJob = await service.retryDocumentExtraction(record.id, "pdftotext");
  assert.equal(retryJob.status, "succeeded");

  const freshManifest = await readManifest(workspace);
  const freshDoc = freshManifest.documents.find((d) => d.id === record.id);

  const freshDiag = JSON.parse(await readFile(freshDoc.pdfDiagnosticsPath, "utf8"));
  const freshPdftotextAtt = freshDiag.extractorAttempts.find(a => a.name === "pdftotext");
  if (freshPdftotextAtt.status === "success") {
    assert.equal(freshDiag.chosenExtractor, "pdftotext");
  } else {
    assert.equal(freshDiag.chosenExtractor, "built-in");
    assert.equal(freshPdftotextAtt.status, "unavailable");
  }
});

test("PDF visual placeholders become inline Markdown assets", () => {
  const source = [
    "<!-- pdf-image: page=12 index=1 file=page-000012-figure-000.png -->",
    "        <!-- pdf-formula: page=12 index=2 file=page-000012-formula-001.png -->",
    "<!-- pdf-table: page=12 index=4 file=page-000012-table-003.png -->",
    "t=2.0<!-- pdf-formula: page=12 index=3 file=page-000012-formula-002.png -->tail"
  ].join("\n");
  const main = attachPdfImagesToMarkdown(source, "Physics Notes", false);
  const readable = attachPdfImagesToMarkdown(source, "Physics Notes", true);
  assert.match(main, /Figure preserved from PDF page 12/);
  assert.match(main, /Formula preserved from PDF page 12/);
  assert.match(main, /Table preserved from PDF page 12/);
  assert.doesNotMatch(main, /^[ \t]{4,}!\[Formula preserved/gm);
  assert.doesNotMatch(main, /t=2\.0!\[Formula preserved/);
  assert.match(main, /t=2\.0\n\n!\[Formula preserved from PDF page 12\]\(<assets\/Physics Notes\.pdf\/page-000012-formula-002\.png>\)\n\ntail/);
  assert.match(main, /<assets\/Physics Notes\.pdf\/page-000012-figure-000\.png>/);
  assert.match(readable, /<\.\.\/assets\/Physics Notes\.pdf\/page-000012-formula-001\.png>/);
});

test("PDF pipeline chooses layout-aware extraction when built-in formulas are damaged", async () => {
  const workspace = await tempDir("pdf-layout-choice-");
  const pdfPath = path.join(workspace, "formula-heavy.pdf");
  await writeFile(pdfPath, markdownToPdfBuffer("# Formula source\n\nBody text."));
  const damaged = [
    "# Formula source",
    "",
    "Readable explanatory body text remains available around the mathematical expressions.",
    String.raw`Formula \022 \000 ffi @ ff = \017`.repeat(12)
  ].join("\n");
  const visualMap = {
    schema: "schema-docs.pdf-visual-map.v1",
    summary: { formulaRegions: 2, imageRegions: 1, tableRegions: 1 },
    pages: []
  };

  const result = await runPdfExtractionPipeline(pdfPath, {
    converter: { convert: async () => ({ markdown: damaged, warnings: [] }) },
    mockPdfLayoutAvailable: true,
    mockPdfLayout: "# Formula source\n\nThe relation λ = 2π/k and derivative ∂φ/∂r are preserved.",
    mockPdfVisualMap: visualMap,
    mockPdftotextAvailable: false,
    mockMutoolAvailable: false,
    mockPandocAvailable: false
  });

  assert.equal(result.extractorName, "pdfplumber");
  assert.equal(result.lowReadableText, false);
  assert.equal(result.stats.semanticLoss.formulaDamageLikely, false);
  assert.equal(result.visualMap.summary.formulaRegions, 2);
  assert.match(result.markdown, /λ = 2π\/k/);
  assert.equal(result.attempts.find((attempt) => attempt.name === "pdfplumber").status, "success");
});
test("PDF scientific retry accepts refined layout Markdown and reports formula OCR", async () => {
  const workspace = await tempDir("pdf-scientific-choice-");
  const pdfPath = path.join(workspace, "science.pdf");
  await writeFile(pdfPath, markdownToPdfBuffer("# Science\n\nBody text."));
  const result = await runPdfExtractionPipeline(pdfPath, {
    preferredExtractor: "scientific",
    converter: { convert: async () => ({ markdown: "# Science\n\nReadable body text.", warnings: [] }) },
    mockPdfLayoutAvailable: true,
    mockPdfLayout: "# Science\n\n$$\\frac{x}{y}$$",
    mockPdfVisualMap: {
      summary: { formulaOcrCandidates: 1, formulaOcrRecognized: 1 },
      pages: []
    }
  });
  assert.equal(result.extractorName, "scientific");
  assert.match(result.markdown, /\\frac\{x\}\{y\}/);
  assert.ok(result.warnings.some((warning) => warning.includes("1 of 1")));
});

test("PDF pipeline runs local OCR when a PDF has no readable text layer", async () => {
  const workspace = await tempDir("pdf-ocr-choice-");
  const pdfPath = path.join(workspace, "scan.pdf");
  await writeFile(pdfPath, markdownToPdfBuffer("# Scan placeholder"));
  const result = await runPdfExtractionPipeline(pdfPath, {
    converter: { convert: async () => ({ markdown: "# Scan\n\nno simple text layer", warnings: [] }) },
    mockPdfLayoutAvailable: false,
    mockPdftotextAvailable: false,
    mockMutoolAvailable: false,
    mockPandocAvailable: false,
    mockOcrAvailable: true,
    mockOcrMarkdown: "# Scan\n\n<!-- pdf-page: 1; extraction: ocr -->\n\nRecognized searchable page content.",
    mockOcrPageCount: 1
  });

  assert.equal(result.extractorName, "tesseract-ocr");
  assert.equal(result.textLayerDetected, true);
  assert.equal(result.lowReadableText, false);
  assert.equal(result.stats.ocr.pagesProcessed, 1);
  assert.equal(result.attempts.find((attempt) => attempt.name === "tesseract-ocr").status, "success");
  assert.match(result.warnings.join("\n"), /visual review/);
});

test("PDF pipeline accepts high-fidelity Marker Markdown with editable equations and assets", async () => {
  const workspace = await tempDir("pdf-marker-choice-");
  const pdfPath = path.join(workspace, "scientific.pdf");
  await writeFile(pdfPath, markdownToPdfBuffer("# Scientific source"));
  const result = await runPdfExtractionPipeline(pdfPath, {
    preferredExtractor: "marker",
    mockMarkerAvailable: true,
    mockMarkerMarkdown: "# Scientific source\n\n$$\\lambda = \\frac{2\\pi}{k}$$\n\n| Symbol | Value |\n| --- | --- |\n| λ | wavelength |\n\n![Figure](assets/figure.png)",
    mockMarkerEquationCount: 1,
    mockMarkerTableCount: 1,
    mockMarkerImageCount: 1,
    mockPdfLayoutAvailable: false,
    mockPdftotextAvailable: false,
    mockMutoolAvailable: false,
    mockPandocAvailable: false,
    mockOcrAvailable: false
  });

  assert.equal(result.extractorName, "marker");
  assert.equal(result.stats.richContent.equations, 1);
  assert.equal(result.stats.richContent.tables, 1);
  assert.equal(result.stats.richContent.images, 1);
  assert.match(result.markdown, /\\frac\{2\\pi\}\{k\}/);
  assert.equal(result.attempts.find((attempt) => attempt.name === "marker").status, "success");
});

test("PDF pipeline preserves built-in output when requested Marker adapter is unavailable", async () => {
  const workspace = await tempDir("pdf-marker-fallback-");
  const pdfPath = path.join(workspace, "fallback.pdf");
  await writeFile(pdfPath, markdownToPdfBuffer("# Fallback"));
  const baseline = "# Fallback\n\nReadable source text remains intact when the optional rich adapter is missing.";
  const result = await runPdfExtractionPipeline(pdfPath, {
    preferredExtractor: "marker",
    converter: { convert: async () => ({ markdown: baseline, warnings: [] }) },
    mockMarkerAvailable: false,
    mockPdfLayoutAvailable: false,
    mockPdftotextAvailable: false,
    mockMutoolAvailable: false,
    mockPandocAvailable: false,
    mockOcrAvailable: false
  });
  assert.equal(result.extractorName, "built-in");
  assert.equal(result.markdown, baseline);
  assert.equal(result.lowReadableText, false);
});

test("Marker image links remain valid after rich Markdown moves into the workspace outputs directory", () => {
  const workspace = path.join("C:", "workspace");
  const markdownPath = path.join(workspace, "outputs", "assets", "doc-marker", "book", "book.md");
  const outputDir = path.join(workspace, "outputs");
  const rewritten = rewriteMarkerLocalAssets("![Figure](images/figure%201.png)", markdownPath, outputDir);
  assert.equal(rewritten, "![Figure](assets/doc-marker/book/images/figure%201.png)");
});

test("preserves CJK paragraph spaces correctly when joining lines", () => {
  const cjkText = "我们正在\n进行测试。";
  const cjkResult = createReadableMarkdown(cjkText, { sourceType: "pdf", sourceName: "test.pdf" });
  assert.match(cjkResult, /我们正在进行测试。/);
  assert.ok(!cjkResult.includes("我们正在 进行测试。"));

  const engText = "Hello\nworld.";
  const engResult = createReadableMarkdown(engText, { sourceType: "pdf", sourceName: "test.pdf" });
  assert.match(engResult, /Hello world\./);
});

test("detects low-readable Chinese PDF with damaged CMap (mojibake)", () => {
  const badChineseText = "v F \u00c6 v | \u00ff w\n## \u00c83 \u00ee\u00ed\u024fP\nv \u00f8 )\nk \u00e0 \u00e9 w\n## N%N%";
  const isLow = pdfMarkdownConverter.canHandle("dummy.pdf") && (badChineseText.length > 0);

  const text = badChineseText.trim();
  const replacementCharCount = (text.match(/\ufffd/g) ?? []).length;
  const hasLow = replacementCharCount > 0 || badChineseText.includes("\u00ee");
  assert.ok(isLow);
  assert.ok(hasLow);
});

test("standardizes qualityStates classification correctly", async () => {
  const workspace = await tempDir("lft-quality-");
  await openOrCreateWorkspace(workspace);

  const { createQualityReport } = await import("../src/core/qualityReport.js");

  const report1 = await createQualityReport(
    workspace,
    "doc_1",
    "clean.txt",
    "txt",
    path.join(workspace, "clean.md"),
    "Hello world, this is a clean document.",
    { confidence: "high" },
    []
  );
  assert.equal(report1.qualityState, "clean_readable");

  const report2 = await createQualityReport(
    workspace,
    "doc_2",
    "warning.txt",
    "txt",
    path.join(workspace, "warning.md"),
    "Hello table.",
    { confidence: "medium", possibleMojibake: true },
    []
  );
  assert.equal(report2.qualityState, "review_required");

  const report3 = await createQualityReport(
    workspace,
    "doc_3",
    "ocr.pdf",
    "pdf",
    path.join(workspace, "ocr.md"),
    "Scanned content",
    { confidence: "low", scannedLikely: true },
    []
  );
  assert.equal(report3.qualityState, "ocr_required");
});
