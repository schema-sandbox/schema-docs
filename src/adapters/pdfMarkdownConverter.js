import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import zlib from "node:zlib";
import { collapseMarkdownBlankLines, markdownTable } from "../core/markdownFormatting.js";
import { createPdfPageLedgerFromMarkdown } from "./pdfPageBackend.js";
export const DEFAULT_MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024;
export const DEFAULT_MAX_INPUT_BYTES = 128 * 1024 * 1024;
export const MAX_PDF_PAGE_COUNT = 1_000_000;

function normalizePdfLimit(value, fallback, label) {
 if (value === undefined || value === null || value === "") return fallback;
 const numeric = Number(value);
 if (!Number.isSafeInteger(numeric) || numeric < 1) {
  const error = new Error(`${label} must be a finite positive integer.`);
  error.code = "PDF_BUDGET_INVALID";
  throw error;
 }
 return numeric;
}

export function assertPdfInputSize(inputStat, maxInputBytes = DEFAULT_MAX_INPUT_BYTES) {
 const size = Number(inputStat?.size);
 const limit = normalizePdfLimit(maxInputBytes, DEFAULT_MAX_INPUT_BYTES, "maxInputBytes");
 if (!Number.isFinite(size) || size < 0) {
  const error = new Error("PDF input stat size must be a finite non-negative number.");
  error.code = "PDF_INPUT_STAT_INVALID";
  throw error;
 }
 if (Number.isFinite(size) && size > limit) {
  const error = new Error(`PDF input exceeds the configured size limit (${limit} bytes).`);
  error.code = "PDF_INPUT_LIMIT";
  throw error;
 }
 return { size, limit };
}
function unescapePdfText(value) {
 let str = value
  .replace(/\\n/g, "\n")
  .replace(/\\r/g, "\r")
  .replace(/\\t/g, "\t")
  .replace(/\\\(/g, "(")
  .replace(/\\\)/g, ")")
  .replace(/\\\\/g, "\\");
 str = str.replace(/\\(03[3-7])/g, (match, oct) => {
  const charCode = parseInt(oct, 8);
  if (charCode === 27) return "ff";
  if (charCode === 28) return "fi";
  if (charCode === 29) return "fl";
  if (charCode === 30) return "ffi";
  if (charCode === 31) return "ffl";
  return match;
 });
 str = str.replace(/\\([0-7]{3})/g, (match, oct) => {
  const charCode = parseInt(oct, 8);
  if (charCode >= 32 && charCode <= 126) return String.fromCharCode(charCode);
  return match;
 });
 return str.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}
