import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readProjectFile(relativePath) {
  return readFile(path.join(projectRoot, relativePath), "utf8");
}

test("AI context preview escapes imported headings before writing HTML", async () => {
  const source = await readProjectFile("public/aiContextPanel.js");

  assert.match(source, /markdownSections = \(preview\.markdownSections \?\? \[\]\)\.map\(escapeHtml\)/);
  assert.doesNotMatch(source, /preview\.markdownSections\.join\(/);
  assert.match(source, /escapeHtml\(preview\.recommendedNextAction \|\| ""\)/);
});

test("toast alerts render provider and runtime errors as text", async () => {
  const source = await readProjectFile("public/alertPanel.js");

  assert.match(source, /messageSpan\.textContent = String\(message \?\? ""\)/);
  assert.doesNotMatch(source, /innerHTML = `<span style="flex: 1;">\$\{message\}/);
});

test("manifest card metadata treats workspace manifest paths as text", async () => {
  const source = await readProjectFile("public/manifestPanel.js");

  assert.match(source, /item\.append\(labelSpan, ` \$\{String\(val \|\| "-"\)\}`\)/);
  assert.doesNotMatch(source, /<span class="record-meta-label">\$\{label\}:<\/span> \$\{val \|\| "-"\}/);
});

test("frontend does not dynamically import remote editor code", async () => {
  const source = await readProjectFile("public/markdownEditorAdapter.js");

  assert.doesNotMatch(source, /https?:\/\//);
  assert.doesNotMatch(source, /esm\.sh/);
});

test("global error banner treats runtime error details as text", async () => {
  const source = await readProjectFile("public/index.html");

  assert.match(source, /message\.textContent = String\(msg \|\| "Unknown error"\)/);
  assert.match(source, /dismiss\.addEventListener\("click", \(\) => div\.remove\(\)\)/);
  assert.doesNotMatch(source, /div\.innerHTML/);
  assert.doesNotMatch(source, /onclick=/);
});

test("PDF export does not disable the Chromium sandbox", async () => {
  const source = await readProjectFile("src/core/markdownExportPipeline.js");

  assert.doesNotMatch(source, /["']--no-sandbox["']/);
  assert.doesNotMatch(source, /unpkg\.com/);
});

test("PDF diagnostics escape status text parsed from imported Markdown", async () => {
  const source = await readProjectFile("public/markdownWorkbenchPanel.js");

  assert.match(source, /escapeHtml\(t\("quality_" \+ quality\)\)/);
  assert.match(source, /escapeHtml\(t\("status_" \+ a\.status\)\)/);
  assert.match(source, /const charCount = Number\(state\.selectedRecord\?\.markdownOutputs\?\.readableStats\?\.characters\) \|\| 0/);
  assert.doesNotMatch(source, /\$\{t\("status_" \+ a\.status\)\}/);
});

test("segment banner coerces workspace manifest line ranges to numbers", async () => {
  const source = await readProjectFile("public/markdownWorkbenchPanel.js");

  assert.match(source, /const startLine = Number\(curSeg\.startLine\) \|\| 0/);
  assert.match(source, /const endLine = Number\(curSeg\.endLine\) \|\| 0/);
  assert.doesNotMatch(source, /Mapped source lines \$\{curSeg\.startLine\}-\$\{curSeg\.endLine\}/);
});
