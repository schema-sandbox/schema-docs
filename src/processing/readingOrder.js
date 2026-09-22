import { pdfPagePieces } from '../adapters/pdfPageStream.js';
function normalizeBox(box) {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const values = box.map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [x0, top, x1, bottom] = values;
  if (x1 < x0 || bottom < top) return null;
  return { x0, top, x1, bottom, width: x1 - x0, height: bottom - top };
}

function clusterColumns(entries, columnGap) {
  const columns = [];
  for (const entry of [...entries].sort((a, b) => a.box.x0 - b.box.x0 || a.index - b.index)) {
    const candidate = columns[columns.length - 1];
    if (!candidate || entry.box.x0 - candidate.maxX > columnGap) {
      columns.push({ entries: [entry], maxX: entry.box.x1 });
    } else {
      candidate.entries.push(entry);
      candidate.maxX = Math.max(candidate.maxX, entry.box.x1);
    }
  }
  return columns;
}

function sortColumn(entries, rowTolerance) {
  return [...entries].sort((a, b) => {
    const topDelta = a.box.top - b.box.top;
    if (Math.abs(topDelta) > rowTolerance) return topDelta;
    return a.box.x0 - b.box.x0 || a.index - b.index;
  });
}

function classifyBlock(block, pageWidth = 0, pageHeight = 0, origin = [0,0], bodyFont = 0, referenceText = "") {
  const text = String(block?.text || "").trim();
  const box = normalizeBox(block?.bbox);
  if (block?.type === "image") return "figure";
  if (block?.type === "table") return "table";
  if (block?.type === "formula") return "formula";
  if (/^(?:figure|fig\.?|table|\u56fe|\u5716|\u8868)\s*[A-Za-z]?\d+(?:[.\s:：-]|$)/i.test(text) && text.length <= 240) return "caption";
  const noteNumber=text.match(/^\[?(\d{1,3})\]?\s/)?.[1];
  const noteEvidence=/^\[\d{1,3}\]/.test(text) || (bodyFont && block.qualitySignals?.fontSize<bodyFont*.9)
    || (noteNumber && new RegExp(`\\[${noteNumber}\\]|\\^${noteNumber}\\b`).test(referenceText));
  if (noteNumber && noteEvidence && box && pageHeight && box.top-origin[1] > pageHeight * .78) return "footnote";
  if (box && pageWidth && box.width < pageWidth * .3 && box.x0-origin[0] > pageWidth * .6
    && (/^(?:note:|key point:|\u63d0\u793a|\u6ce8\u610f|\u6ce8[：:])/i.test(text) || (bodyFont && block.qualitySignals?.fontSize<bodyFont*.85))) return "sidebar";
  if (["heading","title"].includes(block.type) || /^#{1,6}\s+/.test(text)) return "heading";
  return "body";
}

function annotateRelations(blocks, pageWidth, pageHeight, origin) {
  const fonts=blocks.map(b=>b.qualitySignals?.fontSize).filter(n=>Number.isFinite(n)&&n>0).sort((a,b)=>a-b);
  const bodyFont=fonts[Math.floor(fonts.length/2)] || 0;
  const entries = blocks.map((block, index) => ({ block, index, box: normalizeBox(block?.bbox),
    role: classifyBlock(block, pageWidth, pageHeight, origin, bodyFont, blocks.filter(other=>other!==block).map(other=>other.text || "").join("\n")) }));
  for (const entry of entries) {
    entry.block.layoutRole = entry.role;
    if (entry.role !== "caption" || !entry.box) continue;
    const target = entries.filter(candidate => ["figure", "table"].includes(candidate.role) && candidate.box
      && ((candidate.box.bottom<=entry.box.top && entry.box.top-candidate.box.bottom<=Math.max(36,entry.box.height*4))
        || (candidate.role==='table' && candidate.box.top>=entry.box.bottom && candidate.box.top-entry.box.bottom<=36))
      && Math.min(entry.box.x1, candidate.box.x1) > Math.max(entry.box.x0, candidate.box.x0))
      .sort((a, b) => (entry.box.top - a.box.bottom) - (entry.box.top - b.box.bottom))[0];
    if (target) {
      entry.block.captionForBlockId = target.block.id;
      target.block.captionBlockId = entry.block.id;
    }
  }
  return entries;
}

function constrainedOrder(blocks, constraints = []) {
  const body=blocks.filter(b=>!['footnote','sidebar'].includes(b.layoutRole) && !b.captionForBlockId);
  const side=blocks.filter(b=>b.layoutRole==='sidebar'),notes=blocks.filter(b=>b.layoutRole==='footnote');
  const chain=[...body,...side,...notes];
  const edges=constraints.map(e=>({...e}));
  for(let i=1;i<chain.length;i++) edges.push({before:chain[i-1].id,after:chain[i].id,reason:'body_then_supplement'});
  for(const caption of blocks.filter(b=>b.captionForBlockId)) {
    const target=blocks.find(b=>b.id===caption.captionForBlockId),index=chain.indexOf(target);
    if(target?.type==='table' && caption.bbox?.[3]<=target.bbox?.[1]) {
      edges.push({before:caption.id,after:target.id,reason:'table_caption'});
      if(index>0) edges.push({before:chain[index-1].id,after:caption.id,reason:'caption_anchor'});
    } else {
      edges.push({before:target.id,after:caption.id,reason:'figure_caption'});
      if(chain[index+1]) edges.push({before:caption.id,after:chain[index+1].id,reason:'caption_anchor'});
    }
  }
  for(const note of notes) {
    const number=note.text.match(/^\[?(\d{1,3})\]?\s/)?.[1];
    const matches=body.filter(b=>new RegExp(`\\[${number}\\]|\\^${number}\\b`).test(b.text || ''));
    if(matches.length===1) note.noteForBlockId=matches[0].id;
  }
  const byId=new Map(blocks.map(b=>[b.id,b])),outgoing=new Map(blocks.map(b=>[b.id,new Set()])),counts=new Map(blocks.map(b=>[b.id,0]));
  for(const edge of edges) {
    if(!byId.has(edge.before)||!byId.has(edge.after)||edge.before===edge.after) continue;
    const next=outgoing.get(edge.before);if(next.has(edge.after)) continue;
    next.add(edge.after);counts.set(edge.after,counts.get(edge.after)+1);
  }
  const order=[],remaining=new Set(byId.keys());
  while(remaining.size) {
    const next=blocks.find(b=>remaining.has(b.id)&&counts.get(b.id)===0);
    if(!next) return {orderedBlocks:blocks,constraints:edges,conflict:true};
    remaining.delete(next.id);order.push(next);
    for(const target of outgoing.get(next.id)) counts.set(target,counts.get(target)-1);
  }
  return {orderedBlocks:order,constraints:edges,conflict:false};
}

export function orderPageBlocks(blocks, options = {}) {
  const originalBlocks = Array.isArray(blocks) ? [...blocks] : [];
  const pageWidth = Number(options.pageWidth || Math.max(...originalBlocks.map(block => Number(block?.bbox?.[2]) || 0), 0));
  const pageHeight = Number(options.pageHeight || Math.max(...originalBlocks.map(block => Number(block?.bbox?.[3]) || 0), 0));
  const annotated = annotateRelations(originalBlocks, pageWidth, pageHeight, options.coordinateOrigin || [0,0]);
  if (options.preserveSourceOrder) {
    const ordered=constrainedOrder(originalBlocks,options.constraints);
    return {
    ...ordered, columnCount: 0, confidence: ordered.conflict?"unknown":"medium", strategy: ordered.conflict?"preserved":"source_markdown", reason: ordered.conflict?"constraint_conflict":"extractor_source_order",
    layoutRoles: annotated.map(entry => ({ id: entry.block.id, role: entry.role, captionForBlockId: entry.block.captionForBlockId || null }))
  };
  }
  const entries = originalBlocks.map((block, index) => ({ block, index, box: normalizeBox(block?.bbox) }));
  const positioned = entries.filter((entry) => entry.box);
  if (originalBlocks.length < 2) {
    return { orderedBlocks: originalBlocks, columnCount: 0, confidence: "unknown", strategy: "preserved", reason: "too_few_blocks", layoutRoles: annotated.map(entry => ({ id: entry.block.id, role: entry.role })) };
  }
  if (positioned.length !== originalBlocks.length) {
    return { orderedBlocks: originalBlocks, columnCount: 0, confidence: "unknown", strategy: "preserved", reason: "missing_bbox", layoutRoles: annotated.map(entry => ({ id: entry.block.id, role: entry.role })) };
  }
  const columnGap = Math.max(0, Number(options.columnGap ?? 48));
  const rowTolerance = Math.max(0, Number(options.rowTolerance ?? 8));
  const columns = clusterColumns(positioned, columnGap);
  const orderedBlocks = columns.flatMap((column) => sortColumn(column.entries, rowTolerance).map((entry) => entry.block));
  return {
    orderedBlocks,
    columnCount: columns.length,
    confidence: columns.length > 1 ? "medium" : "high",
    strategy: columns.length > 1 ? "column_major" : "top_left",
    reason: "positioned_blocks",
    layoutRoles: annotated.map(entry => ({ id: entry.block.id, role: entry.role, captionForBlockId: entry.block.captionForBlockId || null }))
  };
}

export function applyReadingOrderToPage(page, blocks, options = {}) {
  const result = orderPageBlocks(blocks, options);
  page.blocks = result.orderedBlocks.map((block) => block.id);
  page.quality = {
    ...(page.quality || {}),
    readingOrder: {
      strategy: result.strategy,
      confidence: result.confidence,
      columnCount: result.columnCount,
      reason: result.reason,
      constraints: result.constraints || [],
      conflict: result.conflict || false,
      layoutRoles: result.layoutRoles || []
    }
  };
  result.orderedBlocks.forEach((block, index) => {
    block.readingOrder = index;
  });
  return result;
}

/** One canonical local order is consumed by Markdown, DocumentIR and chunk/export paths. */
export function applyPdfReadingOrder(layout) {
  const byPage=new Map((layout.visualMap?.pages || []).map(page=>[page.page,page]));
  const orderedPieces=[];
  const orderPiece=piece=>{
    const page=byPage.get(Number(piece.match(/^<!-- pdf-page: (\d+)/)?.[1]));
    if(!page || /^(?:```|~~~)/m.test(piece)) return piece;
    const lines=piece.split(/\r?\n/),header=lines.shift(),blocks=[];
    const source=(page.textLines || page.paragraphEdges?.lines || []).map(line=>({...line,used:false}));
    for(const [index,line] of lines.entries()) {
      const text=line.trim();
      if(!text) {if(blocks.length) blocks.at(-1).lines.push(line);continue;}
      if(/^\|.*\|$/.test(text) && blocks.at(-1)?.type==='table') {blocks.at(-1).lines.push(line);continue;}
      const type=/^\|.*\|$|^<!-- schema-table:/.test(text)?'table':/^<!-- pdf-image:|^!\[/.test(text)?'image':/^#{1,6}\s/.test(text)?'heading':'paragraph';
      const region=(page.regions || []).find(r=>r.assetFile && text.includes(r.assetFile));
      const geometry=source.find(item=>!item.used && item.text.replace(/\s/g,'')===text.replace(/^#{1,6}\s+/,'').replace(/\s/g,''));
      if(geometry) geometry.used=true;
      blocks.push({id:`line-${index+2}`,text,type,lines:[line],bbox:region?.bbox || geometry?.bbox,
        qualitySignals:{fontSize:geometry?.fontSize}});
    }
    const ordered=orderPageBlocks(blocks,{pageWidth:page.width,pageHeight:page.height,coordinateOrigin:page.coordinateOrigin,preserveSourceOrder:true});
    page.readingOrder={...(page.readingOrder || {}),localConstraints:ordered.constraints,conflict:ordered.conflict,
      roles:ordered.layoutRoles};
    if(ordered.conflict || ordered.orderedBlocks.every((block,index)=>block===blocks[index])) return piece;
    return [header,'',...ordered.orderedBlocks.flatMap(block=>['sidebar','footnote','caption'].includes(block.layoutRole)?['',...block.lines,'']:block.lines),''].join('\n');
  };
  for(const piece of pdfPagePieces(String(layout.markdown || ''))) orderedPieces.push(orderPiece(piece));
  layout.markdown=orderedPieces.join('');
  return layout;
}
