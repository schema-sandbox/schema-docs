const LIST_LINE = /^\s*(?:[-*+]\s+|\d+[.)]\s+)/;
const HEADING_LINE = /^(#{1,6})\s+(.+)$/;
const FENCE_LINE = /^\s*(`{3,}|~{3,})/;
const TABLE_LINE = /^\s*\|.*\|\s*$/;
const FORMULA_LINE = /^\s*(?:\$\$.*\$\$|\\\(.+\\\)|\\\[.+\\\])\s*$/;
const IMAGE_LINE = /^\s*!\[[^\]]*\]\([^)]*\)\s*$/;

function normalizeMarkdown(markdown) {
  return String(markdown ?? "").replace(/\r\n?/g, "\n");
}

function lineStarts(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function classifySingleLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return "blank";
  if (HEADING_LINE.test(trimmed)) return "heading";
  if (TABLE_LINE.test(trimmed)) return "table";
  if (FORMULA_LINE.test(trimmed) || /^\s*\$\$/.test(trimmed)) return "formula";
  if (IMAGE_LINE.test(trimmed)) return "image";
  if (LIST_LINE.test(trimmed)) return "list";
  if (/^\s*<!--/.test(trimmed)) return "comment";
  return "paragraph";
}

function blockRecord(lines, startLine, endLine, startChar, endChar, type, headingPath, protectedBlock = false) {
  return {
    type,
    text: lines.join("\n"),
    startLine,
    endLine,
    startChar,
    endChar,
    headingPath: [...headingPath],
    protected: protectedBlock || ["table", "formula", "code"].includes(type)
  };
}

export function parseStructuredMarkdown(markdown) {
  const text = normalizeMarkdown(markdown);
  const lines = text.split("\n");
  const starts = lineStarts(text);
  const blocks = [];
  let headingPath = [];
  let current = [];
  let currentType = "paragraph";
  let currentStart = 0;
  let inFence = null;
  let inFormula = false;

  const flush = (endLineIndex) => {
    if (!current.length) return;
    const startLine = currentStart + 1;
    const endLine = endLineIndex;
    const startChar = starts[currentStart] ?? text.length;
    const lastLineIndex = Math.min(lines.length - 1, endLineIndex - 1);
    const endChar = Math.min(text.length, (starts[lastLineIndex] ?? text.length) + lines[lastLineIndex].length);
    blocks.push(blockRecord(current, startLine, endLine, startChar, endChar, currentType, headingPath));
    current = [];
  };

  const begin = (lineIndex, type) => {
    current = [lines[lineIndex]];
    currentStart = lineIndex;
    currentType = type;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (inFormula) {
      current.push(line);
      if (/^(?:\$\$|\\\])\s*$/.test(trimmed)) {
        blocks.push(blockRecord(current, currentStart + 1, index + 1, starts[currentStart], Math.min(text.length, starts[index] + line.length), "formula", headingPath, true));
        current = [];
        inFormula = false;
      }
      continue;
    }
    if (inFence) {
      current.push(line);
      if (FENCE_LINE.test(trimmed) && trimmed.startsWith(inFence.marker) && trimmed.match(new RegExp(`^${inFence.marker}{${inFence.length},}`))) {
        blocks.push(blockRecord(current, currentStart + 1, index + 1, starts[currentStart], Math.min(text.length, starts[index] + line.length), "code", headingPath, true));
        current = [];
        inFence = null;
      }
      continue;
    }
    const fence = trimmed.match(FENCE_LINE);
    if (fence) {
      flush(index);
      begin(index, "code");
      inFence = { marker: fence[1][0], length: fence[1].length };
      continue;
    }
    if (/^(?:\$\$|\\\[)\s*$/.test(trimmed)) {
      flush(index);
      begin(index, "formula");
      inFormula = true;
      continue;
    }
    const heading = trimmed.match(HEADING_LINE);
    if (heading) {
      flush(index);
      const level = heading[1].length;
      headingPath = headingPath.slice(0, level - 1);
      headingPath[level - 1] = heading[2].trim();
      headingPath = headingPath.filter(Boolean);
      blocks.push(blockRecord([line], index + 1, index + 1, starts[index], Math.min(text.length, starts[index] + line.length), "heading", headingPath));
      continue;
    }
    const type = classifySingleLine(line);
    if (type === "blank") {
      flush(index);
      continue;
    }
    if (type === "table" || type === "list" || type === "image" || type === "formula" || type === "comment") {
      if (current.length && currentType !== type) flush(index);
      if (!current.length) begin(index, type);
      else current.push(line);
      const nextType = classifySingleLine(lines[index + 1] || "");
      if (type === "formula" || type === "image" || type === "comment" || nextType !== type) flush(index + 1);
      continue;
    }
    if (!current.length) begin(index, "paragraph");
    else if (currentType !== "paragraph") flush(index), begin(index, "paragraph");
    else current.push(line);
  }
  if ((inFence || inFormula) && current.length) {
    const last = lines.length - 1;
    blocks.push(blockRecord(current, currentStart + 1, last + 1, starts[currentStart], text.length, inFormula ? "formula" : "code", headingPath, true));
  } else {
    flush(lines.length);
  }
  return blocks;
}

export function summarizeStructuredRange(blocks, startChar, endChar) {
  const overlapping = (blocks || []).filter((block) => block.endChar > startChar && block.startChar < endChar);
  const protectedBlocks = overlapping.filter((block) => block.protected);
  const headingPath = overlapping.length ? overlapping[overlapping.length - 1].headingPath : [];
  return {
    blockTypes: [...new Set(overlapping.map((block) => block.type))],
    headingPath: [...headingPath],
    protectedBlocks: protectedBlocks.map((block) => ({ type: block.type, startLine: block.startLine, endLine: block.endLine })),
    hasPartialProtectedBlock: protectedBlocks.some((block) => block.startChar < startChar || block.endChar > endChar),
    sourceRanges: overlapping.map((block) => ({ startLine: block.startLine, endLine: block.endLine, type: block.type }))
  };
}

function splitOversizedBlock(block, maxCharacters) {
  const lines = block.text.split("\n");
  const pieces = [];
  let current = [];
  let currentLength = 0;
  for (const line of lines) {
    if (current.length && currentLength + line.length + 1 > maxCharacters) {
      pieces.push(current.join("\n"));
      current = [];
      currentLength = 0;
    }
    current.push(line);
    currentLength += line.length + 1;
  }
  if (current.length) pieces.push(current.join("\n"));
  return pieces.length ? pieces : [block.text];
}

export function buildStructuredChunks(markdown, options = {}) {
  const text = normalizeMarkdown(markdown);
  const maxCharacters = Math.max(200, Number(options.maxCharacters || 12000));
  const blocks = parseStructuredMarkdown(text);
  const chunks = [];
  let startBlock = null;
  let endBlock = null;
  const flush = () => {
    if (!startBlock || !endBlock) return;
    const startChar = startBlock.startChar;
    const endChar = endBlock.endChar;
    chunks.push({
      index: chunks.length + 1,
      text: text.slice(startChar, endChar),
      startChar,
      endChar,
      startLine: startBlock.startLine,
      endLine: endBlock.endLine,
      headingPath: [...endBlock.headingPath],
      blockTypes: [...new Set(blocks.slice(blocks.indexOf(startBlock), blocks.indexOf(endBlock) + 1).map((block) => block.type))],
      protectedBlocks: blocks.slice(blocks.indexOf(startBlock), blocks.indexOf(endBlock) + 1).filter((block) => block.protected).map((block) => ({ type: block.type, startLine: block.startLine, endLine: block.endLine })),
      split: false
    });
    startBlock = null;
    endBlock = null;
  };
  for (const block of blocks) {
    const blockLength = block.endChar - block.startChar;
    if (blockLength > maxCharacters) {
      flush();
      const pieces = splitOversizedBlock(block, maxCharacters);
      for (const piece of pieces) {
        chunks.push({
          index: chunks.length + 1,
          text: piece,
          startChar: block.startChar,
          endChar: block.endChar,
          startLine: block.startLine,
          endLine: block.endLine,
          headingPath: [...block.headingPath],
          blockTypes: [block.type],
          protectedBlocks: block.protected ? [{ type: block.type, startLine: block.startLine, endLine: block.endLine }] : [],
          split: true
        });
      }
      continue;
    }
    const currentLength = startBlock ? block.endChar - startBlock.startChar : 0;
    if (startBlock && currentLength > maxCharacters) flush();
    if (!startBlock) startBlock = block;
    endBlock = block;
  }
  flush();
  return { blocks, chunks, maxCharacters };
}
