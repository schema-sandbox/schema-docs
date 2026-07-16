import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createMarkdownWorkbenchPanel } from "../public/markdownWorkbenchPanel.js";
const projectRoot = path.resolve(import.meta.dirname, "..");
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function createRenderer(options = {}) {
  const notePath = { value: options.notePath || "outputs/readable/note.md" };
  return createMarkdownWorkbenchPanel({
    $: (id) => id === "notePath" ? notePath : null,
    state: { workspacePath: options.workspacePath || "" },
    run: async (task) => task(),
    saveCurrentNote: async () => ({}),
    refreshVersions: () => {},
    escapeHtml,
    localApiBaseUrl: () => "http://127.0.0.1:4177"
  })._test;
}
test("Markdown workbench renders Obsidian-style reading affordances", () => {
  const renderer = createRenderer();
  const html = renderer.markdownToReadableHtml(`---
title: Demo Note
tags: ai-intake
---
# Demo
> [!WARNING] Review before sending
> Keep **sensitive** fields masked.
>
> Use [[Send Gate|the Send Gate]] first.
Inline code should stay literal: \`**not bold** #notatag\`.
See [[Source Note]] and #release-note.
Claim[^1]
[^1]: Evidence note.
`);
  assert.match(html, /markdown-frontmatter/);
  assert.match(html, /data-callout="warning"/);
  assert.match(html, /Keep <strong>sensitive<\/strong> fields masked/);
  assert.match(html, /Use <span class="wiki-link" title="Send Gate">the Send Gate<\/span> first/);
  assert.match(html, /<code>\*\*not bold\*\* #notatag<\/code>/);
  assert.doesNotMatch(html, /<code><strong>not bold<\/strong>/);
  assert.match(html, /<span class="wiki-link" title="Source Note">Source Note<\/span>/);
  assert.match(html, /<span class="markdown-tag">#release-note<\/span>/);
  assert.match(html, /markdown-footnotes/);
  assert.match(html, /Evidence note/);
});
test("Markdown workbench renders setext headings and exposes them in outline", () => {
  const renderer = createRenderer();
  const markdown = `Main Title
===
Section Title
---
Body text.`;
  const html = renderer.markdownToReadableHtml(markdown);
  const headings = renderer.getMarkdownHeadings(markdown);
  assert.match(html, /<h1 id="main-title-1">Main Title<\/h1>/);
  assert.match(html, /<h2 id="section-title-2">Section Title<\/h2>/);
  assert.deepEqual(headings.map((heading) => [heading.level, heading.title]), [
    [1, "Main Title"],
    [2, "Section Title"]
  ]);
});
test("Markdown workbench hides imported Markdown syntax escapes in reading view", () => {
  const renderer = createRenderer();
  const html = renderer.markdownToReadableHtml("**RIFT\\_24\\_Slow\\_Dolly\\_Out: 缓慢拉远。**");
  assert.match(html, /<strong>RIFT_24_Slow_Dolly_Out: 缓慢拉远。<\/strong>/);
  assert.doesNotMatch(html, /\\_/);
  assert.doesNotMatch(html, /\*\*RIFT/);
});
test("Markdown workbench blocks remote image fetches and file URLs in reading view", () => {
  const renderer = createRenderer();
  const html = renderer.markdownToReadableHtml("![Tracking image](https://example.invalid/pixel.png) [Local file](file:///C:/secret.txt)");
  assert.match(html, /markdown-image-blocked/);
  assert.doesNotMatch(html, /src="https:\/\/example\.invalid/);
  assert.doesNotMatch(html, /href="file:/);
});
test("Markdown workbench resolves angle-bracket local image paths through the protected workspace endpoint", () => {
  const renderer = createRenderer({ workspacePath: "D:\\workspace" });
  const html = renderer.markdownToReadableHtml("![Formula](<../assets/GEO&GTO1.pptx/formula 1.png>)");
  assert.match(html, /api\/workspace-asset/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /assetPath=\.\.%2Fassets%2FGEO%26GTO1\.pptx%2Fformula\+1\.png/);
  assert.doesNotMatch(html, /GEO%26amp%3B/);
});
test("Markdown workbench recognizes PPTX slide documents for dual-layer reading", () => {
  const renderer = createRenderer();
  const markdown = [
    "# Presentation",
    "",
    "## Slide 1: Overview",
    "",
    "![Slide 1 preview](<../assets/deck.pptx/slide-1.png>)",
    "",
    "Editable extracted text"
  ].join("\n");
  assert.equal(renderer.isPptxSlideMarkdown(markdown), true);
  assert.equal(renderer.isPptxSlideMarkdown("# Ordinary Markdown\n\nBody"), false);
});
test("Markdown workbench preserves display math source after inline edits", () => {
  const renderer = createRenderer();
  const original = [
    "$$",
    "S_{invalid}=\\int_{0}^{t}\\frac{dQ}{dt}dt",
    "$$"
  ].join("\n");
  const edited = [
    "$$",
    "S_{invalid}=\\int_{0}^{t}\\left(\\frac{dQ}{dt}-\\eta\\right)dt",
    "$$"
  ].join("\n");
  const html = renderer.markdownToReadableHtml(original);
  assert.match(html, /markdown-math-block/);
  assert.match(html, /katex-math display-mode/);
  assert.equal(renderer.markdownForEditedBlock(original, edited), edited);
});
test("Markdown workbench edits original Markdown instead of expanded KaTeX text", () => {
  const renderer = createRenderer();
  const paragraph = "下界取一个 $m \\times m$ 的网格，因此 $n = m^2$。";
  assert.equal(renderer.editableMarkdownForBlock(paragraph), paragraph);
  assert.equal(
    renderer.editableMarkdownForBlock("## 公式 $n = m^2$"),
    "公式 $n = m^2$"
  );
  assert.equal(
    renderer.editableMarkdownForBlock("> 保持 $C / \\log \\log n$ 不变"),
    "保持 $C / \\log \\log n$ 不变"
  );
});
test("Markdown workbench advertises single-click inline editing", () => {
  const renderer = createRenderer();
  const html = renderer.markdownToReadableHtml("正文包含 $n = m^2$。\n\n$$k = \\prod_i p_i$$");
  assert.match(html, /data-hover-hint="✎ Click to edit"/);
  assert.doesNotMatch(html, /Double-click to edit/);
});
test("Markdown inline editing round-trips structural markers and formulas", () => {
  const renderer = createRenderer();
  const cases = [
    ["正文 $m \\times m$ 与 $n=m^2$。", "正文 $m \\times m$ 与 $n=m^2$。"],
    ["## 公式 $n=m^2$", "公式 $n=m^2$"],
    ["> 保持 $C / \\log \\log n$", "保持 $C / \\log \\log n$"],
    ["- [ ] 检查 $n=m^2$", "检查 $n=m^2$"],
    ["集合标题\n---", "集合标题"]
  ];
  for (const [source, editable] of cases) {
    assert.equal(renderer.editableMarkdownForBlock(source), editable);
    assert.equal(renderer.markdownForEditedBlock(source, editable), source);
    assert.doesNotMatch(editable, /m\n|n\n|=\n/);
  }
});
test("Markdown reading view binds its inline editor to a single click", async () => {
  const source = await readFile(path.join(projectRoot, "public", "markdownWorkbenchPanel.js"), "utf8");
  assert.match(source, /\$\("markdownReadView"\)\?\.addEventListener\("click", \(event\) => \{/);
  assert.match(source, /beginInlineReadEdit\(el, event\);/);
  assert.doesNotMatch(source, /\$\("markdownReadView"\)\?\.addEventListener\("dblclick"/);
});
test("Markdown inline rendering keeps more than one hundred formulas and code spans in order", () => {
  const renderer = createRenderer();
  const formulas = Array.from({ length: 120 }, (_, index) => `x_{${index}}`);
  const codeSpans = Array.from({ length: 120 }, (_, index) => `code-${index}`);
  const source = formulas.map((formula, index) => `$${formula}$ \`${codeSpans[index]}\``).join(" ");
  const html = renderer.renderInlineMarkdown(source);
  const renderedFormulas = [...html.matchAll(/data-math="([^"]+)"/g)].map((match) => match[1]);
  const renderedCode = [...html.matchAll(/<code>([^<]+)<\/code>/g)].map((match) => match[1]);
  assert.deepEqual(renderedFormulas, formulas);
  assert.deepEqual(renderedCode, codeSpans);
  assert.doesNotMatch(html, /SCHEMADOS(?:MATH|CODE)TOKEN/);
});
test("Markdown inline rendering protects code, links, escaped dollars, and literal token text", () => {
  const renderer = createRenderer();
  const html = renderer.renderInlineMarkdown(
    "Literal SCHEMADOSMATHTOKEN0XEND and SCHEMADOSCODETOKEN0XEND; " +
    "`code $not_math$`; [priced link](https://example.invalid/$5/$6); " +
    "bare www.example.com/$7/$8 and ftp://example.invalid/$9/$10 and " +
    "user+$tag$@example.com; ![formula \\] $image_math$](https://example.invalid/image.png); " +
    "escaped \\$12; formula $y^2$."
  );
  assert.match(html, /Literal SCHEMADOSMATHTOKEN0XEND and SCHEMADOSCODETOKEN0XEND/);
  assert.match(html, /<code>code \$not_math\$<\/code>/);
  assert.match(html, /href="https:\/\/example\.invalid\/\$5\/\$6"/);
  assert.match(html, /bare www\.example\.com\/\$7\/\$8/);
  assert.match(html, /ftp:\/\/example\.invalid\/\$9\/\$10/);
  assert.match(html, /user\+\$tag\$@example\.com/);
  assert.match(html, /Image not loaded: formula \] \$image_math\$/);
  assert.doesNotMatch(html, /data-math="image_math"/);
  assert.match(html, /escaped \$12/);
  assert.equal((html.match(/class="katex-math inline-mode"/g) || []).length, 1);
  assert.match(html, /data-math="y\^2"/);
  assert.doesNotMatch(html, /data-math="not_math"/);
});
test("Markdown table editing keeps formula and code pipes in their original cell", async () => {
  const renderer = createRenderer();
  const row = "| label | $\\left|x\\right|$ and `a|b` and escaped \\| |";
  assert.deepEqual(renderer.splitMarkdownTableRow(row), {
    cells: ["label", "$\\left|x\\right|$ and `a|b` and escaped \\|"],
    leadingPipe: true,
    trailingPipe: true
  });
  assert.equal(
    renderer.escapeMarkdownTableCell("$|x|$ and `a|b` plus a | separator"),
    "$|x|$ and `a|b` plus a \\| separator"
  );
  const source = await readFile(path.join(projectRoot, "public", "markdownWorkbenchPanel.js"), "utf8");
  assert.match(source, /el\.textContent = cells\[cellIndex\];/);
});
test("Markdown workbench hides AI citation transport markers in reading view", () => {
  const renderer = createRenderer();
  const html = renderer.markdownToReadableHtml("Reusable document workflow.□cite□turn26academia0□turn26academia1□turn26news6□");
  assert.match(html, /Reusable document workflow/);
  assert.doesNotMatch(html, /turn26/);
  assert.doesNotMatch(html, /cite/);
});
test("Markdown workbench metadata extracts links, tags, tasks, and footnotes", () => {
  const renderer = createRenderer();
  const meta = renderer.getMarkdownMetadata(`- [ ] Open task
- [x] Done task
Link to [[Project Alpha]] and [[Project Beta|Beta]].
Tagged with #office-first and #ai-intake.
[^audit]: Audit footnote.
`);
  assert.deepEqual(meta.wikiLinks, ["Project Alpha", "Project Beta"]);
  assert.deepEqual(meta.tags, ["ai-intake", "office-first"]);
  assert.equal(meta.openTasks, 1);
  assert.equal(meta.doneTasks, 1);
  assert.equal(meta.footnotes, 1);
});
test("Markdown workbench renders readable segment links as internal file actions", () => {
  const renderer = createRenderer();
  const html = renderer.markdownToReadableHtml([
    "# Index",
    "",
    "- [Part 1](./large.readable_1.md)",
    "- [External](https://example.com)"
  ].join("\n"));
  assert.match(html, /data-markdown-relative-link="\.\/large\.readable_1\.md"/);
  assert.match(html, /class="markdown-file-link"/);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.equal(
    renderer.normalizeRelativeMarkdownPath("outputs/readable/large.readable.index.md", "./large.readable_1.md"),
    "outputs/readable/large.readable_1.md"
  );
});
