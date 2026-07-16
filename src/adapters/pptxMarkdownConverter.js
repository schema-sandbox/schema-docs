import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { listZipEntries, readZipEntry } from "../core/zip.js";
import { getAttribute, getXmlBlocks, getXmlTextValues } from "../core/xml.js";
import { markdownTable } from "../core/markdownFormatting.js";
import { AppError } from "../core/errors.js";
import { renderPptxSlides } from "./pptxVisualRenderer.js";

function relationships(xml = "") {
  const result = new Map();
  for (const tag of xml.match(/<Relationship\b[^>]*\/?\s*>/g) ?? []) {
    const id = getAttribute(tag, "Id");
    if (id) result.set(id, { target: getAttribute(tag, "Target") || "", type: getAttribute(tag, "Type") || "" });
  }
  return result;
}
function partTarget(basePart, target) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(basePart), String(target).replace(/\\/g, "/"))).replace(/^\/+/, "");
}
function relsPart(part) {
  return path.posix.join(path.posix.dirname(part), "_rels", `${path.posix.basename(part)}.rels`);
}
function paragraphText(xml) {
  return getXmlTextValues(xml, "a:t").join("").replace(/\s+/g, " ").trim();
}
function shapeText(shapeXml) {
  return getXmlBlocks(shapeXml, "a:p").map((paragraph) => {
    const text = paragraphText(paragraph);
    if (!text) return "";
    if (/<a:bu(?:Char|AutoNum)\b/.test(paragraph)) return `- ${text}`;
    return text;
  }).filter(Boolean).join("\n");
}
function tableMarkdown(frameXml) {
  const tableXml = getXmlBlocks(frameXml, "a:tbl")[0] || "";
  if (!tableXml) return "";
  const rows = getXmlBlocks(tableXml, "a:tr").map((row) =>
    getXmlBlocks(row, "a:tc").map((cell) => getXmlBlocks(cell, "a:p").map(paragraphText).filter(Boolean).join(" "))
  ).filter((row) => row.length);
  return markdownTable(rows);
}
function slideElements(slideXml) {
  return slideXml.match(/<p:sp\b[^>]*>[\s\S]*?<\/p:sp>|<p:pic\b[^>]*>[\s\S]*?<\/p:pic>|<p:graphicFrame\b[^>]*>[\s\S]*?<\/p:graphicFrame>/g) ?? [];
}
function titleShape(shapeXml) {
  const placeholder = /<p:ph\b[^>]*\/?\s*>/.exec(shapeXml)?.[0] || "";
  return /^(?:title|ctrTitle)$/i.test(getAttribute(placeholder, "type") || "");
}
function placeholderType(shapeXml) {
  const placeholder = /<p:ph\b[^>]*\/?\s*>/.exec(shapeXml)?.[0] || "";
  return getAttribute(placeholder, "type") || "";
}
function shouldSkipPlaceholder(shapeXml) {
  return /^(?:sldNum|hdr|ftr|dt)$/i.test(placeholderType(shapeXml));
}
function transformMetrics(xml) {
  const offset = /<a:off\b[^>]*\/?\s*>/.exec(xml)?.[0] || "";
  const extent = /<a:ext\b[^>]*\/?\s*>/.exec(xml)?.[0] || "";
  return {
    x: Number(getAttribute(offset, "x")) || 0,
    y: Number(getAttribute(offset, "y")) || 0,
    cx: Number(getAttribute(extent, "cx")) || 0,
    cy: Number(getAttribute(extent, "cy")) || 0
  };
}
function maximumFontSize(shapeXml) {
  let maximum = 0;
  for (const tag of shapeXml.match(/<a:(?:rPr|defRPr|endParaRPr)\b[^>]*\/?\s*>/g) ?? []) {
    maximum = Math.max(maximum, Number(getAttribute(tag, "sz")) || 0);
  }
  return maximum;
}
function inferredTitleElement(elements, slideHeight) {
  const explicit = elements.find((element) => element.startsWith("<p:sp") && titleShape(element));
  if (explicit) return explicit;
  const candidates = elements.filter((element) => {
    if (!element.startsWith("<p:sp") || shouldSkipPlaceholder(element)) return false;
    const text = shapeText(element).replace(/\n+/g, " ").trim();
    if (!text || text.length > 180) return false;
    const { y } = transformMetrics(element);
    return slideHeight > 0 && y <= slideHeight * 0.38 && maximumFontSize(element) >= 2400;
  });
  return candidates.sort((left, right) => {
    const fontDelta = maximumFontSize(right) - maximumFontSize(left);
    return fontDelta || transformMetrics(left).y - transformMetrics(right).y;
  })[0] || null;
}
function presentationSize(presentationXml) {
  const size = /<p:sldSz\b[^>]*\/?\s*>/.exec(presentationXml)?.[0] || "";
  return {
    width: Number(getAttribute(size, "cx")) || 0,
    height: Number(getAttribute(size, "cy")) || 0
  };
}
function pictureRelationship(element, slideRels) {
  const blip = /<a:blip\b[^>]*\/?\s*>/.exec(element)?.[0] || "";
  return slideRels.get(getAttribute(blip, "r:embed"));
}
function pictureAreaRatio(element, slideSize) {
  if (!slideSize.width || !slideSize.height) return 0;
  const { cx, cy } = transformMetrics(element);
  return cx > 0 && cy > 0 ? (cx * cy) / (slideSize.width * slideSize.height) : 0;
}
function speakerNotes(notesXml) {
  return getXmlBlocks(notesXml, "p:sp").flatMap((shape) => {
    if (shouldSkipPlaceholder(shape)) return [];
    return getXmlBlocks(shape, "a:p").map(paragraphText).filter(Boolean);
  });
}
async function optionalPart(archive, entries, part) {
  return entries.has(part) ? readZipEntry(archive, part).toString("utf8") : "";
}

