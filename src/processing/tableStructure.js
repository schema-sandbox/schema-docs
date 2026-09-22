import { createHash } from "node:crypto";
import { readTableMarker, validateTableGeometry } from "../../public/tableGeometry.js";
import { pdfPageFlowContext } from "./pageNoise.js";

function splitPipeRow(line) {
  const source = String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  let escaped = false;
  for (const character of source) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  if (escaped) current += "\\";
  cells.push(current.trim());
  return cells;
}

function isTableLine(line) {
  return /^\s*\|.*\|\s*$/.test(String(line || ""));
}

function isSeparatorCell(cell) {
  return /^:?-{3,}:?$/.test(String(cell || "").trim());
}

export function parseMarkdownTable(markdown) {
  const lines = String(markdown || "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2 || !lines.every(isTableLine)) {
    return { status: "unknown", rows: [], headers: [], columnCount: 0, rowCount: 0, warnings: ["table_markdown_not_complete"] };
  }
  const headers = splitPipeRow(lines[0]);
  const separator = splitPipeRow(lines[1]);
  if (!separator.length || !separator.every(isSeparatorCell)) {
    return { status: "unknown", rows: [], headers, columnCount: headers.length, rowCount: 0, warnings: ["table_header_separator_missing"] };
  }
  const rows = [headers, ...lines.slice(2).map(splitPipeRow)];
  const columnCount = Math.max(headers.length, ...rows.map((row) => row.length));
  const inconsistentRows = rows.some((row) => row.length !== columnCount);
  return {
    status: inconsistentRows ? "partial" : "structured",
    rows,
    headers,
    columnCount,
    rowCount: rows.length,
    separatorRowIndex: 1,
    warnings: inconsistentRows ? ["table_row_width_inconsistent"] : []
  };
}

function stableTableId(prefix, text) {
  return `${prefix}_${createHash("sha1").update(String(text), "utf8").digest("hex").slice(0, 12)}`;
}

function isSingleTableBlock(block) {
  return block?.type === "table"
    && String(block.text || "").trim().startsWith("|")
    && String(block.text || "").split(/\r?\n/).every((line) => !line.trim() || isTableLine(line));
}

export function annotateMarkdownTableBlocks(blocks, options = {}) {
  const list = Array.isArray(blocks) ? blocks : [];
  const annotated = [];
  let group = [];
  let geometryMetadata = null;
  const flush = () => {
    if (!group.length) return;
    const tableText = group.map((block) => block.text).join("\n");
    const parsed = parseMarkdownTable(tableText);
    const geometry = validateTableGeometry(geometryMetadata, parsed.rows);
    if (parsed.status !== "unknown") {
      const tableId = stableTableId(options.prefix || "table", tableText);
      let dataRowIndex = 0;
      group.forEach((block, blockIndex) => {
        const role = blockIndex === 0 ? "header" : (blockIndex === 1 ? "separator" : "row");
        const rowIndex = role === "separator" ? null : dataRowIndex++;
        const cells = role === "separator" ? [] : (parsed.rows[role === "header" ? 0 : blockIndex - 1] || []);
        const cellRefs = cells.map((_, cellIndex) => (Array.isArray(block.sourceRefs) ? block.sourceRefs : [])
          .map((ref) => ({ ...ref, cellIndex })));
        block.tableStructure = {
          tableId,
          status: parsed.status,
          rowRole: role,
          rowIndex,
          rowCount: parsed.rowCount,
          columnCount: parsed.columnCount,
          cells,
          cellRefs,
          spans: geometry?.spans || [],
          cellGeometry: cells.map((_, column) => ({
            rowSpan: geometry?.anchors.get(`${rowIndex}:${column}`)?.rowSpan || 1,
            columnSpan: geometry?.anchors.get(`${rowIndex}:${column}`)?.columnSpan || 1,
            covered: geometry?.covered.has(`${rowIndex}:${column}`) || false
          })),
          headers: parsed.headers,
          warnings: parsed.warnings
        };
        block.qualitySignals = {
          ...(block.qualitySignals || {}),
          tableStructure: {
            status: parsed.status,
            rowIndex,
            rowCount: parsed.rowCount,
            columnCount: parsed.columnCount
          }
        };
      });
    }
    annotated.push(...group);
    group = [];
    geometryMetadata = null;
  };
  for (const block of list) {
    if (isSingleTableBlock(block)) group.push(block);
    else {
      flush();
      geometryMetadata = readTableMarker(block.text);
      annotated.push(block);
    }
  }
  flush();
  return annotated;
}

