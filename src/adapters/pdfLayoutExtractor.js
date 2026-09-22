import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyPdfReadingOrder } from "../processing/readingOrder.js";
import { existsSync } from "node:fs";
import { readPageStream, assertMemoryBudget } from "./pdfPageStream.js";

const execFileAsync = promisify(execFile);

// Layout extraction cost scales with page count, and a book-length PDF needs far
// longer than a report. A fixed ceiling makes the whole document fail once it is
// exceeded -- the error discards the layout result and the pipeline falls back to
// plain pdftotext, which performs no formula reconstruction at all. So the budget
// is derived from the input size, with the fixed value kept as the floor.
const LAYOUT_TIMEOUT_FLOOR_MS = 20 * 60 * 1000;
const LAYOUT_TIMEOUT_PER_MB_MS = 90 * 1000;
const LAYOUT_TIMEOUT_CEILING_MS = 6 * 60 * 60 * 1000;

// The Markdown and manifest are written to files, so stdout only carries
// diagnostics. A long document still emits enough of them to exceed a small
// buffer, and exceeding it kills the process and loses the entire extraction.
const LAYOUT_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

export async function resolveLayoutTimeoutMs(sourcePath, explicitTimeoutMs) {
  if (Number(explicitTimeoutMs) > 0) return Number(explicitTimeoutMs);
  try {
    const { size } = await stat(sourcePath);
    const budget = LAYOUT_TIMEOUT_FLOOR_MS
      + Math.ceil(size / (1024 * 1024)) * LAYOUT_TIMEOUT_PER_MB_MS;
    return Math.min(budget, LAYOUT_TIMEOUT_CEILING_MS);
  } catch {
    // An unreadable size is not a reason to fail; keep the previous behaviour.
    return LAYOUT_TIMEOUT_FLOOR_MS;
  }
}
const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "pdfLayoutExtractor.py");
const formulaOcrScriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "pdfFormulaOcr.py");

export function hasBundledPdfRuntime() {
  return existsSync(path.resolve(path.dirname(scriptPath), "../../runtime/python",
    process.platform === "win32" ? "python.exe" : "bin/python"));
}

function formulaOcrPython(options = {}) {
  if (options.formulaOcrPython) return options.formulaOcrPython;
  if (process.env.SCHEMA_DOCS_FORMULA_OCR_PYTHON) return process.env.SCHEMA_DOCS_FORMULA_OCR_PYTHON;
  const marker = process.env.SCHEMA_DOCS_MARKER || "";
  if (/marker_single(?:\.exe)?$/i.test(marker)) return path.join(path.dirname(marker), process.platform === "win32" ? "python.exe" : "python");
  return "";
}

