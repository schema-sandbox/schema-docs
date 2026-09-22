function normalizedText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function furnitureIdentity(text) {
  const value = normalizedText(text);
  // Mask only the folio, keeping business numbers and any total page count intact.
  const match = value.match(/^(.*\bpage\s+)([1-9]\d{0,3})(\s*(?:of\s+|\/\s*)[1-9]\d{0,3})?$/)
    || value.match(/^(\u7b2c\s*)([1-9]\d{0,3})(\s*\u9875(?:\s*[,\uff0c/]?\s*\u5171\s*[1-9]\d{0,3}\s*\u9875)?)$/)
    || value.match(/^()([1-9]\d{0,3})()$/);
  return match ? {key:`folio:${match[1]}#${match[3] || ""}`,folio:Number(match[2])} : {key:`text:${value}`,folio:null};
}

// Source coordinates and repeated physical pages are both required. Canonical
// content is retained; callers may omit verified furniture in a reading view.
export function pdfPageFlowContext(markdown, visualMap) {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const pages = [], byNumber = new Map((visualMap?.pages || []).map(p => [p.page, p]));
  let current = null, fence = null;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim(), marker = text.match(/^(?:`{3,}|~{3,})/);
    if (marker) { fence = fence?.[0] === marker[0][0] && marker[0].length >= fence.length ? null : fence || marker[0]; }
    const page = !fence && text.match(/^<!--\s*pdf-page:\s*(\d+)(?:\s*;[^>]*)?\s*-->$/);
    if (page) { current = {number:Number(page[1]), indices:[], code:new Set()}; pages.push(current); }
    else if (current && text) { current.indices.push(i); if (fence || marker) current.code.add(i); }
  }
  const groups = new Map(), furniture = [], ignored = new Set();
  if(new Set(pages.map(p=>p.number)).size!==pages.length) return {lines,pages:[],byNumber,ignored,furniture};
  for (const page of pages) {
    const meta = byNumber.get(page.number);
    if (!meta || meta.ocr || meta.requiresOcr || ![meta.height,meta.width,...(meta.coordinateOrigin || [0,0])].every(Number.isFinite)
      || !(meta.height > 0) || !(meta.width > 0)) continue;
    for (const item of (meta.paragraphEdges?.margins || []).slice(0,6)) {
      const box = item.bbox;
      if (!Array.isArray(box) || box.length !== 4 || ![...box,item.fontSize].every(Number.isFinite)
        || box[2] <= box[0] || box[3] <= box[1] || item.fontSize <= 0 || typeof item.text !== "string" || item.text.length > 90) continue;
      const top = (box[1]-(meta.coordinateOrigin?.[1] || 0))/meta.height;
      const bottom = (box[3]-(meta.coordinateOrigin?.[1] || 0))/meta.height;
      if (!(item.position === "top" ? top >= 0 && bottom < .1 : item.position === "bottom" && top > .9 && bottom <= 1)) continue;
      const matches = page.indices.filter(i => !page.code.has(i) && lines[i].trim() === item.text);
      if (matches.length !== 1) continue;
      const index = matches[0], edge = item.position === "top" ? page.indices.slice(0,3) : page.indices.slice(-3);
      if (!edge.includes(index)) continue;
      const identity = furnitureIdentity(item.text), key = item.position+":"+identity.key;
      const entries = groups.get(key) || [];
      entries.push({page:page.number,index,text:item.text,bbox:box,font:item.fontSize,top,folio:identity.folio,
        x:(box[0]-(meta.coordinateOrigin?.[0] || 0))/meta.width,position:item.position});
      groups.set(key,entries);
    }
  }
  for (const entries of groups.values()) {
    if (new Set(entries.map(e=>e.page)).size < 3 || entries.length !== new Set(entries.map(e=>e.page)).size) continue;
    if (entries[0].folio !== null && new Set(entries.map(e=>e.folio-e.page)).size !== 1) continue;
    if ([['top',.008],['x',.025],['font',.5]].some(([key,tolerance]) => Math.max(...entries.map(e=>e[key]))-Math.min(...entries.map(e=>e[key])) > tolerance)) continue;
    for (const entry of entries) {
      ignored.add(entry.index);
      furniture.push({text:entry.text,position:entry.position,sourceRefs:[{kind:"pdf",pageNumber:entry.page,lineNumber:entry.index+1,bbox:entry.bbox}]});
    }
  }
  for (const page of pages) {
    page.indices = page.indices.filter(i=>!ignored.has(i));
    page.first = page.indices[0] ?? null; page.last = page.indices.at(-1) ?? null;
  }
  return {lines,pages,byNumber,ignored,furniture};
}

/** Mark repeated page text as a review candidate without deleting content. */
export function annotateRepeatedPageText(documentIr, options = {}) {
  const pages = Array.isArray(documentIr?.pages) ? documentIr.pages : [];
  const blocks = Array.isArray(documentIr?.blocks) ? documentIr.blocks : [];
  const byId = new Map(blocks.map(block => [block.id, block]));
  const occurrences = new Map();
  for (const page of pages) {
    const seenOnPage = new Set();
    for (const id of page.blocks || []) {
      const block = byId.get(id);
      const text = normalizedText(block?.text);
      if (!block || !text || text.length < Number(options.minLength || 3) || seenOnPage.has(text)) continue;
      seenOnPage.add(text);
      const entry = occurrences.get(text) || { pages: [], blocks: [] };
      entry.pages.push(page.pageNumber);
      entry.blocks.push(block);
      occurrences.set(text, entry);
    }
  }
  let markedCount = 0;
  for (const entry of occurrences.values()) {
    const distinctPages = new Set(entry.pages.filter(pageNumber => pageNumber !== null && pageNumber !== undefined));
    if (distinctPages.size < Number(options.minPages || 2)) continue;
    for (const block of entry.blocks) {
      block.qualitySignals = {
        ...(block.qualitySignals || {}),
        repeatedPageText: true,
        noiseCandidate: true,
        noisePosition: block.ordinal <= 1 ? "top" : "body_or_bottom"
      };
      markedCount += 1;
    }
  }
  return { repeatedTextCount: [...occurrences.values()].filter(entry => new Set(entry.pages).size >= Number(options.minPages || 2)).length, markedCount };
}
