import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);
const markerRuntimeProbeCache = new Map();

function localLlamaServerBinary(options = {}) {
  // Never ship or persist a developer-machine path.  A packaged installation
  // can opt into the advanced Marker add-on by configuring this variable, or
  // by putting llama-server on PATH (which Marker resolves itself).
  const configured = options.llamaCppBinary || process.env.LLAMA_CPP_BINARY || process.env.SCHEMA_DOCS_LLAMA_CPP_BINARY || "";
  return configured && existsSync(configured) ? configured : "";
}

function markerRuntimeEnvironment(options = {}) {
  const binary = localLlamaServerBinary(options);
  return binary ? { LLAMA_CPP_BINARY: binary } : {};
}

function elapsedLabel(startedAt) {
  const elapsedSeconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

async function probeMarkerRuntime(command, options = {}) {
  if (!path.isAbsolute(command) || !/marker_single(?:\.exe)?$/i.test(command)) return { ok: true, detail: "command-on-path" };
  const runtimeEnv = markerRuntimeEnvironment(options);
  const cacheKey = `${command}\u0000${runtimeEnv.LLAMA_CPP_BINARY || ""}`;
  if (markerRuntimeProbeCache.has(cacheKey)) return markerRuntimeProbeCache.get(cacheKey);
  const markerPython = path.join(path.dirname(command), process.platform === "win32" ? "python.exe" : "python");
  const probe = !existsSync(markerPython)
    ? Promise.resolve({ ok: false, detail: "Marker Python runtime is missing." })
    : execFileAsync(markerPython, ["-c", "from surya.inference.backends.llamacpp import _resolve_llama_server_binary; print(_resolve_llama_server_binary())"], {
      timeout: 15000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, ...runtimeEnv }
    }).then(() => ({ ok: true, detail: "ready" })).catch((error) => ({
      ok: false,
      detail: /llama-server binary not found/i.test(String(error.stderr || error.message || ""))
        ? "Marker needs its local llama-server runtime before mathematical reconstruction can run."
        : "Marker runtime preflight failed."
    }));
  markerRuntimeProbeCache.set(cacheKey, probe);
  return probe;
}

export async function detectPdfMarkerExtractor(options = {}) {
  const configured = options.markerCommand || process.env.SCHEMA_DOCS_MARKER || "";
  const standardWindowsMarker = path.join(os.homedir(), ".schema-docs-marker", "Scripts", "marker_single.exe");
  const candidates = [
    ...(configured ? [configured] : ["marker_single"]),
    ...(process.platform === "win32" && existsSync(standardWindowsMarker) && standardWindowsMarker !== configured ? [standardWindowsMarker] : [])
  ];
  // Marker may be installed as a bare executable or as a script that needs an
  // interpreter in front of it. Leading arguments are kept alongside the command
  // so both forms are invocable, matching the layout extractor's convention.
  const args = Array.isArray(options.markerArgs) ? [...options.markerArgs] : [];
  let firstUnavailable = null;
  for (const command of candidates) {
   if (path.isAbsolute(command) && existsSync(command) && /marker_single(?:\.exe)?$/i.test(command)) {
    const runtime = await probeMarkerRuntime(command, options);
    const detected = {
      available: runtime.ok,
      command,
      args,
      runtimeEnv: markerRuntimeEnvironment(options),
      version: runtime.ok ? "installed" : runtime.detail
    };
    if (detected.available) return detected;
    firstUnavailable ||= detected;
    continue;
   }
   try {
    const { stdout, stderr } = await execFileAsync(command, [...args, "--help"], {
      timeout: 15000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024
    });
    return { available: true, command, args, version: String(stdout || stderr || "present").split(/\r?\n/)[0] };
   } catch (error) {
    if (error.code !== "ENOENT" && error.code !== 127) return { available: true, command, args, version: "present" };
   }
  }
  return firstUnavailable || { available: false, command: candidates[0] || "marker_single", args, version: null };
}