export const pptxMarkdownConverter = {
  name: "pptx-markdown-converter",
  cacheVersion: "4",
  canHandle(file) {
    return path.extname(file.sourcePath ?? file).toLowerCase() === ".pptx";
  },
  async convert(input) {
    try {
      const archive = await readFile(input.sourcePath);
      const entries = new Set(listZipEntries(archive).map((entry) => entry.fileName));
      const presentationPart = "ppt/presentation.xml";
      const presentationXml = await optionalPart(archive, entries, presentationPart);
      if (!presentationXml) throw new Error("ppt/presentation.xml is missing");
      const presentationRels = relationships(await optionalPart(archive, entries, relsPart(presentationPart)));
      const slideIds = (presentationXml.match(/<p:sldId\b[^>]*\/?\s*>/g) ?? []).map((tag) => getAttribute(tag, "r:id")).filter(Boolean);
      const slideParts = slideIds.map((id) => presentationRels.get(id)).filter(Boolean).map((rel) => partTarget(presentationPart, rel.target));
      const slideSize = presentationSize(presentationXml);
      const slides = [];
      const mediaReferenceCounts = new Map();
      for (const slidePart of slideParts) {
        const slideXml = await optionalPart(archive, entries, slidePart);
        const slideRels = relationships(await optionalPart(archive, entries, relsPart(slidePart)));
        const elements = slideElements(slideXml);
        slides.push({ slidePart, slideXml, slideRels, elements });
        for (const element of elements.filter((item) => item.startsWith("<p:pic"))) {
          const rel = pictureRelationship(element, slideRels);
          if (!rel) continue;
          const mediaPart = partTarget(slidePart, rel.target);
          mediaReferenceCounts.set(mediaPart, (mediaReferenceCounts.get(mediaPart) || 0) + 1);
        }
      }
      const title = path.parse(input.sourceName || path.basename(input.sourcePath)).name || "Presentation";
      const output = [`# ${title}`, ""];
      const warnings = [];
      let imageCount = 0, tableCount = 0, notesCount = 0, richObjectCount = 0;
      if (input.assetDir) await mkdir(input.assetDir, { recursive: true });
      const renderWidth = 1600;
      const renderHeight = slideSize.width > 0 && slideSize.height > 0
        ? Math.max(180, Math.round(renderWidth * slideSize.height / slideSize.width))
        : 900;
      let renderedSlides = new Map();
      let renderedAdapter = "";
      if (input.assetDir && input.renderSlides !== false) {
        try {
          const renderer = typeof input.renderSlides === "function" ? input.renderSlides : renderPptxSlides;
          const rendered = await renderer(input.sourcePath, {
            outputDir: input.assetDir,
            width: renderWidth,
            height: renderHeight
          });
          renderedSlides = new Map((rendered?.slides || []).map((slide) => [slide.index, slide.fileName]));
          renderedAdapter = rendered?.adapter || "local-office";
          if (renderedSlides.size !== slides.length) {
            warnings.push(`The local slide renderer returned ${renderedSlides.size} of ${slides.length} slide preview(s); missing pages use structured fallback content.`);
          }
        } catch (error) {
          warnings.push(`Full-slide previews were unavailable (${error.message}). Structured text and recoverable slide assets were preserved instead.`);
        }
      }
      let suppressedDecorationCount = 0;
      for (let index = 0; index < slides.length; index++) {
        const { slidePart, slideRels, elements } = slides[index];
        const titleElement = inferredTitleElement(elements, slideSize.height);
        const slideTitle = titleElement ? shapeText(titleElement).replace(/\n+/g, " ") : "";
        output.push(`## Slide ${index + 1}${slideTitle ? `: ${slideTitle}` : ""}`, "");
        const renderedFile = renderedSlides.get(index + 1);
        if (renderedFile) {
          const relative = `${String(input.assetRelativeBase || "assets").replace(/\\/g, "/").replace(/\/$/, "")}/${renderedFile}`;
          output.push(`![Slide ${index + 1} preview](<${relative}>)`, "");
          imageCount++;
        }
        const meaningfulText = elements
          .filter((element) => element.startsWith("<p:sp") && !shouldSkipPlaceholder(element))
          .map(shapeText)
          .join("")
          .trim();
        const pictures = elements.filter((element) => element.startsWith("<p:pic"));
        const imageOnlySlide = !meaningfulText && pictures.length > 0;
        for (const element of elements) {
          if (element === titleElement) continue;
          if (element.startsWith("<p:sp")) {
            if (shouldSkipPlaceholder(element)) continue;
            const text = shapeText(element);
            if (text) output.push(text, "");
            continue;
          }
          if (element.startsWith("<p:pic")) {
            if (renderedFile) continue;
            const rel = pictureRelationship(element, slideRels);
            if (!rel) continue;
            const mediaPart = partTarget(slidePart, rel.target);
            if (!entries.has(mediaPart)) continue;
            const referenceCount = mediaReferenceCounts.get(mediaPart) || 1;
            const areaRatio = pictureAreaRatio(element, slideSize);
            const hasUnknownPosition = areaRatio === 0;
            const preservePicture = imageOnlySlide
              || (referenceCount === 1 && (hasUnknownPosition || areaRatio >= 0.04));
            if (!preservePicture) {
              suppressedDecorationCount++;
              continue;
            }
            const originalName = path.posix.basename(mediaPart).replace(/[^A-Za-z0-9._-]/g, "_");
            const fileName = `slide-${index + 1}-${originalName}`;
            if (input.assetDir) await writeFile(path.join(input.assetDir, fileName), readZipEntry(archive, mediaPart));
            const relative = `${String(input.assetRelativeBase || "assets").replace(/\\/g, "/").replace(/\/$/, "")}/${fileName}`;
            output.push(`![Slide ${index + 1} image](<${relative}>)`, "");
            imageCount++;
            continue;
          }
          const table = tableMarkdown(element);
          if (table) {
            output.push(table, "");
            tableCount++;
          } else if (/<(?:c:chart|dgm:relIds|a:graphicData)\b/.test(element)) {
            output.push("[Chart or SmartArt preserved in the source presentation]", "");
            richObjectCount++;
          }
        }
        const notesRel = [...slideRels.values()].find((rel) => /\/notesSlide$/i.test(rel.type));
        if (notesRel) {
          const notesXml = await optionalPart(archive, entries, partTarget(slidePart, notesRel.target));
          const notes = speakerNotes(notesXml).filter((line) => line !== String(index + 1)).join("\n");
          if (notes) {
            output.push("> Speaker notes", ...notes.split("\n").map((line) => `> ${line}`), "");
            notesCount++;
          }
        }
      }
      if (renderedSlides.size) {
        warnings.push(`Preserved ${renderedSlides.size} complete slide preview(s) through the ${renderedAdapter} renderer, with searchable structured text retained below each slide.`);
        warnings.push("Animations and transitions are not reproduced; edit the source PPTX for exact slide layout changes.");
      } else {
        warnings.push("Slide layout simplified into reading order; animations, transitions, masters, and exact positioning are not preserved.");
      }
      if (imageCount) warnings.push(`Preserved ${imageCount} slide image asset(s) as local Markdown images.`);
      if (suppressedDecorationCount) warnings.push(`Omitted ${suppressedDecorationCount} repeated slide background or decorative image reference(s).`);
      if (tableCount) warnings.push(`Converted ${tableCount} PowerPoint table(s) to editable Markdown tables.`);
      if (notesCount) warnings.push(`Preserved speaker notes for ${notesCount} slide(s).`);
      if (richObjectCount) warnings.push(`${richObjectCount} chart or SmartArt object(s) remain marked as source-only rich objects.`);
      return {
        markdown: output.join("\n").trimEnd() + "\n",
        warnings,
        quality: { hasTextLayer: true, hasTablesSimplified: tableCount > 0, hasOcrMissing: false, confidence: "medium" },
        extractionQuality: {
          textLayerDetected: true,
          scannedLikely: false,
          tableSimplified: tableCount > 0,
          layoutSimplified: true,
          possibleMojibake: false,
          unsupportedFeatures: ["animations", "transitions", "masters", "exact_positioning", "charts", "smartart", "embedded_objects", "macros"],
          confidence: "medium"
        }
      };
    } catch (error) {
      throw new AppError("document_corrupt", `PPTX is corrupt or invalid. Confirm it opens locally in PowerPoint or WPS. Cause: ${error.message}`, { originalError: error.message });
    }
  }
};
