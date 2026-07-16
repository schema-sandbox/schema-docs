import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import {
  exportMarkdownToDocx,
  exportMarkdownToHtml,
  exportMarkdownToPdf,
  sanitizeXmlText,
  waitForStablePdfFile
} from "../src/core/markdownExportPipeline.js";
import { readZipEntry } from "../src/core/zip.js";

test("Markdown Export Pipeline - Chinese paragraph and typography", async () => {
  const title = "\u6807\u9898";
  const paragraph = "\u8fd9\u662f\u4e00\u6bb5\u5305\u542b**\u7c97\u4f53\u6587\u5b57**\u548c*\u659c\u4f53\u6587\u5b57*\u4ee5\u53ca`\u884c\u5185\u4ee3\u7801`\u7684\u4e2d\u6587\u6bb5\u843d\u3002";
  const md = `# ${title}\n\n${paragraph}`;
  const docxBuffer = await exportMarkdownToDocx(md);
  assert.ok(docxBuffer instanceof Buffer);
  assert.ok(docxBuffer.length > 100);
  const documentXml = readZipEntry(docxBuffer, "word/document.xml").toString("utf8");
  assert.match(documentXml, /\u8fd9\u662f\u4e00\u6bb5/);
  assert.match(documentXml, /w:eastAsia="Microsoft YaHei"/);
});

