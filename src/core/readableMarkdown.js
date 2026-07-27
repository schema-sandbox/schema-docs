const metadataLinePattern = /^>\s*(Source|Converted by|Extractor|Extraction quality|Source format|Human-readable Markdown view\.?):\s*/i;
function isProcessMetadataLine(line) {
  const trimmed = String(line || "").trim();
  return metadataLinePattern.test(trimmed)
    || /^>\s*Human-readable Markdown view\.?$/i.test(trimmed);
}
function stripProcessMetadataLines(lines) {
  return lines.filter((line) => !isProcessMetadataLine(line));
}
const defaultReadableSegmentCharacterLimit = 120000;
function normalizeLineEndings(markdown) {
return String(markdown ?? "").replace(/\r\n?/g, "\n");
}
function isHeading(line) {
 const match = line.match(/^#{1,6}\s+(.+)$/);
 if (!match) return false;
 const content = match[1].trim();
 const replacementCharCount = (content.match(/\ufffd/g) ?? []).length;
 if (replacementCharCount > 1) return false;
 const cjkChars = content.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) ?? [];
 if (cjkChars.length > 0) {
  const commonChinese = content.match(/[\u7684\u4e86\u662f\u6709\u6211\u5728\u4e00\u4e2a\u8fd9\u4e2d\u4ed6\u4f1a\u4e0e\u53ca\u4ee5\u548c\u8981\u56fd\u4eba]/g) ?? [];
  if (cjkChars.length >= 4 && commonChinese.length === 0 && /[\ufffd\u25a1]|[\u00c0-\u024f]/g.test(content)) {
   return false;
  }
 }
 return true;
}
function isStructuralLine(line) {
const trimmed = line.trim();
return !trimmed
|| isHeading(trimmed)
|| /^<!--[^>]*-->$/.test(trimmed)
|| /^!\[[^\]]*\]\(.+\)$/.test(trimmed)
|| /^\$\$/.test(trimmed)
|| /^\*\*[^*].*\*\*$/.test(trimmed)
|| /^[-*+]\s+/.test(trimmed)
|| /^\d+[.)]\s+/.test(trimmed)
|| /^>\s*/.test(trimmed)
|| /^\|.*\|$/.test(trimmed)
|| /^-{3,}$/.test(trimmed)
|| /^```/.test(trimmed);
}
function isLikelyPageNoise(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return /^(page\s*)?\d{1,5}\s*(\/\s*\d{1,5})?$/i.test(trimmed)
    || /^[-\u2013\u2014]\s*\d{1,5}\s*[-\u2013\u2014]$/.test(trimmed);
}
function repeatNoiseKey(line) {
  const trimmed = line.trim();
  if (
    trimmed.length < 4
    || trimmed.length > 90
    || isHeading(trimmed)
    || metadataLinePattern.test(trimmed)
    || /^!\[[^\]]*\]\(.+\)$/.test(trimmed)
    || /^[-*+]\s+/.test(trimmed)
    || /^\d+[.)]\s+/.test(trimmed)
    || /^\|.*\|$/.test(trimmed)
  ) {
    return "";
  }
  return trimmed
    .toLowerCase()
    .replace(/\bpage\s+\d{1,5}\s*(of|\/)\s*\d{1,5}\b/g, "page #")
    .replace(/\bpage\s+\d{1,5}\b/g, "page #")
    .replace(/\b\d{1,5}\s*(of|\/)\s*\d{1,5}\b/g, "#")
    .replace(/\b\d{1,5}\b/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}
function removeRepeatedShortLines(lines) {
  const counts = new Map();
  for (const line of lines) {
    const key = repeatNoiseKey(line);
    if (key) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.max(4, Math.floor(lines.length / 90));
  return lines.filter((line) => {
    const key = repeatNoiseKey(line);
    return !key || (counts.get(key) ?? 0) < threshold;
  });
}
function isSetextUnderline(line) {
  const trimmed = line.trim();
  return /^={3,}$/.test(trimmed) || /^-{3,}$/.test(trimmed);
}
function canPromoteSetextHeading(line) {
  const trimmed = line.trim();
  return trimmed
    && trimmed.length <= 90
    && !isStructuralLine(trimmed)
    && !metadataLinePattern.test(trimmed)
    && !/[.!?;:]$/.test(trimmed);
}
function promoteSetextHeadings(lines) {
  const out = [];
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index] ?? "";
    const next = lines[index + 1] ?? "";
    if (canPromoteSetextHeading(current) && isSetextUnderline(next)) {
      const level = next.trim().startsWith("=") ? "#" : "##";
      out.push(`${level} ${current.trim()}`);
      index += 1;
      continue;
    }
    out.push(current);
  }
  return out;
}
function splitTableOfContentsLines(lines) {
  const output = [];
  // Textbooks number sections as ``5-2``, ``5.2``, ``44`` (a whole chapter), or
  // ``A.3`` (an appendix).  Requiring a decimal point dropped the latter two,
  // so those contents lines survived as one unreadable paragraph.
  // A sub-entry always carries a separator (``5.2``, ``A.3``, ``5-2``).  A whole
  // chapter may be a bare integer (``44 Convex Sets``), but accepting that form
  // everywhere lets the leading chapter number of a contents block match as an
  // entry, which swallows the chapter heading into the first entry's title.  So
  // the strict form is tried first and the permissive one only as a fallback.
  const strictEntryNumber = String.raw`(?:[A-Z]|\d{1,3})[.-]\d{1,3}`;
  const looseEntryNumber = String.raw`(?:[A-Z]|\d{1,3})(?:[.-]\d{1,3})?`;
  const pageNumber = String.raw`\d{1,4}(?:-\d{1,3})?`;
  // A PDF text layer renders dot leaders glyph by glyph and drops stacked math
  // glyphs onto the same baseline, so an entry arrives as ``. . . . 403 *``.
  // The page number therefore cannot be anchored to the line end or to the next
  // entry number; trailing glyph debris is consumed and discarded instead.
  const leaderDebris = String.raw`[^\p{L}\p{N}]*`;
  // A chapter heading such as ``4 Matrices and Linear Maps 115`` opens a
  // contents block and carries no dot leader.  Titles are therefore matched
  // lazily but must not swallow a page number followed by more words, which is
  // what a bare chapter number at position zero would otherwise do.
  const buildPattern = (entryNumber) => new RegExp(
    `(${entryNumber})\\s+(.+?)\\s*(?:\\.\\s*){2,}${leaderDebris}(${pageNumber})${leaderDebris}(?=\\s*(?:${entryNumber}\\s+|$))`,
    "gu"
  );
  const strictPattern = buildPattern(strictEntryNumber);
  const loosePattern = buildPattern(looseEntryNumber);
  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    // Two leaders are enough to identify an entry once debris is tolerated; the
    // old threshold of eight rejected lines whose leader run was truncated.
    if ((line.match(/\./g) || []).length < 3 || !new RegExp(looseEntryNumber).test(line)) {
      output.push(rawLine);
      continue;
    }
    // Numbered sub-entries are matched first so a leading chapter number stays
    // in the prefix.  Only a line made purely of bare-integer chapter entries
    // falls through to the permissive pattern.
    let entries = [...line.matchAll(strictPattern)];
    if (!entries.length) {
      entries = [...line.matchAll(loosePattern)];
    }
    if (!entries.length) {
      output.push(rawLine);
      continue;
    }
    const prefix = line.slice(0, entries[0].index).trim();
    if (prefix) {
      const chapter = prefix.match(/^(\d{1,3})\s+(.+?)\s+(\d{1,4})$/);
      output.push(chapter ? `**${chapter[1]} ${chapter[2]} - ${chapter[3]}**` : `**${prefix}**`);
    }
    for (const match of entries) {
      output.push(`- ${match[1]} ${match[2].trim()} - ${match[3]}`);
    }
  }
  return output;
}
function shouldJoinParagraph(previous, current) {
  if (!previous || !current) return false;
  const prev = previous.trim();
  const next = current.trim();
  if (isStructuralLine(prev) || isStructuralLine(next)) {
    return false;
  }
  if (/!\[[^\]]*\]\(/.test(prev) || /!\[[^\]]*\]\(/.test(next)) {
    return false;
  }
  if (/[.!?:;\u3002\uff01\uff1f\uff1a\uff1b\uff09\u300d\u300f\u3011\u201d)\]"]$/.test(prev)) {
    return false;
  }
  if (/^[A-Z0-9][A-Z0-9\s-]{4,}$/.test(next) && next.length < 80) {
    return false;
  }
  return prev.length < 120 || next.length < 120;
}
function cleanupParagraphs(lines) {
  const blocks = [];
  let inCodeFence = false;
  for (const rawLine of lines) {
    const line = rawLine.replace(/[ \t]+$/g, "");
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      inCodeFence = !inCodeFence;
      blocks.push(trimmed);
      continue;
    }
    if (inCodeFence) {
      blocks.push(line);
      continue;
    }
    if (isLikelyPageNoise(trimmed)) {
      continue;
    }
    const previous = blocks[blocks.length - 1] ?? "";
    if (shouldJoinParagraph(previous, trimmed)) {
      const p = previous.trim();
      const n = trimmed;
      const cjkRegex = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/;
      const isPrevCjk = cjkRegex.test(p.slice(-1));
      const isNextCjk = cjkRegex.test(n.slice(0, 1));
      if (isPrevCjk && isNextCjk) {
        blocks[blocks.length - 1] = p + n;
      } else {
        blocks[blocks.length - 1] = `${p} ${n}`.replace(/\s+/g, " ");
      }
    } else {
      blocks.push(trimmed);
    }
  }
  return blocks;
}
function collapseBlankLines(lines) {
const out = [];
let blank = 0;
for (const line of lines) {
if (!line.trim()) {
blank += 1;
if (blank <= 1) {
out.push("");
}
} else {
blank = 0;
out.push(line);
}
}
while (out.length && !out[0].trim()) out.shift();
while (out.length && !out[out.length - 1].trim()) out.pop();
return out;
}
function buildReadableToc(lines) {
const headings = lines
.filter((line) => /^#{1,3}\s+\S/.test(line))
.slice(0, 80)
.map((line) => {
const level = line.match(/^#+/)?.[0].length ?? 1;
const title = line.replace(/^#{1,6}\s+/, "").trim();
return `${"  ".repeat(Math.max(0, level - 1))}- ${title}`;
});
if (headings.length < 3) return [];
return ["## Contents", "", ...headings, ""];
}
export function createReadableMarkdown(markdown, options = {}) {
const sourceFormat = options.sourceType || "document";
const sourceName = options.sourceName || "source";
const inputLines = normalizeLineEndings(markdown)
.split("\n")
.map((line) => line.replace(/\t/g, "  "));
const cleanedSourceLines = stripProcessMetadataLines(inputLines);
const cleaned = sourceFormat === "md"
? collapseBlankLines(cleanedSourceLines)
: collapseBlankLines(cleanupParagraphs(removeRepeatedShortLines(splitTableOfContentsLines(promoteSetextHeadings(cleanedSourceLines)))));
const hasTitle = cleaned.some((line) => /^#\s+\S/.test(line));
const title = hasTitle ? [] : [`# ${sourceName}`, ""];
const body = [...title, ...cleaned];
const toc = sourceFormat === "pptx" ? [] : buildReadableToc(body);
const insertIndex = body.findIndex((line, index) => index > 0 && !metadataLinePattern.test(line) && line.trim() && !line.startsWith(">"));
const finalLines = toc.length && insertIndex >= 0
? [...body.slice(0, insertIndex), ...toc, ...body.slice(insertIndex)]
: body;
return collapseBlankLines(finalLines).join("\n").trimEnd() + "\n";
}
export function readableMarkdownStats(markdown) {
const text = normalizeLineEndings(markdown);
return {
characters: text.length,
headings: (text.match(/^#{1,6}\s+\S/gm) || []).length,
paragraphs: text.split(/\n{2,}/).filter((block) => block.trim() && !block.trim().startsWith("|")).length
};
}
function segmentTitleFromLines(lines, fallback) {
const heading = lines.find((line) => /^#{1,3}\s+\S/.test(line));
return (heading ? heading.replace(/^#{1,6}\s+/, "") : fallback).trim();
}
function splitOversizedBlock(lines, maxCharacters) {
const segments = [];
let current = [];
let currentLength = 0;
const flush = () => {
if (current.length) {
segments.push(current);
current = [];
currentLength = 0;
}
};
for (const line of lines) {
const lineLength = line.length + 1;
if (currentLength > 0 && currentLength + lineLength > maxCharacters) {
flush();
}
current.push(line);
currentLength += lineLength;
}
flush();
return segments;
}
export function splitReadableMarkdown(markdown, options = {}) {
const maxCharacters = Math.max(20000, Number(options.maxCharacters || defaultReadableSegmentCharacterLimit));
const minCharactersForSplit = Math.max(maxCharacters + 1, Number(options.minCharactersForSplit || Math.floor(maxCharacters * 1.2)));
const text = normalizeLineEndings(markdown).trimEnd();
if (text.length < minCharactersForSplit) return {
segmented: false,
maxCharacters,
segments: []
};
const lines = text.split("\n");
const segments = [];
let current = [];
let currentLength = 0;
let currentStartLine = 1;
let nextStartLine = 1;
const flush = () => {
if (!current.length) {
return;
}
const startLine = currentStartLine;
const endLine = currentStartLine + current.length - 1;
if (currentLength > maxCharacters * 1.35) {
let oversizedStartLine = startLine;
for (const part of splitOversizedBlock(current, maxCharacters)) {
segments.push({
lines: part,
startLine: oversizedStartLine,
endLine: oversizedStartLine + part.length - 1
});
oversizedStartLine += part.length;
}
} else {
segments.push({
lines: current,
startLine,
endLine
});
}
current = [];
currentLength = 0;
currentStartLine = nextStartLine;
};
for (const [lineIndex, line] of lines.entries()) {
const isMajorHeading = /^#{1,2}\s+\S/.test(line);
const lineLength = line.length + 1;
if (currentLength > 0 && (currentLength + lineLength > maxCharacters || (isMajorHeading && currentLength > maxCharacters * 0.55))) {
flush();
}
if (!current.length) {
currentStartLine = lineIndex + 1;
}
current.push(line);
currentLength += lineLength;
nextStartLine = lineIndex + 2;
}
flush();
const total = segments.length;
return {
segmented: total > 1,
maxCharacters,
segments: segments.map((segment, index) => {
const segmentLines = segment.lines;
const title = segmentTitleFromLines(segmentLines, `Part ${index + 1}`);
const body = [
`> Human Markdown segment ${index + 1}/${total}.`,
`> Source line range: ${segment.startLine}-${segment.endLine}`,
"",
...segmentLines
].join("\n").trimEnd() + "\n";
return {
index: index + 1,
title,
startLine: segment.startLine,
endLine: segment.endLine,
headingCount: segmentLines.filter((line) => /^#{1,6}\s+\S/.test(line)).length,
characters: body.length,
markdown: body
};
})
};
}
export function createReadableMarkdownSegmentIndex({ title, sourceName, sourceType, baseFileName, segments }) {
const safeTitle = title || sourceName || "Readable Markdown";
const lines = [
`# ${safeTitle}`,
"",
"> Long document index. Open numbered parts for reading/editing.",
`> Parts: ${segments.length}`,
`> Segment map: ${baseFileName}.source-map.json`,
"",
"## Verification",
"",
`- Source map: [${baseFileName}.source-map.json](./${baseFileName}.source-map.json)`,
"- Each part records its source line range.",
"- AI-ready Markdown is stored separately.",
"",
"## Parts",
""
];
for (const segment of segments) {
const fileName = `${baseFileName}_${segment.index}.md`;
const sourceRange = segment.startLine && segment.endLine
? `, source lines ${segment.startLine}-${segment.endLine}`
: "";
lines.push(`- [Part ${segment.index}: ${segment.title}](./${fileName}) (${segment.characters.toLocaleString()} characters${sourceRange})`);
}
return lines.join("\n").trimEnd() + "\n";
}
