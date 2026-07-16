import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

export async function detectPdfPageRenderer(command = process.env.SCHEMA_DOCS_PDFTOPPM || "pdftoppm") {
  try {
    const { stdout, stderr } = await execFileAsync(command, ["-h"], { timeout: 5000, windowsHide: true });
    return { available: true, command, version: (stdout || stderr || "present").split(/\r?\n/)[0] };
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== 127) return { available: true, command, version: "present" };
    return { available: false, command, version: null };
  }
}

export async function renderPdfVisualRegion({ sourcePath, visualMapPath, pageNumber, regionIndex, outputPath, dpi = 180, command, detection: suppliedDetection }) {
  const detection = suppliedDetection || await detectPdfPageRenderer(command);
  if (!detection.available) {
    const error = new Error("pdftoppm is required to render PDF visual regions.");
    error.code = "PDF_PAGE_RENDERER_UNAVAILABLE";
    throw error;
  }
  const visualMap = JSON.parse(await readFile(visualMapPath, "utf8"));
  const page = (visualMap.pages || []).find((entry) => Number(entry.page) === Number(pageNumber));
  if (!page) throw new Error(`Page ${pageNumber} is not present in the PDF visual map.`);
  const region = regionIndex === undefined || regionIndex === null
    ? null
    : (page.regions || [])[Number(regionIndex)];
  if (regionIndex !== undefined && regionIndex !== null && !region) {
    throw new Error(`Region ${regionIndex} is not present on page ${pageNumber}.`);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  const outputPrefix = outputPath.replace(/\.png$/i, "") + ".rendering";
  const generatedPath = `${outputPrefix}.png`;
  const args = ["-f", String(pageNumber), "-l", String(pageNumber), "-singlefile", "-r", String(dpi), "-png"];
  if (region?.bbox && page.width && page.height) {
    const scale = Number(dpi) / 72;
    const [x0, top, x1, bottom] = region.bbox.map(Number);
    const padding = 8;
    args.push(
      "-x", String(Math.max(0, Math.floor(x0 * scale) - padding)),
      "-y", String(Math.max(0, Math.floor(top * scale) - padding)),
      "-W", String(Math.max(1, Math.ceil((x1 - x0) * scale) + padding * 2)),
      "-H", String(Math.max(1, Math.ceil((bottom - top) * scale) + padding * 2))
    );
  }
  args.push(sourcePath, outputPrefix);
  try {
    await execFileAsync(detection.command, args, { timeout: 2 * 60 * 1000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    await rename(generatedPath, outputPath);
  } catch (error) {
    await rm(generatedPath, { force: true }).catch(() => {});
    throw error;
  }
  return {
    outputPath,
    page: Number(pageNumber),
    regionIndex: region ? Number(regionIndex) : null,
    regionType: region?.type || "page",
    bbox: region?.bbox || null,
    dpi: Number(dpi),
    confidence: region?.confidence || null
  };
}

export async function materializePdfVisualAssets({
  sourcePath,
  visualMapPath,
  outputDir,
  dpi = 220,
  mode = "fallback",
  types = ["formula", "table", "image"],
  command,
  onProgress
}) {
  const detection = await detectPdfPageRenderer(command);
  if (!detection.available) {
    const error = new Error("pdftoppm is required to preserve PDF visual regions.");
    error.code = "PDF_PAGE_RENDERER_UNAVAILABLE";
    throw error;
  }
  const visualMap = JSON.parse(await readFile(visualMapPath, "utf8"));
  const allowedTypes = new Set(types);
  const selected = [];
  for (const page of visualMap.pages || []) {
    for (let regionIndex = 0; regionIndex < (page.regions || []).length; regionIndex += 1) {
      const region = page.regions[regionIndex];
      const shouldRender = allowedTypes.has(region.type)
        && (mode === "all" || region.needsVisualFallback || region.confidence === "low");
      if (shouldRender) selected.push({ page, region, regionIndex });
    }
  }
  await mkdir(outputDir, { recursive: true });
  const rendered = [];
  const failed = [];
  for (let index = 0; index < selected.length; index += 1) {
    const item = selected[index];
    const fileName = `page-${String(item.page.page).padStart(6, "0")}-${item.region.type}-${String(item.regionIndex).padStart(3, "0")}.png`;
    const outputPath = path.join(outputDir, fileName);
    try {
      const asset = await renderPdfVisualRegion({
        sourcePath,
        visualMapPath,
        pageNumber: item.page.page,
        regionIndex: item.regionIndex,
        outputPath,
        dpi,
        detection
      });
      item.region.assetFile = fileName;
      item.region.assetStatus = "rendered";
      rendered.push(asset);
    } catch (error) {
      item.region.assetStatus = "failed";
      item.region.assetError = error.message;
      failed.push({ page: item.page.page, regionIndex: item.regionIndex, type: item.region.type, error: error.message });
    }
    if (onProgress) onProgress({
      current: index + 1,
      total: selected.length,
      page: item.page.page,
      percent: selected.length ? Math.round(((index + 1) / selected.length) * 100) : 100
    });
  }
  visualMap.assets = {
    mode,
    dpi: Number(dpi),
    requested: selected.length,
    rendered: rendered.length,
    failed: failed.length,
    updatedAt: new Date().toISOString()
  };
  await writeFile(visualMapPath, JSON.stringify(visualMap, null, 2), "utf8");
  const indexLines = [
    "# Preserved PDF visual content",
    "",
    `- Source: ${path.basename(sourcePath)}`,
    `- Render mode: ${mode}`,
    `- Regions requested: ${selected.length}`,
    `- Regions rendered: ${rendered.length}`,
    `- Regions failed: ${failed.length}`,
    ""
  ];
  for (const page of visualMap.pages || []) {
    const assets = (page.regions || []).filter((region) => region.assetStatus);
    if (!assets.length) continue;
    indexLines.push(`## Source page ${page.page}`, "");
    for (const region of assets) {
      if (region.assetStatus === "rendered") {
        indexLines.push(`### ${region.type}`, "", `![PDF page ${page.page} ${region.type}](${region.assetFile})`, "");
      } else {
        indexLines.push(`- ${region.type}: rendering failed; inspect source page ${page.page}.`);
      }
    }
  }
  const indexPath = path.join(outputDir, "visual-content.md");
  await writeFile(indexPath, indexLines.join("\n").trimEnd() + "\n", "utf8");
  return {
    outputDir,
    indexPath,
    requested: selected.length,
    rendered: rendered.length,
    failed,
    mode,
    dpi: Number(dpi)
  };
}
