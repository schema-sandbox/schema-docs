import path from "node:path";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { pdfMarkdownConverter, DEFAULT_MAX_INPUT_BYTES } from "../adapters/pdfMarkdownConverter.js";
import { docxMarkdownConverter } from "../adapters/docxMarkdownConverter.js";
import { textMarkdownConverter } from "../adapters/textMarkdownConverter.js";
import { xlsxImporter } from "../adapters/xlsxImporter.js";
import { runPdfExtractionPipeline } from "../adapters/pdfExtractorPipeline.js";
import { createReadableMarkdown } from "../core/readableMarkdown.js";
import { classifySource } from "../core/records.js";
import { validatePdfConversion } from "../adapters/pdfConversionValidation.js";
import { acquireEvaluationLock, validateRunId } from "./realMaterialRun.js";
import { collectRuntimeIdentity } from "../core/runtimeIdentity.js";

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(`sha256:${hash.digest("hex")}`));
  });
}

function converterFor(extension) {
  if (extension === ".pdf") return pdfMarkdownConverter;
  if (extension === ".docx") return docxMarkdownConverter;
  if ([".txt", ".md"].includes(extension)) return textMarkdownConverter;
  if (extension === ".xlsx") return xlsxImporter;
  return null;
}

function safeCaseId(name, sourceHash) {
  const stem = path.parse(name).name
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "document";
  const hashSuffix = String(sourceHash || "").replace(/[^a-f0-9]/gi, "").slice(-12) || "nohash";
  return `${stem}-${hashSuffix}`;
}

function isInterruptedError(error) {
  return error?.code === "ETIMEDOUT"
    || error?.code === "TIMEOUT"
    || error?.code === "job_cancelled"
    || error?.code === "ABORT_ERR"
    || error?.name === "AbortError";
}

async function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
}

