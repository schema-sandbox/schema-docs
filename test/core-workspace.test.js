import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openOrCreateWorkspace, readManifest } from "../src/core/manifest.js";
import { saveMarkdown, readMarkdown } from "../src/core/markdown.js";
import { importFileToWorkspace, classifySource } from "../src/core/records.js";
import { assertInsideRoot } from "../src/core/pathGuard.js";
import { createAppService } from "../src/core/appService.js";
import { createQualityReport } from "../src/core/qualityReport.js";
async function tempDir(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}
test("creates a workspace layout and manifest", async () => {
  const workspace = await tempDir("lft-workspace-");
  const manifest = await openOrCreateWorkspace(workspace);
  assert.equal(manifest.version, 1);
  assert.ok(manifest.workspaceId.startsWith("workspace_"));
  const loaded = await readManifest(workspace);
  assert.equal(loaded.workspaceId, manifest.workspaceId);
});
test("saves and reads markdown inside workspace", async () => {
  const workspace = await tempDir("lft-markdown-");
  await openOrCreateWorkspace(workspace);
  await saveMarkdown(workspace, path.join("notes", "a.md"), "# A\n");
  const content = await readMarkdown(workspace, path.join("notes", "a.md"));
  assert.equal(content, "# A\n");
});
test("normalizes legacy low-readable PDF markdown notices on read", async () => {
  const workspace = await tempDir("lft-legacy-low-readable-");
  await openOrCreateWorkspace(workspace);
  const relativePath = path.join("outputs", "readable", "garbled.readable.md");
  const fullPath = path.join(workspace, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, [
    "# garbled.pdf",
    "",
    "> Human-readable Markdown was not generated because the extracted text looks unreadable.",
    "> Source format: pdf",
    "",
    "## What happened",
    "",
    "- Schema Docs kept the AI-ready extraction and audit evidence separately, but this human reading view is blocked to avoid showing misleading garbled text.",
    "",
    "---",
    "",
    "# garbled raw extraction",
    "",
    "A\uFFFDB\uFFFDC\uFFFDencoded glyph junk"
  ].join("\n"), "utf8");
  const content = await readMarkdown(workspace, relativePath);
  assert.match(content, /PDF\/OCR extraction limit/);
  assert.doesNotMatch(content, /this human reading view is blocked/);
  assert.doesNotMatch(content, /encoded glyph junk/);
});
test("normalizes current low-readable PDF notices on read", async () => {
  const workspace = await tempDir("lft-current-low-readable-");
  await openOrCreateWorkspace(workspace);
  const relativePath = path.join("outputs", "readable", "garbled-current.readable.md");
  const fullPath = path.join(workspace, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, [
    "# PDF extraction needs another path",
    "",
    "> **Status**: This PDF could not be converted into human-readable Markdown. AI-ready raw extraction is preserved. Presentation replaced due to low readability.",
    "",
    "Source file: garbled.pdf",
    "",
    "## What Schema Docs tried",
    "- built-in: low_readable",
    "",
    "---",
    "",
    "> Extractor: built-in",
    "> Extraction quality: low",
    "",
    "> Human-readable Markdown view.",
    "> Source format: pdf",
    "",
    "# garbled raw extraction",
    "",
    "A\uFFFDB\uFFFDC\uFFFDencoded glyph junk"
  ].join("\n"), "utf8");
  const content = await readMarkdown(workspace, relativePath);
  assert.match(content, /PDF extraction needs another path/);
  assert.doesNotMatch(content, /Human-readable Markdown view/);
  assert.doesNotMatch(content, /encoded glyph junk/);
});
test("hides document process metadata when reading markdown", async () => {
  const workspace = await tempDir("lft-process-metadata-");
  await openOrCreateWorkspace(workspace);
  const relativePath = path.join("outputs", "readable", "imported.readable.md");
  const fullPath = path.join(workspace, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, [
    "# Imported",
    "",
    "> Source: imported.docx",
    "> Converted by: docx-markdown-converter",
    "",
    "> Extractor: docx-markdown-converter",
    "> Extraction quality: high",
    "",
    "> Human-readable Markdown view.",
    "> Source format: docx",
    "",
    "Real content"
  ].join("\n"), "utf8");
  const content = await readMarkdown(workspace, relativePath);
  assert.match(content, /# Imported/);
  assert.match(content, /Real content/);
  assert.doesNotMatch(content, /Source: imported\.docx/);
  assert.doesNotMatch(content, /Converted by:/);
  assert.doesNotMatch(content, /Extractor:/);
  assert.doesNotMatch(content, /Extraction quality:/);
  assert.doesNotMatch(content, /Human-readable Markdown view/);
  assert.doesNotMatch(content, /Source format:/);
});
test("blocks stale readable segments that already contain mojibake", async () => {
  const workspace = await tempDir("lft-stale-readable-mojibake-");
  await openOrCreateWorkspace(workspace);
  const relativePath = path.join("outputs", "readable", "bad.readable_1.md");
  const fullPath = path.join(workspace, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  const bad = String.fromCharCode(0xfffd);
  await writeFile(fullPath, [
    "# bad readable segment",
    "",
    `${bad.repeat(3)}P${bad.repeat(3)}□□${bad}I${bad.repeat(3)}U${bad.repeat(4)}n${bad.repeat(3)}?`,
    `${bad.repeat(3)}h${bad}q${bad}u${bad.repeat(7)}u${bad}`,
    `${bad.repeat(3)}O${bad.repeat(2)}K${bad}`,
    bad.repeat(120)
  ].join("\n"), "utf8");
  const content = await readMarkdown(workspace, relativePath);
  assert.match(content, /Document needs another extraction path/);
  assert.match(content, /blocked the human reading view/);
  assert.doesNotMatch(content, new RegExp(`${bad.repeat(3)}P`));
});
test("preserves user-authored process-like blockquotes outside converted outputs", async () => {
  const workspace = await tempDir("lft-native-source-blockquote-");
  await openOrCreateWorkspace(workspace);
  await saveMarkdown(workspace, path.join("notes", "source-note.md"), [
    "# Note",
    "",
    "> Source: user-authored citation",
    "> Converted by: the narrator",
    "",
    "Body"
  ].join("\n"));
  const content = await readMarkdown(workspace, path.join("notes", "source-note.md"));
  assert.match(content, /> Source: user-authored citation/);
  assert.match(content, /> Converted by: the narrator/);
});
test("exports handwritten markdown without removing user-authored blockquotes", async () => {
  const workspace = await tempDir("lft-native-export-blockquote-");
  await openOrCreateWorkspace(workspace);
  const service = createAppService(workspace);
  const notePath = path.join("notes", "source-note.md");
  await saveMarkdown(workspace, notePath, [
    "# Note",
    "",
    "> Source: user-authored citation",
    "",
    "Body"
  ].join("\n"));
  await service.exportMarkdownDocument(notePath, path.join("exports", "source-note.md"), "md");
  const exported = await readFile(path.join(workspace, "exports", "source-note.md"), "utf8");
  assert.match(exported, /> Source: user-authored citation/);
});
test("rejects paths outside workspace", async () => {
  const workspace = await tempDir("lft-guard-");
  const outside = await tempDir("lft-outside-");
  await openOrCreateWorkspace(workspace);
  const outsideFile = path.join(outside, "secret.md");
  await writeFile(outsideFile, "secret", "utf8");
  await assert.rejects(() => assertInsideRoot(outsideFile, workspace), {
    code: "path_outside_workspace"
  });
});
test("classifies supported source files", () => {
  assert.deepEqual(classifySource("a.pdf"), { kind: "document", sourceType: "pdf" });
  assert.deepEqual(classifySource("a.docx"), { kind: "document", sourceType: "docx" });
  assert.deepEqual(classifySource("a.pptx"), { kind: "document", sourceType: "pptx" });
  assert.deepEqual(classifySource("a.txt"), { kind: "document", sourceType: "txt" });
  assert.deepEqual(classifySource("a.xlsx"), { kind: "dataset", sourceType: "xlsx" });
  assert.deepEqual(classifySource("a.csv"), { kind: "dataset", sourceType: "csv" });
  assert.throws(() => classifySource("a.doc"), (error) => (
    error.code === "optional_adapter_required"
      && error.details.adapterRequired === "soffice"
      && error.details.mode === "optional-system-adapter"
  ));
  assert.throws(() => classifySource("a.exe"), { code: "unsupported_file_type" });
});
test("quality report records missing OCR adapter guidance for scanned PDFs", async () => {
  const workspace = await tempDir("lft-quality-adapter-");
  await openOrCreateWorkspace(workspace);
  const outputPath = path.join(workspace, "outputs", "scan.md");
  await writeFile(outputPath, "# scan\n\n<!-- conversion-note: no simple text layer was detected -->\n", "utf8");
  const report = await createQualityReport(
    workspace,
    "doc_scan",
    path.join(workspace, "imports", "scan.pdf"),
    "pdf",
    outputPath,
    "<!-- conversion-note: no simple text layer was detected -->",
    {
      textLayerDetected: false,
      scannedLikely: true,
      confidence: "low"
    },
    ["scannedLikely"]
  );
  assert.ok(report.requiredAdapters.some((adapter) => adapter.key === "tesseract"));
  assert.ok(report.matchedKnownLimits.includes("ocr_unsupported"));
  if (report.missingAdapters.some((adapter) => adapter.key === "tesseract")) {
    assert.ok(report.matchedKnownLimits.includes("ocr_adapter_missing"));
    assert.ok(report.adapterGuidance.some((guidance) => guidance.adapter === "tesseract"));
    assert.ok(report.suggestedActions.some((action) => action.includes("Tesseract OCR")));
  }
});
test("imports supported files as records", async () => {
  const workspace = await tempDir("lft-import-");
  await openOrCreateWorkspace(workspace);
  const csvPath = path.join(workspace, "input.csv");
  await writeFile(csvPath, "x,y\n1,2\n", "utf8");
  const record = await importFileToWorkspace(workspace, csvPath);
  const manifest = await readManifest(workspace);
  assert.equal(record.sourceType, "csv");
  assert.equal(record.status, "imported");
  assert.equal(manifest.datasets.length, 1);
});
test("detects external updates and refreshes records", async () => {
  const workspace = await tempDir("lft-refresh-");
  await openOrCreateWorkspace(workspace);
  const externalTxtPath = path.join(workspace, "doc.txt");
  await writeFile(externalTxtPath, "hello world v1\n", "utf8");
  const service = createAppService(workspace);
  const record = await service.importFile(externalTxtPath);
  assert.equal(record.status, "imported");
  assert.ok(record.hash);
  let updates = await service.checkUpdates();
  assert.equal(updates.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await writeFile(externalTxtPath, "hello world v2 shifted content!\n", "utf8");
  updates = await service.checkUpdates();
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, record.id);
  assert.equal(updates[0].changed, true);
  const refreshResult = await service.refreshRecord(record.id);
  assert.equal(refreshResult.kind, "document");
  assert.equal(refreshResult.record.status, "imported");
  updates = await service.checkUpdates();
  assert.equal(updates.length, 0);
  const copiedContent = await readFile(refreshResult.record.sourcePath, "utf8");
  assert.equal(copiedContent, "hello world v2 shifted content!\n");
});
