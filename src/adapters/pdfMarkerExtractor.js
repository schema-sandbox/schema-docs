import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

export async function detectPdfMarkerExtractor(options = {}) {
  const command = options.markerCommand || process.env.SCHEMA_DOCS_MARKER || "marker_single";
  try {
    const { stdout, stderr } = await execFileAsync(command, ["--help"], {
      timeout: 15000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024
    });
    return { available: true, command, version: String(stdout || stderr || "present").split(/\r?\n/)[0] };
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== 127) return { available: true, command, version: "present" };
    return { available: false, command, version: null };
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
  const ownsOutputDir = !options.outputDir;
  const outputDir = options.outputDir || await mkdtemp(path.join(os.tmpdir(), "schema-docs-marker-"));
  await mkdir(outputDir, { recursive: true });
  const args = [sourcePath, "--output_dir", outputDir, "--output_format", "markdown", "--paginate_output"];
  if (options.forceOcr) args.push("--force_ocr");
  if (options.pageRange) args.push("--page_range", String(options.pageRange));
  try {
    const { stdout, stderr } = await execFileAsync(detection.command, args, {
      timeout: options.timeoutMs || 12 * 60 * 60 * 1000,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" }
    });
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
    if (ownsOutputDir) await rm(outputDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
