import path from "node:path";
import { createDocumentIr, addIrAsset, addIrBlock, addIrPage } from "../core/documentIr.js";
import { createQualitySignal, summarizeDocumentQuality } from "../core/conversionQuality.js";
import { applyReadingOrderToPage } from "../processing/readingOrder.js";
import { annotateMarkdownTableBlocks, summarizeVisualTableRegion, reflowPdfTables } from "../processing/tableStructure.js";
import { annotateFormulaBlocks } from "../processing/formulaStructure.js";
import { annotateRepeatedPageText } from "../processing/pageNoise.js";
import { annotateHeadingHierarchy } from "../processing/headingStructure.js";
import { reflowPdfParagraphs } from "../core/readableMarkdown.js";

function markerPage(line) {
  const match = String(line).match(/<!--\s*pdf-page:\s*(\d+)(?:\s*;\s*extraction:\s*([^;\s]+))?/i);
  if (!match) return null;
  return {
    pageNumber: Number(match[1]),
    status: String(match[2] || "").toLowerCase() === "ocr_failed" ? "failed" : "completed"
  };
}

function markerRegion(line) {
  const match = String(line).match(/<!--\s*pdf-(formula|table|image):\s*page=(\d+)(?:\s+index=(\d+))?(?:\s+file=([^\s>]+))?/i);
  if (!match) return null;
  return { type: match[1] === "image" ? "image" : match[1], pageNumber: Number(match[2]), index: Number(match[3] || 0), file: match[4] || "" };
}

function sourceRef(pageNumber, bbox = null, extra = {}) {
  return [{ kind: "pdf", pageNumber, ...(bbox ? { bbox } : {}), ...extra }];
}

function addPageIfNeeded(documentIr, pageByNumber, pageNumber, pageMeta = {}) {
  if (!Number.isFinite(pageNumber)) return null;
  if (!pageByNumber.has(pageNumber)) {
    const page = addIrPage(documentIr, {
      pageNumber,
      status: pageMeta.status || "completed",
      width: pageMeta.width,
      height: pageMeta.height,
      sourceRefs: sourceRef(pageNumber),
      quality: pageMeta.quality || {}
    });
    pageByNumber.set(pageNumber, page);
  }
  return pageByNumber.get(pageNumber);
}

