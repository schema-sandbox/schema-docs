import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readMarkdown } from "./markdown.js";
import { assertSafeWritePath } from "./pathGuard.js";
import { normalizeDocumentFormat } from "./documentExchangeMatrix.js";
import { appendTimelineEvent } from "./timeline.js";
import { exportMarkdownToDocx, exportMarkdownToPdf, exportMarkdownToHtml, readSafeMarkdownImageAsset } from "./markdownExportPipeline.js";
import { projectPptxSlidesForExport } from "./pptxMarkdownProjection.js";
import { markdownToDocxBuffer as legacyMarkdownToDocxBuffer } from "../adapters/markdownDocxExporter.js";
function cleanMarkdownForExport(markdown, options = {}) {
if (options.stripProcessMetadata === false) return String(markdown || "").trim();
return String(markdown || "")
.replace(/^>\s*(Source|Converted by|Extractor|Extraction quality|Source format):[^\n]*\r?\n?/gim, "")
.replace(/^>\s*Human-readable Markdown view\.?\s*\r?\n?/gim, "")
.trim();
}
async function renderMarkdown(markdown, format, options = {}) {
const cleaned = cleanMarkdownForExport(markdown, options);
if (format === "md") return Buffer.from(cleaned, "utf8");
if (format === "docx") {
try {
return await exportMarkdownToDocx(cleaned, options);
} catch (err) {
return legacyMarkdownToDocxBuffer(cleaned);
}
}
if (format === "pdf") {
return await exportMarkdownToPdf(cleaned, options);
}
if (format === "html") return Buffer.from(await exportMarkdownToHtml(cleaned, options), "utf8");
throw new Error(`Unhandled normalized document format: ${format}`);
}
async function portableMarkdownAssets(markdown, sourceBaseDir, assetRoot, outputPath) {
if (!sourceBaseDir) return markdown;
const assetFolderName = `${path.parse(outputPath).name}.assets`;
const assetFolder = path.join(path.dirname(outputPath), assetFolderName);
const replacements = [];
const imagePattern = /(!\[[^\]]*\]\()(?:<([^>\n]+)>|([^\s)\n]+))(\))/g;
for (const match of String(markdown || "").matchAll(imagePattern)) {
const target = String(match[2] || match[3] || "").trim();
const asset = await readSafeMarkdownImageAsset(target, sourceBaseDir, assetRoot || sourceBaseDir);
if (!asset) continue;
await mkdir(assetFolder, { recursive: true });
const fileName = path.basename(asset.filePath);
await writeFile(path.join(assetFolder, fileName), asset.data);
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
export async function exportMarkdownDocument(workspacePath, markdownRelativePath, outputRelativePath, format) {
const normalizedFormat = normalizeDocumentFormat(format);
const markdown = await readMarkdown(workspacePath, markdownRelativePath);
const outputPath = await writeRenderedDocument(workspacePath, markdown, outputRelativePath, normalizedFormat, {
stripProcessMetadata: shouldStripProcessMetadataForPath(markdownRelativePath),
baseDir: path.dirname(path.resolve(workspacePath, markdownRelativePath)),
assetRoot: workspacePath
});
const buffer = await readFile(outputPath);
const hash = createHash("sha256").update(buffer).digest("hex");
await appendTimelineEvent(workspacePath, markdownRelativePath, "export", `Exported Markdown "${markdownRelativePath}" to ${normalizedFormat.toUpperCase()}`, {
artifactPath: outputPath,
artifactHash: hash
});
return outputPath;
}
export async function writeRenderedDocument(workspacePath, markdown, outputRelativePath, format, options = {}) {
const normalizedFormat = normalizeDocumentFormat(format);
const isAbs = path.isAbsolute(outputRelativePath);
const outputPath = isAbs ? outputRelativePath : path.resolve(workspacePath, outputRelativePath);
await mkdir(path.dirname(outputPath), { recursive: true });
let safePath = outputPath;
if (!isAbs) {
safePath = await assertSafeWritePath(outputPath, workspacePath, [`.${normalizedFormat}`]);
}
const exportMarkdown = projectPptxSlidesForExport(markdown);
const portableMarkdown = normalizedFormat === "md"
? await portableMarkdownAssets(exportMarkdown, options.baseDir, options.assetRoot, safePath)
: exportMarkdown;
const renderedBuffer = await renderMarkdown(portableMarkdown, normalizedFormat, options);
await writeFile(safePath, renderedBuffer);
return safePath;
}
export async function readMarkdownFile(filePath) {
return readFile(filePath, "utf8");
}