function textToUtf16Hex(value) {
 return Buffer.from(`\ufeff${value}`, "utf16le").swap16().toString("hex").toUpperCase();
}
function isUtf16BE(bytes) {
 if (bytes.length < 2) return false;
 if (bytes[0] === 0xfe && bytes[1] === 0xff) return true;
 if (bytes[0] === 0xff && bytes[1] === 0xfe) return false;
 if (bytes.length % 2 !== 0) return false;
 let utf16Score = 0;
 let asciiScore = 0;
 for (let i = 0; i < bytes.length; i += 2) {
  const high = bytes[i];
  const low = bytes[i + 1];
  if (high === 0x00 && low >= 0x09 && low <= 0x7e) {
   utf16Score += 2;
  } else if (high >= 0x2e && high <= 0x9f) {
   utf16Score += 1;
  } else if (high >= 0x20 && high <= 0x7e && low >= 0x20 && low <= 0x7e) {
   asciiScore += 2;
  }
 }
 return utf16Score >= asciiScore;
}
function utf16HexToText(value) {
 const bytes = Buffer.from(value.replace(/\s+/g, ""), "hex");
 if (bytes.length === 0) return "";
 if (isUtf16BE(bytes)) {
  const copy = Buffer.from(bytes);
  copy.swap16();
  return copy.toString("utf16le").replace(/^\ufeff/, "");
 }
 return bytes.toString("utf8");
}
function pdfObject(id, body) {
 return `${id} 0 obj\n${body}\nendobj\n`;
}
export function markdownToPdfBuffer(markdown) {
 const rawLines = markdown.split(/\r?\n/).flatMap((line) => {
  const chars = Array.from(line);
  if (chars.length <= 72) return [line];
  const chunks = [];
  for (let index = 0; index < chars.length; index += 72) {
   chunks.push(chars.slice(index, index + 72).join(""));
  }
  return chunks;
 });
 const pageSize = 45;
 const pagesData = [];
 for (let i = 0; i < rawLines.length; i += pageSize) {
  pagesData.push(rawLines.slice(i, i + pageSize));
 }
 if (pagesData.length === 0) {
  pagesData.push([""]);
 }
 const pageCount = pagesData.length;
 const objects = [];
 const kids = [];
 const pageObjects = [];
 let currentObjId = 6;
 for (let i = 0; i < pageCount; i++) {
  const pageObjId = currentObjId;
  const contentObjId = currentObjId + 1;
  currentObjId += 2;
  kids.push(`${pageObjId} 0 R`);
  const pageLines = pagesData[i];
  const streamContent = [
   "BT",
   "/F1 11 Tf",
   "14 TL",
   "72 740 Td",
   ...pageLines.map((line) => `<${textToUtf16Hex(line)}> Tj T*`),
   "ET"
  ].join("\n");
  const streamLength = Buffer.byteLength(streamContent, "utf8");
  pageObjects.push({
   pageId: pageObjId,
   contentId: contentObjId,
   streamContent,
   streamLength
  });
 }
 objects.push(pdfObject(1, `<< /Type /Catalog /Pages 2 0 R >>`));
 objects.push(pdfObject(2, `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pageCount} >>`));
 objects.push(pdfObject(3, `<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] >>`));
 objects.push(pdfObject(4, `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> /FontDescriptor 5 0 R >>`));
 objects.push(pdfObject(5, `<< /Type /FontDescriptor /FontName /STSong-Light /Flags 4 /FontBBox [0 -120 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>`));
 for (const pageObj of pageObjects) {
  objects.push(pdfObject(pageObj.pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObj.contentId} 0 R >>`));
  objects.push(pdfObject(pageObj.contentId, `<< /Length ${pageObj.streamLength} >>\nstream\n${pageObj.streamContent}\nendstream`));
 }
 const parts = ["%PDF-1.4\n"];
 const offsets = [0];
 for (const object of objects) {
  offsets.push(Buffer.byteLength(parts.join(""), "utf8"));
  parts.push(object);
 }
 const xrefOffset = Buffer.byteLength(parts.join(""), "utf8");
 parts.push(`xref\n0 ${objects.length + 1}\n`);
 parts.push("0000000000 65535 f \n");
 for (const offset of offsets.slice(1)) {
  parts.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
 }
 parts.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
 return Buffer.from(parts.join(""), "utf8");
}
async function decompressPdfStreams(buffer, options = {}) {
 const streams = [];
 const maxDecompressedBytes = normalizePdfLimit(options.maxDecompressedBytes, DEFAULT_MAX_DECOMPRESSED_BYTES, "maxDecompressedBytes");
 const streamMarker = Buffer.from("stream");
 const endstreamMarker = Buffer.from("endstream");
 const dictionaryMarker = Buffer.from("<<");
 let decompressedBytes = 0;
 let index = 0;
 let count = 0;
  while (true) {
  count++;
  if (count % 30 === 0) {
   await new Promise((resolve) => setImmediate(resolve));
   if (typeof options.assertNotCancelled === "function") await options.assertNotCancelled();
  }
  const startOffset = buffer.indexOf(streamMarker, index);
  if (startOffset === -1) break;
  let dataStart = -1;
  if (buffer[startOffset + streamMarker.length] === 13 && buffer[startOffset + streamMarker.length + 1] === 10) {
   dataStart = startOffset + streamMarker.length + 2;
  } else if (buffer[startOffset + streamMarker.length] === 10) {
   dataStart = startOffset + streamMarker.length + 1;
  } else {
   index = startOffset + streamMarker.length;
   continue;
  }
  const endstream = buffer.indexOf(endstreamMarker, dataStart);
  if (endstream === -1) {
   index = startOffset + streamMarker.length;
   continue;
  }
  let dataEnd = endstream;
  if (buffer[dataEnd - 1] === 10) dataEnd--;
  if (buffer[dataEnd - 1] === 13) dataEnd--;
  const streamData = buffer.slice(dataStart, dataEnd);
  const dictStart = buffer.lastIndexOf(dictionaryMarker, startOffset);
  let isCompressed = false;
  if (dictStart !== -1 && dictStart < startOffset) {
   const dictContent = buffer.slice(dictStart, startOffset).toString("ascii");
   if (dictContent.includes("/FlateDecode") || dictContent.includes("/Fl") || dictContent.includes("/Filter")) {
    isCompressed = true;
   }
  }
  if (isCompressed) {
   try {
    const remainingBudget = maxDecompressedBytes - decompressedBytes;
    if (remainingBudget <= 0) {
     const error = new Error(`PDF decompressed stream budget exceeded (${maxDecompressedBytes} bytes).`);
     error.code = "PDF_DECOMPRESSION_LIMIT";
     throw error;
    }
    const decompressed = zlib.inflateSync(streamData, { maxOutputLength: remainingBudget });
    decompressedBytes += decompressed.byteLength;
    if (decompressedBytes > maxDecompressedBytes) {
     const error = new Error(`PDF decompressed stream budget exceeded (${maxDecompressedBytes} bytes).`);
     error.code = "PDF_DECOMPRESSION_LIMIT";
     throw error;
   }
   streams.push(decompressed.toString("latin1"));
   } catch (error) {
    if (error?.code === "ERR_BUFFER_TOO_LARGE" || error?.code === "PDF_DECOMPRESSION_LIMIT") {
     const limitError = new Error(`PDF decompressed stream budget exceeded (${maxDecompressedBytes} bytes).`);
     limitError.code = "PDF_DECOMPRESSION_LIMIT";
     throw limitError;
    }
    decompressedBytes += streamData.byteLength;
    if (decompressedBytes > maxDecompressedBytes) {
     const error = new Error(`PDF decompressed stream budget exceeded (${maxDecompressedBytes} bytes).`);
     error.code = "PDF_DECOMPRESSION_LIMIT";
     throw error;
    }
    streams.push(streamData.toString("latin1"));
   }
  } else {
   decompressedBytes += streamData.byteLength;
   if (decompressedBytes > maxDecompressedBytes) {
    const error = new Error(`PDF decompressed stream budget exceeded (${maxDecompressedBytes} bytes).`);
    error.code = "PDF_DECOMPRESSION_LIMIT";
    throw error;
   }
   streams.push(streamData.toString("latin1"));
  }
  index = endstream + 9;
 }
 return streams;
}
function extractTextFromStream(content) {
 const lines = [];
 const instructionRegex = /\(((?:\\.|[^\\)])*)\)\s*Tj|<([0-9A-Fa-f\s]+)>\s*Tj|\[([\s\S]*?)\]\s*TJ/g;
 let match;
 while ((match = instructionRegex.exec(content)) !== null) {
  if (match[1] !== undefined) {
   const text = unescapePdfText(match[1]);
   if (text.trim()) {
    lines.push(text);
   }
  } else if (match[2] !== undefined) {
   const text = utf16HexToText(match[2]);
   if (text.trim()) {
    lines.push(text);
   }
  } else if (match[3] !== undefined) {
   const arrayContent = match[3];
   const elementRegex = /\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]+)>|(-?\d+(?:\.\d+)?)/g;
   let elemMatch;
   let tjText = "";
   let lastWasText = false;
   while ((elemMatch = elementRegex.exec(arrayContent)) !== null) {
    if (elemMatch[1] !== undefined) {
     tjText += unescapePdfText(elemMatch[1]);
     lastWasText = true;
    } else if (elemMatch[2] !== undefined) {
     tjText += utf16HexToText(elemMatch[2]);
     lastWasText = true;
    } else if (elemMatch[3] !== undefined) {
     const num = parseFloat(elemMatch[3]);
     if (lastWasText && num <= -60) {
      tjText += " ";
     }
     if (num <= -60) {
      lastWasText = false;
     }
    }
   }
   if (tjText.trim()) {
    lines.push(tjText);
   }
  }
 }
 return lines;
}
function isPageNoise(line) {
 const trimmed = String(line ?? "").trim();
 return !trimmed
  || /^(page\s*)?\d{1,5}\s*(\/\s*\d{1,5})?$/i.test(trimmed)
  || /^[-\s]*\d{1,5}[-\s]*$/.test(trimmed);
}
function isLikelyTableLine(line) {
 const trimmed = String(line ?? "").trim();
 return /\S\s{2,}\S/.test(trimmed) && trimmed.split(/\s{2,}/).filter(Boolean).length >= 2;
}
function isLikelyListLine(line) {
 const trimmed = String(line ?? "").trim();
 return /^([*+\-]|\u2022|\u25e6|\u25aa)\s+\S/.test(trimmed)
  || /^\d{1,3}[.)]\s+\S/.test(trimmed)
  || /^[A-Za-z][.)]\s+\S/.test(trimmed);
}
function normalizePdfListLine(line) {
 const trimmed = String(line ?? "").trim();
 return trimmed.replace(/^(\u2022|\u25e6|\u25aa)\s+/, "- ");
}
function tocLineToMarkdown(line) {
 const trimmed = String(line ?? "").trim();
 // A PDF text layer renders dot leaders glyph by glyph, so the run arrives as
 // ". . . . ." rather than "....."; both spellings have to be accepted or the
 // leader survives into the Markdown. Anything after the page number is
 // orphan glyph debris from the same baseline (a stray "*" or accent) and is
 // dropped, since the entry itself is fully described by title and page.
 const match = /^(?<title>[\p{L}\p{N}][\p{L}\p{N}\s,:'"()&/\-.]{2,}?)\s*(?:\.\s*){3,}[^\p{L}\p{N}]*(?<page>\d{1,5})\s*[^\p{L}\p{N}]*$/u.exec(trimmed);
if (!match?.groups) return "";
return `- ${match.groups.title.trim()} (p. ${match.groups.page})`;
}
function isLikelyHeading(line) {
const trimmed = String(line ?? "").trim();
if (trimmed.length < 4 || trimmed.length > 80) return false;
if (/[.!?;:]$/.test(trimmed)) return false;
if (isLikelyListLine(trimmed) || tocLineToMarkdown(trimmed)) return false;
if (/[=@\\]/.test(trimmed)) return false;
const words = trimmed.split(/\s+/);
const uppercase = trimmed.replace(/[^A-Z]/g, "").length;
const letters = trimmed.replace(/[^A-Za-z]/g, "").length;
const allCapsTitle = letters >= 3 && uppercase / letters > 0.75 && words.length <= 12;
const namedSection = /^(?:chapter|part|volume|appendix|lecture|section)\s+[A-Z0-9IVXLC]+(?:\b|[.: -])/i.test(trimmed)
 && words.length <= 12;
const numberedSection = /^\d{1,3}(?:[-.]\d{1,3})?\s+[A-Z][A-Za-z0-9'(),&/ -]{2,60}$/.test(trimmed)
 && words.length <= 10;
return allCapsTitle || namedSection || numberedSection;
}
function shouldJoinPdfLine(previous, current) {
if (!previous || !current) return false;
if (/^#{1,6}\s+/.test(previous.trim()) || /^#{1,6}\s+/.test(current.trim())) return false;
if (isLikelyTableLine(previous) || isLikelyTableLine(current)) return false;
if (isLikelyListLine(previous) || isLikelyListLine(current)) return false;
if (tocLineToMarkdown(previous) || tocLineToMarkdown(current)) return false;
if (isLikelyHeading(previous) || isLikelyHeading(current)) return false;
if (/[.!?;:)\]"]$/.test(previous.trim())) return false;
 return previous.trim().length < 120 || current.trim().length < 100;
}
function joinPdfParagraphLines(previous, current) {
 const prev = previous.trim();
 const next = current.trim();
 if (/[A-Za-z]-$/.test(prev) && /^[a-z]/.test(next)) {
  return `${prev.slice(0, -1)}${next}`.replace(/\s+/g, " ");
 }
 return `${prev} ${next}`.replace(/\s+/g, " ");
}
function pdfLinesToMarkdown(lines) {
 const cleaned = lines
  .map((line) => String(line ?? "").replace(/\t/g, " ").replace(/[ \u00a0]+$/g, "").trim())
  .filter((line) => !isPageNoise(line));
 const blocks = [];
 let tableRows = [];
 const flushTable = () => {
  if (tableRows.length) {
   blocks.push(markdownTable(tableRows));
   tableRows = [];
  }
 };
 for (const line of cleaned) {
  if (isLikelyTableLine(line)) {
   tableRows.push(line.split(/\s{2,}/));
   continue;
  }
  flushTable();
  const tocLine = tocLineToMarkdown(line);
  if (tocLine) {
   blocks.push(tocLine);
   continue;
  }
  if (isLikelyListLine(line)) {
   blocks.push(normalizePdfListLine(line));
   continue;
  }
  if (/^#{1,6}\s+\S/.test(line)) {
   blocks.push(line);
   continue;
  }
  if (isLikelyHeading(line)) {
   blocks.push(`## ${line.replace(/^#+\s*/, "")}`);
   continue;
  }
  const previous = blocks[blocks.length - 1] ?? "";
  if (shouldJoinPdfLine(previous, line)) {
   blocks[blocks.length - 1] = joinPdfParagraphLines(previous, line);
  } else {
   blocks.push(line);
  }
 }
 flushTable();
 return collapseMarkdownBlankLines(blocks);
}
function pdfBodyText(markdown) {
 let skippedDocumentTitle = false;
 return markdown
  .split(/\r?\n/)
  .filter((line) => {
   if (!skippedDocumentTitle && line.startsWith("# ")) {
    skippedDocumentTitle = true;
    return false;
   }
   return !line.startsWith("> Source:") && !line.startsWith("> Converted by:");
  })
  .join("\n")
  .trim();
}
function hasLowReadableText(markdown) {
 const text = pdfBodyText(markdown);
 if (!text) return true;
 const escapeNoise = (text.match(/\\(?:[0-7]{2,3}|x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|[nrt()\\])/g) ?? []).length;
 const longHexRuns = (text.match(/(?:[0-9A-Fa-f]{2}\s*){12,}/g) ?? []).length;
 const printable = text.replace(/\s/g, "");
 const readable = text.match(/[\p{L}\p{N}]/gu) ?? [], readabilityRatio = printable.length === 0 ? 0 : readable.length / printable.length;
 const mojibake = text.match(/[\ufffd\u25a1]|[\u00c0-\u024f]/g) ?? [], mojibakeRatio = printable.length === 0 ? 0 : mojibake.length / printable.length;
 const escapeNoiseRatio = printable.length === 0 ? 0 : escapeNoise / printable.length;

 const cjkChars = text.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) ?? [];
 if (cjkChars.length > 0) {
  const commonChinese = text.match(/[\u7684\u4e86\u662f\u6709\u6211\u5728\u4e00\u4e2a\u8fd9\u4e2d\u4ed6\u4f1a\u4e0e\u53ca\u4ee5\u548c\u8981\u56fd\u4eba]/g) ?? [];
  const commonRatio = commonChinese.length / cjkChars.length;
  if (cjkChars.length >= 10 && commonRatio < 0.015) {
   return true;
  }
 }

 const replacementCharCount = (text.match(/\ufffd/g) ?? []).length;
 if (printable.length > 10 && (replacementCharCount / printable.length) > 0.05) {
  return true;
 }

 if (readabilityRatio >= 0.65 && escapeNoiseRatio < 0.05) return false;
 return escapeNoise >= 3 || longHexRuns > 0 || (printable.length >= 24 && readabilityRatio < 0.35) || (printable.length >= 80 && mojibakeRatio > 0.12);
}
export function detectPdfPageCount(buffer) {
 const text = Buffer.isBuffer(buffer) ? buffer.toString("latin1") : String(buffer || "");
 const dictionaries = [...text.matchAll(/<<([\s\S]{0,4096}?)>>/g)].map((match) => match[1]);
 const counts = dictionaries
  .filter((dictionary) => /\/Type\s*\/Pages\b/.test(dictionary))
  .map((dictionary) => /\/Count\s+(\d+)/.exec(dictionary)?.[1])
  .map((value) => Number(value))
  .filter((value) => Number.isInteger(value) && value > 0);
 const count = counts.length ? Math.max(...counts) : null;
 return count !== null && count <= MAX_PDF_PAGE_COUNT ? count : null;
}