export function buildPdfDocumentIr(input = {}) {
  const visualMap = input.visualMap || {};
  const sourcePath = String(input.sourcePath || "");
  const source = {
    path: sourcePath,
    name: path.basename(sourcePath),
    type: "pdf",
    hash: String(input.sourceHash || ""),
    size: input.sourceSize,
    pageCount: visualMap.pageCount || input.pageCount || input.pageLedger?.sourcePageCount
  };
  const documentIr = createDocumentIr({
    documentId: input.documentId,
    revisionId: input.revisionId,
    source,
    extraction: {
      engine: input.extractorName || "unknown",
      engineVersion: input.extractorVersion || "",
      pipelineVersion: input.pipelineVersion || "1",
      warnings: input.warnings || [],
      status: input.status || "completed"
    },
    metadata: { title: input.title || path.parse(source.name).name },
    quality: input.quality || {}
  });
  const pageByNumber = new Map();
  const visualsByPage = new Map();
  const ocrLines = new Map();
  const nativeLines = new Map();
  const sourcePageCount = Number.isInteger(Number(source.pageCount)) && Number(source.pageCount) > 0
    ? Number(source.pageCount)
    : null;
  for (const entry of visualMap.pages || []) {
    const edges=entry.paragraphEdges || {};
    const candidates=entry.textLines || edges.lines || [edges.first,edges.last,...(edges.leading || []),...(edges.trailing || [])];
    const seen=new Set();
    nativeLines.set(Number(entry.page),candidates.filter(item=> {
      if(!item?.text || !Array.isArray(item.bbox)) return false;
      const key=JSON.stringify([item.text,item.bbox]);if(seen.has(key)) return false;seen.add(key);return true;
    }).map(item=>({...item,used:false})));
    const failedVisual = (entry.regions || []).some(region => region.assetStatus === "failed");
    const reviewRegions = Array.isArray(entry.ocrReviewRegions)
      ? entry.ocrReviewRegions
      : (entry.ocr?.regions || []).filter(region => ["visual_only", "unresolved", "failed"].includes(region.status));
    const ocrReviewRequired = entry.ocrReviewRequired === true || reviewRegions.length > 0;
    const qualityStatus = entry.requiresOcr ? "ocr_required" : (failedVisual ? "unresolved" : (ocrReviewRequired ? "ocr_review_required" : (entry.regions || []).length ? "visual_preserved" : "native_text"));
    const page = addPageIfNeeded(documentIr, pageByNumber, Number(entry.page), {
      status: entry.requiresOcr || failedVisual || ocrReviewRequired ? "partial" : "completed",
      width: entry.width, height: entry.height,
      quality: { regionCount: Array.isArray(entry.regions) ? entry.regions.length : 0,
        sourceReadingOrder: entry.readingOrder || null,
        qualityStatus,
        ...(entry.requiresOcr ? { requiresOcr: true } : {}),
        ...(ocrReviewRequired ? { ocrReviewRequired: true, ocrReviewRegions: reviewRegions } : {}),
        ...(failedVisual ? { unresolved: true } : {}) }
    });
    const lines = new Map();
    for (const word of entry.ocr?.words || []) {
      const key = word.line.join("-");
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push(word);
    }
    ocrLines.set(Number(entry.page), [...lines.values()].map(words => ({
      text: words.map(word => word.text).join("").replace(/\s/g, ""),
      bbox: [Math.min(...words.map(w => w.bbox[0])), Math.min(...words.map(w => w.bbox[1])),
        Math.max(...words.map(w => w.bbox[2])), Math.max(...words.map(w => w.bbox[3]))],
      confidence: words.reduce((sum, w) => sum + w.confidence, 0) / words.length
    })));
    for (const [index, region] of (entry.regions || []).entries()) {
      const type = ["formula", "table", "image"].includes(region.type) ? region.type : "unknown";
      const assetPath = String(region.assetFile || "");
      let assetId = "";
      if (assetPath) {
        const asset = addIrAsset(documentIr, {
          path: assetPath,
          type,
          pageNumber: Number(entry.page),
          bbox: region.bbox,
          sourceRefs: sourceRef(Number(entry.page), region.bbox, { regionIndex: index }),
          status: region.needsVisualFallback ? "visual_preserved" : "derived"
        });
        assetId = asset.id;
      }
      const visual = addIrBlock(documentIr, {
        type,
        pageId: page?.id,
        pageNumber: Number(entry.page),
        ordinal: index,
        text: String(region.text || region.latex || ""),
        bbox: region.bbox,
        assetId,
        status: region.needsVisualFallback ? "visual_preserved" : "extracted",
        sourceRefs: sourceRef(Number(entry.page), region.bbox, { regionIndex: index }),
        qualitySignals: {
          confidence: region.confidence || (region.needsVisualFallback ? "low" : "medium"),
          ...(type === "table" ? { tableStructure: summarizeVisualTableRegion(region) } : {})
        }
      });
      const visualEntries = visualsByPage.get(Number(entry.page)) || [];
      visualEntries.push({block:visual,file:assetPath});
      visualsByPage.set(Number(entry.page),visualEntries);
    }
  }
  for (const entry of input.pageLedger?.pages || []) {
    addPageIfNeeded(documentIr, pageByNumber, Number(entry.pageNumber), { status: entry.status });
  }
  let currentPage = null;
  let ordinal = documentIr.blocks.length;
  let inCode = false;
  for (const [lineIndex, line] of String(input.markdown || "").split(/\r?\n/).entries()) {
    const pageMarker = markerPage(line);
    const pageNumber = pageMarker?.pageNumber ?? null;
    if (pageNumber !== null) {
      currentPage = addPageIfNeeded(documentIr, pageByNumber, pageNumber, { status: pageMarker.status });
      if (pageMarker.status === "failed") {
        currentPage.status = "failed";
        currentPage.warnings = [...new Set([...(currentPage.warnings || []), "OCR failed for source page"])];
      }
    }
    const region = markerRegion(line);
    const contentLine = region
      ? line.replace(/<!--\s*pdf-(?:formula|table|image):[^>]*-->/gi, " ")
      : line;
    const trimmed = contentLine.trim();
    const visual = (visualsByPage.get(currentPage?.pageNumber) || []).find(v => v.file
      && (region?.file === v.file || (/^!\[/.test(trimmed) && trimmed.includes(path.basename(v.file)))));
    if (visual) {
      visual.block.sourceRefs.push(...sourceRef(currentPage.pageNumber, visual.block.bbox, {lineNumber:lineIndex+1}));
      if (!trimmed || /^!\[/.test(trimmed)) { visual.block.text=trimmed;continue; }
    }
    if (!trimmed || (/^<!--/.test(trimmed) && !/^<!-- schema-table: /.test(trimmed))) continue;
    const isFence = /^(?:```|~~~)/.test(trimmed);
    if (isFence) inCode = !inCode;
    const type = inCode || isFence ? "code"
      : /^<!-- schema-table: /.test(trimmed) ? "comment"
      : /^#{1,6}\s+/.test(trimmed) ? (trimmed.startsWith("# ") ? "title" : "heading")
      : /^\|.*\|$/.test(trimmed) ? "table"
      : /^\$\$|^\\\(|^\\\[/.test(trimmed) ? "formula"
      : /^!\[[^\]]*\]\(/.test(trimmed) ? "image"
      : /^\s*(?:[-*+] |\d+[.)] )/.test(trimmed) ? "list"
      : "paragraph";
    const headingMatch = /^(#{1,6})\s+/.exec(trimmed);
    const ocrLine = (ocrLines.get(currentPage?.pageNumber) || []).find(line => !line.used && line.text === trimmed.replace(/\s/g, ""));
    if (ocrLine) ocrLine.used = true;
    const nativeLine=(nativeLines.get(currentPage?.pageNumber) || []).find(line=>!line.used && line.text.replace(/\s/g,"")===trimmed.replace(/^#{1,6}\s+/,"").replace(/\s/g,""));
    if(nativeLine) nativeLine.used=true;
    const sourceLine=nativeLine || ocrLine;
    const block = addIrBlock(documentIr, {
      type,
      pageId: currentPage?.id,
      pageNumber: currentPage?.pageNumber ?? null,
      ordinal: ordinal++,
      text: trimmed.replace(/^#{1,6}\s+/, ""),
      bbox: sourceLine?.bbox,
      sourceRefs: currentPage ? sourceRef(currentPage.pageNumber, sourceLine?.bbox || null, { lineNumber: lineIndex + 1 }) : [{ kind: "pdf", lineNumber: lineIndex + 1 }],
      status: "extracted",
      qualitySignals: { ...(nativeLine ? {fontSize:nativeLine.fontSize,extractionMethod:"native"} : {}), ...(headingMatch ? { headingLevel: headingMatch[1].length } : {}),
        ...(ocrLine ? { ocrConfidence: ocrLine.confidence, extractionMethod: "ocr" } : {}) }
    });
    if (!currentPage && block.pageNumber === null) {
      documentIr.quality = { ...(documentIr.quality || {}), hasUnpagedBlocks: true };
    }
  }
  if (sourcePageCount !== null) {
    for (let pageNumber = 1; pageNumber <= sourcePageCount; pageNumber += 1) {
      if (!pageByNumber.has(pageNumber)) {
        const page = addPageIfNeeded(documentIr, pageByNumber, pageNumber, {
          status: "skipped",
          quality: { missingExtraction: true }
        });
        page.warnings = [...new Set([...(page.warnings || []), "No extracted page content was mapped."])]
      }
    }
  }
  const blocksById = new Map(documentIr.blocks.map((block) => [block.id, block]));
  for (const page of documentIr.pages) {
    const pageBlocks = page.blocks
      .map((id) => blocksById.get(id))
      .filter(Boolean);
    const lineOf = block => block.sourceRefs.find(r => r.lineNumber)?.lineNumber ?? Infinity;
    const hasSourceOrder = pageBlocks.some(b => Number.isFinite(lineOf(b)));
    if (hasSourceOrder) pageBlocks.sort((a,b) => lineOf(a)-lineOf(b) || a.ordinal-b.ordinal);
    annotateMarkdownTableBlocks(pageBlocks, { prefix: page.id });
    applyReadingOrderToPage(page, pageBlocks, {
      preserveSourceOrder: hasSourceOrder,
      pageWidth: Number(page.width || 0),
      pageHeight: Number(page.height || 0),
      coordinateOrigin: (visualMap.pages || []).find(p=>p.page===page.pageNumber)?.coordinateOrigin || [0,0]
    });
  }
  annotateFormulaBlocks(documentIr.blocks);
  const repeatedPageText = annotateRepeatedPageText(documentIr);
  annotateHeadingHierarchy(documentIr);
  const byLine = new Map(documentIr.blocks.flatMap(b => b.sourceRefs.filter(r => r.lineNumber).map(r => [r.lineNumber,b.id])));
  const flow = reflowPdfParagraphs(input.markdown, visualMap);
  documentIr.metadata.paragraphContinuations = flow.links.map(link => ({
    ...link, fromBlock: byLine.get(link.fromLine), toBlock: byLine.get(link.toLine)
  }));
  documentIr.metadata.pageFurniture = flow.furniture.map(item=>({...item,blockId:byLine.get(item.sourceRefs[0].lineNumber)}));
  const tableFlow = reflowPdfTables(input.markdown,visualMap);
  documentIr.metadata.tableContinuations = tableFlow.links.map(link=>({
    ...link,fromBlock:byLine.get(link.fromLine),toBlock:byLine.get(link.toLine)
  }));
  const signals = [];
  for(const page of documentIr.pages.filter(p=>p.quality?.readingOrder?.conflict || p.quality?.sourceReadingOrder?.conflict)) {
    signals.push(createQualitySignal({kind:'reading_order_conflict',severity:'warning',pageNumber:page.pageNumber,message:'Conflicting reading relations; source order retained.'}));
  }
  for (const page of documentIr.pages.filter(p => p.quality?.ocrReviewRequired)) {
    signals.push(createQualitySignal({
      kind: "ocr_review_required",
      severity: "warning",
      pageNumber: page.pageNumber,
      message: `${page.quality.ocrReviewRegions?.length || 0} OCR region(s) retain visual content without verified editable text.`,
      sourceRefs: [{ kind: "pdf", pageNumber: page.pageNumber }]
    }));
  }
  documentIr.metadata.continuationDecisions = [...tableFlow.decisions,...flow.decisions];
  for(const decision of documentIr.metadata.continuationDecisions.filter(d=>d.status==="candidate")) {
    signals.push(createQualitySignal({kind:"continuation_candidate",severity:"warning",pageNumber:decision.fromPage,
      message:`Uncertain continuation preserved separately: ${decision.reason}`,sourceRefs:decision.sourceRefs}));
  }
  if (repeatedPageText.markedCount > 0) signals.push(createQualitySignal({ kind: "page_noise_candidate", severity: "warning", message: `${repeatedPageText.markedCount} repeated page-text block(s) require review.` }));
  for (const page of documentIr.pages.filter((candidate) => candidate.status === "failed")) {
    signals.push(createQualitySignal({
      kind: "page_failed",
      severity: "error",
      pageNumber: page.pageNumber,
      message: page.warnings?.join("; ") || "Page extraction failed."
    }));
  }
  if (!documentIr.pages.length) signals.push(createQualitySignal({ kind: "page_mapping", severity: "warning", message: "No page markers or visual map were available." }));
  if (input.lowReadableText) signals.push(createQualitySignal({ kind: "readability", severity: "error", message: "Extractor output was low-readable." }));
  if ((input.warnings || []).length) signals.push(...input.warnings.map((message) => createQualitySignal({ kind: "extractor_warning", severity: "warning", message })));
  const qualitySummary = summarizeDocumentQuality(documentIr, [...(input.quality?.signals || []), ...signals]);
  documentIr.quality = { ...(documentIr.quality || {}), ...qualitySummary };
  return documentIr;
}
