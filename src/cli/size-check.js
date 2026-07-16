import { readdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_DIRS = ["src", "test", "docs"];
const RUNTIME_DIRS = ["src/core", "src/server", "src/adapters", "src/sdk", "public"];
const IGNORED_SOURCE_PATTERNS = [
  /^docs\/.*\u6d4b\u8bd5\u62a5\u544a.*\.md$/u,
  /^docs\/.*\u5ba2\u6237\u89c6\u89d2.*\.md$/u
];
const BUDGETS = {
  runtimeDependencies: 0,
  devDependencies: 1,
  runtimeBytes: 1_160_000,
  runtimeFiles: 100,
  sourceFiles: 195,
  totalBytes: 1_700_000,
  totalLines: 38_500,
  largestFileBytes: 100_000,
  runtimeLargestFileBytes: 125_000,
  publicModuleBytes: 100_000
};

async function walkFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "libs" || entry.name === "images" || entry.name === "icons" || entry.name === "resources" || entry.name === "node_modules" || entry.name === "target" || entry.name === "dist") {
        continue;
      }
      files.push(...await walkFiles(fullPath));
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if ([".png", ".jpg", ".jpeg", ".gif", ".ico", ".exe", ".pdf", ".zip", ".msi", ".woff", ".woff2"].includes(ext)) {
        continue;
      }
      files.push(fullPath);
    }
  }

  return files;
}

async function main() {
  const packageJson = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  const dependencies = Object.keys(packageJson.dependencies ?? {});
  const devDependencies = Object.keys(packageJson.devDependencies ?? {});
  const readStats = async (dirs) => {
    const files = (await Promise.all(dirs.map((dir) => walkFiles(path.join(ROOT, dir))))).flat();
    return Promise.all(files.map(async (file) => {
      const relative = path.relative(ROOT, file).replaceAll("\\", "/");
      if (IGNORED_SOURCE_PATTERNS.some((pattern) => pattern.test(relative))) return null;
      const fileStat = await stat(file);
      const content = await readFile(file, "utf8");
      return {
        file: relative,
        bytes: fileStat.size,
        lines: content.split("\n").length
      };
    })).then((items) => items.filter(Boolean));
  };
  const stats = await readStats(SOURCE_DIRS);
  const runtimeStats = await readStats(RUNTIME_DIRS);
  const summarizeStats = (items) => {
    const bytes = items.reduce((sum, item) => sum + item.bytes, 0);
    const lines = items.reduce((sum, item) => sum + item.lines, 0);
    const largestFiles = items
      .toSorted((left, right) => right.bytes - left.bytes)
      .slice(0, 10);
    return {
      fileCount: items.length,
      bytes,
      lines,
      largestFiles
    };
  };
  const repositorySummary = summarizeStats(stats);
  const runtimeSummary = summarizeStats(runtimeStats);
  const totalBytes = repositorySummary.bytes;
  const totalLines = repositorySummary.lines;
  const largestFiles = repositorySummary.largestFiles;
  const largestFileBytes = largestFiles[0]?.bytes ?? 0;
  const runtimeLargestFileBytes = runtimeSummary.largestFiles[0]?.bytes ?? 0;
  const publicModuleFiles = runtimeStats
    .filter((item) => /^public\/[^/]+\.js$/.test(item.file))
    .toSorted((left, right) => right.bytes - left.bytes);
  const publicModuleLargestFileBytes = publicModuleFiles[0]?.bytes ?? 0;
  const failures = [];
  const warnings = [];
  if (dependencies.length > BUDGETS.runtimeDependencies) {
    failures.push(`runtime dependencies ${dependencies.length} exceed budget ${BUDGETS.runtimeDependencies}`);
  }
  if (devDependencies.length > BUDGETS.devDependencies) {
    failures.push(`dev dependencies ${devDependencies.length} exceed budget ${BUDGETS.devDependencies}`);
  }
  if (runtimeSummary.fileCount > BUDGETS.runtimeFiles) {
    failures.push(`runtime files ${runtimeSummary.fileCount} exceed budget ${BUDGETS.runtimeFiles}`);
  }
  if (runtimeSummary.bytes > BUDGETS.runtimeBytes) {
    failures.push(`runtime bytes ${runtimeSummary.bytes} exceed budget ${BUDGETS.runtimeBytes}`);
  }
  if (stats.length > BUDGETS.sourceFiles) {
    failures.push(`source files ${stats.length} exceed budget ${BUDGETS.sourceFiles}`);
  }
  if (totalBytes > BUDGETS.totalBytes) {
    failures.push(`source bytes ${totalBytes} exceed budget ${BUDGETS.totalBytes}`);
  }
  if (totalLines > BUDGETS.totalLines) {
    failures.push(`source lines ${totalLines} exceed budget ${BUDGETS.totalLines}`);
  }
  if (largestFileBytes > BUDGETS.largestFileBytes) {
    failures.push(`largest source file ${largestFileBytes} bytes exceeds budget ${BUDGETS.largestFileBytes}`);
  }
  if (runtimeLargestFileBytes > BUDGETS.runtimeLargestFileBytes) {
    failures.push(`largest runtime file ${runtimeLargestFileBytes} bytes exceeds budget ${BUDGETS.runtimeLargestFileBytes}`);
  }
  if (publicModuleLargestFileBytes > BUDGETS.publicModuleBytes) {
    failures.push(`largest public browser module ${publicModuleLargestFileBytes} bytes exceeds budget ${BUDGETS.publicModuleBytes}`);
  }
  if (runtimeSummary.bytes > BUDGETS.runtimeBytes * 0.8) {
    warnings.push(`runtime bytes are above 80% of budget (${runtimeSummary.bytes}/${BUDGETS.runtimeBytes})`);
  }
  if (totalBytes > BUDGETS.totalBytes * 0.8) {
    warnings.push(`source bytes are above 80% of budget (${totalBytes}/${BUDGETS.totalBytes})`);
  }
  if (largestFileBytes > BUDGETS.largestFileBytes * 0.9) {
    warnings.push(`largest source file is above 90% of budget (${largestFileBytes}/${BUDGETS.largestFileBytes})`);
  }
  if (runtimeLargestFileBytes > BUDGETS.runtimeLargestFileBytes * 0.9) {
    warnings.push(`largest runtime file is above 90% of budget (${runtimeLargestFileBytes}/${BUDGETS.runtimeLargestFileBytes})`);
  }
  if (publicModuleLargestFileBytes > BUDGETS.publicModuleBytes * 0.9) {
    warnings.push(`largest public browser module is above 90% of budget (${publicModuleLargestFileBytes}/${BUDGETS.publicModuleBytes})`);
  }

  console.log(JSON.stringify({
    ok: failures.length === 0,
    budgets: BUDGETS,
    failures,
    warnings,
    dependencies,
    devDependencies,
    dependencyCount: dependencies.length,
    devDependencyCount: devDependencies.length,
    runtimeFileCount: runtimeSummary.fileCount,
    runtimeBytes: runtimeSummary.bytes,
    runtimeLines: runtimeSummary.lines,
    publicModuleLargestFileBytes,
    publicModuleLargestFiles: publicModuleFiles.slice(0, 10),
    sourceFileCount: stats.length,
    totalBytes,
    totalLines,
    runtimeLargestFiles: runtimeSummary.largestFiles,
    largestFiles
  }, null, 2));
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