export async function evaluateRealMaterials(argv = process.argv.slice(2)) {
  const sourceRoot = path.resolve(argv[0] || "G:/test");
  const outputPath = path.resolve(argv[1] || ".ai-doc-exchange/real-material-final/real-material-results.json");
  const runId = process.env.SCHEMA_DOCS_REAL_MATERIAL_RUN_ID
    || `${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}-${process.pid}`;
  await mkdir(path.dirname(outputPath), { recursive: true });
  validateRunId(runId);
  const guard = await acquireEvaluationLock(path.dirname(outputPath), { runId, sourceRoot });
  try {
  const runRoot = path.join(path.dirname(outputPath), "real-material-artifacts", runId);
  await mkdir(runRoot, { recursive: true });
  const ownerPath = path.join(runRoot, ".run-owner.json");
  await writeFile(ownerPath, JSON.stringify({ schema: "schema-docs.real-material-run", runId, sourceRoot,
    retained: false, status: "running" }), { flag: "wx" });
  const entries = (await readdir(sourceRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
  const results = [];
  let currentResult = null;
  const startedBatchAt = new Date().toISOString();
  const partialPath = `${outputPath}.partial`;
  const runtimeIdentity = await collectRuntimeIdentity();
  const writeReport = async (status = "running") => {
    const report = {
      schema: "schema-docs.real-material-evaluation",
      version: 3,
      status,
      generatedAt: new Date().toISOString(),
      startedAt: startedBatchAt,
      sourceRoot,
      sourceRootReadOnly: results.length > 0 && results.every((result) => result.evidence?.sourceUnchanged === true),
      sourceIntegrity: {
        checked: results.filter((result) => result.evidence && Object.hasOwn(result.evidence, "sourceUnchanged")).length,
        allUnchanged: results.length > 0 && results.every((result) => result.evidence?.sourceUnchanged === true)
      },
      runtimeIdentity,
      runId,
      maxPdfInputBytes: DEFAULT_MAX_INPUT_BYTES,
      largePdfPageWindowEnabled: true,
      results,
      current: currentResult,
      summary: {
        total: entries.length,
        recorded: results.length,
        converted: results.filter((result) => ["converted", "converted_partial"].includes(result.status)).length,
        inspected: results.filter((result) => result.status === "converted_inspected").length,
        validationFailures: results.filter(result => result.evidence?.validation?.passed === false).length,
        backendFailures: results.reduce((sum, result) => sum + (result.evidence?.backendFailures?.length || 0), 0),
        qualityGaps: results.filter((result) => result.qualityState === "partial").length,
        resourceLimited: results.filter((result) => ["resource_limit_preflight", "resource_limit"].includes(result.status)).length,
        unsupported: results.filter((result) => ["unsupported", "optional_adapter_required"].includes(result.status)).length,
        interrupted: results.filter((result) => result.status === "interrupted").length,
        errors: results.filter((result) => result.status === "conversion_error").length,
        timeouts: results.filter((result) => result.status === "interrupted" && ["ETIMEDOUT", "TIMEOUT"].includes(result.evidence?.code)).length
      }
    };
    await mkdir(path.dirname(outputPath), { recursive: true });
    await atomicWriteJson(partialPath, report);
    if (status === "completed") {
      await atomicWriteJson(outputPath, report);
      await unlink(partialPath).catch(() => {});
    }
    return report;
  };
  let reportQueue = Promise.resolve();
  const persistReport = (status = "running") => {
    reportQueue = reportQueue.then(() => writeReport(status));
    reportQueue.catch(() => {}); // the owner awaits this queue before completion
    return reportQueue;
  };
  await persistReport();
  for (const entry of entries) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const startedAt = Date.now();
    const sourceStat = await stat(sourcePath);
    const extension = path.extname(entry.name).toLowerCase();
    const sourceHash = await hashFile(sourcePath);
    const result = {
      name: entry.name,
      extension,
      sourceSize: sourceStat.size,
      sourceHash,
      caseId: safeCaseId(entry.name, sourceHash),
      status: "untested",
      elapsedMs: 0,
      startedAt: new Date(startedAt).toISOString(),
      stage: "queued",
      evidence: {},
      warnings: []
    };
    currentResult = result;
    await persistReport();
    try {
      const classification = (() => {
        try { return classifySource(sourcePath); } catch (error) { return { error }; }
      })();
      if (classification.error) {
        result.status = classification.error.code || "unsupported";
        result.evidence = { message: classification.error.message, details: classification.error.details || {} };
      } else {
        const converter = converterFor(extension);
        if (!converter) {
          result.status = "unsupported";
          result.evidence = { message: `No local converter registered for ${extension}.` };
        } else if (extension === ".xlsx") {
          result.stage = "workbook_import";
          const imported = await converter.import({ sourcePath });
          result.status = "converted_inspected";
          result.evidence = {
            sheetCount: imported.sheetCount,
            rowCountEstimate: imported.rowCountEstimate,
            sheets: imported.sheets.map((sheet) => ({
              sheetId: sheet.sheetId,
              name: sheet.name,
              rowCountEstimate: sheet.totalRowsEstimate,
              columnCount: sheet.columns.length,
              previewRowCount: sheet.previewRows.length,
              sample: sheet.previewRows.slice(0, 3)
            }))
          };
        } else {
          const artifactRoot = path.join(path.dirname(outputPath), "real-material-artifacts", runId, result.caseId);
          await mkdir(artifactRoot, { recursive: true });
          const progressPath = path.join(artifactRoot, "progress.jsonl");
          let progressQueue = Promise.resolve();
          let progressWriteError = null;
          const recordProgress = (event) => {
            progressQueue = progressQueue.then(async () => {
              await appendFile(progressPath, `${JSON.stringify({
                at: new Date().toISOString(),
                runId,
                ...event
              })}\n`, "utf8");
              if (event.event === "started" || (event.event === "progress" && !event.details?.pagesProcessed)) await persistReport();
            }).catch((error) => {
              progressWriteError = error;
            });
            return progressQueue;
          };
          result.stage = "conversion";
          await recordProgress({ event: "started", sourceSize: sourceStat.size, sourceHash });
          const converted = extension === ".pdf"
            ? await runPdfExtractionPipeline(sourcePath, {
              converter,
              maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
              allowLargePageWindow: true,
              assertNotCancelled: () => { if (progressWriteError) throw progressWriteError; },
              layoutAssetDir: path.join(artifactRoot, "assets"),
              layoutCacheDir: path.join(artifactRoot, "cache"),
              ocrCacheDir: path.join(artifactRoot, "ocr-cache"),
              onProgress: (message, percent, details) => {
                result.stage = String(message || "conversion");
                recordProgress({ event: "progress", stage: message, percent, details: details || null,
                  nodeRssBytes: process.memoryUsage().rss });
              },
              onLayoutPage: (page) => recordProgress({ event: "layout_page", ...page }),
              onHeartbeat: (heartbeat) => recordProgress({ event: "heartbeat", ...heartbeat,
                nodeRssBytes: process.memoryUsage().rss })
            })
            : await converter.convert({
              sourcePath,
              inputStat: sourceStat,
              assetDir: path.join(artifactRoot, "assets"),
              onProgress: (message, percent) => {
                result.stage = String(message || "conversion");
                recordProgress({ event: "progress", stage: message, percent });
              }
            });
          await progressQueue;
          if (progressWriteError) throw progressWriteError;
          const markdownPath = path.join(artifactRoot, "raw.md");
          const readablePath = path.join(artifactRoot, "readable.md");
          await writeFile(markdownPath, converted.markdown || "", "utf8");
          await writeFile(readablePath, createReadableMarkdown(converted.markdown || "", { sourceType: extension.slice(1), visualMap: converted.visualMap }), "utf8");
          if (converted.visualMap) await writeFile(path.join(artifactRoot, "visual-map.json"), JSON.stringify(converted.visualMap, null, 2), "utf8");
          const quality = converted.extractionQuality || {};
          const validation = extension === ".pdf" ? validatePdfConversion(converted) : converted.validation || null;
          const qualityGap = Number(quality.pendingOcrPages || 0) > 0
            || Number(quality.unresolvedPages || 0) > 0
            || Number(quality.failedVisualRegions || 0) > 0
            || Boolean(converted.partial) || validation?.passed === false;
          result.status = qualityGap ? "converted_partial" : "converted";
          result.qualityState = qualityGap ? "partial" : "complete";
          result.evidence = {
            artifacts: { markdownPath, readablePath, markdownHash: await hashFile(markdownPath) },
            qualityVerified: false,
            validation,
            backendFailures: converted.backendFailures || [],
            extractorName: converted.extractorName || extension.slice(1),
            attempts: converted.attempts || [],
            qualityState: result.qualityState,
            verificationScope: "Conversion and retained artifacts; content accuracy requires a source oracle.",
            visualSummary: converted.visualMap?.summary || null,
            resources: converted.stats?.resources || converted.visualMap?.resources || null,
            markdownCharacters: String(converted.markdown || "").length,
            pageCount: converted.pageCount ?? null,
            pageLedger: converted.pageLedger ? {
              sourcePageCount: converted.pageLedger.sourcePageCount,
              pageCountKnown: converted.pageLedger.pageCountKnown,
              pageStatuses: converted.pageLedger.pages.map((page) => [page.pageNumber, page.status]),
              pageQualityStatuses: converted.pageLedger.pages.map((page) => [page.pageNumber, page.qualityStatus || page.status])
            } : null,
            extractionQuality: converted.extractionQuality || null,
            warningCount: Array.isArray(converted.warnings) ? converted.warnings.length : 0
          };
          await recordProgress({ event: "completed", status: result.status, qualityState: result.qualityState,
            pageCount: result.pageCount ?? converted.pageCount ?? null });
          await progressQueue;
          if (progressWriteError) throw progressWriteError;
          result.warnings = converted.warnings || [];
        }
      }
      const finishHash = await hashFile(sourcePath);
      result.evidence = { ...result.evidence, sourceHashAtFinish: finishHash, sourceUnchanged: finishHash === sourceHash };
      if (finishHash !== sourceHash) {
        const sourceChanged = new Error("Source changed while the evaluation was running.");
        sourceChanged.code = "SOURCE_CHANGED";
        throw sourceChanged;
      }
    } catch (error) {
      const interrupted = isInterruptedError(error);
      const knownStatuses = new Set(["optional_adapter_required", "resource_limit_preflight", "resource_limit", "unsupported"]);
      const code = interrupted ? (error.code || "interrupted") : (knownStatuses.has(error.code) ? error.code : "conversion_error");
      result.status = interrupted ? "interrupted" : code;
      result.evidence = { ...result.evidence, code, rawErrorCode: error.code || null, message: error.message, interrupted,
        backendFailures: error.backend ? [{ backend: error.backend, message: error.message }] : [], attempts: error.attempts || [] };
      const finishHash = await hashFile(sourcePath).catch(() => null);
      result.evidence.sourceHashAtFinish = finishHash;
      result.evidence.sourceUnchanged = finishHash === sourceHash;
    }
    result.elapsedMs = Date.now() - startedAt;
    result.finishedAt = new Date().toISOString();
    result.stage = result.status;
    results.push(result);
    currentResult = null;
    await persistReport();
  }
  const finalIdentity = await collectRuntimeIdentity();
  if (finalIdentity.buildId !== runtimeIdentity.buildId) throw new Error("Runtime changed during evaluation; final report cannot be certified.");
  const report = await persistReport("completed");
  await atomicWriteJson(ownerPath, { schema: "schema-docs.real-material-run", runId, sourceRoot,
    retained: true, status: "completed", reportPath: outputPath });
  console.log(JSON.stringify({ outputPath, summary: report.summary }, null, 2));
  return report;
  } finally { guard.release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  evaluateRealMaterials().then(report => {
    if (report.summary.errors || report.summary.interrupted || report.summary.validationFailures) process.exitCode = 1;
  }).catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  });
}
