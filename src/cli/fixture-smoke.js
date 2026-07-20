import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { markdownToDocxBuffer } from "../adapters/markdownDocxExporter.js";
import { createZip } from "../core/zipWriter.js";
import { createAppService } from "../core/appService.js";
import { queryResultToExport } from "../core/exporters.js";
import { buildReleaseArtifactManifest } from "./release-artifacts.js";

const root = path.resolve(import.meta.dirname, "../..");
const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-fixtures-"));
const service = createAppService(workspace);
await service.openWorkspace();
function argValue(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function resolveFromRoot(value) {
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}

const existingResultsPath = resolveFromRoot(argValue("--results", "samples/fixture-results.json"));

async function readExistingFixtureResult(id) {
  try {
    const raw = await readFile(existingResultsPath, "utf8");
    const existing = JSON.parse(raw);
    return (existing.results ?? []).find((item) => item.id === id) ?? null;
  } catch {
    return null;
  }
}

async function readJsonFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function recordPathFromDesktopEvidence(result) {
  const match = /desktop verification record passed strict check:\s*(.+)$/i.exec(result?.evidence ?? "");
  return match?.[1]?.trim() ?? "";
}

async function validateExistingDesktopResult(existingResult) {
  if (existingResult?.status !== "pass") {
    return {
      ok: false,
      reason: "No previously closed F-012 result is available."
    };
  }
  const recordPathText = recordPathFromDesktopEvidence(existingResult);
  if (!recordPathText) {
    return {
      ok: false,
      reason: "The previous F-012 result does not point to a filled desktop verification record."
    };
  }
  const recordPath = resolveFromRoot(recordPathText);
  let record;
  try {
    record = await readJsonFile(recordPath);
  } catch (error) {
    return {
      ok: false,
      reason: `The previous filled desktop verification record cannot be read: ${error.message}`
    };
  }
  const artifactSha256 = record.artifact?.sha256 ?? "";
  const artifactManifest = await buildReleaseArtifactManifest();
  const match = artifactManifest.artifacts.find((artifact) => artifact.exists && artifact.sha256 === artifactSha256);
  if (!match) {
    return {
      ok: false,
      reason: `The previous desktop verification artifact SHA-256 does not match the current release artifacts. Previous: ${artifactSha256 || "missing"}. Current: ${artifactManifest.artifacts.map((artifact) => artifact.sha256 || "missing").join(", ")}.`
    };
  }
  return {
    ok: true,
    recordPath,
    matchedArtifact: match
  };
}

function result(id, status, evidence, notes = "") {
  return {
    id,
    status,
    evidence,
    notes
  };
}

async function runFixture(id, fn) {
  try {
    return await fn();
  } catch (error) {
    return result(id, "fail", error.code ?? error.name ?? "error", error.message);
  }
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readConvertedMarkdown(job) {
  return readFile(job.output.outputMarkdownPath, "utf8");
}

async function writeDocxFixture(relativeName, markdown) {
  const filePath = path.join(workspace, relativeName);
  await writeFile(filePath, markdownToDocxBuffer(markdown));
  return filePath;
}

async function writeXlsxFixture(relativeName) {
  const filePath = path.join(workspace, relativeName);
  const sheetXml = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>name</t></is></c><c r="B1" t="inlineStr"><is><t>value</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>alpha</t></is></c><c r="B2"><v>1</v></c></row>
  </sheetData>
</worksheet>`;
  await writeFile(filePath, createZip([{
    name: "xl/worksheets/sheet1.xml",
    content: sheetXml
  }]));
  return filePath;
}

const outputs = {};

const results = [];

results.push(await runFixture("F-001", async () => {
  const docxPath = await writeDocxFixture("simple-paragraphs.docx", "Simple paragraph one.\n\nSimple paragraph two.");
  const imported = await service.importFile(docxPath);
  const job = await service.convertDocument(imported.id);
  const markdown = await readConvertedMarkdown(job);
  assertCondition(markdown.includes("Simple paragraph one."), "DOCX paragraph text was not extracted");
  return result("F-001", "pass", "synthetic DOCX converted through appService.convertDocument");
}));

results.push(await runFixture("F-002", async () => {
  const docxPath = await writeDocxFixture("headings-bullets.docx", "# Fixture Heading\n\n- First bullet");
  const imported = await service.importFile(docxPath);
  const job = await service.convertDocument(imported.id);
  const markdown = await readConvertedMarkdown(job);
  assertCondition(markdown.includes("# Fixture Heading"), "DOCX heading was not extracted");
  assertCondition(markdown.includes("- First bullet"), "DOCX bullet was not extracted");
  return result("F-002", "pass", "synthetic DOCX heading/list converted through appService.convertDocument");
}));

results.push(await runFixture("F-003", async () => {
  await service.saveMarkdown("synthetic/structured.md", "# Structured\n\n- One\n- Two\n");
  outputs.docx = await service.exportMarkdownDocument("synthetic/structured.md", "generated/exported.docx", "docx");
  const imported = await service.importFile(outputs.docx);
  const job = await service.convertDocument(imported.id);
  const markdown = await readConvertedMarkdown(job);
  assertCondition(markdown.includes("Structured"), "Markdown exported DOCX did not round-trip text");
  return result("F-003", "pass", "Markdown exported to DOCX and re-imported");
}));

results.push(await runFixture("F-004", async () => {
  outputs.pdf = await service.exportMarkdownDocument("synthetic/structured.md", "generated/exported.pdf", "pdf");
  const imported = await service.importFile(outputs.pdf);
  const job = await service.convertDocument(imported.id);
  const markdown = await readConvertedMarkdown(job);
  assertCondition(markdown.includes("Structured"), "Markdown exported PDF did not expose text layer");
  return result("F-004", "pass", "Markdown exported to PDF and text layer re-imported");
}));

results.push(await runFixture("F-005", async () => {
  const imported = await service.importFile(outputs.docx);
  const job = await service.convertDocument(imported.id);
  const markdown = await readConvertedMarkdown(job);
  assertCondition(markdown.includes("Structured"), "Generated DOCX did not re-import");
  return result("F-005", "pass", "generated DOCX re-imported through DOCX adapter");
}));

results.push(await runFixture("F-006", async () => {
  const imported = await service.importFile(outputs.pdf);
  const job = await service.convertDocument(imported.id);
  const markdown = await readConvertedMarkdown(job);
  assertCondition(markdown.includes("Structured"), "Generated PDF text layer did not extract");
  return result("F-006", "pass", "generated PDF text layer extracted through PDF adapter");
}));

results.push(await runFixture("F-007", async () => {
  const imported = await service.importFile(outputs.pdf);
  const job = await service.convertDocument(imported.id);
  const markdown = await readConvertedMarkdown(job);
  assertCondition(markdown.includes("Structured"), "Existing text-layer PDF fixture did not extract");
  return result("F-007", "known_limit", "synthetic text-layer PDF extracted", "Uses generated text-layer PDF; external real PDFs still need manual review.");
}));

results.push(await runFixture("F-008", async () => {
  const csvPath = path.join(workspace, "table.csv");
  await writeFile(csvPath, "name,value\nalpha,1\nbeta,2\n", "utf8");
  const imported = await service.importFile(csvPath);
  await service.inspectDataset(imported.id);
  const tables = await service.listTables();
  const query = await service.runQuery(`select name,value from ${tables[0].tableName} limit 2`);
  const markdown = queryResultToExport(query.output, "markdown");
  const csv = queryResultToExport(query.output, "csv");
  assertCondition(markdown.includes("| name | value |"), "query Markdown export missing header");
  assertCondition(csv.includes("alpha,1"), "query CSV export missing row");
  return result("F-008", "pass", "CSV import, query, Markdown export, and CSV export completed");
}));

results.push(await runFixture("F-009", async () => {
  const xlsxPath = await writeXlsxFixture("first-sheet.xlsx");
  const imported = await service.importFile(xlsxPath);
  await service.inspectDataset(imported.id);
  const manifest = await service.getManifest();
  const dataset = manifest.datasets.find((candidate) => candidate.id === imported.id);
  assertCondition(dataset.sheets[0].columns.some((column) => column.name === "name"), "XLSX first sheet did not expose columns");
  assertCondition(dataset.sheets[0].previewRows[0].name === "alpha", "XLSX first sheet did not expose preview row");
  return result("F-009", "pass", "synthetic XLSX first sheet preview completed");
}));

results.push(await runFixture("F-010", async () => {
  const pkg = await service.saveExchangePackage("packages/fixture", {
    title: "Fixture Package",
    body: "# Fixture Package\n\nMarkdown exchange package.",
    exportFormats: ["docx", "pdf"]
  });
  const readBack = await service.readExchangePackage("packages/fixture");
  const receiverReport = await service.writeExchangePackageReceiverReport("packages/fixture");
  assertCondition(pkg.packageExports.length === 2, "exchange package exports missing");
  assertCondition(readBack.valid === true, "exchange package read-back invalid");
  assertCondition(receiverReport.markdownPath.endsWith("receiver-report.md"), "receiver report markdown missing");
  assertCondition(receiverReport.jsonPath.endsWith("trust-report.json"), "trust report json missing");
  assertCondition(receiverReport.markdownHash.startsWith("sha256:"), "receiver report hash missing");
  assertCondition(receiverReport.jsonHash.startsWith("sha256:"), "trust report hash missing");
  return result("F-010", "pass", "exchange package exported DOCX/PDF, read-back hash verification passed, and receiver/trust report artifacts were written");
}));

results.push(await runFixture("F-011", async () => {
  const preview = await service.previewAiPayload({
    operation: "summarize",
    content: "api_key=secret-value",
    sourceRef: "fixture"
  });
  assertCondition(preview.output.sendGate.decision === "review_required", "Send Gate did not require review");
  return result("F-011", "pass", "AI preview detected credential-like text and returned review_required");
}));

const existingDesktopResult = await readExistingFixtureResult("F-012");
const existingDesktopValidation = await validateExistingDesktopResult(existingDesktopResult);
results.push(existingDesktopValidation.ok
  ? existingDesktopResult
  : result(
      "F-012",
      "blocked",
      "desktop runtime bridge, diagnostics, native workspace/file picker hooks, visible first-workflow check, and packaged API workflow smoke exist, but no current strict desktop verification record is present yet",
      `${existingDesktopValidation.reason} Run desktop-verification-fill with explicit visible UI evidence for the current artifact, verify it with desktop-verification-check -- --strict, then run desktop-fixture-close -- --record <filled-record.json> --write so fixture-smoke can preserve the closed F-012 result.`
    ));

const fileSummary = {
  releaseTarget: "v0.1.2",
  generatedBy: "npm run fixture-smoke",
  results,
  statusCounts: results.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {})
};
const consoleSummary = {
  ...fileSummary,
  generatedAt: new Date().toISOString(),
  workspace
};
const outputPath = resolveFromRoot(argValue("--out", existingResultsPath));

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(fileSummary, null, 2) + "\n", "utf8");

console.log(JSON.stringify({
  ...consoleSummary,
  outputPath
}, null, 2));
