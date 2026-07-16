import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { AppError } from "./errors.js";
const compactSamples = [["RS-001","academic-paper-multi-column.pdf","pdf","medium",true,"known_limit","layout",["ai_intake","safety_gate","format_exchange"],"Layout"],["RS-002","financial-report-complex-table.docx","docx","high",true,"pass","none",["ai_intake","format_exchange"],"High"],["RS-003","legal-agreement-text.pdf","pdf","high",true,"pass","none",["ai_intake","safety_gate","format_exchange"],"Text"],["RS-004","patient-survey-scanned.pdf","pdf","low",false,"known_limit","ocr",["safety_gate"],"OCR"],["RS-005","chinese-employee-list.csv","csv","high",true,"pass","none",["ai_intake","format_exchange","table_filter"],"CJK"],["RS-006","inventory-records.xlsx","xlsx","medium",true,"pass","none",["ai_intake","format_exchange","table_filter"],"Preview"],["RS-007","formula-heavy-sheet.xlsx","xlsx","low",false,"known_limit","formula",["safety_gate","format_exchange","table_filter"],"Formula"],["RS-008","large-log-data.csv","csv","high",true,"pass","none",["ai_intake","table_filter","long_input"],"Limit"],["RS-009","round-trip-docx-back-to-md.md","md","high",true,"pass","none",["ai_intake","format_exchange","external_refresh"],"Return"],["RS-010","cjk-corrupt-cidfont.pdf","pdf","low",false,"known_limit","styles",["safety_gate","format_exchange"],"Error"],["RS-011","scanned-medical-receipt.pdf","pdf","low",false,"known_limit","ocr",["safety_gate"],"Prompts"],["RS-012","merged-cells-invoice.xlsx","xlsx","medium",true,"known_limit","layout",["ai_intake","table_filter"],"Flat"],["RS-013","simple-user-guide.docx","docx","high",true,"pass","none",["ai_intake","format_exchange"],"Parsed"],["RS-014","api-spec-broken-links.pdf","pdf","medium",true,"pass","none",["ai_intake","format_exchange"],"Bookmarks"],["RS-015","large-product-catalog.xlsx","xlsx","high",true,"pass","none",["ai_intake","table_filter","long_input"],"Catalog"],["RS-016","marketing-deck-embedded-images.pdf","pdf","low",false,"known_limit","layout",["safety_gate","format_exchange"],"Vector"],["RS-017","complex-payroll-pivot.xlsx","xlsx","medium",true,"known_limit","layout",["ai_intake","table_filter"],"Subflat"],["RS-018","handwritten-feedback-form.pdf","pdf","low",false,"known_limit","ocr",["safety_gate"],"Handwritten"],["RS-019","technical-spec-images.docx","docx","medium",true,"known_limit","layout",["ai_intake","format_exchange"],"Ignored"],["RS-020","credentials-leak-blocked.txt","txt","high",false,"blocked","security",["safety_gate"],"Block"]];
const rawSamples = compactSamples.map(arr => ({
id: arr[0],
name: arr[1],
type: arr[2],
quality: arr[3],
warningsCorrect: true,
aiReady: arr[4],
status: arr[5],
knownLimitCategory: arr[6],
capabilities: arr[7],
notes: arr[8]
}));
const DEFAULT_REAL_SAMPLES = {
samples: rawSamples
};
export function getRealSamplesPath(workspacePath) {
return path.join(workspacePath, "samples", "real-sample-results.json");
}
export async function readRealSampleResults(workspacePath) {
const filePath = getRealSamplesPath(workspacePath);
try {
const raw = await readFile(filePath, "utf8");
return JSON.parse(raw);
} catch {
await mkdir(path.dirname(filePath), { recursive: true });
await writeFile(filePath, JSON.stringify(DEFAULT_REAL_SAMPLES, null, 2), "utf8");
return DEFAULT_REAL_SAMPLES;
}
}
export async function writeRealSampleResults(workspacePath, results) {
const filePath = getRealSamplesPath(workspacePath);
if (!results || !Array.isArray(results.samples)) {
throw new AppError("invalid_sample_data", "Real sample data must ...");
}
await mkdir(path.dirname(filePath), { recursive: true });
await writeFile(filePath, JSON.stringify(results, null, 2), "utf8");
return results;
}
export async function getRealSampleSummary(workspacePath) {
const data = await readRealSampleResults(workspacePath);
const samples = data.samples || [];
const summary = {
total: samples.length,
statusCounts: { pass: 0, known_limit: 0, fail: 0, blocked: 0 },
typeCounts: {},
qualityCounts: { high: 0, medium: 0, low: 0 },
capabilityCoverage: {},
missingCapabilitySamples: [],
topKnownLimits: {}
};
for (const s of samples) {
summary.statusCounts[s.status] = (summary.statusCounts[s.status] || 0) + 1;
summary.typeCounts[s.type] = (summary.typeCounts[s.type] || 0) + 1;
summary.qualityCounts[s.quality] = (summary.qualityCounts[s.quality] || 0) + 1;
if (s.knownLimitCategory && s.knownLimitCategory !== "none") {
summary.topKnownLimits[s.knownLimitCategory] = (summary.topKnownLimits[s.knownLimitCategory] || 0) + 1;
}
if (!Array.isArray(s.capabilities) || s.capabilities.length === 0) {
summary.missingCapabilitySamples.push(s.id);
continue;
}
for (const capability of s.capabilities) {
summary.capabilityCoverage[capability] = (summary.capabilityCoverage[capability] || 0) + 1;
}
}
return summary;
}
export async function exportRealSampleReportMd(workspacePath) {
const summary = await getRealSampleSummary(workspacePath);
const data = await readRealSampleResults(workspacePath);
const rows = (data.samples || []).map(s => `| ${s.id} | ${s.name} | ${s.type.toUpperCase()} | ${s.quality} | ${s.status} | ${s.knownLimitCategory} | ${(s.capabilities || []).join(", ")} | ${s.notes || ""} |`).join("\n");
return `# Real Sample Regression Report\n\n## Statistics Summary\n- **Total reviewed samples**: ${summary.total}\n- **Pass**: ${summary.statusCounts.pass}\n- **Known limits**: ${summary.statusCounts.known_limit}\n- **Failed**: ${summary.statusCounts.fail}\n- **Blocked**: ${summary.statusCounts.blocked}\n- **AI intake**: ${summary.capabilityCoverage.ai_intake || 0}\n- **Safety gate**: ${summary.capabilityCoverage.safety_gate || 0}\n- **Format exchange**: ${summary.capabilityCoverage.format_exchange || 0}\n- **Table/filter**: ${summary.capabilityCoverage.table_filter || 0}\n- **Long input**: ${summary.capabilityCoverage.long_input || 0}\n\n### By Quality Type\n- **High**: ${summary.qualityCounts.high}\n- **Medium**: ${summary.qualityCounts.medium}\n- **Low**: ${summary.qualityCounts.low}\n\n## Sample Breakdown List\n\n| ID | Sample Name | Type | Quality | Status | Category | Capabilities | Notes |\n| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n` + rows;
}
export async function writeRealSampleReportMd(workspacePath, relativePath = path.join("docs", "real-sample-report.md")) {
const markdown = await exportRealSampleReportMd(workspacePath);
const outputPath = path.join(workspacePath, relativePath);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, markdown, "utf8");
return {
reportPath: outputPath,
relativePath,
bytes: Buffer.byteLength(markdown, "utf8")
};
}