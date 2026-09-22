import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { detectPdfLayoutExtractor, runLayoutProcess } from "./pdfLayoutExtractor.js";
import { readPageStream, assertMemoryBudget } from "./pdfPageStream.js";

const execFileAsync = promisify(execFile);
const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "pdfOcrWorker.py");

async function runNativeOcr(detection, config, options = {}) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "schema-docs-native-ocr-"));
  try {
    const input = path.join(temporary, "input.json"), output = path.join(temporary, "output.json");
    await writeFile(input, JSON.stringify({ library: detection.library, tessdataDir: detection.tessdataDir,
      ...config, maxWorkerResidentBytes: options.maxWorkerResidentBytes, maxTemporaryBytes: options.maxTemporaryBytes,
      pageTimeoutMs: options.pageTimeoutMs, regionTimeoutMs: options.regionTimeoutMs, streamOutput: true, cacheDir: config.cacheDir || path.join(temporary, "cache") }));
    const { workerResources } = await runLayoutProcess(detection.python, [workerPath, input, output], {
      // Long-document OCR has no implicit whole-document deadline. A caller
      // may still supply an explicit timeout for a user-requested budget.
      timeout: config.probe ? 15000 : (Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : undefined),
      maxBuffer: 16 * 1024 * 1024,
      assertNotCancelled: options.assertNotCancelled,
      maxResidentBytes: options.maxResidentBytes,
      env: { TEMP: temporary, TMP: temporary, TMPDIR: temporary },
      onRegionComplete: event => options.onProgress?.({ page: event.pageNumber, totalPages: event.pageCount,
        regionId: event.regionId, regionsProcessed: event.regionsProcessed,
        regionsRequested: event.regionsRequested, status: event.status, phase: "region" }),
      onPageComplete: event => options.onProgress?.({ page: event.pageNumber, totalPages: event.pageCount,
        pagesProcessed: event.pagesProcessed, pagesRequested: event.pagesRequested,
        percent: event.pagesRequested ? Math.round(event.pagesProcessed / event.pagesRequested * 100) : 0,
        reused: event.reused, resumed: event.resumed, reusedRegions: event.reusedRegions,
        regionsRequested: event.regionsRequested, regionsProcessed: event.regionsProcessed,
        status: event.status }),
      onHeartbeat: heartbeat => options.onHeartbeat?.(heartbeat)
    });
    const result = JSON.parse(await readFile(output, "utf8"));
    if (workerResources) result.resources = { ...result.resources, ...workerResources };
    if (result.pageStream) {
      const consumed = await readPageStream(result.pageStream, options);
      result.pages = consumed.pages;
      result.resources.nodePageConsumption = consumed.resources;
      if (!options.omitMarkdown) {
        const parts = [`# ${result.sourceStem}\n\n`];
        for (const page of result.pages) {
          const status = page.status === "completed" ? "ocr" : (page.text ? "ocr_partial" : "ocr_failed");
          parts.push(`<!-- pdf-page: ${page.page}; extraction: ${status}; languages: ${result.languages} -->\n\n${page.text || ""}\n`);
          if (status !== "ocr") parts.push("> OCR incomplete for this source page; review the retained PDF.\n");
        }
        result.markdown = parts.join("\n");
      }
      delete result.pageStream;
    }
    return result;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function commandVersion(command, args) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: 5000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024
    });
    return { available: true, version: String(stdout || stderr || "present").split(/\r?\n/)[0] };
  } catch (error) {
    return { available: false, version: null, error: error.message };
  }
}