export function summarizeVisualTableRegion(region = {}) {
  const rowCount = Number(region.rowCount ?? region.rows?.length ?? 0);
  const columnCount = Number(region.columnCount ?? region.columns?.length ?? 0);
  const hasGrid = rowCount > 0 && columnCount > 0;
  return {
    status: hasGrid ? "structured" : "unknown",
    rowCount: hasGrid ? rowCount : 0,
    columnCount: hasGrid ? columnCount : 0,
    headers: Array.isArray(region.headers) ? region.headers.map(String) : [],
    spans: Array.isArray(region.spans) ? structuredClone(region.spans) : [],
    warnings: hasGrid ? [] : ["visual_table_grid_unresolved"]
  };
}

function tableMarkdown(rows, spans = []) {
  const row = cells => `| ${cells.map(c=>String(c).replace(/\|/g,"\\|")).join(" | ")} |`;
  const lines = [row(rows[0]),row(rows[0].map(()=>"---")),...rows.slice(1).map(row)];
  if (spans.length) lines.unshift(`<!-- schema-table: ${JSON.stringify({v:1,rows:rows.length,cols:rows[0].length,spans})} -->`);
  return lines.join("\n");
}

function sourceTable(region, meta) {
  if (region.type !== "table" || region.needsVisualFallback || !region.inlinePlaceholder || !Array.isArray(region.rows)) return null;
  const rows = region.rows.map(row=>row.map(c=>String(c ?? "").replace(/\s*\n\s*/g,"; ").trim()));
  const spans = region.spans || [], cols = rows[0]?.length, headers = region.headerRowCount || 1;
  const geometry = validateTableGeometry({rows:rows.length,cols,spans},rows);
  const box = region.bbox, cells = region.cellBoxes;
  if (!geometry || rows.length <= headers || cols < 2 || cols > 60 || !Number.isInteger(headers) || headers < 1 || headers > 3
    || !Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite) || box[2] <= box[0] || box[3] <= box[1]
    || !Array.isArray(cells) || !cells.length || !Number.isFinite(meta.width) || !Number.isFinite(meta.height)
    || meta.width <= 0 || meta.height <= 0 || rows.slice(0,headers).flat().filter(c=>/\p{L}/u.test(c)).length < 2) return null;
  // Ruled tables do not yet carry a reliable multi-level header depth.
  if (!region.headerRowCount && spans.some(([r])=>r===0)) return null;
  if (spans.some(([r,,height])=>r<headers && r+height>headers)) return null;
  const xs = new Map(), occupied = new Set();
  for (const cell of cells) {
    const {row:r,column:c,rowSpan:rs,columnSpan:cs,bbox:b} = cell;
    if (![r,c,rs,cs].every(Number.isInteger) || r<0 || c<0 || rs<1 || cs<1 || r+rs>rows.length || c+cs>cols
      || !Array.isArray(b) || b.length!==4 || !b.every(Number.isFinite) || b[2]<=b[0] || b[3]<=b[1]) return null;
    const expected=geometry.anchors.get(`${r}:${c}`);
    if(rs!==(expected?.rowSpan || 1) || cs!==(expected?.columnSpan || 1)) return null;
    for(let y=r;y<r+rs;y++) for(let x=c;x<c+cs;x++) {
      if(occupied.has(`${y}:${x}`)) return null; occupied.add(`${y}:${x}`);
    }
    for(const [column,x] of [[c,b[0]],[c+cs,b[2]]]) {
      if(xs.has(column) && Math.abs(xs.get(column)-x)>1) return null;
      xs.set(column,x);
    }
  }
  if(occupied.size!==rows.length*cols || xs.size!==cols+1) return null;
  const origin=meta.coordinateOrigin || [0,0];
  if(!origin.every(Number.isFinite) || box[0]<origin[0] || box[2]>origin[0]+meta.width || box[1]<origin[1] || box[3]>origin[1]+meta.height) return null;
  const boundaries=Array.from({length:cols+1},(_,i)=>(xs.get(i)-origin[0])/meta.width);
  if(boundaries.some((x,i)=>!Number.isFinite(x) || x<0 || x>1 || (i>0 && x<=boundaries[i-1]))) return null;
  return {region,rows,spans,headers,boundaries,top:(box[1]-origin[1])/meta.height,bottom:(box[3]-origin[1])/meta.height};
}

