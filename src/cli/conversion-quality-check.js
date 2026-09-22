import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { readManifest } from "../core/manifest.js";
import { readDocumentIr } from "../core/documentIrStore.js";
import { compareQualityBaselines, createQualityBaseline } from "../core/qualityBaseline.js";

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = String(item?.[key] || "unknown");
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function summarizeIr(documentIr) {
  const pages = Array.isArray(documentIr?.pages) ? documentIr.pages : [];
  const blocks = Array.isArray(documentIr?.blocks) ? documentIr.blocks : [];
  const assets = Array.isArray(documentIr?.assets) ? documentIr.assets : [];
  return {
    available: true,
    schema: documentIr.schema,
    version: documentIr.version,
    revisionId: documentIr.revisionId,
    pageCount: pages.length,
    partCount: pages.filter(page => page.pageNumber === null || page.partId).length,
    logicalPartOnly: Boolean(documentIr.quality?.logicalPartOnly),
    blockCount: blocks.length,
    assetCount: assets.length,
    pageStatuses: countBy(pages, "status"),
    readingOrderStrategies: countBy(pages.map((page) => ({ strategy: page.quality?.readingOrder?.strategy || "unknown" })), "strategy"),
    unknownReadingOrderPageCount: pages.filter((page) => !page.quality?.readingOrder || page.quality.readingOrder.confidence === "unknown").length,
    blockTypes: countBy(blocks, "type"),
    assetStatuses: countBy(assets, "status"),
    headingCount: blocks.filter(block => ["title", "heading"].includes(block.type)).length,
    repeatedNoiseCandidateCount: blocks.filter(block => block.qualitySignals?.noiseCandidate).length,
    structuredTableCount: blocks.filter(block => block.tableStructure?.status === "structured").length,
    unresolvedFormulaCount: blocks.filter(block => block.formulaStructure?.status === "unresolved").length,
    quality: documentIr.quality || {}
  };
}

async function inspectDocument(workspacePath, document) {
  const base = {
    id: document.id,
    title: document.title || document.name || document.id,
    sourceType: document.sourceType || "unknown",
    status: document.status || "unknown",
    sourceSize: Number(document.sourceSize || 0),
    pageEstimate: Number(document.pageEstimate || 0),
    documentIr: {
      available: false,
      revisionId: document.documentIrRevisionId || "",
      reason: "document_ir_missing"
    }
  };
  if (!document.documentIrRevisionId) return base;
  try {
    const documentIr = await readDocumentIr(workspacePath, document.id, document.documentIrRevisionId);
    return { ...base, documentIr: summarizeIr(documentIr) };
  } catch (error) {
    return {
      ...base,
      documentIr: {
        ...base.documentIr,
        reason: "document_ir_unreadable",
        error: error.message
      }
    };
  }
}

function summarizeDocuments(documents) {
  const irDocuments = documents.filter((document) => document.documentIr?.available);
  const allPages = irDocuments.flatMap((document) => Object.entries(document.documentIr.pageStatuses || {})
    .flatMap(([status, count]) => Array.from({ length: count }, () => ({ status }))));
  const qualityStates = {};
  let unresolvedCount = 0;
  for (const document of irDocuments) {
    const quality = document.documentIr.quality || {};
    const state = String(quality.state || "unknown");
    qualityStates[state] = (qualityStates[state] || 0) + 1;
    unresolvedCount += Number(quality.unresolvedCount || 0);
  }
  return {
    documentCount: documents.length,
    irDocumentCount: irDocuments.length,
    missingIrDocumentCount: documents.length - irDocuments.length,
    pageCount: allPages.length,
    pageStatuses: countBy(allPages, "status"),
    qualityStates,
    unresolvedCount
  };
}

export async function buildConversionQualityReport(workspacePath) {
  const manifest = await readManifest(workspacePath);
  const documents = [];
  for (const document of manifest.documents || []) {
    documents.push(await inspectDocument(workspacePath, document));
  }
  return {
    schema: "schema-docs.conversion-quality-report",
    version: 1,
    workspacePath: path.resolve(workspacePath),
    generatedAt: new Date().toISOString(),
    documents,
    summary: summarizeDocuments(documents)
  };
}

function parseArgs(argv) {
  const json = argv.includes("--json");
  const strict = argv.includes("--strict");
  const workspacePath = argv.find((value) => !value.startsWith("--")) || process.cwd();
  const optionValue = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] || "" : "";
  };
  return { json, strict, workspacePath, baselineOut: optionValue("--baseline-out"), baselinePath: optionValue("--baseline") };
}

export async function runConversionQualityCheck(argv = process.argv.slice(2), io = console) {
  const { json, strict, workspacePath, baselineOut, baselinePath } = parseArgs(argv);
  const report = await buildConversionQualityReport(workspacePath);
  const baseline = createQualityBaseline(report);
  let baselineDiff = null;
  if (baselinePath) {
    const expected = JSON.parse(await readFile(path.resolve(workspacePath, baselinePath), "utf8"));
    baselineDiff = compareQualityBaselines(expected, baseline);
  }
  if (baselineOut) {
    const outputPath = path.resolve(workspacePath, baselineOut);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  }
  if (json) {
    io.log(JSON.stringify({ ...report, ...(baselineOut ? { baseline } : {}), ...(baselineDiff ? { baselineDiff } : {}) }, null, 2));
  } else {
    io.log(`Documents: ${report.summary.documentCount}`);
    io.log(`DocumentIR available: ${report.summary.irDocumentCount}`);
    io.log(`Pages: ${report.summary.pageCount}`);
    io.log(`Quality states: ${JSON.stringify(report.summary.qualityStates)}`);
    io.log(`Unresolved signals: ${report.summary.unresolvedCount}`);
  }
  const strictSupportedTypes = new Set(["pdf", "docx", "pptx", "txt", "md"]);
  const strictMissingIrCount = report.documents.filter((document) =>
    strictSupportedTypes.has(document.sourceType)
    && ["ready", "converted"].includes(document.status)
    && !document.documentIr.available
  ).length;
  if (strict && strictMissingIrCount > 0) return 1;
  if (strict && baselineDiff && !baselineDiff.ok) return 1;
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runConversionQualityCheck().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  });
}