export async function detectPdfOcrAdapter(options = {}) {
  const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const tesseractCandidates = [
    path.join(runtimeRoot, "runtime", "tesseract", "tesseract.exe"),
    path.join(path.dirname(process.execPath), "tesseract", "tesseract.exe"),
    path.join(process.env.ProgramFiles || "C:/Program Files", "Tesseract-OCR", "tesseract.exe")
  ];
  const tesseractCommand = options.tesseractCommand || process.env.SCHEMA_DOCS_TESSERACT
    || (process.platform === "win32" && tesseractCandidates.find(candidate => existsSync(candidate))) || "tesseract";
  const rendererCommand = options.rendererCommand || process.env.SCHEMA_DOCS_PDFTOPPM || "pdftoppm";
  const pdfInfoCommand = options.pdfInfoCommand || process.env.SCHEMA_DOCS_PDFINFO || "pdfinfo";
  const userTessdata = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "SchemaDocs", "tessdata") : "";
  const tessdataDir = options.tessdataDir
    || process.env.SCHEMA_DOCS_TESSDATA
    || (userTessdata && existsSync(userTessdata) ? userTessdata : "")
    || (path.isAbsolute(tesseractCommand) ? path.join(path.dirname(tesseractCommand), "tessdata") : "");
  const [tesseract, renderer, pdfInfo] = await Promise.all([
    commandVersion(tesseractCommand, ["--version"]),
    commandVersion(rendererCommand, ["-h"]),
    commandVersion(pdfInfoCommand, ["-v"])
  ]);
  const languages = tesseract.available ? [...await availableLanguages(tesseractCommand, tessdataDir)] : [];
  if (!options.rendererCommand && !options.pdfInfoCommand && !process.env.SCHEMA_DOCS_PDFTOPPM && !process.env.SCHEMA_DOCS_PDFINFO) {
    const library = options.tesseractLibrary || (path.isAbsolute(tesseractCommand)
      ? ["tesseract55.dll", "libtesseract-5.dll"].map(name => path.join(path.dirname(tesseractCommand), name)).find(existsSync) : "");
    if (library && existsSync(library) && languages.length) {
      const python = await detectPdfLayoutExtractor({ pythonPath: options.pythonPath });
      if (python.available) {
        try {
          const native = { python, library, tessdataDir };
          const probe = await runNativeOcr(native, { probe: true, languages: languages.includes("eng") ? "eng" : languages[0] });
          return { available: true, native,
            tesseract: { ...tesseract, command: tesseractCommand, tessdataDir, languages, version: probe.version },
            renderer: { available: true, command: python.command, backend: "pdfium", version: probe.pdfiumVersion },
            pdfInfo: { available: true, command: python.command, backend: "pdfium", version: probe.pdfiumVersion } };
        } catch { /* Preserve the explicitly supported external-tool fallback. */ }
      }
    }
  }
  return {
    available: tesseract.available && renderer.available && pdfInfo.available,
    tesseract: { ...tesseract, command: tesseractCommand, tessdataDir, languages },
    renderer: { ...renderer, command: rendererCommand },
    pdfInfo: { ...pdfInfo, command: pdfInfoCommand }
  };
}

async function pageCount(sourcePath, command) {
  const { stdout, stderr } = await execFileAsync(command, [sourcePath], {
    timeout: 30000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });
  const match = String(stdout || stderr || "").match(/^Pages:\s+(\d+)/mi);
  if (!match) throw new Error("pdfinfo did not report a PDF page count.");
  return Number(match[1]);
}

