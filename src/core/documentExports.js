import path from "node:path";
import { createReadStream } from "node:fs";
import { access, mkdtemp, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readMarkdown } from "./markdown.js";
import { assertInsideRoot, prepareSafeWritePath } from "./pathGuard.js";
import { normalizeDocumentFormat } from "./documentExchangeMatrix.js";
import { appendTimelineEvent } from "./timeline.js";
import { exportMarkdownToDocx, exportMarkdownToPdf, exportMarkdownToHtml, exportMarkdownToHtmlFile, readSafeMarkdownImageAsset, checkExportBudget } from "./markdownExportPipeline.js";
import { isPptxSlideMarkdown, projectPptxSlidesForExport } from "./pptxMarkdownProjection.js";
import { markdownToDocxBuffer as legacyMarkdownToDocxBuffer } from "../adapters/markdownDocxExporter.js";
function cleanMarkdownForExport(markdown, options = {}) {
if (options.stripProcessMetadata === false) return String(markdown || "").trim();
return String(markdown || "")
.replace(/^>\s*(Source|Converted by|Extractor|Extraction quality|Source format):[^\n]*\r?\n?/gim, "")
.replace(/^>\s*Human-readable Markdown view\.?\s*\r?\n?/gim, "")
// Page markers are an internal join/ledger protocol. They are useful while
// building the readable view, but must never become user-visible export text.
.replace(/^[ \t]*<!--\s*pdf-page:\s*\d+(?:\s*;[^>]*)?\s*-->[ \t]*(?:\r?\n)?/gim, "")
.trim();
}
async function renderMarkdown(markdown, format, options = {}) {
const cleaned = format === "md" && options.stripProcessMetadata === false
? String(markdown ?? "")
: cleanMarkdownForExport(markdown, options);
if (format === "md") return Buffer.from(cleaned, "utf8");
if (format === "docx") {
try {
return await exportMarkdownToDocx(cleaned, options);
} catch (err) {
if (["resource_limit", "job_cancelled", "ABORT_ERR", "TIMEOUT"].includes(err?.code) || /!\[[^\]]*\]\(/.test(cleaned)) throw err;
return legacyMarkdownToDocxBuffer(cleaned);
}
}
if (format === "pdf") {
return await exportMarkdownToPdf(cleaned, options);
}
if (format === "html") return Buffer.from(await exportMarkdownToHtml(cleaned, options), "utf8");
throw new Error(`Unhandled normalized document format: ${format}`);
}
async function portableMarkdownAssets(markdown, sourceBaseDir, assetRoot, outputPath, workspacePath) {
if (!sourceBaseDir) return markdown;
const assetFolderName = `${path.parse(outputPath).name}.assets`;
const assetFolder = path.join(path.dirname(outputPath), assetFolderName);
const replacements = [];
const imagePattern = /(!\[[^\]]*\]\()(?:<([^>\n]+)>|([^\s)\n]+))(\))/g;
for (const match of String(markdown || "").matchAll(imagePattern)) {
const target = String(match[2] || match[3] || "").trim();
const asset = await readSafeMarkdownImageAsset(target, sourceBaseDir, assetRoot || sourceBaseDir);
if (!asset) continue;
const fileName = path.basename(asset.filePath);
const assetPath = await prepareSafeWritePath(path.join(assetFolder, fileName), workspacePath);
await writeFile(assetPath, asset.data);
const portableTarget = `./${assetFolderName}/${encodeURI(fileName)}`;
replacements.push({ start: match.index, end: match.index + match[0].length, value: `${match[1]}<${portableTarget}>${match[4]}` });
}
let output = String(markdown || "");
for (const replacement of replacements.reverse()) {
output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end);
}
return output;
}
function shouldStripProcessMetadataForPath(markdownRelativePath) {
const normalized = String(markdownRelativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
return normalized === "outputs" || normalized.startsWith("outputs/");
}
export async function exportMarkdownDocument(workspacePath, markdownRelativePath, outputRelativePath, format, options = {}) {
const normalizedFormat = normalizeDocumentFormat(format);
const markdown = await readMarkdown(workspacePath, markdownRelativePath);
const outputPath = await writeRenderedDocument(workspacePath, markdown, outputRelativePath, normalizedFormat, {
...options,
stripProcessMetadata: shouldStripProcessMetadataForPath(markdownRelativePath),
baseDir: path.dirname(path.resolve(workspacePath, markdownRelativePath)),
assetRoot: workspacePath,
avoidOverwrite: options.avoidOverwrite
});
const hash = await hashFileIncrementally(outputPath);
await appendTimelineEvent(workspacePath, markdownRelativePath, "export", `Exported Markdown "${markdownRelativePath}" to ${normalizedFormat.toUpperCase()}`, {
artifactPath: outputPath,
artifactHash: hash
});
return outputPath;
}

const maxRestoredSegmentLineCount = 250000;
function reconstructedSegmentBody(content) {
const normalized = String(content ?? "").replace(/\r\n?/g, "\n");
const metadata = /^(?:\uFEFF)?[ \t]*>\s*Human Markdown segment\s+\d+\s*\/\s*\d+\.?[ \t]*\n[ \t]*>\s*Source line range:\s*(\d+)\s*-\s*(\d+)[ \t]*\n(?:[ \t]*\n)?/i.exec(normalized);
if (!metadata) {
return normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
}
const startLine = Number(metadata[1]);
const endLine = Number(metadata[2]);
const expectedLineCount = endLine - startLine + 1;
let body = normalized.slice(metadata[0].length);
if (body.endsWith("\n")) body = body.slice(0, -1);
const presentLineCount = body ? body.split("\n").length : 0;
const missingTrailingLines = expectedLineCount - presentLineCount;
if (
Number.isSafeInteger(expectedLineCount)
&& expectedLineCount > 0
&& expectedLineCount <= maxRestoredSegmentLineCount
&& missingTrailingLines > 0
) {
body += "\n".repeat(missingTrailingLines);
}
return body;
}

async function readSegmentMarkdownSource(workspacePath, relativePath) {
const requestedPath = path.isAbsolute(relativePath)
? relativePath
: path.join(workspacePath, relativePath);
const safePath = await assertInsideRoot(requestedPath, workspacePath);
return readFile(safePath, "utf8");
}

async function hashFileIncrementally(filePath) {
const hash = createHash("sha256");
for await (const chunk of createReadStream(filePath)) hash.update(chunk);
return hash.digest("hex");
}

/**
 * Server-side merged HTML export for large segmented documents. Segment text is
 * merged through a bounded temporary file and rendered as one Markdown document
 * so CommonMark blocks can safely cross segment boundaries. Image payloads and
 * the final self-contained HTML are streamed by exportMarkdownToHtmlFile instead
 * of being materialized as one image-heavy Buffer/string in memory.
 */
export async function exportSegmentedMarkdownToHtmlDocument(workspacePath, segmentRelativePaths, outputRelativePath, options = {}) {
const segments = Array.isArray(segmentRelativePaths)
? segmentRelativePaths.map((value) => String(value || "").trim()).filter(Boolean)
: [];
if (!segments.length) throw new Error("At least one Markdown segment is required for merged HTML export.");
if (segments.length > 10000) throw new Error("Merged HTML export supports at most 10000 segments.");

let safePath = await prepareSafeWritePath(path.resolve(workspacePath, outputRelativePath), workspacePath, [".html"]);
if (options.avoidOverwrite) {
safePath = await availableOutputPath(safePath);
safePath = await prepareSafeWritePath(safePath, workspacePath, [".html"]);
}

const tempDir = await mkdtemp(path.join(path.dirname(safePath), ".schema-docs-segmented-html-"));
const mergedMarkdownPath = path.join(tempDir, "merged.md");
const streamedHtmlPath = path.join(tempDir, "streamed.html");
let totalSegmentCharacters = 0;
try {
const mergedHandle = await open(mergedMarkdownPath, "w");
let containsPptxSlides = false;
try {
for (const relativePath of segments) {
await checkExportBudget(options);
const content = reconstructedSegmentBody(await readSegmentMarkdownSource(workspacePath, relativePath));
totalSegmentCharacters += content.length;
containsPptxSlides ||= isPptxSlideMarkdown(content);
await mergedHandle.writeFile(`${content}\n`, "utf8");
}
} finally {
await mergedHandle.close();
}

const firstSegmentPath = path.resolve(workspacePath, segments[0]);
const htmlOptions = {
...options,
title: options.title,
baseDir: path.dirname(firstSegmentPath),
assetRoot: workspacePath
};
const mergedMarkdown = await readFile(mergedMarkdownPath, "utf8");
const projectedMarkdown = containsPptxSlides
? projectPptxSlidesForExport(mergedMarkdown)
: mergedMarkdown;
const cleanedMarkdown = cleanMarkdownForExport(projectedMarkdown, { stripProcessMetadata: true });
const streamMetrics = await exportMarkdownToHtmlFile(cleanedMarkdown, streamedHtmlPath, htmlOptions);

// Validate the destination again immediately before publishing the complete
// temporary file, matching the final-write guard used by normal exports.
safePath = await prepareSafeWritePath(safePath, workspacePath, [".html"]);
await checkExportBudget(options);
await rename(streamedHtmlPath, safePath);
const outputStat = await stat(safePath);
const artifactHash = await hashFileIncrementally(safePath);
if (options.recordTimeline !== false) {
await appendTimelineEvent(workspacePath, segments[0], "export", `Exported ${segments.length} Markdown segments to HTML`, {
artifactPath: safePath,
artifactHash
});
}
return {
outputPath: safePath,
format: "html",
segmentCount: segments.length,
sourceCharacters: totalSegmentCharacters,
outputBytes: outputStat.size,
...streamMetrics
};
} finally {
await rm(tempDir, { recursive: true, force: true }).catch(() => {});
}
}

export async function writeRenderedDocument(workspacePath, markdown, outputRelativePath, format, options = {}) {
await checkExportBudget(options);
const normalizedFormat = normalizeDocumentFormat(format);
const outputPath = path.resolve(workspacePath, outputRelativePath);
let safePath = await prepareSafeWritePath(outputPath, workspacePath, [`.${normalizedFormat}`]);
if (options.avoidOverwrite) {
safePath = await availableOutputPath(safePath);
safePath = await prepareSafeWritePath(safePath, workspacePath, [`.${normalizedFormat}`]);
}
const exportMarkdown = projectPptxSlidesForExport(markdown);
if (normalizedFormat === 'html') {
  const scratch = await mkdtemp(path.join(path.dirname(safePath), '.schema-docs-html-'));
  try {
    const temporary = path.join(scratch, 'output.html');
    await exportMarkdownToHtmlFile(cleanMarkdownForExport(exportMarkdown, options), temporary, options);
    await checkExportBudget(options);
    safePath = await prepareSafeWritePath(safePath, workspacePath, ['.html']);
    await rename(temporary, safePath);
    return safePath;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
const portableMarkdown = normalizedFormat === "md"
? await portableMarkdownAssets(exportMarkdown, options.baseDir, options.assetRoot, safePath, workspacePath)
: exportMarkdown;
const renderedBuffer = await renderMarkdown(portableMarkdown, normalizedFormat, options);
await checkExportBudget(options);
// Validate again immediately before the final write to reduce symlink-swap risk.
safePath = await prepareSafeWritePath(safePath, workspacePath, [`.${normalizedFormat}`]);
await writeFile(safePath, renderedBuffer);
return safePath;
}
async function availableOutputPath(filePath) {
const { dir, name, ext } = path.parse(filePath);
let candidate = filePath;
for (let index = 2; ; index++) {
try { await access(candidate); } catch (error) { if (error.code === "ENOENT") return candidate; throw error; }
candidate = path.join(dir, `${name} (${index})${ext}`);
}
}
export async function readMarkdownFile(filePath) {
return readFile(filePath, "utf8");
}
