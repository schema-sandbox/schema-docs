import path from "node:path";
import { createHash } from "node:crypto";
import { createDocumentIr, addIrAsset, addIrBlock, addIrPage } from "../core/documentIr.js";
import { createQualitySignal, summarizeDocumentQuality } from "../core/conversionQuality.js";
import { annotateMarkdownTableBlocks } from "../processing/tableStructure.js";
import { annotateFormulaBlocks } from "../processing/formulaStructure.js";
import { annotateRepeatedPageText } from "../processing/pageNoise.js";
import { annotateHeadingHierarchy } from "../processing/headingStructure.js";

function sourceRef(sourceType) {
  return [{ kind: sourceType }];
}

function hashText(text) {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function lineBlockType(line) {
  const value = String(line).trim();
  if (/^<!-- schema-table: /.test(value)) return "comment";
  if (/^#{1,6}\s+/.test(value)) return value.startsWith("# ") ? "title" : "heading";
  if (/^\|.*\|$/.test(value)) return "table";
  if (/^(?:```|~~~)/.test(value)) return "code";
  if (/^\$\$|^\\\(|^\\\[/.test(value)) return "formula";
  if (/!\[[^\]]*\]\(/.test(value)) return "image";
  if (/^\s*(?:[-*+] |\d+[.)] )/.test(value)) return "list";
  return "paragraph";
}

function parseMarkdownImages(line) {
  const value = String(line || "");
  const images = [];
  const marker = /!\[([^\]]*)\]\(/g;
  let match;
  while ((match = marker.exec(value))) {
    const destinationStart = marker.lastIndex;
    let index = destinationStart;
    while (/\s/.test(value[index] || "")) index += 1;
    let target = "";
    if (value[index] === "<") {
      const end = value.indexOf(">", index + 1);
      if (end < 0) continue;
      target = value.slice(index + 1, end);
      index = end + 1;
      while (/\s/.test(value[index] || "")) index += 1;
      if (value[index] !== ")") {
        const quote = value[index];
        const closing = quote === "\"" || quote === "'" ? quote : quote === "(" ? ")" : "";
        if (!closing) continue;
        const titleEnd = value.indexOf(closing, index + 1);
        if (titleEnd < 0) continue;
        index = titleEnd + 1;
        while (/\s/.test(value[index] || "")) index += 1;
      }
      if (value[index] !== ")") continue;
    } else {
      const start = index;
      let depth = 0;
      let escaped = false;
      for (; index < value.length; index += 1) {
        const char = value[index];
        if (escaped) { escaped = false; continue; }
        if (char === "\\") { escaped = true; continue; }
        if (char === "(") { depth += 1; continue; }
        if (char === ")") {
          if (depth === 0) break;
          depth -= 1;
        }
      }
      if (value[index] !== ")") continue;
      target = value.slice(start, index).trim()
        .replace(/\s+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\))$/u, "");
    }
    if (target) images.push({ alt: match[1], path: target, offset: match.index });
    marker.lastIndex = index + 1;
  }
  return images;
}

/** Build a loss-aware logical DocumentIR for text-bearing non-PDF sources. */
export function buildDocumentIr(input = {}) {
  const sourcePath = String(input.sourcePath || "");
  const sourceType = String(input.sourceType || path.extname(sourcePath).slice(1) || "document").toLowerCase();
  const markdown = String(input.markdown || "");
  const refs = sourceRef(sourceType);
  const documentIr = createDocumentIr({
    documentId: input.documentId,
    revisionId: input.revisionId || `extract-${hashText(markdown).slice(7, 23)}`,
    source: {
      path: sourcePath,
      name: path.basename(sourcePath),
      type: sourceType,
      hash: String(input.sourceHash || ""),
      size: input.sourceSize,
      pageCount: null
    },
    extraction: {
      engine: input.extractorName || "built-in",
      engineVersion: input.extractorVersion || "",
      pipelineVersion: input.pipelineVersion || "1",
      warnings: input.warnings || [],
      status: input.status || "completed"
    },
    metadata: { title: input.title || path.parse(path.basename(sourcePath) || "document").name },
    quality: input.quality || {}
  });

  // A logical part is deliberately represented without a fabricated page number.
  const page = addIrPage(documentIr, {
    pageNumber: null,
    partId: "document",
    status: "completed",
    sourceRefs: refs,
    quality: { logicalPart: true }
  });
  let ordinal = 0;
  let inCode = false;
  const imageAssetsByPath = new Map();
  for (const [lineIndex, rawLine] of markdown.split(/\r?\n/).entries()) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (/^(?:```|~~~)/.test(trimmed)) inCode = !inCode;
    const type = inCode ? "code" : lineBlockType(trimmed);
    const imageMatches = inCode ? [] : parseMarkdownImages(rawLine);
    const assetIds = [];
    for (const imageMatch of imageMatches) {
      const imagePath = imageMatch.path;
      const existingAsset = imageAssetsByPath.get(imagePath);
      const asset = existingAsset || addIrAsset(documentIr, {
        path: imagePath,
        type: "image",
        sourceRefs: [{ ...refs[0], lineNumber: lineIndex + 1, column: imageMatch.offset + 1 }],
        status: "referenced"
      });
      if (!existingAsset) imageAssetsByPath.set(imagePath, asset);
      assetIds.push(asset.id);
    }
    const assetId = assetIds[0] || "";
    const headingMatch = /^(#{1,6})\s+/.exec(trimmed);
    addIrBlock(documentIr, {
      type,
      pageId: page.id,
      pageNumber: null,
      ordinal: ordinal++,
      text: trimmed.replace(/^#{1,6}\s+/, ""),
      assetId,
      assetIds,
      sourceRefs: [{ kind: sourceType, lineNumber: lineIndex + 1 }],
      qualitySignals: headingMatch ? { headingLevel: headingMatch[1].length } : {},
      status: "extracted"
    });
  }
  const blocksById = new Map(documentIr.blocks.map((block) => [block.id, block]));
  const pageBlocks = page.blocks.map((id) => blocksById.get(id)).filter(Boolean);
  annotateMarkdownTableBlocks(pageBlocks, { prefix: page.id });
  annotateFormulaBlocks(documentIr.blocks);
  annotateRepeatedPageText(documentIr);
  annotateHeadingHierarchy(documentIr);
  const signals = [];
  if (!markdown.trim()) signals.push(createQualitySignal({ kind: "readability", severity: "error", message: "No readable Markdown content was produced." }));
  if (["docx", "pptx"].includes(sourceType)) signals.push(createQualitySignal({ kind: "pagination", severity: "warning", message: "Logical content was preserved without fabricating page numbers." }));
  if ((input.warnings || []).length) signals.push(...input.warnings.map((message) => createQualitySignal({ kind: "extractor_warning", severity: "warning", message })));
  documentIr.quality = {
    ...(documentIr.quality || {}),
    ...summarizeDocumentQuality(documentIr, [...(input.quality?.signals || []), ...signals]),
    logicalPartOnly: true
  };
  return documentIr;
}
