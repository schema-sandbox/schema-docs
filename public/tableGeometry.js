// A plain Markdown table remains readable by other applications. This bounded
// comment records only spans; it cannot contain HTML, scripts, or hidden content.
export function readTableMarker(line) {
  const match = /^<!-- schema-table: (.{1,16000}) -->$/.exec(String(line || "").trim());
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]);
    return value?.v === 1 && Array.isArray(value.spans) ? value : null;
  } catch { return null; }
}

export function validateTableGeometry(metadata, rows) {
  if (!metadata || !rows.length || !Number.isInteger(metadata.rows) || !Number.isInteger(metadata.cols)
    || metadata.rows !== rows.length || metadata.cols < 1 || metadata.cols > 1000
    || metadata.rows * metadata.cols > 100000 || metadata.spans.length > 10000
    || rows.some(row => row.length !== metadata.cols)) return null;
  const anchors = new Map(), covered = new Set(), occupied = new Set();
  for (const span of metadata.spans) {
    if (!Array.isArray(span) || span.length !== 4 || !span.every(Number.isInteger)) return null;
    const [r, c, height, width] = span;
    if (r < 0 || c < 0 || height < 1 || width < 1 || r + height > metadata.rows || c + width > metadata.cols) return null;
    for (let y = r; y < r + height; y++) for (let x = c; x < c + width; x++) {
      const key = `${y}:${x}`;
      if (occupied.has(key)) return null;
      occupied.add(key);
      if (y !== r || x !== c) {
        // Editing a formerly covered cell invalidates the spans, so content can
        // never disappear behind stale or malicious geometry metadata.
        if (String(rows[y][x]).trim()) return null;
        covered.add(key);
      }
    }
    anchors.set(`${r}:${c}`, { rowSpan: height, columnSpan: width });
  }
  return { anchors, covered, spans: metadata.spans, rowCount: metadata.rows, columnCount: metadata.cols };
}

export function tableGeometryPlugin(md) {
  md.renderer.rules.schema_table_hidden = () => "";
  md.core.ruler.after("block", "schema_table_geometry", state => {
    const lines = state.src.split(/\r?\n/), tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const table = tokens[i];
      if (table.type !== "table_open") continue;
      const metadata = readTableMarker(lines[(table.map?.[0] ?? 0) - 1]);
      if (!metadata) continue;
      const rows = [], cells = [];
      let end = i + 1, row = -1, column = 0;
      for (; end < tokens.length && tokens[end].type !== "table_close"; end++) {
        const token = tokens[end];
        if (token.type === "tr_open") { rows.push([]); row++; column = 0; }
        if (token.type === "th_open" || token.type === "td_open") {
          rows[row].push(tokens[end + 1]?.content || "");
          cells.push({ index: end, row, column: column++ });
        }
      }
      const geometry = validateTableGeometry(metadata, rows);
      if (!geometry) continue;
      table.meta = { ...(table.meta || {}), geometry };
      for (const cell of cells) {
        const token = tokens[cell.index], key = `${cell.row}:${cell.column}`;
        token.meta = { ...(token.meta || {}), geometry: geometry.anchors.get(key), covered: geometry.covered.has(key) };
        const span = token.meta.geometry;
        if (span?.rowSpan > 1) token.attrSet("rowspan", String(span.rowSpan));
        if (span?.columnSpan > 1) token.attrSet("colspan", String(span.columnSpan));
        if (token.meta.covered) {
          // Keep token kinds for the DOCX compiler; HTML renderer ignores them.
          for (let k = 0; k < 3; k++) tokens[cell.index + k].hidden = true;
          tokens[cell.index + 1].content = "";
        }
      }
      // HTML rowspans cannot cross thead/tbody boundaries. Preserve the source
      // grid in one row group when a first-row cell continues into the body.
      if (geometry.spans.some(([r, , height]) => r === 0 && height > 1)) {
        for (let k = i + 1; k < end; k++) {
          if (tokens[k].type === "thead_open") tokens[k].tag = "tbody";
          if (tokens[k].type === "thead_close" || tokens[k].type === "tbody_open") tokens[k].hidden = true;
        }
      }
    }
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type === "html_block" && readTableMarker(token.content)) token.type = "schema_table_hidden";
      if (token.type === "paragraph_open" && readTableMarker(tokens[i+1]?.content)) {
        for (let k = 0; k < 3; k++) tokens[i+k].type = "schema_table_hidden";
      }
    }
  });
}
