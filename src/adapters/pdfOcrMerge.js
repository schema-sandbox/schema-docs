import { applyPdfReadingOrder } from "../processing/readingOrder.js";
import { pdfPagePieces } from "./pdfPageStream.js";
// The page decision comes from source geometry. Document-wide readability must
// never hide an image-only page between otherwise readable text pages.
function compactText(value) {
  return String(value || "").toLocaleLowerCase().replace(/\s+/g, "").trim();
}

function mergeNativeAndOcrText(nativeText, ocrText) {
  const nativeLines = String(nativeText || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const ocrLines = String(ocrText || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!nativeLines.length) return { text: ocrLines.join("\n"), mode: "ocr_only", addedLines: ocrLines.length };
  const known = new Set(nativeLines.map(compactText));
  const nativeStream = compactText(nativeText);
  const additions = ocrLines.filter(line => {
    const key = compactText(line);
    if (!key || known.has(key) || (key.length >= 12 && nativeStream.includes(key))) return false;
    known.add(key);
    return true;
  });
  return { text: [String(nativeText).trim(), ...additions].join("\n"), mode: additions.length ? "native_plus_ocr" : "native_verified", addedLines: additions.length };
}

function overlap(a,b) {
  return Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
}

function renderOcrTable(table) {
  const row=cells=>`| ${cells.map(value=>String(value).replace(/\|/g,'\\|').replace(/\s*\n\s*/g,'; ')).join(' | ')} |`;
  const rows=[row(table.rows[0]),row(table.rows[0].map(()=>'---')),...table.rows.slice(1).map(row)];
  if(table.spans?.length) rows.unshift(`<!-- schema-table: ${JSON.stringify({v:1,rows:table.rowCount,cols:table.columnCount,spans:table.spans})} -->`);
  return rows.join('\n');
}

function mergeRegions(piece, recognized, meta) {
  const lines=piece.split(/\r?\n/), insertions=new Map();
  const source=meta.textLines || meta.paragraphEdges?.lines || [];
  const native=source.filter(line=>line?.bbox && !/\(cid:|\ufffd/.test(line.text));
  let added=0,deduplicated=0;
  for(const region of recognized.regions) {
    if(region.status!=='completed') continue;
    const words=(region.words || []).filter(word=>{
      const area=Math.max(.01,(word.bbox[2]-word.bbox[0])*(word.bbox[3]-word.bbox[1]));
      const covered=native.some(line=>overlap(line.bbox,word.bbox)/area>.65);
      if(covered) deduplicated++;
      return !covered;
    });
    const tables=words.length===region.words.length ? (region.tables || (region.table?[region.table]:[])) : [];
    const grouped=new Map();
    for(const word of words) {
      if(tables.some(table=>overlap(word.bbox,table.bbox)/Math.max(.01,(word.bbox[2]-word.bbox[0])*(word.bbox[3]-word.bbox[1]))>.85)) continue;
      const key=word.line.join('-');
      if(!grouped.has(key)) grouped.set(key,[]);grouped.get(key).push(word);
    }
    // OCR line order belongs to the corrected image. Sorting source-space y
    // would reverse or interleave text after a 90-degree rotation.
    const paragraphs=[...grouped.values()].map(group=>({text:group.map(w=>w.text).join(' '),order:region.words.indexOf(group[0]),bbox:[Math.min(...group.map(w=>w.bbox[0])),Math.min(...group.map(w=>w.bbox[1])),Math.max(...group.map(w=>w.bbox[2])),Math.max(...group.map(w=>w.bbox[3]))]}));
    for(const table of tables) {
      const structured={...table,page:meta.page,inlinePlaceholder:true,sourceRegionId:region.id,extractionMethod:'ocr'};
      meta.regions.push(structured);
      paragraphs.push({text:renderOcrTable(table),bbox:table.bbox,order:region.words.findIndex(word=>overlap(word.bbox,table.bbox)>0)});
    }
    if(!paragraphs.length) continue;
    paragraphs.sort((a,b)=>a.order-b.order);
    const image=meta.regions.find(r=>r.type==='image' && r.assetFile && overlap(r.bbox,region.bbox)>overlap(region.bbox,region.bbox)*.7);
    let index=image ? lines.findIndex(line=>line.includes(image.assetFile)) : -1;
    if(index>=0) index++;
    else {
      const following=native.filter(line=>line.bbox[1]>=region.bbox[3]-2 && Math.min(line.bbox[2],region.bbox[2])>Math.max(line.bbox[0],region.bbox[0]))
        .sort((a,b)=>a.bbox[1]-b.bbox[1])[0];
      index=following ? lines.findIndex(line=>compactText(line)===compactText(following.text)) : -1;
      if(index<0) index=lines.length;
    }
    if(!insertions.has(index)) insertions.set(index,[]);
    insertions.get(index).push(...paragraphs.map(p=>p.text));added+=paragraphs.length;
  }
  recognized.mergeMode=added?'native_plus_region_ocr':'native_verified';
  recognized.addedTextLines=added;recognized.deduplicatedWords=deduplicated;
  return Array.from({length:lines.length+1},(_,i)=>[...(insertions.get(i)||[]).flatMap(text=>['',text,'']),...(i<lines.length?[lines[i]]:[])]).flat().join('\n');
}

export function mergeOcrPages(layout, ocr) {
  const byPage = new Map((ocr.pages || []).map(page => [page.page, page]));
  const metaByPage = new Map(layout.visualMap.pages.map(page => [page.page, page]));
  const pieces = pdfPagePieces(layout.markdown);
  const mergePiece = piece => {
    const number = Number(piece.match(/^<!-- pdf-page: (\d+)/)?.[1]);
    const page = byPage.get(number);
    if (!page) return piece;
    if (page.status === "failed") return piece.replace(/<!-- pdf-page:[^>]*-->/, `<!-- pdf-page: ${number}; extraction: ocr_failed -->`);
    const meta=metaByPage.get(number);
    if(Array.isArray(page.regions) && meta) return mergeRegions(piece,page,meta);
    const visuals = [...piece.matchAll(/<!-- pdf-(?:image|formula|table):[^>]*-->/g)].map(match => match[0]);
    const markerEnd = piece.indexOf("-->");
    const nativeText = markerEnd >= 0 ? piece.slice(markerEnd + 3).replace(/<!-- pdf-(?:image|formula|table):[^>]*-->/g, "\n") : "";
    const merged = mergeNativeAndOcrText(nativeText, page.text);
    page.mergeMode = merged.mode;
    page.nativeTextCharacters = nativeText.trim().length;
    page.addedTextLines = merged.addedLines;
    return [`<!-- pdf-page: ${number}; extraction: ocr; languages: ${ocr.languages}; merge: ${merged.mode} -->`, "", merged.text, "", ...visuals, "", ""].join("\n");
  };
  const merged = [];
  for (const piece of pieces) merged.push(mergePiece(piece));
  layout.markdown = merged.join("");
  for (const page of layout.visualMap.pages) {
    const recognized = byPage.get(page.page);
    if (recognized) {
      const [dx, dy] = page.coordinateOrigin || [0, 0];
      recognized.words = (recognized.words || []).map(word => recognized.coordinateSpace==='source_page' ? word : ({ ...word,
        bbox: [word.bbox[0] + dx, word.bbox[1] + dy, word.bbox[2] + dx, word.bbox[3] + dy] }));
      page.ocr = recognized;
      const reviewRegions = (recognized.regions || []).filter(region =>
        ["visual_only", "unresolved", "failed"].includes(region.status));
      page.ocrReviewRequired = reviewRegions.length > 0;
      page.ocrReviewRegions = reviewRegions.map(region => ({
        id: region.id, candidateId: region.candidateId || "", bbox: region.bbox,
        status: region.status, reason: region.reason || "", visualFallbackCoverage: Boolean(region.visualFallbackCoverage)
      }));
      // Scheduling is terminal for visual-only regions, but their text is not
      // verified. Keep those concepts separate for quality and IR consumers.
      page.requiresOcr = recognized.status !== "completed" || (!recognized.regions && !recognized.text.trim());
    }
  }
  layout.visualMap.summary.ocrPages = (ocr.pages || []).filter(p => p.status === "completed" && p.text.trim()).length;
  layout.visualMap.summary.pendingOcrPages = layout.visualMap.pages.filter(p => p.requiresOcr).length;
  layout.visualMap.summary.ocrReviewPages = layout.visualMap.pages.filter(p => p.ocrReviewRequired).length;
  layout.visualMap.summary.ocrReviewRegions = layout.visualMap.pages.reduce((sum, page) => sum + (page.ocrReviewRegions || []).length, 0);
  layout.ocr = { ...ocr, markdown: undefined, pages: undefined };
  return applyPdfReadingOrder(layout);
}

export { mergeNativeAndOcrText };
