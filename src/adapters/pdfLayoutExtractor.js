import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function formulaOcrPython(options = {}) {
  if (options.formulaOcrPython) return options.formulaOcrPython;
  if (process.env.SCHEMA_DOCS_FORMULA_OCR_PYTHON) return process.env.SCHEMA_DOCS_FORMULA_OCR_PYTHON;
  const marker = process.env.SCHEMA_DOCS_MARKER || "";
  if (/marker_single(?:\.exe)?$/i.test(marker)) return path.join(path.dirname(marker), process.platform === "win32" ? "python.exe" : "python");
  return "";
}

async function runPython(candidate, args, options = {}) {
  const commandArgs = candidate.args ? [...candidate.args, ...args] : args;
  return execFileAsync(candidate.command, commandArgs, options);
}

export async function detectPdfLayoutExtractor(options = {}) {
  const candidates = options.pythonPath
    ? [{ command: options.pythonPath, args: [] }]
    : [
        ...(process.env.SCHEMA_DOCS_PYTHON ? [{ command: process.env.SCHEMA_DOCS_PYTHON, args: [] }] : []),
        { command: "python", args: [] },
        { command: "python3", args: [] },
        { command: "py", args: ["-3"] }
      ];
  for (const candidate of candidates) {
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
  try {
    const args = [scriptPath, sourcePath, markdownPath, manifestPath];
    if (options.startPage) args.push("--start-page", String(options.startPage));
    if (options.maxPages) args.push("--max-pages", String(options.maxPages));
    if (options.assetDir) args.push("--asset-dir", options.assetDir);
    const { stdout, stderr } = await runPython(detection, args, {
      timeout: await resolveLayoutTimeoutMs(sourcePath, options.timeoutMs),
      maxBuffer: LAYOUT_MAX_BUFFER_BYTES,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" }
    });
    let formulaOcr = null;
    const ocrPython = options.formulaOcr ? formulaOcrPython(options) : "";
    if (ocrPython && options.assetDir) {
      const ocrResult = await execFileAsync(ocrPython, [
        formulaOcrScriptPath,
        markdownPath,
        manifestPath,
        options.assetDir,
        "--batch-size",
        String(options.formulaOcrBatchSize || 6)
      ], {
        timeout: options.formulaOcrTimeoutMs || 24 * 60 * 60 * 1000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" }
      });
      formulaOcr = String(ocrResult.stdout || "").trim().split(/\r?\n/).at(-1) || "";
    }
    const [markdown, manifestText] = await Promise.all([
      readFile(markdownPath, "utf8"),
      readFile(manifestPath, "utf8")
    ]);
    return {
      markdown,
      visualMap: JSON.parse(manifestText),
      adapterVersion: detection.version,
      stdout: String(stdout || "").trim(),
      stderr: String(stderr || "").trim(),
      formulaOcr
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
