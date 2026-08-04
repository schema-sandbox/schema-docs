import { copyFile, cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");

export function isPythonCacheArtifact(relativePath) {
  const normalized = String(relativePath || "").split(path.sep).join("/");
  return normalized.split("/").includes("__pycache__") || /\.py[co]$/i.test(normalized);
}

async function findPythonCacheArtifacts(directoryPath, relativeBase = "") {
  const entries = await readdir(directoryPath, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const artifacts = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeBase, entry.name);
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__pycache__") {
        artifacts.push(relativePath);
      } else {
        artifacts.push(...await findPythonCacheArtifacts(absolutePath, relativePath));
      }
    } else if (entry.isFile() && isPythonCacheArtifact(relativePath)) {
      artifacts.push(relativePath);
    }
  }
  return artifacts.sort();
}

export async function cleanPythonCacheArtifacts(directoryPath) {
  const artifacts = await findPythonCacheArtifacts(directoryPath);
  for (const relativePath of artifacts) {
    await rm(path.join(directoryPath, relativePath), { recursive: true, force: true });
  }
  const remaining = await findPythonCacheArtifacts(directoryPath);
  if (remaining.length) {
    throw new Error(`Python cache cleanup failed: ${remaining.join(", ")}`);
  }
  return artifacts.map((relativePath) => relativePath.split(path.sep).join("/"));
}

async function fileDigest(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });
  return hash.digest("hex");
}

async function sameFileContent(sourcePath, targetPath) {
  try {
    const [sourceStat, targetStat] = await Promise.all([stat(sourcePath), stat(targetPath)]);
    if (sourceStat.size !== targetStat.size) {
      return false;
    }
    const [sourceHash, targetHash] = await Promise.all([fileDigest(sourcePath), fileDigest(targetPath)]);
    return sourceHash === targetHash;
  } catch {
    return false;
  }
}

export async function prepareReleaseRuntime({ rootDir = root, nodeExecutable = process.execPath } = {}) {
  const tauriResourcesDir = path.join(rootDir, "src-tauri", "resources");
  const targetNodePath = path.join(tauriResourcesDir, "node.exe");
  const staleRuntimeDir = path.join(rootDir, "src-tauri", "target", "release", "runtime");
  await rm(staleRuntimeDir, { recursive: true, force: true });
  const removedPythonCaches = await cleanPythonCacheArtifacts(path.join(rootDir, "src"));
  await mkdir(tauriResourcesDir, { recursive: true });
  if (!(await sameFileContent(nodeExecutable, targetNodePath))) {
    await copyFile(nodeExecutable, targetNodePath);
  }
  return { targetNodePath, staleRuntimeDir, removedPythonCaches };
}

export async function stageReleaseRuntime({ rootDir = root } = {}) {
  const runtimeDir = path.join(rootDir, "src-tauri", "target", "release", "runtime");
  await rm(runtimeDir, { recursive: true, force: true });
  await mkdir(runtimeDir, { recursive: true });
  await Promise.all([
    cp(path.join(rootDir, "src"), path.join(runtimeDir, "src"), { recursive: true }),
    cp(path.join(rootDir, "public"), path.join(runtimeDir, "public"), { recursive: true }),
    copyFile(path.join(rootDir, "package.json"), path.join(runtimeDir, "package.json")),
    copyFile(path.join(rootDir, "src-tauri", "resources", "node.exe"), path.join(runtimeDir, "node.exe"))
  ]);
  return { runtimeDir };
}

async function main() {
  try {
    if (process.argv.includes("--stage-runtime")) {
      const result = await stageReleaseRuntime();
      console.log(`Staged packaged runtime: ${result.runtimeDir}`);
      return;
    }
    console.log(`Locating node executable: ${process.execPath}`);
    const result = await prepareReleaseRuntime();
    console.log(`Prepared packaged Node executable: ${result.targetNodePath}`);
    console.log(`Removed ${result.removedPythonCaches.length} Python cache artifact(s).`);
    console.log("Zero-dependency runtime prepared successfully.");
  } catch (error) {
    console.error("Failed to prepare standalone runtime:", error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
