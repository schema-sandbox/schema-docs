function stringifyCell(value) {
if (value === null || value === undefined) return "";
return String(value);
}
function escapeMarkdownCell(value) {
return stringifyCell(value).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}
function escapeCsvCell(value) {
const text = stringifyCell(value);
if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }
  return text;
}
export function rowsToMarkdownTable(columns, rows) {
  const safeColumns = columns.length > 0 ? columns : Object.keys(rows[0] ?? {});
  if (safeColumns.length === 0) return "";
  const joinCells = (cells) => `| ${cells.join(" | ")} |`;
  const header = joinCells(safeColumns.map(escapeMarkdownCell));
  const separator = joinCells(safeColumns.map(() => "---"));
  const body = rows.map((row) => {
    return joinCells(safeColumns.map((column) => escapeMarkdownCell(row[column])));
  });
  return [header, separator, ...body].join("\n");
}
export function rowsToCsv(columns, rows) {
  const safeColumns = columns.length > 0 ? columns : Object.keys(rows[0] ?? {});
  if (safeColumns.length === 0) return "";
  const header = safeColumns.map(escapeCsvCell).join(",");
  const body = rows.map((row) => {
    return safeColumns.map((column) => escapeCsvCell(row[column])).join(",");
  });
  return [header, ...body].join("\n");
}
export function queryResultToExport(result, format) {
  if (format === "markdown") return rowsToMarkdownTable(result.columns ?? [], result.rows ?? []);
  if (format === "csv") return rowsToCsv(result.columns ?? [], result.rows ?? []);
  throw new Error(`Unsupported export format: ${format}`);
}