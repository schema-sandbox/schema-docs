export function normalizeMarkdownText(value) {
return String(value ?? "")
.replace(/\r\n?/g, "\n")
.replace(/\u0000/g, "")
.replace(/[ \t]+\n/g, "\n");
}
export function escapeMarkdownTableCell(value) {
return String(value ?? "")
.replace(/\r\n?/g, " ")
.replace(/\n/g, "<br>")
.replace(/\|/g, "\\|")
.trim();
}
export function markdownTable(rows, options = {}) {
const normalizedRows = rows
.map((row) => row.map((cell) => escapeMarkdownTableCell(cell)))
.filter((row) => row.some((cell) => cell !== ""));
if (normalizedRows.length === 0) return "";
const width = Math.max(...normalizedRows.map((row) => row.length));
const paddedRows = normalizedRows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ""));
const firstRow = paddedRows[0].map((cell, index) => cell || `Column ${index + 1}`);
const separator = Array.from({ length: width }, () => "---");
const body = options.header === false ? paddedRows : paddedRows.slice(1);
const formatRow = (row) => `| ${row.join(" | ")} |`;
return [formatRow(firstRow), formatRow(separator), ...body.map(formatRow)].join("\n");
}
export function datasetSheetsToMarkdown({ title, sourceName, sourceType, sheets = [] }) {
const lines = [
`# ${title || sourceName || "Dataset"}`,
""
];
for (const sheet of sheets) {
const columns = (sheet.columns || []).map((column) => column.name);
const rows = (sheet.previewRows || []).map((row) => columns.map((column) => row[column] ?? ""));
lines.push(`## ${sheet.name || sheet.sheetId || "Sheet"}`, "");
const preambleRows = sheet.preambleRows || [];
const preambleRowNumbers = sheet.preambleRowNumbers || [];
for (let index = 0; index < preambleRows.length;) {
const row = preambleRows[index];
if (row.length >= 2) {
const tableRows = [row];
let next = index + 1;
while (next < preambleRows.length
&& preambleRows[next].length === row.length
&& (!preambleRowNumbers.length || preambleRowNumbers[next] === preambleRowNumbers[next - 1] + 1)) {
tableRows.push(preambleRows[next]);
next += 1;
}
if (tableRows.length >= 2) {
lines.push(markdownTable(tableRows), "");
index = next;
continue;
}
}
const text = row.map((cell) => String(cell ?? "").trim()).filter(Boolean).join(" ");
if (text) lines.push(text, "");
index += 1;
}
lines.push(`Rows: ${Number(sheet.totalRowsEstimate || rows.length).toLocaleString()}`);
lines.push(`Columns: ${columns.length.toLocaleString()}`, "");
if (columns.length && rows.length) {
lines.push(markdownTable([columns, ...rows]));
} else {
lines.push("_No tabular data detected in this sheet._");
}
lines.push("");
}
return collapseMarkdownBlankLines(lines).join("\n").trimEnd() + "\n";
}
export function collapseMarkdownBlankLines(lines) {
const out = [];
let blank = 0;
for (const line of lines) {
if (!String(line).trim()) {
blank += 1;
if (blank <= 1) out.push("");
} else {
blank = 0;
out.push(String(line).replace(/[ \t]+$/g, ""));
}
}
while (out.length && !out[0].trim()) out.shift();
while (out.length && !out[out.length - 1].trim()) out.pop();
return out;
}