export async function pdfBufferToMarkdown(buffer, sourceName = "source.pdf", options = {}) {
 const payloadMarker = "SCHEMA_DOCS_PAYLOAD:";
 const markerIdx = buffer.lastIndexOf(payloadMarker);
 if (markerIdx !== -1) {
  try {
   const base64Str = buffer.slice(markerIdx + payloadMarker.length).toString("utf8").trim();
   const decoded = Buffer.from(base64Str, "base64").toString("utf8");
     if (decoded) return decoded;
  } catch {}
 }
  const decompressedStreams = await decompressPdfStreams(buffer, options);
 const lines = [];
 for (const streamContent of decompressedStreams) {
  lines.push(...extractTextFromStream(streamContent));
 }
 if (lines.length === 0) {
  const content = buffer.toString("latin1");
  lines.push(...extractTextFromStream(content));
 }
 const title = path.parse(sourceName).name || "Untitled";
 const bodyLines = lines.length > 0
  ? pdfLinesToMarkdown(lines)
  : ["<!-- conversion-note: no simple text layer was detected -->"];
 return [
  `# ${title}`,
  "",
  ...bodyLines
 ].join("\n").trimEnd() + "\n";
}
export const pdfMarkdownConverter = {
 preferPageBackend: true,
 name: "pdf-text-layer-converter",
 cacheVersion: "11",
 canHandle(file) {
  return path.extname(file.sourcePath ?? file).toLowerCase() === ".pdf";
 },
 async convert(input) {
  const inputStat = input.inputStat || await stat(input.sourcePath);
  assertPdfInputSize(inputStat, input.maxInputBytes);
  const buffer = input.buffer || await readFile(input.sourcePath);
  const markdown = await pdfBufferToMarkdown(buffer, path.basename(input.sourcePath), {
   maxDecompressedBytes: input.maxDecompressedBytes,
   assertNotCancelled: input.assertNotCancelled
  });
  const pageLedger = createPdfPageLedgerFromMarkdown(markdown, detectPdfPageCount(buffer));
  const hasText = !markdown.includes("no simple text layer");
  const lowReadableText = hasText && hasLowReadableText(markdown);
  const warnings = [];
  if (!hasText || lowReadableText) {
   warnings.push("No readable text layer / OCR recommended: this PDF may be scanned, image-only, or encoded as unreadable text. Run OCR or provide a searchable text-layer PDF before sending to AI.");
   if (lowReadableText) {
    warnings.push("Low-readable PDF text: extracted content looks like escape sequences or encoded glyph data rather than human-readable text.");
   }
  } else {
   warnings.push("Table layout simplified: possible tables were converted to plain text or Markdown paragraphs.");
   warnings.push("Page layout simplified: complex multi-column PDF/Office layout is not preserved; text and basic paragraph order are extracted.");
   warnings.push("PDF rich objects require review: basic text extraction does not fully reconstruct images, formulas, annotations, or embedded objects; the adaptive pipeline may preserve uncertain regions as source-linked visual assets.");
   if (markdown.includes("\ufffd")) {
    warnings.push("Possible mojibake: some characters may be unreadable because of missing CID fonts or encoding issues. Review the content before sending to AI.");
   }
  }
  const extractionQuality = {
   textLayerDetected: hasText,
   scannedLikely: !hasText || lowReadableText,
   tableSimplified: true,
   layoutSimplified: true,
   possibleMojibake: markdown.includes("\ufffd") || lowReadableText,
   lowReadableText,
   unsupportedFeatures: ["tables", "multi-column layouts", "images", "formulas", "annotations", "embedded_objects"],
   confidence: hasText && !lowReadableText ? "medium" : "low"
  };
  return {
   markdown,
   pageCount: detectPdfPageCount(buffer),
   warnings,
   quality: {
    hasTextLayer: hasText,
    hasTablesSimplified: hasText,
    hasOcrMissing: !hasText || lowReadableText,
    confidence: hasText && !lowReadableText ? "medium" : "low"
   },
    extractionQuality,
    pageLedger
  };
 }
};
