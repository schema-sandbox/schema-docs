import path from "node:path";
import { listZipEntries, readZipEntry, readZipEntryFromFile } from "../core/zip.js";
import { getAttribute, getXmlBlocks, getXmlTextValues, stripXmlTags } from "../core/xml.js";
import { inferType, normalizeColumnNames } from "./csvImporter.js";
import { readFile } from "node:fs/promises";
function columnLettersToIndex(cellRef) {
const letters = /^[A-Z]+/i.exec(cellRef)?.[0]?.toUpperCase() ?? "";
let index = 0;
for (const letter of letters) {
index = index * 26 + (letter.charCodeAt(0) - 64);
}
return Math.max(index - 1, 0);
}
function readSharedStrings(sharedStringsXml) {
return getXmlBlocks(sharedStringsXml, "si").map((itemXml) => {
const runs = getXmlBlocks(itemXml, "r");
if (runs.length > 0) {
return {
rich: true,
runs: runs.map((runXml) => {
const fontTag = /<rFont\b[^>]*\/>/.exec(runXml)?.[0] ?? "";
return { text: getXmlTextValues(runXml, "t").join(""), font: getAttribute(fontTag, "val") ?? "" };
})
};
}
const textValues = getXmlTextValues(itemXml, "t");
return textValues.length > 0 ? textValues.join("") : stripXmlTags(itemXml).trim();
});
}
const symbolFontMap = new Map(Object.entries({
A: "Α", B: "Β", C: "Χ", D: "Δ", E: "Ε", F: "Φ", G: "Γ", H: "Η", I: "Ι", J: "ϑ",
K: "Κ", L: "Λ", M: "Μ", N: "Ν", O: "Ο", P: "Π", Q: "Θ", R: "Ρ", S: "Σ", T: "Τ",
U: "Υ", V: "ς", W: "Ω", X: "Ξ", Y: "Ψ", Z: "Ζ",
a: "α", b: "β", c: "χ", d: "δ", e: "ε", f: "φ", g: "γ", h: "η", i: "ι", j: "ϕ",
k: "κ", l: "λ", m: "μ", n: "ν", o: "ο", p: "π", q: "θ", r: "ρ", s: "σ", t: "τ",
u: "υ", v: "ϖ", w: "ω", x: "ξ", y: "ψ", z: "ζ"
}));
function decodeSymbolFont(value) {
return Array.from(String(value ?? ""), (character) => symbolFontMap.get(character) ?? character).join("");
}
function readCellStyles(stylesXml) {
if (!stylesXml) return [];
const fontsBlock = /<fonts\b[\s\S]*?<\/fonts>/.exec(stylesXml)?.[0] ?? "";
const fontNames = getXmlBlocks(fontsBlock, "font").map((fontXml) => {
const nameTag = /<name\b[^>]*\/>/.exec(fontXml)?.[0] ?? "";
return getAttribute(nameTag, "val") ?? "";
});
const cellXfsBlock = /<cellXfs\b[\s\S]*?<\/cellXfs>/.exec(stylesXml)?.[0] ?? "";
const numberFormats = new Map((stylesXml.match(/<numFmt\b[^>]*\/?\s*>/g) ?? []).map((tag) => [
Number(getAttribute(tag, "numFmtId")),
getAttribute(tag, "formatCode") ?? ""
]));
return (cellXfsBlock.match(/<xf\b[^>]*>/g) ?? []).map((xfXml) => {
const fontId = Number(getAttribute(xfXml, "fontId") ?? 0);
const numFmtId = Number(getAttribute(xfXml, "numFmtId") ?? 0);
return { fontName: fontNames[fontId] ?? "", numFmtId, formatCode: numberFormats.get(numFmtId) ?? "" };
});
}
function formatGeneralNumber(number) {
if (!Number.isFinite(number)) return String(number);
if (Number.isInteger(number)) return String(number);
const absolute = Math.abs(number);
if (absolute !== 0 && (absolute >= 1e12 || absolute < 1e-6)) return number.toPrecision(10).replace(/\.?0+(e|$)/i, "$1");
return String(Number(number.toPrecision(6)));
}
function formatNumericCell(value, style) {
if (String(value ?? "").trim() === "") return "";
const number = Number(value);
if (!Number.isFinite(number)) return value;
const builtInFormats = new Map([[1, "0"], [2, "0.00"], [3, "#,##0"], [4, "#,##0.00"], [9, "0%"], [10, "0.00%"]]);
const formatCode = style?.formatCode || builtInFormats.get(style?.numFmtId) || "";
const section = formatCode.split(";")[0].replace(/"[^"]*"|\[[^\]]*\]/g, "");
const percent = section.includes("%");
const decimalPattern = /\.([0#]+)/.exec(section)?.[1] ?? "";
if (!formatCode || /^general$/i.test(formatCode)) return formatGeneralNumber(number);
const scaled = percent ? number * 100 : number;
const rendered = scaled.toFixed(decimalPattern.length);
const trimmed = decimalPattern.includes("#") ? rendered.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : rendered;
return `${trimmed}${percent ? "%" : ""}`;
}
function cellValue(cellXml, sharedStrings, cellStyles = []) {
const cellTag = /^<c\b[^>]*>/.exec(cellXml)?.[0] ?? cellXml;
const type = getAttribute(cellTag, "t");
const value = getXmlTextValues(cellXml, "v")[0] ?? "";
let resolved = value;
const styleIndex = Number(getAttribute(cellTag, "s") ?? 0);
const styleEntry = cellStyles[styleIndex] ?? "";
const styleFont = typeof styleEntry === "string" ? styleEntry : styleEntry.fontName ?? "";
if (type === "s") {
const shared = sharedStrings[Number(value)] ?? "";
if (shared && typeof shared === "object" && shared.rich) {
return shared.runs.map((run) => {
if (/^symbol$/i.test(run.font)) return decodeSymbolFont(run.text);
if (!run.font && /^symbol$/i.test(styleFont)) return run.text.replace(/P/g, "Π").replace(/p/g, "π");
return run.text;
}).join("");
}
resolved = shared;
}
if (type === "inlineStr") resolved = getXmlTextValues(cellXml, "t").join("");
if (!type || type === "n") resolved = formatNumericCell(resolved, typeof styleEntry === "object" ? styleEntry : null);
return /^symbol$/i.test(styleFont) ? decodeSymbolFont(resolved) : resolved;
}
export function worksheetXmlToPreview(sheetXml, sharedStrings = [], limit = 500, sheetMeta = {}, cellStyles = []) {
const rowBlocks = getXmlBlocks(sheetXml, "row");
const rowNumbers = rowBlocks.map((rowXml, index) => Number(getAttribute(rowXml, "r")) || index + 1);
const rows = rowBlocks.map((rowXml) => {
const cells = [];
const cellBlocks = rowXml.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) ?? [];
for (const cellXml of cellBlocks) {
const ref = getAttribute(cellXml, "r") ?? "";
cells[columnLettersToIndex(ref)] = cellValue(cellXml, sharedStrings, cellStyles);
}
return Array.from({ length: cells.length }, (_, index) => cells[index] ?? "");
});
if (rows.length === 0) return {
sheetId: sheetMeta.sheetId ?? "sheet1",
name: sheetMeta.name ?? "Sheet1",
columns: [],
previewRows: [],
totalRowsEstimate: 0
};
const populatedRows = rows
.map((row, index) => {
const values = row.map((cell) => String(cell ?? "").trim()).filter(Boolean);
return {
row,
index,
populated: values.length,
textual: values.filter((value) => !Number.isFinite(Number(value))).length
};
})
.filter((entry) => entry.populated > 0);
const widestPopulation = Math.max(...populatedRows.map((entry) => entry.populated));
const minimumHeaderPopulation = Math.max(2, Math.ceil(widestPopulation * 0.6));
let headerEntry = populatedRows
.filter((entry) => entry.populated >= minimumHeaderPopulation)
.sort((left, right) => right.textual - left.textual || left.index - right.index)[0] ?? populatedRows[0];
const previousEntry = populatedRows.filter((entry) => entry.index < headerEntry.index).at(-1);
if (previousEntry
&& headerEntry.textual === 1
&& previousEntry.textual === 0
&& headerEntry.index - previousEntry.index === 1
&& previousEntry.populated >= headerEntry.populated - 2) {
headerEntry = previousEntry;
}
const headerRowIndex = headerEntry?.index ?? 0;
const sourceDataRows = rows.slice(headerRowIndex + 1)
.filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
const relevantRows = [rows[headerRowIndex] ?? [], ...sourceDataRows];
let usedStart = Infinity;
for (const row of relevantRows) {
for (let index = 0; index < row.length; index++) {
if (String(row[index] ?? "").trim() !== "") { usedStart = Math.min(usedStart, index); break; }
}
}
if (!Number.isFinite(usedStart)) usedStart = 0;
const usedWidth = Math.max(rows[headerRowIndex]?.length ?? 0, ...sourceDataRows.map((row) => {
let lastNonEmpty = -1;
for (let index = row.length - 1; index >= 0; index--) {
if (String(row[index] ?? "").trim() !== "") { lastNonEmpty = index; break; }
}
return lastNonEmpty + 1;
}));
const headerCells = Array.from({ length: Math.max(usedWidth - usedStart, 0) }, (_, index) =>
rows[headerRowIndex]?.[index + usedStart] ?? ""
);
const promotedColumns = new Set();
const firstDataRow = sourceDataRows[0] ?? [];
for (let index = 0; index < headerCells.length; index++) {
const candidate = String(firstDataRow[index + usedStart] ?? "").trim();
if (!String(headerCells[index] ?? "").trim() && candidate && !Number.isFinite(Number(candidate))) {
headerCells[index] = candidate;
promotedColumns.add(index);
}
}
for (let index = 1; index < headerCells.length - 1; index++) {
if (String(headerCells[index] ?? "").trim()) continue;
const previous = String(headerCells[index - 1] ?? "").trim();
const next = String(headerCells[index + 1] ?? "").trim();
if (previous && next && Number.isFinite(Number(previous)) && Number.isFinite(Number(next))) {
headerCells[index] = `${previous} (secondary)`;
}
}
if (!String(headerCells[1] ?? "").trim()
&& String(headerCells[0] ?? "").trim()
&& Number.isFinite(Number(firstDataRow[usedStart + 1]))) {
headerCells[1] = `${headerCells[0]} value`;
}
for (let index = 0; index < headerCells.length - 1; index++) {
const header = String(headerCells[index] ?? "").trim();
const currentHasData = sourceDataRows.some((row) => String(row[index + usedStart] ?? "").trim());
const nextHasData = sourceDataRows.some((row) => String(row[index + usedStart + 1] ?? "").trim());
if (/^(?:given|max)\b/i.test(header) && !currentHasData && !String(headerCells[index + 1] ?? "").trim() && nextHasData) {
headerCells[index + 1] = headerCells[index];
headerCells[index] = "";
}
}
const activeIndexes = headerCells.map((_, index) => index);
const headers = normalizeColumnNames(activeIndexes.map((index) => headerCells[index]));
const dataRows = sourceDataRows.slice(0, limit).map((row, rowIndex) => {
return Object.fromEntries(headers.map((header, outputIndex) => {
const index = activeIndexes[outputIndex];
return [
header,
rowIndex === 0 && promotedColumns.has(index) ? "" : row[index + usedStart] ?? ""
];
}));
});
const columns = headers.map((header) => {
const values = dataRows.map((row) => String(row[header] ?? ""));
return {
name: header,
inferredType: inferType(values),
nullable: values.some((value) => value === "")
};
});
return {
sheetId: sheetMeta.sheetId ?? "sheet1",
name: sheetMeta.name ?? "Sheet1",
columns,
previewRows: dataRows,
preambleRows: rows.slice(0, headerRowIndex)
.map((row) => row.filter((cell) => String(cell ?? "").trim() !== ""))
.filter((row) => row.length > 0),
preambleRowNumbers: rows.slice(0, headerRowIndex)
.map((row, index) => ({ row, sourceRow: rowNumbers[index] }))
.filter((entry) => entry.row.some((cell) => String(cell ?? "").trim() !== ""))
.map((entry) => entry.sourceRow),
headerRowIndex,
totalRowsEstimate: sourceDataRows.length
};
}
function readWorkbookSheets(workbookXml) {
if (!workbookXml) return [{ sheetId: "sheet1", name: "Sheet1", rId: "rId1" }];
const sheetsBlock = /<sheets[\s\S]*?<\/sheets>/.exec(workbookXml)?.[0] ?? "";
const sheetTags = sheetsBlock.match(/<sheet\b[^>]*\/?\s*>/g) ?? [];
if (sheetTags.length === 0) return [{ sheetId: "sheet1", name: "Sheet1", rId: "rId1" }];
return sheetTags.map((tag, index) => {
const name = getAttribute(tag, "name") ?? `Sheet${index + 1}`;
const sheetId = getAttribute(tag, "sheetId") ?? String(index + 1);
const rId = getAttribute(tag, "r:id") ?? getAttribute(tag, "id") ?? `rId${index + 1}`;
return { sheetId, name, rId };
});
}
function readWorkbookRels(relsXml) {
const map = new Map();
if (!relsXml) return map;
const relTags = relsXml.match(/<Relationship\b[^>]*\/?\s*>/g) ?? [];
for (const tag of relTags) {
const id = getAttribute(tag, "Id");
const target = getAttribute(tag, "Target");
if (id && target) {
map.set(id, target);
}
}
return map;
}
async function readOptionalZipEntry(filePath, entryName) {
try {
return (await readZipEntryFromFile(filePath, entryName)).toString("utf8");
} catch {
return "";
}
}
async function readOptionalZipEntryFromBuffer(buffer, entryName) {
try {
return readZipEntry(buffer, entryName).toString("utf8");
} catch {
return "";
}
}
export const xlsxImporter = {
name: "xlsx-importer",
canHandle(file) {
return path.extname(file.sourcePath ?? file).toLowerCase() === ".xlsx";
},
async inspect(input) {
const result = await this.import(input);
return result.sheets[0] ?? {
sheetId: "sheet1",
name: "Sheet1",
columns: [],
previewRows: [],
totalRowsEstimate: 0
};
},
async import(input) {
const buffer = await readFile(input.sourcePath);
const sharedStringsXml = await readOptionalZipEntryFromBuffer(buffer, "xl/sharedStrings.xml");
const sharedStrings = sharedStringsXml ? readSharedStrings(sharedStringsXml) : [];
const stylesXml = await readOptionalZipEntryFromBuffer(buffer, "xl/styles.xml");
const cellStyles = readCellStyles(stylesXml);
const workbookXml = await readOptionalZipEntryFromBuffer(buffer, "xl/workbook.xml");
const sheetDefs = readWorkbookSheets(workbookXml);
const relsXml = await readOptionalZipEntryFromBuffer(buffer, "xl/_rels/workbook.xml.rels");
const relsMap = readWorkbookRels(relsXml);
let zipEntries;
try {
const { listZipEntries: listEntries } = await import("../core/zip.js");
zipEntries = listEntries(buffer)
.map((e) => e.fileName)
.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
.sort((a, b) => {
const numA = Number(/(\d+)\.xml$/.exec(a)?.[1] ?? 0);
const numB = Number(/(\d+)\.xml$/.exec(b)?.[1] ?? 0);
return numA - numB;
});
} catch {
zipEntries = ["xl/worksheets/sheet1.xml"];
}
const limit = input.limit ?? 500;
const sheets = [];
for (let i = 0; i < sheetDefs.length; i++) {
const def = sheetDefs[i];
let relTarget = relsMap.get(def.rId) ?? "";
if (relTarget && !relTarget.startsWith("xl/")) {
relTarget = `xl/${relTarget}`;
}
const zipPath = relTarget || zipEntries[i] || `xl/worksheets/sheet${i + 1}.xml`;
const sheetXml = await readOptionalZipEntryFromBuffer(buffer, zipPath);
if (!sheetXml) continue;
sheets.push(worksheetXmlToPreview(sheetXml, sharedStrings, limit, {
sheetId: def.sheetId,
name: def.name
}, cellStyles));
}
if (sheets.length === 0) {
const sheet1Xml = await readOptionalZipEntryFromBuffer(buffer, "xl/worksheets/sheet1.xml");
sheets.push(worksheetXmlToPreview(sheet1Xml, sharedStrings, limit, {
sheetId: "sheet1",
name: "Sheet1"
}, cellStyles));
}
const populatedSheets = sheets.filter((sheet) =>
sheet.columns.length > 0 || sheet.previewRows.length > 0 || sheet.totalRowsEstimate > 0
);
if (populatedSheets.length === 0) {
throw new Error("The Excel workbook contains no cell data in any worksheet. Open it in Excel or WPS and confirm that the table was saved before importing.");
}
return {
sheets,
sheetCount: sheets.length,
rowCountEstimate: sheets.reduce((sum, s) => sum + s.totalRowsEstimate, 0)
};
}
};
