import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";

const execFileAsync = promisify(execFile);

async function commandVersion(command, args) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: 5000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024
    });
    return { available: true, version: String(stdout || stderr || "present").split(/\r?\n/)[0] };
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== 127) return { available: true, version: "present" };
    return { available: false, version: null };
  }
}

export async function detectPdfOcrAdapter(options = {}) {
  const tesseractCommand = options.tesseractCommand || process.env.SCHEMA_DOCS_TESSERACT || "tesseract";
  const rendererCommand = options.rendererCommand || process.env.SCHEMA_DOCS_PDFTOPPM || "pdftoppm";
  const pdfInfoCommand = options.pdfInfoCommand || process.env.SCHEMA_DOCS_PDFINFO || "pdfinfo";
  const userTessdata = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "SchemaDocs", "tessdata") : "";
  const tessdataDir = options.tessdataDir
    || process.env.SCHEMA_DOCS_TESSDATA
    || (userTessdata && existsSync(userTessdata) ? userTessdata : "");
  const [tesseract, renderer, pdfInfo] = await Promise.all([
    commandVersion(tesseractCommand, ["--version"]),
    commandVersion(rendererCommand, ["-h"]),
    commandVersion(pdfInfoCommand, ["-v"])
  ]);
  return {
    available: tesseract.available && renderer.available && pdfInfo.available,
    tesseract: { ...tesseract, command: tesseractCommand, tessdataDir },
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
    return new Set(String(stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function chooseLanguages(requested, installed) {
  const wanted = String(requested || process.env.SCHEMA_DOCS_OCR_LANGUAGES || "chi_sim+eng")
    .split("+")
    .map((item) => item.trim())
    .filter(Boolean);
  const selected = installed.size ? wanted.filter((item) => installed.has(item)) : wanted;
  if (!selected.length && installed.has("eng")) selected.push("eng");
  if (!selected.length) throw new Error("Tesseract has no requested OCR language data installed.");
  return selected.join("+");
}

export async function extractPdfWithOcr(sourcePath, options = {}) {
  const detection = options.detection || await detectPdfOcrAdapter(options);
  if (!detection.available) {
    const error = new Error("PDF OCR requires Tesseract, pdftoppm, and pdfinfo.");
    error.code = "PDF_OCR_ADAPTER_UNAVAILABLE";
    throw error;
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
  try {
    for (let page = startPage; page <= endPage; page += 1) {
      const prefix = path.join(tempRoot, `page-${page}`);
      const imagePath = `${prefix}.png`;
      try {
        await execFileAsync(detection.renderer.command, [
          "-f", String(page), "-l", String(page), "-singlefile", "-r", String(dpi), "-png", sourcePath, prefix
        ], { timeout: options.pageTimeoutMs || 2 * 60 * 1000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
        const ocrArgs = [imagePath, "stdout"];
        if (tessdataDir) ocrArgs.push("--tessdata-dir", tessdataDir);
        ocrArgs.push("-l", languages, "--psm", String(options.pageSegmentationMode || 3));
        const { stdout } = await execFileAsync(detection.tesseract.command, ocrArgs, {
          timeout: options.pageTimeoutMs || 2 * 60 * 1000,
          windowsHide: true,
          maxBuffer: 32 * 1024 * 1024
        });
        const text = String(stdout || "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").trim();
        extractedCharacters += text.length;
        markdown.push(`<!-- pdf-page: ${page}; extraction: ocr; languages: ${languages} -->`, "", text, "");
      } catch (error) {
        failedPages.push({ page, error: error.message });
        markdown.push(`<!-- pdf-page: ${page}; extraction: ocr_failed -->`, "", `> OCR failed for source page ${page}. Review the original PDF page.`, "");
      } finally {
        await rm(imagePath, { force: true }).catch(() => {});
      }
      if (options.onProgress) {
        options.onProgress({ page, startPage, endPage, totalPages, percent: Math.round(((page - startPage + 1) / (endPage - startPage + 1)) * 100) });
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
