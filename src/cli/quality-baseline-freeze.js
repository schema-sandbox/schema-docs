import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { assertSafeWritePath } from "../core/pathGuard.js";
import { buildConversionQualityReport } from "./conversion-quality-check.js";
import { createQualityBaseline } from "../core/qualityBaseline.js";
import { readQualitySampleCatalog } from "../core/qualitySampleCatalog.js";

function parseArgs(argv) {
  const workspacePath = argv.find(value => !value.startsWith("--")) || process.cwd();
  const value = flag => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] || "" : "";
  };
  return {
    workspacePath,
    output: value("--output") || path.join(".ai-doc-exchange", "logs", "quality-baseline.json"),
    label: value("--label") || "local-quality-baseline",
    catalogPath: value("--catalog") || "docs/quality-samples.json"
  };
}

export async function freezeQualityBaseline(argv = process.argv.slice(2), io = console) {
  const { workspacePath, output, label, catalogPath } = parseArgs(argv);
  const report = await buildConversionQualityReport(workspacePath);
  const catalog = await readQualitySampleCatalog(workspacePath, catalogPath, { strict: true, requireFiles: true });
  const baseline = createQualityBaseline(report, { label });
  baseline.catalog = {
    path: catalogPath,
    schema: catalog.schema,
    version: catalog.version,
    sampleCount: catalog.samples.length,
    sampleIds: catalog.samples.map(sample => sample.id),
    protectedCount: catalog.samples.filter(sample => sample.protected).length,
    fixtureOnlyCount: catalog.samples.filter(sample => sample.fixtureOnly).length,
    realSourceCount: catalog.samples.filter(sample => !sample.fixtureOnly).length
  };
  const outputPath = await assertSafeWritePath(path.resolve(workspacePath, output), workspacePath, [".json"]);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  io.log(JSON.stringify({ ok: true, outputPath, sampleCount: catalog.samples.length, documentCount: report.summary.documentCount }, null, 2));
  return { outputPath, baseline, report, catalog };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  freezeQualityBaseline().catch(error => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  });
}
