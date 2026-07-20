import path from "node:path";
import { readFile, writeFile, rm } from "node:fs/promises";
import { assertInsideRoot, prepareSafeWritePath } from "./pathGuard.js";
function fixLegacyPdfNotice(content) {
const text = String(content ?? "");
if (
text.includes("# PDF extraction needs another path")
&& text.includes("Presentation replaced due to low readability")
&& text.includes("\n---\n")
) {
const [notice] = text.split(/\n---\n/);
return notice.trimEnd() + "\n";
}
if (!text.includes("Human-readable Markdown was not generated") || !text.includes("this human reading view is blocked")) {
return text;
}
const [notice] = text.split(/\n---\n\n/);
return notice
.replace(
/^- Schema Docs kept.*this human reading view is blocked.*$/m,
"- PDF/OCR extraction limit; not Markdown failure."
)
.trimEnd() + "\n";
}
function stripDocumentProcessMetadata(content) {
const lines = String(content ?? "").replace(/\r\n?/g, "\n").split("\n");
const out = [];
let skippingProcessQuote = false;
for (const line of lines) {
const trimmed = line.trim();
const isProcessQuote = /^>\s*(Source|Converted by|Extractor|Extraction quality|Human-readable Markdown view\.?|Source format):/i.test(trimmed)
|| /^>\s*Human-readable Markdown view\.?$/i.test(trimmed);
if (isProcessQuote) {
skippingProcessQuote = true;
continue;
}
if (skippingProcessQuote && !trimmed) {
skippingProcessQuote = false;
continue;
}
skippingProcessQuote = false;
out.push(line);
}
return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
function hasHighMojibakeRatio(content) {
const text = String(content ?? "");
const printable = text.replace(/\s/g, "");
if (printable.length < 80) return false;
const replacementCount = (printable.match(/\ufffd/g) || []).length;
const replacementRatio = replacementCount / printable.length;
return replacementCount >= 20 && replacementRatio > 0.04;
}
function lowReadableMarkdownNotice() {
return [
"# Document needs another extraction path",
"",
"> **Status**: This generated reading file contains unreadable replacement characters, so Schema Docs blocked the human reading view instead of showing corrupted text.",
"",
"## What you can do",
"- Refresh extraction after saving the source as UTF-8 text.",
"- If this came from a TXT file, confirm it is real plain text and not a compressed, binary, or ebook/export file.",
"- If this is an older generated readable segment, delete the stale output and re-import or refresh the source.",
"",
"## Warnings",
"- Low-readable generated Markdown was detected while opening this file.",
""
].join("\n");
}
function shouldCleanConvertedMarkdown(workspacePath, safePath) {
const relativePath = path.relative(workspacePath, safePath).split(path.sep).join("/");
return relativePath === "outputs" || relativePath.startsWith("outputs/");
}
export async function saveMarkdown(workspacePath, relativePath, content) {
const isAbs = path.isAbsolute(relativePath);
const outputPath = isAbs ? relativePath : path.join(workspacePath, relativePath);
const safePath = await prepareSafeWritePath(outputPath, workspacePath, [".md"]);
await writeFile(safePath, content, "utf8");
return safePath;
}
export async function readMarkdown(workspacePath, relativePath) {
const isAbs = path.isAbsolute(relativePath);
const targetPath = isAbs ? relativePath : path.join(workspacePath, relativePath);
const safePath = await assertInsideRoot(targetPath, workspacePath);
const content = await readFile(safePath, "utf8");
if (!shouldCleanConvertedMarkdown(workspacePath, safePath)) {
return content;
}
const cleaned = stripDocumentProcessMetadata(fixLegacyPdfNotice(content));
if (hasHighMojibakeRatio(cleaned)) {
return lowReadableMarkdownNotice();
}
return cleaned;
}
export async function deleteMarkdown(workspacePath, relativePath) {
const isAbs = path.isAbsolute(relativePath);
const targetPath = isAbs ? relativePath : path.join(workspacePath, relativePath);
const safePath = await assertInsideRoot(targetPath, workspacePath);
await rm(safePath, { force: true });
return { ok: true, deletedPath: relativePath };
}