test("Markdown Export Pipeline - strips XML-forbidden controls before DOCX packing", async () => {
  const markdown = "# Safe export\n\nBefore\u0000\u0007\u001Fafter\n\nKeep\ttabs and\nlines.";
  assert.equal(sanitizeXmlText(markdown), "# Safe export\n\nBeforeafter\n\nKeep\ttabs and\nlines.");
  const docxBuffer = await exportMarkdownToDocx(markdown);
  const documentXml = readZipEntry(docxBuffer, "word/document.xml").toString("utf8");
  assert.doesNotMatch(documentXml, /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
  assert.match(documentXml, /Beforeafter/);
});

test("Markdown Export Pipeline - Nested headings and structural runs", async () => {
  const md = "# Heading 1\n\n## Heading 2\n\n### Heading 3";
  const docxBuffer = await exportMarkdownToDocx(md);
  const documentXml = readZipEntry(docxBuffer, "word/document.xml").toString("utf8");
  assert.match(documentXml, /Heading 1/);
  assert.match(documentXml, /Heading 2/);
  assert.match(documentXml, /Heading 3/);
  assert.match(documentXml, /<w:pStyle w:val="Heading1"\/>/);
  assert.match(documentXml, /<w:pStyle w:val="Heading2"\/>/);
  assert.match(documentXml, /<w:pStyle w:val="Heading3"\/>/);
});

test("Markdown Export Pipeline - Ordered list and sequence numbering", async () => {
  const md = "1. First ordered item\n2. Second ordered item\n- Bullet item";
  const docxBuffer = await exportMarkdownToDocx(md);
  const documentXml = readZipEntry(docxBuffer, "word/document.xml").toString("utf8");
  assert.match(documentXml, /First ordered item/);
  assert.match(documentXml, /1\.  /);
  assert.match(documentXml, /Second ordered item/);
  assert.match(documentXml, /2\.  /);
  assert.match(documentXml, /Bullet item/);
  assert.match(documentXml, /\u2022   /);
});

test("Markdown Export Pipeline - Math formulas export as native Office math", async () => {
  const md = "Formulas: $E=mc^2$ and $$S_{invalid} = \\int_{t_0}^{t} (\\frac{dQ_{\\text{know}}}{dt} - \\eta_{\\min} \\frac{dE_{\\text{spent}}}{dt}) dt$$.";
  const docxBuffer = await exportMarkdownToDocx(md);
  const documentXml = readZipEntry(docxBuffer, "word/document.xml").toString("utf8");

  assert.match(documentXml, /<m:oMath/);
  assert.match(documentXml, /<m:f>/);
  assert.match(documentXml, /<m:nary>/);
  assert.doesNotMatch(documentXml, /<undefined>/);
  assert.match(documentXml, /invalid/);
  assert.match(documentXml, /know/);
  assert.match(documentXml, /spent/);
  assert.doesNotMatch(documentXml, /\$\$/);
});

test("Markdown Export Pipeline - Braced math scripts never emit invalid numeric XML tags", async () => {
  const md = "$$\\hat{H}_{AI} + \\underbrace{A}_{efficiency} + \\langle \\Psi | \\hat{O}_{sound} | \\Psi \\rangle$$";
  const docxBuffer = await exportMarkdownToDocx(md);
  const documentXml = readZipEntry(docxBuffer, "word/document.xml").toString("utf8");
  assert.match(documentXml, /<m:oMath/);
  assert.doesNotMatch(documentXml, /<0\/>/);
  assert.doesNotMatch(documentXml, /<undefined>/);
  assert.doesNotMatch(documentXml, />hat<|>underbrace<|>langle<|>rangle</);
  assert.ok(documentXml.includes("\u27e8"));
  assert.ok(documentXml.includes("\u27e9"));
});

test("Markdown Export Pipeline - advanced LaTeX commands become Office math symbols", async () => {
  const md = "$$|\\Psi\\rangle = \\frac{1}{\\sqrt{2}}(|\\eta\\rangle_A \\otimes |\\infty\\rangle_B) + \\hat{H}_{sound} + \\sum_k \\hbar \\omega_k a_k^\\dagger$$";
  const docxBuffer = await exportMarkdownToDocx(md);
  const documentXml = readZipEntry(docxBuffer, "word/document.xml").toString("utf8");
  for (const symbol of ["\u27e9", "\u2297", "\u221e", "\u2211", "\u210f", "\u2020"]) assert.ok(documentXml.includes(symbol), `missing ${symbol.codePointAt(0).toString(16)}`);
  assert.doesNotMatch(documentXml, />rangle<|>sqrt<|>otimes<|>infty<|>sum<|>hbar<|>dagger<|>hat</);
  assert.match(documentXml, /<m:rad>/);
  assert.match(documentXml, /<m:nary>/);
});

test("Markdown Export Pipeline - quantum formulas retain Greek Psi, radicals, hats and large sums", async () => {
  const md = "$$|\\Psi_{double}\\rangle=\\frac{1}{\\sqrt{2}}(|\\eta\\rangle_A\\otimes|\\infty\\rangle_B)$$\n\n$$\\langle\\Psi|\\hat{H}_{sound}|\\Psi\\rangle>E_{limit}$$\n\n$$\\hat{H}_{sound}=\\sum_k\\hbar\\omega_k(a_k^\\dagger a_k+\\frac{1}{2})$$";
  const docxBuffer = await exportMarkdownToDocx(md);
  const documentXml = readZipEntry(docxBuffer, "word/document.xml").toString("utf8");
  assert.ok(documentXml.includes("\u03a8"));
  assert.ok(documentXml.includes("\u0124"));
  assert.match(documentXml, /<m:rad>/);
  assert.match(documentXml, /<m:nary>/);
  assert.doesNotMatch(documentXml, />Psi<|>sqrt<|>hat<|>sum</);
});

test("Markdown Export Pipeline - underbrace annotations retain native Office braces", async () => {
  const md = "$$V=\\underbrace{\\int \\eta d\\tau}_{efficiency}\\times\\underbrace{\\prod_k P_k}_{probability}$$";
  const docxBuffer = await exportMarkdownToDocx(md);
  const documentXml = readZipEntry(docxBuffer, "word/document.xml").toString("utf8");
  assert.match(documentXml, /<m:groupChr>/);
  assert.match(documentXml, /<m:chr m:val="\u23df"\/?>/);
  assert.match(documentXml, /<m:pos m:val="bot"\/?>/);
  assert.match(documentXml, /efficiency/);
  assert.match(documentXml, /probability/);
  assert.doesNotMatch(documentXml, />underbrace</);
});

test("Markdown Export Pipeline - Survival probability math keeps Greek tau and spacing commands clean", async () => {
  const md = "$$P_s(t) = \\exp\\left( -\\int_0^t \\lambda(\\tau) \\, d\\tau \\right)$$";
  const docxBuffer = await exportMarkdownToDocx(md);
  const documentXml = readZipEntry(docxBuffer, "word/document.xml").toString("utf8");
  assert.match(documentXml, /<m:oMath/);
  assert.ok(documentXml.includes("\u03c4"));
  assert.doesNotMatch(documentXml, /tau/);
  assert.doesNotMatch(documentXml, /\\,/);
  assert.doesNotMatch(documentXml, /<0\/>|<undefined>/);
});

test("Markdown Export Pipeline - HTML snapshot render check", async () => {
  const md = "# HTML Document\n\nThis is a *custom html output* with formulas: $E=mc^2$ and $$\\sum_{i=1}^{n} i$$.";
  const html = await exportMarkdownToHtml(md, { title: "Special Export" });
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /Special Export/);
  assert.match(html, /<h1>HTML Document<\/h1>/);
  assert.match(html, /E=mc\^2/);
  assert.match(html, /class="katex-inline-math"/);
  assert.match(html, /class="katex-display-math"/);
  assert.match(html, /<math xmlns="http:\/\/www\.w3\.org\/1998\/Math\/MathML"/);
  assert.match(html, /data:font\/woff2;base64,/);
  assert.doesNotMatch(html, /SCHEMADOSMATHTOKEN/);
  assert.doesNotMatch(html, />\$E=mc\^2\$</);
  assert.match(html, /border-bottom:2px solid #0f766e/);
  assert.match(html, /img\{display:block;max-width:100%;width:auto;height:auto/);
  assert.match(html, /@page\{size:A4;margin:16mm 14mm\}/);
  assert.match(html, /max-height:240mm/);
});

test("Markdown Export Pipeline - HTML export escapes active content and stays offline", async () => {
  const html = await exportMarkdownToHtml(
    '# Safe\n\n<script>globalThis.pwned = true</script>\n\n<img src=x onerror="globalThis.pwned = true">',
    { title: '</title><script>globalThis.titlePwned = true</script>' }
  );
  assert.doesNotMatch(html, /<script\b/i);
  assert.doesNotMatch(html, /<img\b[^>]*onerror/i);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.match(html, /&lt;script&gt;globalThis\.pwned = true&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=/);
  assert.match(html, /&lt;\/title&gt;&lt;script&gt;globalThis\.titlePwned = true&lt;\/script&gt;/);
  assert.match(html, /script-src 'none'/);
});

test("Markdown Export Pipeline - vendored KaTeX renders safely without executable formula markup", async () => {
  const html = await exportMarkdownToHtml(
    String.raw`Math: $\href{javascript:alert(1)}{click}$ and $</span><script>globalThis.pwned=true</script>$.`
  );
  assert.match(html, /class="katex-inline-math"/);
  assert.match(html, /class="katex"/);
  assert.doesNotMatch(html, /<script\b/i);
  assert.doesNotMatch(html, /href=["']javascript:/i);
  assert.doesNotMatch(html, /SCHEMADOSMATHTOKEN/);
  assert.match(html, /script-src 'none'/);
});

test("Markdown Export Pipeline - embeds the complete KaTeX WOFF2 font set for advanced formulas", async () => {
  const formula = String.raw`\mathbb{R}\;\mathcal{F}\;\mathbf{x}\;\left(\frac{a}{b}\right)`;
  const html = await exportMarkdownToHtml(`$$${formula}$$`);
  assert.equal((html.match(/data:font\/woff2;base64,/g) || []).length, 20);
  assert.match(html, /KaTeX_AMS/);
  assert.match(html, /KaTeX_Caligraphic/);
  assert.match(html, /KaTeX_Size4/);
  assert.match(html, /KaTeX_Typewriter/);
  assert.doesNotMatch(html, /url\(fonts\//);
  assert.doesNotMatch(html, /data:application\/octet-stream;base64,/);
  assert.ok(html.includes(`data-math="${formula}"`));
});

test("Markdown Export Pipeline - renders many formulas without token prefix collisions", async () => {
  const markdown = Array.from({ length: 35 }, (_value, index) => `$x_${index}^2$`).join(" ");
  const html = await exportMarkdownToHtml(markdown);
  assert.equal((html.match(/class="katex-inline-math"/g) || []).length, 35);
  assert.doesNotMatch(html, /SCHEMADOSMATHTOKEN/);
  for (let index = 0; index < 35; index++) {
    assert.ok(html.includes(`data-math="x_${index}^2"`), `formula ${index} should retain its exact token`);
  }
});

test("Markdown Export Pipeline - protects Markdown literal zones and collision-like text from math replacement", async () => {
  const literalToken = "SCHEMADOSMATHTOKEN0XEND";
  const markdown = [
    `Literal ${literalToken}.`,
    "",
    `Inline code: \`code $not_math$ ${literalToken}\`.`,
    "",
    "```md",
    "$also_not_math$",
    "```",
    "",
    "    const price = $indented_not_math$;",
    "",
    "- list item",
    "    formula $z^2$",
    "",
    "> quote",
    ">",
    ">     code $quoted_not_math$",
    "",
    String.raw`Escaped: \$12. Link: [priced](https://example.invalid/$5/$6).`,
    "Bare: https://example.invalid/$9/$10.",
    "Other links: www.example.com/$11/$12 ftp://example.invalid/$13/$14 user+$tag$@example.com.",
    "Reference: [priced ref][price-ref].",
    "[price-ref]: https://example.invalid/$7/$8",
    "",
    "Formula: $y^2$."
  ].join("\n");
  const html = await exportMarkdownToHtml(markdown);
  assert.equal((html.match(/SCHEMADOSMATHTOKEN0XEND/g) || []).length, 2);
  assert.match(html, /<code>code \$not_math\$ SCHEMADOSMATHTOKEN0XEND<\/code>/);
  assert.match(html, /<pre><code class="language-md">\$also_not_math\$\n<\/code><\/pre>/);
  assert.match(html, /<pre><code>const price = \$indented_not_math\$;\n<\/code><\/pre>/);
  assert.match(html, /<pre><code>code \$quoted_not_math\$\n<\/code><\/pre>/);
  assert.match(html, /href="https:\/\/example\.invalid\/\$5\/\$6"/);
  assert.match(html, /href="https:\/\/example\.invalid\/\$9\/\$10"/);
  assert.match(html, /href="https:\/\/example\.invalid\/\$7\/\$8"/);
  assert.match(html, /href="http:\/\/www\.example\.com\/\$11\/\$12"/);
  assert.match(html, /href="ftp:\/\/example\.invalid\/\$13\/\$14"/);
  assert.match(html, /href="mailto:user\+\$tag\$@example\.com"/);
  assert.match(html, /Escaped: \$12/);
  assert.equal((html.match(/class="katex-inline-math"/g) || []).length, 2);
  assert.match(html, /data-math="y\^2"/);
  assert.match(html, /data-math="z\^2"/);
  assert.doesNotMatch(html, /data-math="(?:not_math|also_not_math|indented_not_math|quoted_not_math|5\/|7\/|9\/|11\/|13\/|tag)"/);
});

test("Markdown Export Pipeline - keeps formula-like image alt text out of HTML attributes", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const html = await exportMarkdownToHtml(
    "![formula \\] $image_math$](docs/images/schema_docs_gateway_infographic.png)",
    { baseDir: root }
  );
  const imageTag = html.match(/<img\b[^>]*>/)?.[0] || "";
  assert.match(imageTag, /src="data:image\/(?:png|jpeg);base64,/);
  assert.match(imageTag, /alt="[^"]*\$image_math\$"/);
  assert.doesNotMatch(imageTag, /<span/);
  assert.doesNotMatch(html, /data-math="image_math"/);
});

test("Markdown Export Pipeline - image embedding cannot escape its allowed root", async () => {
  const container = await mkdtemp(path.join(os.tmpdir(), "schema-docs-export-boundary-"));
  const baseDir = path.join(container, "workspace", "notes");
  const outsidePath = path.join(container, "outside.png");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l4QW2QAAAABJRU5ErkJggg==", "base64");
  await mkdir(baseDir, { recursive: true });
  await writeFile(outsidePath, png);
  const html = await exportMarkdownToHtml("![Outside](../../outside.png)", { baseDir });
  assert.doesNotMatch(html, /data:image\/png;base64,/);
  assert.doesNotMatch(html, new RegExp(png.toString("base64")));
  assert.doesNotMatch(html, /<img\b/i);
  assert.doesNotMatch(html, /\.\.\/\.\.\/outside\.png/);
  assert.match(html, /Image omitted from export: Outside/);
});

test("Markdown Export Pipeline - HTML export removes remote image sources", async () => {
  const html = await exportMarkdownToHtml("![Tracking pixel](https://tracking.invalid/pixel.png)");
  assert.doesNotMatch(html, /tracking\.invalid/);
  assert.doesNotMatch(html, /<img\b/i);
  assert.match(html, /Image omitted from export: Tracking pixel/);
});

test("Markdown Export Pipeline - embeds local PDF visual assets in HTML and Word", async () => {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "schema-docs-export-image-"));
  const imageDir = path.join(baseDir, "Physics Notes");
  const imagePath = path.join(imageDir, "formula.png");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l4QW2QAAAABJRU5ErkJggg==", "base64");
  await mkdir(imageDir);
  await writeFile(imagePath, png);
  const markdown = "![Formula preserved from PDF page 12](<Physics Notes/formula.png>)";
  const html = await exportMarkdownToHtml(markdown, { baseDir });
  assert.match(html, /data:image\/png;base64,/);
  const docxBuffer = await exportMarkdownToDocx(markdown, { baseDir });
  const documentXml = readZipEntry(docxBuffer, "word/document.xml").toString("utf8");
  assert.match(documentXml, /<w:drawing>/);
});

test("Markdown Export Pipeline - PDF smoke check fallback", async () => {
  const md = "# PDF Title\n\nPDF content.";
  const pdfBuffer = await exportMarkdownToPdf(md);
  assert.ok(pdfBuffer instanceof Buffer);
  assert.match(pdfBuffer.toString("latin1"), /%PDF-1\.4/);
});

test("Markdown Export Pipeline - waits for delayed browser PDF output to become complete and stable", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "schema-docs-delayed-pdf-"));
  const pdfPath = path.join(tempDir, "delayed.pdf");
  const partialPdf = Buffer.from("%PDF-1.4\n1 0 obj\n", "ascii");
  const completePdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n", "ascii");
  const startedAt = Date.now();
  const writer = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    await writeFile(pdfPath, partialPdf);
    await new Promise((resolve) => setTimeout(resolve, 90));
    await writeFile(pdfPath, completePdf);
  })();
  try {
    const result = await waitForStablePdfFile(pdfPath, {
      timeoutMs: 1500,
      intervalMs: 20,
      stableSamples: 2
    });
    await writer;
    assert.deepEqual(result, completePdf);
    assert.ok(Date.now() - startedAt >= 100);
  } finally {
    await writer.catch(() => {});
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Markdown Export Pipeline - image-only slide deck exports one embedded image per PDF page", async () => {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "schema-docs-slide-pdf-"));
  const imageDir = path.join(baseDir, "GEO&GTO1.pptx");
  const pngChunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0]))),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
  await mkdir(imageDir);
  await writeFile(path.join(imageDir, "slide-1.png"), png);
  await writeFile(path.join(imageDir, "slide-2.png"), png);
  const markdown = [
    "# Image deck",
    "",
    "## Slide 1",
    "",
    "![Slide 1 image](<GEO&GTO1.pptx/slide-1.png>)",
    "",
    "## Slide 2",
    "",
    "![Slide 2 image](<GEO&GTO1.pptx/slide-2.png>)"
  ].join("\n");
  const pdf = await exportMarkdownToPdf(markdown, { baseDir });
  const source = pdf.toString("latin1");
  assert.match(source, /\/Count 2/);
  assert.equal((source.match(/\/Subtype \/Image/g) || []).length, 2);
  assert.doesNotMatch(source, /Slide 1 image/);
});

