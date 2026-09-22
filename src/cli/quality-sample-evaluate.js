import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { assertInsideRoot, assertSafeWritePath } from "../core/pathGuard.js";
import { buildDocumentIr } from "../adapters/documentIr.js";
import { readQualitySampleCatalog } from "../core/qualitySampleCatalog.js";

function hashBuffer(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function parseArgs(argv) {
  const workspacePath = argv.find(value => !value.startsWith("--")) || process.cwd();
  const value = flag => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] || "" : "";
  };
  return {
    workspacePath,
    catalogPath: value("--catalog") || "docs/quality-samples.json",
    output: value("--output") || path.join(".ai-doc-exchange", "logs", "quality-sample-evaluation.json")
  };
}

function summarizeIr(ir) {
  return {
    schema: ir.schema,
    version: ir.version,
    pageCount: ir.pages.length,
    blockCount: ir.blocks.length,
    assetCount: ir.assets.length,
    blockTypes: Object.fromEntries([...new Set(ir.blocks.map(block => block.type))].sort().map(type => [type, ir.blocks.filter(block => block.type === type).length])),
    quality: {
      state: ir.quality?.state || "unknown",
      confidence: ir.quality?.confidence || "unknown",
      unresolvedCount: Number(ir.quality?.unresolvedCount || 0)
    }
  };
}

function detectFeatures(markdown, ir) {
  const text = String(markdown || "");
  const types = new Set(ir.blocks.map(block => block.type));
  const features = new Set();
  if (types.has("title") || types.has("heading")) features.add("headings");
  if (types.has("list")) features.add("lists");
  if (types.has("table")) features.add("table");
  if (types.has("formula")) features.add("formula");
  if (types.has("image") || ir.assets.length) features.add("visual_fallback");
  if (/[\u4e00-\u9fff]/.test(text)) features.add("cjk");
  if (/[A-Za-z]/.test(text)) features.add("english");
  if (text.length > 400) features.add("long_document");
  if (/\b(?:page|slide|section)\s*\d+/i.test(text)) features.add("segmentation");
  if (/(?:\*\*\*|\[REDACTED\]|<redacted>)/i.test(text)) features.add("secret_redaction");
  return [...features].sort();
}

export async function evaluateQualitySamples(argv = process.argv.slice(2), io = console) {
  const { workspacePath, catalogPath, output } = parseArgs(argv);
  const catalog = await readQualitySampleCatalog(workspacePath, catalogPath, { strict: true, requireFiles: true });
  const samples = [];
  for (const sample of catalog.samples) {
    const samplePath = await assertInsideRoot(path.resolve(workspacePath, sample.path), workspacePath);
    const content = await readFile(samplePath);
    const sourceStat = await stat(samplePath);
    const sourceType = sample.sourceType || path.extname(samplePath).slice(1) || "md";
    let summary = null;
    let error = "";
    try {
      const ir = buildDocumentIr({
        documentId: `sample_${sample.id}`,
        sourcePath: sample.path,
        sourceType,
        sourceHash: hashBuffer(content),
        sourceSize: sourceStat.size,
        markdown: content.toString("utf8")
      });
      summary = summarizeIr(ir);
      summary.detectedFeatures = detectFeatures(content.toString("utf8"), ir);
    } catch (caught) {
      error = caught.message;
    }
    const missingExpectedFeatures = summary ? sample.expectedFeatures.filter(feature => !summary.detectedFeatures.includes(feature)) : sample.expectedFeatures;
    samples.push({
      id: sample.id,
      category: sample.category,
      sourceType,
      path: sample.path,
      protected: sample.protected,
      fixtureOnly: sample.fixtureOnly,
      evidenceState: sample.fixtureOnly ? "fixture_only" : "real_source",
      expectedFeatures: sample.expectedFeatures,
      missingExpectedFeatures,
      status: error ? "error" : missingExpectedFeatures.length ? "feature_gap" : "pass",
      sourceHash: hashBuffer(content),
      summary,
      error
    });
  }
  const evaluation = {
    schema: "schema-docs.quality-sample-evaluation",
    version: 1,
    generatedAt: new Date().toISOString(),
    catalog: { path: catalogPath, sampleCount: catalog.samples.length },
    samples,
    summary: {
      sampleCount: samples.length,
      evaluatedCount: samples.filter(sample => sample.summary).length,
      failedCount: samples.filter(sample => sample.error).length,
      featureGapCount: samples.filter(sample => sample.status === "feature_gap").length,
      passedCount: samples.filter(sample => sample.status === "pass").length,
      protectedCount: samples.filter(sample => sample.protected).length,
      fixtureOnlyCount: samples.filter(sample => sample.fixtureOnly).length,
      realSourceCount: samples.filter(sample => !sample.fixtureOnly).length,
      realSourceFeatureGapCount: samples.filter(sample => !sample.fixtureOnly && sample.status === "feature_gap").length,
      fixtureOnlyFeatureGapCount: samples.filter(sample => sample.fixtureOnly && sample.status === "feature_gap").length
    }
  };
  evaluation.summary.result = evaluation.summary.failedCount > 0
    ? "errors"
    : evaluation.summary.featureGapCount > 0
    ? "feature_gaps"
    : "pass";
  const outputPath = await assertSafeWritePath(path.resolve(workspacePath, output), workspacePath, [".json"]);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evaluation, null, 2)}\n`, "utf8");
  io.log(JSON.stringify({ ok: evaluation.summary.result === "pass", outputPath, summary: evaluation.summary }, null, 2));
  return { outputPath, evaluation };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  evaluateQualitySamples().then(result => {
    if (result.evaluation.summary.result !== "pass") process.exitCode = 1;
  }).catch(error => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  });
}