async function runPython(candidate, args, options = {}) {
  const commandArgs = candidate.args ? [...candidate.args, ...args] : args;
  return execFileAsync(candidate.command, commandArgs, {
    ...options,
    env: { ...process.env, ...options.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
}

export async function runLayoutProcess(candidate, args, options = {}) {
  const { assertNotCancelled, onPageComplete, onRegionComplete, onHeartbeat, heartbeatMs, maxResidentBytes, ...execOptions } = options;
  await assertNotCancelled?.();
  let child, failure, check = null, pending = "", events = Promise.resolve();
  const startedAt = Date.now();
  let pagesCompleted = 0;
  let lastPageAt = startedAt;
  let workerResources = null;
  const stop = (error) => {
    failure ||= error;
    child?.kill("SIGKILL");
  };
  const completed = new Promise((resolve, reject) => {
    child = execFile(candidate.command, [...(candidate.args || []), ...args], {
      ...execOptions, windowsHide: true,
      env: { ...process.env, ...execOptions.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" }
    }, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
    child.stdout?.on("data", (chunk) => {
      pending += chunk;
      let newline;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.event === "worker_resource") {
          workerResources = event;
          if (event.budgetExceeded) stop(Object.assign(new Error("Worker resource budget reached; committed checkpoints are retained."), { code: "resource_limit", recoverable: true, resources: event }));
          if (event.timeoutScope) stop(Object.assign(new Error(`Explicit ${event.timeoutScope} OCR deadline reached; checkpoints are retained.`), { code: "TIMEOUT", recoverable: true, scope: event.timeoutScope, resources: event }));
        } else if (event.event === "layout_page") {
          pagesCompleted += 1;
          lastPageAt = Date.now();
          events = events.then(() => onPageComplete?.(event)).catch(stop);
        } else if (event.event === "ocr_region") {
          lastPageAt = Date.now();
          events = events.then(() => onRegionComplete?.(event)).catch(stop);
        }
      }
    });
  });
  const timer = assertNotCancelled || maxResidentBytes ? setInterval(() => {
    if (check) return;
    check = Promise.resolve().then(() => { assertMemoryBudget(maxResidentBytes); return assertNotCancelled?.(); }).catch(stop).finally(() => { check = null; });
  }, 200) : null;
  const heartbeat = onHeartbeat
    ? setInterval(() => {
      Promise.resolve().then(() => onHeartbeat({
        elapsedMs: Date.now() - startedAt,
        pagesCompleted,
        lastPageAt,
        stalledForMs: Date.now() - lastPageAt,
        nodeRssBytes: process.memoryUsage().rss,
        workerResources,
        phase: "python_layout"
      })).catch(stop);
    }, Math.max(1000, Number(heartbeatMs) || 10000))
    : null;
  try {
    const result = await completed;
    await events;
    await assertNotCancelled?.();
    if (failure) throw failure;
    return { ...result, workerResources };
  } catch (error) {
    if (failure) throw failure;
    if (error.code === 75) throw Object.assign(error, { code: "resource_limit", recoverable: true, resources: workerResources });
    if (error.code === 76) throw Object.assign(error, { code: "TIMEOUT", recoverable: true, resources: workerResources });
    if (error.killed && Number(execOptions.timeout) > 0 && Date.now() - startedAt >= Number(execOptions.timeout)) {
      throw Object.assign(error, { code: "TIMEOUT", recoverable: true });
    }
    throw error;
  } finally {
    if (timer) clearInterval(timer);
    if (heartbeat) clearInterval(heartbeat);
    await check;
    await events;
  }
}

export async function detectPdfLayoutExtractor(options = {}) {
  const bundledCandidates = process.platform === "win32"
    ? [
        path.join(path.dirname(process.execPath), "python.exe"),
        path.join(path.dirname(process.execPath), "python", "python.exe"),
        path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "runtime", "python", "python.exe"),
      ]
    : [
        path.join(path.dirname(process.execPath), "python"),
        path.join(path.dirname(process.execPath), "python", "bin", "python"),
        path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "runtime", "python", "bin", "python"),
      ];
  const candidates = options.pythonPath
    ? [{ command: options.pythonPath, args: [] }]
    : [
        ...(process.env.SCHEMA_DOCS_PYTHON ? [{ command: process.env.SCHEMA_DOCS_PYTHON, args: [] }] : []),
        ...bundledCandidates.filter((candidate) => existsSync(candidate)).map((command) => ({ command, args: [] })),
        { command: "python", args: [] },
        { command: "python3", args: [] },
        { command: "py", args: ["-3"] }
      ];
  for (const unresolved of candidates) {
    const candidate = { ...unresolved, args: [...unresolved.args, "-B", "-X", "utf8"] };
    try {
      const { stdout } = await runPython(candidate, ["-c", "import pdfplumber; print(pdfplumber.__version__)"], {
        timeout: 5000,
        windowsHide: true
      });
      return {
        available: true,
        command: candidate.command,
        args: candidate.args,
        version: String(stdout || "unknown").trim().split(/\r?\n/)[0] || "unknown"
      };
    } catch {}
  }
  return { available: false, command: null, args: [], version: null };
}

export function analyzePdfSemanticLoss(markdown) {
  const text = String(markdown || "");
  const octalArtifacts = (text.match(/\\[0-2][0-7]{2}/g) || []).length;
  const cidArtifacts = (text.match(/\(cid:\d+\)/g) || []).length;
  const privateUseArtifacts = (text.match(/[\uE000-\uF8FF]/g) || []).length;
  const replacementArtifacts = (text.match(/\uFFFD/g) || []).length;
  const brokenLigatureMath = (text.match(/(?:@|=|\\[0-7]{3})\s*(?:ff|fi|fl|ffi|ffl)\b/g) || []).length;
  const score = octalArtifacts * 3 + cidArtifacts * 4 + privateUseArtifacts * 4 + replacementArtifacts * 5 + brokenLigatureMath * 2;
  return {
    octalArtifacts,
    cidArtifacts,
    privateUseArtifacts,
    replacementArtifacts,
    brokenLigatureMath,
    score,
    formulaDamageLikely: score >= 24
  };
}

export async function extractPdfWithLayout(sourcePath, options = {}) {
  const detection = options.detection || await detectPdfLayoutExtractor(options);
  if (!detection.available) {
    const error = new Error("Python pdfplumber adapter is unavailable.");
    error.code = "PDF_LAYOUT_ADAPTER_UNAVAILABLE";
    throw error;
  }
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "schema-docs-pdf-layout-"));
  const markdownPath = path.join(tempRoot, "document.md");
  const manifestPath = path.join(tempRoot, "visual-map.json");
  const temporaryWorkingSet = { maxObservedBytes: 0, samples: 0, sampledAt: null, scope: 'owned layout scratch including parser window' };
  let lastDiskSample = 0;
  const sampleScratch = async () => {
    if (Date.now() - lastDiskSample < 5000) return;
    lastDiskSample = Date.now();
    let bytes = 0;
    const visit = async directory => {
      for (const entry of await readdir(directory, {withFileTypes:true}).catch(()=>[])) {
        if (entry.isSymbolicLink()) continue;
        const file=path.join(directory,entry.name);
        if (entry.isDirectory()) await visit(file);
        else bytes += (await stat(file).catch(()=>({size:0}))).size;
      }
    };
    await visit(tempRoot);
    temporaryWorkingSet.maxObservedBytes = Math.max(temporaryWorkingSet.maxObservedBytes,bytes);
    temporaryWorkingSet.samples++;
    temporaryWorkingSet.sampledAt = Date.now();
  };
  try {
    const args = [scriptPath, sourcePath, markdownPath, manifestPath];
    if (options.startPage) args.push("--start-page", String(options.startPage));
    if (options.maxPages) args.push("--max-pages", String(options.maxPages));
    if (options.pageWindowSize) args.push("--window-size", String(options.pageWindowSize));
    if (options.assetDir) args.push("--asset-dir", options.assetDir);
    if (options.cacheDir) args.push("--cache-dir", options.cacheDir);
    if (options.maxWorkerResidentBytes) args.push("--max-worker-resident-bytes", String(options.maxWorkerResidentBytes));
    if (options.maxTemporaryBytes) args.push("--max-temporary-bytes", String(options.maxTemporaryBytes));
    const layoutProcessOptions = {
      assertNotCancelled: options.assertNotCancelled,
      onPageComplete: async event => { await sampleScratch(); await options.onPageComplete?.(event); },
      onHeartbeat: options.onHeartbeat,
      heartbeatMs: options.heartbeatMs,
      maxResidentBytes: options.maxResidentBytes,
      maxBuffer: LAYOUT_MAX_BUFFER_BYTES,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", TEMP: tempRoot, TMP: tempRoot, TMPDIR: tempRoot }
    };
    // A long document has no implicit whole-document deadline. A caller may
    // still provide an explicit operation budget, in which case cancellation
    // is deliberate and the resulting error is surfaced as an interruption.
    if (Number(options.timeoutMs) > 0) layoutProcessOptions.timeout = Number(options.timeoutMs);
    const { stdout, stderr, workerResources } = await runLayoutProcess(detection, args, layoutProcessOptions);
    let formulaOcr = null;
    const ocrPython = options.formulaOcr ? formulaOcrPython(options) : "";
    if (ocrPython && options.assetDir) {
      const ocrResult = await runLayoutProcess({ command: ocrPython }, [
        formulaOcrScriptPath,
        markdownPath,
        manifestPath,
        options.assetDir,
        "--batch-size",
        String(options.formulaOcrBatchSize || 6)
      ], {
        assertNotCancelled: options.assertNotCancelled,
        timeout: Number(options.formulaOcrTimeoutMs) > 0 ? Number(options.formulaOcrTimeoutMs) : undefined,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" }
      });
      formulaOcr = String(ocrResult.stdout || "").trim().split(/\r?\n/).at(-1) || "";
    }
    const markdown = await readFile(markdownPath, "utf8");
    let visualMap;
    if (formulaOcr) visualMap = JSON.parse(await readFile(manifestPath, "utf8"));
    else {
      visualMap = JSON.parse(await readFile(`${manifestPath}.meta.json`, "utf8"));
      const consumed = await readPageStream(`${markdownPath}.pages.jsonl`, options);
      visualMap.pages = consumed.pages;
      visualMap.resources.nodePageConsumption = consumed.resources;
    }
    if (workerResources) visualMap.resources = { ...visualMap.resources, ...workerResources };
    await sampleScratch();
    visualMap.resources.temporaryWorkingSet = temporaryWorkingSet;
    return applyPdfReadingOrder({
      markdown,
      visualMap,
      adapterVersion: detection.version,
      stdout: String(stdout || "").trim(),
      stderr: String(stderr || "").trim(),
      formulaOcr
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