async function markerPageCount(sourcePath, detection, explicitPageCount) {
  if (Number.isInteger(explicitPageCount) && explicitPageCount > 0) return explicitPageCount;
  const markerPython = /marker_single(?:\.exe)?$/i.test(String(detection.command || ""))
    ? path.join(path.dirname(detection.command), process.platform === "win32" ? "python.exe" : "python")
    : "";
  if (!markerPython || !existsSync(markerPython)) return 0;
  try {
    const { stdout } = await execFileAsync(markerPython, ["-c", "import pypdfium2 as pdfium; import sys; print(len(pdfium.PdfDocument(sys.argv[1])))", sourcePath], {
      timeout: 15000,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    const count = Number.parseInt(String(stdout || "").trim(), 10);
    return Number.isInteger(count) && count > 0 ? count : 0;
  } catch {
    return 0;
  }
}

async function findNewestMarkdown(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    const fullPath = path.join(entry.parentPath || entry.path || root, entry.name);
    const details = await stat(fullPath);
    files.push({ path: fullPath, mtimeMs: details.mtimeMs });
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.path || "";
}

export function rewriteMarkerLocalAssets(markdown, markdownPath, markdownBaseDir) {
  if (!markdownBaseDir) return markdown;
  const sourceDir = path.dirname(markdownPath);
  return String(markdown || "").replace(/(!\[[^\]]*\]\()([^\s)]+)(\))/g, (whole, open, target, close) => {
    if (/^(?:https?:|data:|#|\/)/i.test(target)) return whole;
    const absolute = path.resolve(sourceDir, decodeURIComponent(target));
    const relative = path.relative(markdownBaseDir, absolute).replace(/\\/g, "/");
    return `${open}${encodeURI(relative)}${close}`;
  });
}

export async function extractPdfWithMarker(sourcePath, options = {}) {
  const detection = options.detection || await detectPdfMarkerExtractor(options);
  if (!detection.available) {
    const error = new Error("Marker PDF adapter is unavailable.");
    error.code = "PDF_MARKER_ADAPTER_UNAVAILABLE";
    throw error;
  }
  if (options.forceOcr) {
    const runtime = await probeMarkerRuntime(detection.command, options);
    if (!runtime.ok) {
      const error = new Error(runtime.detail);
      error.code = "PDF_MARKER_FULL_PAGE_OCR_UNAVAILABLE";
      throw error;
    }
  }
  const pageCount = options.pageRange
    ? 0
    : await markerPageCount(sourcePath, detection, options.pageCount);
  const batchSize = Number.isInteger(options.batchSize) ? options.batchSize : 250;
  if (!options.pageRange && pageCount > batchSize && batchSize > 0) {
    const ownsBatchRoot = !options.outputDir;
    const batchRoot = options.outputDir || await mkdtemp(path.join(os.tmpdir(), "schema-docs-marker-batches-"));
    const batchCount = Math.ceil(pageCount / batchSize);
    const batches = [];
    try {
      for (let index = 0; index < batchCount; index += 1) {
        const start = index * batchSize;
        const end = Math.min(pageCount - 1, start + batchSize - 1);
        const range = `${start}-${end}`;
        const batchOutputDir = path.join(batchRoot, `batch-${String(index + 1).padStart(4, "0")}`);
        if (typeof options.onProgress === "function") {
          options.onProgress(`Marker batch ${index + 1}/${batchCount}: pages ${start + 1}-${end + 1} of ${pageCount}`, 48 + Math.floor(index / batchCount * 46));
        }
        const priorMarkdownPath = await findNewestMarkdown(batchOutputDir).catch(() => "");
        if (priorMarkdownPath) {
          const markdown = rewriteMarkerLocalAssets(await readFile(priorMarkdownPath, "utf8"), priorMarkdownPath, options.markdownBaseDir);
          batches.push({
            markdown,
            markdownPath: priorMarkdownPath,
            outputDir: batchOutputDir,
            equationCount: (markdown.match(/\$\$[\s\S]*?\$\$/g) || []).length,
            tableCount: (markdown.match(/^\|.+\|\r?\n\|(?:\s*:?-+:?\s*\|)+/gm) || []).length,
            imageCount: (markdown.match(/!\[[^\]]*\]\([^)]+\)/g) || []).length,
            adapterVersion: detection.version,
            stdout: `Reused completed Marker batch ${index + 1}/${batchCount}.`,
            stderr: ""
          });
          continue;
        }
        batches.push(await extractPdfWithMarker(sourcePath, {
          ...options,
          detection,
          outputDir: batchOutputDir,
          pageRange: range,
          pageCount: 0,
          batchSize: 0,
          onProgress: options.onProgress
        }));
      }
    } catch (error) {
      if (ownsBatchRoot) await rm(batchRoot, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    if (typeof options.onProgress === "function") options.onProgress(`Marker completed ${batchCount}/${batchCount} batches`, 96);
    return {
      markdown: batches.map((batch) => batch.markdown.trim()).filter(Boolean).join("\n\n"),
      markdownPath: "",
      outputDir: batchRoot,
      equationCount: batches.reduce((sum, batch) => sum + batch.equationCount, 0),
      tableCount: batches.reduce((sum, batch) => sum + batch.tableCount, 0),
      imageCount: batches.reduce((sum, batch) => sum + batch.imageCount, 0),
      adapterVersion: detection.version,
      stdout: batches.map((batch) => batch.stdout).filter(Boolean).join("\n"),
      stderr: batches.map((batch) => batch.stderr).filter(Boolean).join("\n"),
      pageCount,
      batchesCompleted: batchCount,
      batchesTotal: batchCount
    };
  }
  const ownsOutputDir = !options.outputDir;
  const outputDir = options.outputDir || await mkdtemp(path.join(os.tmpdir(), "schema-docs-marker-"));
  await mkdir(outputDir, { recursive: true });
  const args = [sourcePath, "--output_dir", outputDir, "--output_format", "markdown", "--paginate_output"];
  // Marker converts display equations by default but leaves inline mathematics
  // as plain text unless its inline-math pass is requested.  A mathematics
  // textbook is mostly inline math -- variables, relations, and scripts inside
  // running sentences -- so without this the very content that motivates using
  // Marker comes back unconverted.  It costs an extra model pass per page, so
  // callers that only need display equations can turn it off.
  if (options.inlineMath !== false) args.push("--redo_inline_math");
  if (options.forceOcr) args.push("--force_ocr");
  if (options.pageRange) args.push("--page_range", String(options.pageRange));
  const startedAt = Date.now();
  let heartbeat = null;
  try {
    const commandArgs = Array.isArray(detection.args) ? [...detection.args, ...args] : args;
    if (typeof options.onProgress === "function") {
      options.onProgress("Marker started local full-page reconstruction");
      heartbeat = setInterval(() => {
        options.onProgress(`Marker is still reconstructing this ${options.pageRange ? `page range (${options.pageRange})` : "document"} - elapsed ${elapsedLabel(startedAt)}`);
      }, 15_000);
    }
    const { stdout, stderr } = await execFileAsync(detection.command, commandArgs, {
      timeout: options.timeoutMs || 12 * 60 * 60 * 1000,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, ...detection.runtimeEnv, ...markerRuntimeEnvironment(options), ...options.env, PYTHONIOENCODING: "utf-8" }
    });
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    const markdownPath = await findNewestMarkdown(outputDir);
    if (!markdownPath) throw new Error("Marker completed without producing a Markdown file.");
    const rawMarkdown = await readFile(markdownPath, "utf8");
    const markdown = rewriteMarkerLocalAssets(rawMarkdown, markdownPath, options.markdownBaseDir);
    const equationCount = (markdown.match(/\$\$[\s\S]*?\$\$/g) || []).length;
    const tableCount = (markdown.match(/^\|.+\|\r?\n\|(?:\s*:?-+:?\s*\|)+/gm) || []).length;
    const imageCount = (markdown.match(/!\[[^\]]*\]\([^)]+\)/g) || []).length;
    return {
      markdown,
      markdownPath,
      outputDir,
      equationCount,
      tableCount,
      imageCount,
      adapterVersion: detection.version,
      stdout: String(stdout || "").trim(),
      stderr: String(stderr || "").trim()
    };
  } catch (error) {
    if (heartbeat) clearInterval(heartbeat);
    if (ownsOutputDir) await rm(outputDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