test("Markdown Export Pipeline - image-only slide deck preserves RGBA PNG colors", async () => {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "schema-docs-slide-rgba-pdf-"));
  const pngChunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0, 255, 0, 128, 255, 64]))),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
  await writeFile(path.join(baseDir, "slide.png"), png);
  const pdf = await exportMarkdownToPdf("# Deck\n\n## Slide 1\n\n![Slide](slide.png)", { baseDir });
  const source = pdf.toString("latin1");
  assert.match(source, /\/ColorSpace \/DeviceRGB/);
  assert.match(source, /\/Colors 3/);
  const imageObject = pdf.indexOf(Buffer.from("/Subtype /Image"));
  const streamStart = pdf.indexOf(Buffer.from("stream\n"), imageObject) + 7;
  const imageStream = pdf.subarray(streamStart, pdf.indexOf(Buffer.from("\nendstream"), streamStart));
  assert.deepEqual(inflateSync(imageStream), Buffer.from([0, 255, 0, 0, 191, 223, 255]));
});

test("Markdown Export Pipeline - Exchange package pipeline quality check", async () => {
  const markdown = "# Test Exchange\n- List item\n1. Numbered item\n$\\beta \\pm \\lambda$";
  const docxResult = await exportMarkdownToDocx(markdown);
  const docxXml = readZipEntry(docxResult, "word/document.xml").toString("utf8");
  assert.match(docxXml, /Numbered item/);
  assert.match(docxXml, /1\.  /);
  assert.match(docxXml, /<m:oMath/);
  assert.doesNotMatch(docxXml, /<undefined>/);
  assert.ok(docxXml.includes("\u03b2"));
  assert.ok(docxXml.includes("\u00b1"));
  assert.ok(docxXml.includes("\u03bb"));
});
