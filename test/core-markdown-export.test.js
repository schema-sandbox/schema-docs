import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { initExportLibraries, exportMarkdownToDocx, exportMarkdownToHtml, exportMarkdownToPdf } from "../src/core/markdownExportPipeline.js";
const projectRoot = path.resolve(import.meta.dirname, "..");

test("Document PDF exports do not silently downgrade styled-export failures", async () => {
  const source = await readFile(path.join(projectRoot, "src", "core", "documentExports.js"), "utf8");
  assert.match(source, /if \(format === "pdf"\) \{\s*return await exportMarkdownToPdf\(cleaned, options\);\s*\}/);
  assert.doesNotMatch(source, /legacyMarkdownToPdfBuffer/);
});

test("Markdown Export Quality Upgrade", async (t) => {
  await t.test("initExportLibraries should resolve successfully", async () => {
    const libs = await initExportLibraries();
    assert.ok(libs.markdownit);
    assert.ok(libs.docx);
    assert.equal(typeof libs.katex?.renderToString, "function");
  });

  await t.test("LaTeX math safety boundary checks", async () => {

    const complexMd = "$$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$";
    const complexHtml = await exportMarkdownToHtml(complexMd);
    assert.match(complexHtml, /data-math="x = \\frac\{-b \\pm \\sqrt\{b\^2-4ac\}\}\{2a\}"/);
    assert.match(complexHtml, /<math xmlns="http:\/\/www\.w3\.org\/1998\/Math\/MathML"/);
    assert.doesNotMatch(complexHtml, />\$\$x =/);

    const inlineComplexMd = "Formula $E = mc^2$ and $\\sqrt{x}$";
    const inlineComplexHtml = await exportMarkdownToHtml(inlineComplexMd);
    assert.match(inlineComplexHtml, /data-math="\\sqrt\{x\}"/);
    assert.doesNotMatch(inlineComplexHtml, />\$\\sqrt\{x\}\$</);

    const simpleMd = "Angle is $\\Delta$ or $\\lambda$";
    const simpleHtml = await exportMarkdownToHtml(simpleMd);
    assert.match(simpleHtml, /data-math="\\Delta"/);
    assert.match(simpleHtml, /data-math="\\lambda"/);
    assert.doesNotMatch(simpleHtml, /SCHEMADOSMATHTOKEN/);
  });

  await t.test("HTML export outputs style templates", async () => {
    const md = "# Title\n> Quote\n\n```js\nconst x = 1;\n```";
    const html = await exportMarkdownToHtml(md);
    assert.ok(html.includes("<!DOCTYPE html>"), "Should contain DOCTYPE");
    assert.ok(html.includes("style"), "Should contain CSS styling block");
    assert.ok(html.includes("body"), "Should contain body tag");
    assert.ok(html.includes("katex-display-math") || html.includes("katex-inline-math"), "Should support display/inline class templates");
  });

  await t.test("DOCX export runs without crashing", async () => {
    const md = `# H1 Title\n## H2 Title\n### H3 Title\n\n> This is a blockquote\n\n| Col1 | Col2 |\n| ---- | ---- |\n| val1 | val2 |\n\n\`\`\`js\nconsole.log(1);\n\`\`\``;
    const buffer = await exportMarkdownToDocx(md);
    assert.ok(buffer instanceof Buffer, "Should output a Buffer");
    assert.ok(buffer.length > 0, "Buffer should not be empty");
  });

  await t.test("PDF test-context fallback remains a valid PDF buffer", async () => {
    const md = "Hello world";
    const buffer = await exportMarkdownToPdf(md);
    assert.ok(buffer instanceof Buffer, "PDF exporter should return a PDF buffer in tests");
  });
});