async function availableLanguages(command, tessdataDir = "") {
  try {
    const args = tessdataDir ? ["--tessdata-dir", tessdataDir, "--list-langs"] : ["--list-langs"];
    const { stdout } = await execFileAsync(command, args, {
      timeout: 10000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024
    });
    return new Set(String(stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(line => /^[A-Za-z_]+$/.test(line)));
  } catch {
    return new Set();
  }
}

function chooseLanguages(requested, installed) {
  const wanted = String(requested || process.env.SCHEMA_DOCS_OCR_LANGUAGES || "chi_sim+eng")
    .split("+")
    .map((item) => item.trim())
    .filter(Boolean);
  const missing = wanted.filter(item => !installed.has(item));
  if (missing.length) throw Object.assign(new Error(`Missing OCR language data: ${missing.join(", ")}`), { code: "OCR_LANGUAGE_UNAVAILABLE" });
  return wanted.join("+");
}

export async function extractPdfWithOcr(sourcePath, options = {}) {
  const detection = options.detection || await detectPdfOcrAdapter(options);
  if (!detection.available) {
    const error = new Error("PDF OCR requires Tesseract and a working PDF renderer.");
    error.code = "PDF_OCR_ADAPTER_UNAVAILABLE";
    throw error;
  }
  if (detection.native) {
    const languages = chooseLanguages(options.languages, new Set(detection.tesseract.languages));
    return runNativeOcr(detection.native, { source: sourcePath, languages,
      startPage: options.startPage || 1, maxPages: options.maxPages,
      pageNumbers: options.pageNumbers, pageRegions: options.pageRegions, cacheDir: options.cacheDir,
      dpi: options.dpi || 220, maxPixels: options.maxPixels || 16_000_000,
      psm: options.pageSegmentationMode || 3,
      regionBatchSize: options.regionBatchSize || options.ocrRegionBatchSize || 16,
      retryUnresolved: options.retryUnresolved === true, maxRegionAttempts: options.maxRegionAttempts || 2 }, options);
  }
  const totalPages = await pageCount(sourcePath, detection.pdfInfo.command);
  const startPage = Math.max(1, Math.min(totalPages, Number(options.startPage) || 1));
  const endPage = options.maxPages
    ? Math.min(totalPages, startPage + Math.max(1, Number(options.maxPages)) - 1)
    : totalPages;
  const tessdataDir = options.tessdataDir || detection.tesseract.tessdataDir || "";
  const languages = chooseLanguages(options.languages, await availableLanguages(detection.tesseract.command, tessdataDir));
  const dpi = Math.max(120, Math.min(400, Number(options.dpi) || 220));
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "schema-docs-pdf-ocr-"));
  const markdown = [`# ${path.parse(sourcePath).name}`, ""];
  const failedPages = [];
  let extractedCharacters = 0;
  const taskStarted = Date.now();
  const checkControl = async () => {
    await options.assertNotCancelled?.();
    assertMemoryBudget(options.maxResidentBytes);
    if (Number(options.timeoutMs) > 0 && Date.now() - taskStarted >= Number(options.timeoutMs)) {
      throw Object.assign(new Error('Explicit OCR task deadline reached.'), {code:'TIMEOUT',recoverable:true});
    }
  };
  const processOptions = () => ({ assertNotCancelled: checkControl,
    timeout: Number(options.pageTimeoutMs) > 0 ? Number(options.pageTimeoutMs) : undefined,
    onHeartbeat: options.onHeartbeat, windowsHide: true });
  try {
    for (let page = startPage; page <= endPage; page += 1) {
      await checkControl();
      const prefix = path.join(tempRoot, `page-${page}`);
      const imagePath = `${prefix}.png`;
      try {
        await runLayoutProcess({ command: detection.renderer.command }, [
          "-f", String(page), "-l", String(page), "-singlefile", "-r", String(dpi), "-png", sourcePath, prefix
        ], { ...processOptions(), maxBuffer: 4 * 1024 * 1024 });
        const ocrArgs = [imagePath, "stdout"];
        if (tessdataDir) ocrArgs.push("--tessdata-dir", tessdataDir);
        ocrArgs.push("-l", languages, "--psm", String(options.pageSegmentationMode || 3));
        const { stdout } = await runLayoutProcess({ command: detection.tesseract.command }, ocrArgs, {
          ...processOptions(),
          maxBuffer: 32 * 1024 * 1024
        });
        const text = String(stdout || "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").trim();
        extractedCharacters += text.length;
        markdown.push(`<!-- pdf-page: ${page}; extraction: ocr; languages: ${languages} -->`, "", text, "");
      } catch (error) {
        if (["job_cancelled", "ABORT_ERR", "resource_limit", "TIMEOUT", "ETIMEDOUT"].includes(error?.code)) throw error;
        failedPages.push({ page, error: error.message });
        markdown.push(`<!-- pdf-page: ${page}; extraction: ocr_failed -->`, "", `> OCR failed for source page ${page}. Review the original PDF page.`, "");
      } finally {
        await rm(imagePath, { force: true }).catch(() => {});
      }
      if (options.onProgress) {
        await options.onProgress({ page, startPage, endPage, totalPages, percent: Math.round(((page - startPage + 1) / (endPage - startPage + 1)) * 100) });
      }
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
  return {
    markdown: markdown.join("\n").trimEnd() + "\n",
    pageCount: totalPages,
    pagesProcessed: endPage - startPage + 1,
    pageRange: { start: startPage, end: endPage },
    languages,
    dpi,
    extractedCharacters,
    failedPages
  };
}
