import { readFile } from "node:fs/promises";
import path from "node:path";
function decodeWithEncoding(buffer, encoding) {
try {
return new TextDecoder(encoding).decode(buffer);
} catch {
return "";
}
}
function swapUtf16Bytes(buffer) {
const swapped = Buffer.from(buffer);
for (let index = 0; index + 1 < swapped.length; index += 2) {
const first = swapped[index];
swapped[index] = swapped[index + 1];
swapped[index + 1] = first;
}
return swapped;
}
function textQualityScore(text) {
const value = String(text ?? "");
if (!value) return Number.NEGATIVE_INFINITY;
const length = value.length;
const replacementCount = (value.match(/\ufffd/g) || []).length;
const controlCount = (value.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g) || []).length;
const commonTextCount = (value.match(/[A-Za-z0-9\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\s.,;:!?'"()[\]{}\-_/\\]/g) || []).length;
const replacementRatio = replacementCount / length;
const controlRatio = controlCount / length;
const commonRatio = commonTextCount / length;
return commonRatio - replacementRatio * 5 - controlRatio * 4;
}
function looksBinary(bytes) {
if (!bytes.length) return false;
const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
let zeroCount = 0;
let controlCount = 0;
for (const byte of sample) {
if (byte === 0) zeroCount += 1;
if ((byte < 9 || (byte > 13 && byte < 32)) && byte !== 0) controlCount += 1;
}
return zeroCount / sample.length > 0.15 || controlCount / sample.length > 0.12;
}
export function decodeTextBuffer(buffer) {
const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
const binaryLike = looksBinary(bytes);
if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
return { text: decodeWithEncoding(bytes.subarray(3), "utf-8"), encoding: "utf-8-bom", confidence: binaryLike ? "low" : "high", binaryLike };
}
if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
return { text: decodeWithEncoding(bytes.subarray(2), "utf-16le"), encoding: "utf-16le-bom", confidence: "high", binaryLike: false };
}
if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
return { text: decodeWithEncoding(swapUtf16Bytes(bytes.subarray(2)), "utf-16le"), encoding: "utf-16be-bom", confidence: "high", binaryLike: false };
}
const evenNulls = bytes.filter((byte, index) => index % 2 === 0 && byte === 0).length;
const oddNulls = bytes.filter((byte, index) => index % 2 === 1 && byte === 0).length;
const likelyUtf16Be = evenNulls > Math.max(2, bytes.length / 8);
const likelyUtf16Le = oddNulls > Math.max(2, bytes.length / 8);
const candidates = [
{ encoding: "utf-8", text: decodeWithEncoding(bytes, "utf-8") },
{ encoding: "gb18030", text: decodeWithEncoding(bytes, "gb18030") },
{ encoding: "gbk", text: decodeWithEncoding(bytes, "gbk") },
{ encoding: "utf-16le", text: decodeWithEncoding(bytes, "utf-16le") },
{ encoding: "utf-16be", text: decodeWithEncoding(swapUtf16Bytes(bytes), "utf-16le") }
].map((candidate) => ({
...candidate,
score: textQualityScore(candidate.text)
}));
if (likelyUtf16Le) {
candidates.find((candidate) => candidate.encoding === "utf-16le").score += 2;
}
if (likelyUtf16Be) {
candidates.find((candidate) => candidate.encoding === "utf-16be").score += 2;
}
candidates.sort((a, b) => b.score - a.score);
const best = candidates[0] || { encoding: "utf-8", text: "" };
const replacementRatio = best.text ? (best.text.match(/\ufffd/g) || []).length / best.text.length : 1;
const confidence = binaryLike || replacementRatio > 0.02 || best.score < 0.55 ? "low" : best.score < 0.75 ? "medium" : "high";
return { text: best.text, encoding: best.encoding, confidence, binaryLike };
}
export function textToMarkdown(content, sourceName = "source.txt") {
const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
const title = path.parse(sourceName).name || "Untitled";
if (!normalized) return `# ${title}\n\n<!-- conversion-note: source file was empty -->\n`;
return [
`# ${title}`,
"",
normalized,
""
].join("\n");
}
export const textMarkdownConverter = {
name: "text-markdown-converter",
canHandle(file) {
return [".txt", ".md"].includes(path.extname(file.sourcePath ?? file).toLowerCase());
},
async convert(input) {
const buffer = await readFile(input.sourcePath);
const decoded = decodeTextBuffer(buffer);
const warnings = [];
if (decoded.confidence === "low") {
warnings.push(`Low-confidence text decoding (${decoded.encoding}). Verify the TXT file encoding before using this content.`);
}
if (decoded.binaryLike) {
warnings.push("The TXT file looks binary or compressed, not plain text. Convert it to a real text file before importing.");
}
return {
markdown: textToMarkdown(decoded.text, path.basename(input.sourcePath)),
warnings,
extractionQuality: {
textLayerDetected: true,
scannedLikely: false,
tableSimplified: false,
layoutSimplified: false,
possibleMojibake: decoded.confidence === "low",
lowReadableText: decoded.confidence === "low",
unsupportedFeatures: [],
confidence: decoded.confidence,
detectedEncoding: decoded.encoding,
binaryLike: decoded.binaryLike
}
};
}
};