function hasClosingSummary(table) {
  const last = table.rows.length-1;
  const labels = [...table.rows[last], ...table.spans.filter(([r,,h])=>r>=table.headers && r<last && r+h>last)
    .map(([r,c])=>table.rows[r][c])];
  // A terminal summary is a table boundary even if the next page repeats its grid.
  // Inspect body cells only: "Total" remains a valid column header in a continuation.
  return labels.some(text=>/^(?:(?:(?:grand|sub|net|page|overall|running)\s*)?total|sub-total|balance(?:\s+due)?|amount\s+due|(?:\u672c[\u9875\u9801\u8868]|\u7d2f[\u8ba1\u8a08])?(?:\u5408[\u8ba1\u8a08]|[\u603b\u7e3d][\u8ba1\u8a08\u989d\u984d]|\u5c0f[\u8ba1\u8a08]))\s*(?:[\uff08(][^()\uff08\uff09]{1,16}[\uff09)])?\s*[:\uff1a]?$/i.test(text.trim()));
}

function rowSequence(table) {
  const rows = hasClosingSummary(table) ? table.rows.slice(table.headers,-1) : table.rows.slice(table.headers);
  const labels = rows.map(row => /^(.*?)(\d+)\s*$/.exec(row[0]));
  if (!labels.length || labels.some(label=>!label)) return null;
  const prefix=labels[0][1].trim().toLowerCase(), values=labels.map(label=>Number(label[2]));
  if(labels.some(label=>label[1].trim().toLowerCase()!==prefix) || values.some((n,i)=>!Number.isSafeInteger(n) || (i>0 && n!==values[i-1]+1))) return null;
  return {prefix,first:values[0],last:values.at(-1),count:values.length};
}

