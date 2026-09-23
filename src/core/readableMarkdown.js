import { pdfPageFlowContext } from "../processing/pageNoise.js";
import { reflowPdfTables } from "../processing/tableStructure.js";
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

const generatedPdfInlineImageLinePattern = /^\+[ \t]{5,}(!\[Inline formula preserved from PDF page \d+\]\(<(?:\.\.\/)?assets\/[^>\r\n]+\.pdf\/page-\d+-formula-\d+(?:-[a-f0-9]+)?\.(?:png|jpe?g)>\))\+([ \t]*)$/i;

/**
 * Repairs a legacy PDF-extraction edge case where a line-leading arithmetic
 * operator plus wide layout spacing makes CommonMark parse the generated
 * inline formula image as list-item code. The rule is intentionally limited
 * to generated PDF asset labels and skips fenced or indented code.
 */
export function normalizeGeneratedPdfInlineImageLines(markdown) {
  const parts = String(markdown ?? "").split(/(\r\n|\n|\r)/);
  let fence = null;
  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index];
    if (fence) {
      const closing = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/);
      if (closing && closing[1][0] === fence.marker && closing[1].length >= fence.length) fence = null;
      continue;
    }
    const opening = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
    if (opening) {
      fence = { marker: opening[1][0], length: opening[1].length };
      continue;
    }
    if (/^[ \t]/.test(line)) continue;
    parts[index] = line.replace(generatedPdfInlineImageLinePattern, "+$1+$2");
  }
  return parts.join("");
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
    .replace(/\s+/g, " ")
    .trim();
}
function removeRepeatedShortLines(lines) {
  const counts = new Map();
  const pageMarker = /^<!--\s*pdf-page:\s*(\d+)(?:\s*;[^>]*)?\s*-->$/;
  const paged = lines.some(line => pageMarker.test(line.trim()));
  const seen = new Set(), repeatedWithinPage = new Set();
  let page = null;
  for (const line of lines) {
    const marker = paged && line.trim().match(pageMarker);
    if (marker) { page = marker[1]; continue; }
    const key = repeatNoiseKey(line);
    if (key && (!paged || page !== null)) {
      // Similar numbered body lines on one physical page are not evidence of
      // a recurring header. Count distinct pages and retain such body content.
      // Numeric similarity may protect body text, but must never justify removal.
      const family = key.replace(/\b\d{1,5}\b/g, "#"), occurrence = `${page}:${family}`;
      if (paged && seen.has(occurrence)) { repeatedWithinPage.add(family); continue; }
      if (paged) seen.add(occurrence);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.max(4, Math.floor(lines.length / 90));
  return lines.filter((line) => {
    const key = repeatNoiseKey(line);
    return !key || repeatedWithinPage.has(key.replace(/\b\d{1,5}\b/g, "#")) || (counts.get(key) ?? 0) < threshold;
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
function cleanupParagraphs(lines, sourceMargins = false) {
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
    if (!sourceMargins && isLikelyPageNoise(trimmed)) {
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
export function reflowPdfParagraphs(markdown, visualMap) {
  const {lines,pages,byNumber,ignored,furniture} = pdfPageFlowContext(markdown,visualMap);
  const links=[], decisions=[], roots=new Map(), replacements=new Map(), removed=new Set(ignored);
  const sourceWords = new Set(String(markdown).toLowerCase().match(/\p{L}{3,}/gu) ?? []);
  for(let i=1;i<pages.length;i++) {
    const a=pages[i-1],b=pages[i],left=byNumber.get(a.number),right=byNumber.get(b.number);
    const edge = (meta,page,side) => {
      const candidate=meta?.paragraphEdges?.[side], index=side==="first"?page.first:page.last;
      if(candidate?.text===lines[index]?.trim()) return candidate;
      if(!furniture.some(f=>f.sourceRefs[0].pageNumber===page.number)) return null;
      return meta?.paragraphEdges?.[side==="first"?"leading":"trailing"]?.find(e=>e.text===lines[index]?.trim());
    };
    const tail=edge(left,a,"last"),head=edge(right,b,"first");
    if(b.number!==a.number+1 || a.last===null || b.first===null || !tail || !head
      || left.requiresOcr || right.requiresOcr || left.ocr || right.ocr || a.code.has(a.last) || b.code.has(b.first)) continue;
    const t=lines[a.last].trim(),h=lines[b.first].trim();
    const cjkTail=/[\u3400-\u9fff]$/u.test(t), cjkHead=/^[\u3400-\u9fff]/u.test(h);
    // A discretionary hyphen or an independently occurring full word supplies
    // evidence. Letter casing alone cannot distinguish evidence-based from a split word.
    // This is the same criterion over the same whole-document vocabulary as
    // `joinPdfParagraphLines` here and `join_prose_line` in pdfLayoutExtractor.py:
    // the fragment is the letter run before the hyphen, the head is the letter run
    // the next page opens with, and a head that does not start lowercase is no
    // evidence. A hyphen with fewer than two letters before it spells no fragment,
    // so a numeric tail like `1-` is left alone rather than fused into `1year`.
    const softTail = t.endsWith("\u00ad");
    const split = /[\p{L}\p{N}][-\u00ad]$/u.test(t) ? /(\p{L}{2,})[-\u00ad]$/u.exec(t) : null;
    const following = /^(\p{L}+)/u.exec(h);
    const hyphenJoin = Boolean(split && following && /^\p{Ll}/u.test(following[1])
      && (softTail || sourceWords.has((split[1]+following[1]).toLowerCase())));
    if (split && following && !hyphenJoin) decisions.push({status:"candidate",reason:"ambiguous_hyphen",fromPage:a.number,toPage:b.number,
      sourceRefs:[{kind:"pdf",pageNumber:a.number,lineNumber:a.last+1,bbox:tail.bbox},{kind:"pdf",pageNumber:b.number,lineNumber:b.first+1,bbox:head.bbox}]});
    const naturalHead=/^\p{Ll}/u.test(h) || cjkHead;
    const naturalTail=/[\p{L},]$/u.test(t) || cjkTail || hyphenJoin;
    const minimumTailLength=cjkTail ? 16 : 40, minimumHeadLength=cjkHead ? 12 : 20;
    if(t!==tail.text || h!==head.text || t.length<minimumTailLength || h.length<minimumHeadLength || !naturalTail || !naturalHead
      || /[#$|<>\\[\]{}*\x60]/.test(t+h) || /^(?:[-*+]\s|\d+[.)]\s)/.test(t)
      || /^#{1,6}\s/.test(t) || /^#{1,6}\s/.test(h)) continue;
    if(![tail.bbox,head.bbox].every(b=>Array.isArray(b) && b.length===4)
      || ![...tail.bbox,...head.bbox,tail.fontSize,head.fontSize,left.height,right.height].every(Number.isFinite)
      || tail.fontSize<=0 || Math.abs(tail.fontSize-head.fontSize)>tail.fontSize*.1
      || Math.abs((tail.bbox[0]-(left.coordinateOrigin?.[0]||0))-(head.bbox[0]-(right.coordinateOrigin?.[0]||0)))>Math.max(4,tail.fontSize*.5)
      || tail.bbox[3]-(left.coordinateOrigin?.[1]||0)<left.height*.75
      || head.bbox[1]-(right.coordinateOrigin?.[1]||0)>right.height*.2) continue;
    const root=roots.get(a.last) ?? a.last;
    const joinKind=hyphenJoin ? "hyphenated_word" : cjkTail && cjkHead ? "cjk_continuation" : "latin_continuation";
    const leftText=(replacements.get(root) ?? lines[root]).trimEnd();
    const joined=hyphenJoin ? `${leftText.slice(0,-1)}${h}` : cjkTail && cjkHead ? `${leftText}${h}` : `${leftText} ${h}`;
    replacements.set(root,joined);
    roots.set(b.first,root);removed.add(b.first);
    links.push({fromPage:a.number,toPage:b.number,fromLine:a.last+1,toLine:b.first+1,confidence:"medium",status:"accepted",joinKind,
      evidence:hyphenJoin ? [softTail ? "source_soft_hyphen" : "independent_source_word"] : ["aligned_body_edges","compatible_font","open_sentence"],
      sourceRefs:[{kind:"pdf",pageNumber:a.number,bbox:tail.bbox},{kind:"pdf",pageNumber:b.number,bbox:head.bbox}]});
  }
  return {markdown:lines.map((line,i)=>removed.has(i)?"":replacements.get(i) ?? line).join("\n"),links,decisions:[...decisions,...links],furniture};
}

export function createReadableMarkdown(markdown, options = {}) {
const sourceFormat = options.sourceType || "document";
const sourceName = options.sourceName || "source";
const inputLines = normalizeLineEndings(sourceFormat === "pdf" ? reflowPdfTables(reflowPdfParagraphs(markdown, options.visualMap).markdown, options.visualMap).markdown : markdown)
.split("\n")
.map((line) => line.replace(/\t/g, "  "));
const cleanedSourceLines = stripProcessMetadataLines(inputLines);
const structuralLines = splitTableOfContentsLines(promoteSetextHeadings(cleanedSourceLines));
const sourceMargins = sourceFormat === "pdf" && options.visualMap?.pages?.some(p=>Array.isArray(p.paragraphEdges?.margins));
const cleaned = sourceFormat === "md"
? collapseBlankLines(cleanedSourceLines)
: collapseBlankLines(cleanupParagraphs(sourceMargins ? structuralLines : removeRepeatedShortLines(structuralLines), sourceMargins));
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
].join("\n") + "\n";
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
