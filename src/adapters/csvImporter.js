import { readFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../core/errors.js";
export function parseCsvLine(line) {
const cells = [];
let current = "";
let inQuotes = false;
for (let index = 0; index < line.length; index += 1) {
const char = line[index];
const next = line[index + 1];
if (char === "\"" && inQuotes && next === "\"") {
current += "\"";
index += 1;
continue;
}
if (char === "\"") {
inQuotes = !inQuotes;
continue;
}
if (char === "," && !inQuotes) {
cells.push(current);
current = "";
continue;
}
current += char;
}
cells.push(current);
return cells;
}
export function normalizeColumnNames(rawColumns) {
const counts = new Map();
return rawColumns.map((raw, index) => {
const trimmed = raw.trim();
const base = trimmed || `column_${index + 1}`;
const count = counts.get(base) ?? 0;
counts.set(base, count + 1);
return count === 0 ? base : `${base}_${count + 1}`;
});
}
export function inferType(values) {
const nonEmpty = values.filter((value) => value !== "");
if (nonEmpty.length === 0) return "unknown";
const numericCount = nonEmpty.filter((value) => Number.isFinite(Number(value))).length;
if (numericCount / nonEmpty.length >= 0.9) return "number";
const booleanCount = nonEmpty.filter((value) => /^(true|false|yes|no|0|1)$/i.test(value)).length;
if (booleanCount / nonEmpty.length >= 0.9) return "boolean";
const dateCount = nonEmpty.filter((value) => !Number.isNaN(Date.parse(value))).length;
if (dateCount / nonEmpty.length >= 0.9) return "date";
return "string";
}
export function parseCsvPreview(content, limit = 500) {
const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const lines = normalized.split("\n").filter((line, index, all) => line.length > 0 || index < all.length - 1);
if (lines.length === 0) throw new AppError("csv_empty", "CSV file is empty.");
const columns = normalizeColumnNames(parseCsvLine(lines[0]));
const rows = lines.slice(1, limit + 1).map((line) => {
const cells = parseCsvLine(line);
return Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? ""]));
});
const columnRecords = columns.map((column) => {
const values = rows.map((row) => String(row[column] ?? ""));
return {
name: column,
inferredType: inferType(values),
nullable: values.some((value) => value === "")
};
});
return {
sheetId: "csv",
name: "CSV",
columns: columnRecords,
previewRows: rows,
totalRowsEstimate: Math.max(lines.length - 1, 0)
};
}
export const csvImporter = {
name: "csv-importer",
canHandle(file) {
return path.extname(file.sourcePath ?? file).toLowerCase() === ".csv";
},
async inspect(input) {
const content = await readFile(input.sourcePath, "utf8");
return parseCsvPreview(content, input.limit ?? 500);
},
async import(input) {
const preview = await this.inspect(input);
return {
sheets: [preview],
rowCountEstimate: preview.totalRowsEstimate
};
}
};