/** Join complete rows only; never infer missing cells or split-row text. */
export function reflowPdfTables(markdown, visualMap) {
  const {lines,pages,byNumber,ignored} = pdfPageFlowContext(markdown,visualMap);
  for(const page of pages) {
    page.tables=[];
    const meta=byNumber.get(page.number);
    if(!meta || meta.ocr || meta.requiresOcr) continue;
    const sources=(meta.regions || []).map(r=>sourceTable(r,meta)).filter(Boolean);
    for(let cursor=0;cursor<page.indices.length;cursor++) {
      const start=page.indices[cursor];
      if(page.code.has(start) || !isTableLine(lines[start])) continue;
      let end=start;
      while(cursor+1<page.indices.length && page.indices[cursor+1]===end+1 && isTableLine(lines[end+1])) {end++;cursor++;}
      const raw=lines.slice(start,end+1).map(l=>l.trim()).join("\n");
      const candidates=sources.filter(s=>tableMarkdown(s.rows)===raw);
      if(candidates.length!==1) continue;
      const source=candidates[0], marker=readTableMarker(lines[start-1]);
      if(source.spans.length && (!marker || !validateTableGeometry(marker,source.rows)
        || JSON.stringify(marker.spans)!==JSON.stringify(source.spans))) continue;
      if(!source.spans.length && /^<!-- schema-table:/.test(lines[start-1]?.trim() || "")) continue;
      const tableStart=marker?start-1:start;
      const captionIndex=page.indices.filter(index=>index<tableStart).at(-1);
      const caption=typeof captionIndex==="number" ? /^(?:table|\u8868)\s*([A-Za-z]?\d+(?:[.-]\d+)*)(?:\b|[\s：:（(])/i.exec(lines[captionIndex].trim()) : null;
      page.tables.push({...source,start:tableStart,rowStart:start,end,page:page.number,
        caption:caption ? {id:caption[1].toLowerCase(),line:captionIndex,text:lines[captionIndex],continued:/\bcontinued\b|[\u7eed\u7e8c]/i.test(lines[captionIndex])} : null});
    }
  }
  const links=[], decisions=[], roots=new Map(), replacements=new Map(), removed=new Set(ignored);
  for(let i=1;i<pages.length;i++) {
    const before=pages[i-1],after=pages[i],a=before.tables.at(-1),b=after.tables[0];
    if(after.number!==before.number+1 || !a || !b || before.last!==a.end || (after.first!==b.start && after.first!==b.caption?.line)
      || a.bottom<.75 || a.bottom>1 || b.top<0 || b.top>.2 || a.headers!==b.headers
      || a.boundaries.length!==b.boundaries.length || a.boundaries.some((x,c)=>Math.abs(x-b.boundaries[c])>.005)
      || JSON.stringify(a.rows.slice(0,a.headers))!==JSON.stringify(b.rows.slice(0,b.headers))
      || JSON.stringify(a.spans.filter(([r])=>r<a.headers))!==JSON.stringify(b.spans.filter(([r])=>r<b.headers))) continue;
    const sequenceA=rowSequence(a),sequenceB=rowSequence(b);
    const explicit=Boolean(a.caption && b.caption?.continued && a.caption.id===b.caption.id);
    const continuous=sequenceA && sequenceB && sequenceA.prefix===sequenceB.prefix
      && sequenceA.last+1===sequenceB.first && sequenceA.count>=2;
    const continues=explicit || continuous;
    const restarted=sequenceA && sequenceB && sequenceA.prefix===sequenceB.prefix && sequenceB.first<=sequenceA.last;
    const conflictingCaption=Boolean(b.caption && (!a.caption || a.caption.id!==b.caption.id));
    const status=conflictingCaption || hasClosingSummary(a) || restarted ? "rejected" : continues ? "accepted" : "candidate";
    const reason=conflictingCaption ? "different_table_identity" : hasClosingSummary(a) ? "terminal_summary" : restarted ? "restarted_row_identifiers" : explicit ? "explicit_continued_caption" : continuous ? "continuous_row_identifiers" : "table_identity_unproven";
    const decision={fromPage:a.page,toPage:b.page,fromLine:a.rowStart+1,toLine:b.rowStart+1,status,reason,
      sourceHash:createHash("sha256").update((a.caption?.text || "")+tableMarkdown(a.rows,a.spans)+(b.caption?.text || "")+tableMarkdown(b.rows,b.spans)).digest("hex"),
      evidence:["adjacent_pages","edge_geometry","header_rows","column_boundaries",...(continuous?["continuous_row_identifiers"]:[]),...(explicit?["explicit_continued_caption"]:[])],
      sourceRefs:[{kind:"pdf",pageNumber:a.page,bbox:a.region.bbox},{kind:"pdf",pageNumber:b.page,bbox:b.region.bbox}]};
    decisions.push(decision);
    if(status!=="accepted") continue;
    const root=roots.get(a.start) || {...a,rows:[...a.rows],spans:[...a.spans]}, offset=root.rows.length-b.headers;
    if((root.rows.length+b.rows.length-b.headers)*root.rows[0].length>100000) continue;
    root.rows.push(...b.rows.slice(b.headers));
    root.spans.push(...b.spans.filter(([r])=>r>=b.headers).map(([r,c,h,w])=>[r+offset,c,h,w]));
    roots.set(b.start,root);
    replacements.set(root.start,tableMarkdown(root.rows,root.spans));
    for(let j=root.start+1;j<=root.end;j++) removed.add(j);
    for(let j=b.start;j<=b.end;j++) removed.add(j);
    if(explicit) removed.add(b.caption.line);
    links.push({...decision,headerRows:b.headers,rowOffset:offset,confidence:"medium"});
  }
  return {markdown:lines.map((line,i)=>removed.has(i)?"":replacements.get(i) ?? line).join("\n"),links,decisions};
}
