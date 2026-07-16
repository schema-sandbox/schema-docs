import { copyFile, mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const tauriResourcesDir = path.join(root, "src-tauri", "resources");
const targetNodePath = path.join(tauriResourcesDir, "node.exe");

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

async function main() {
  try {
    await mkdir(tauriResourcesDir, { recursive: true });
    const currentExecPath = process.execPath;
    console.log(`Locating node executable: ${currentExecPath}`);
    console.log(`Copying to target path: ${targetNodePath}`);
    if (await sameFileContent(currentExecPath, targetNodePath)) {
      console.log("Packaged Node executable is already current; skipping copy.");
      return;
    }
    await copyFile(currentExecPath, targetNodePath);
    console.log("Zero-dependency Node executable prepared successfully.");
  } catch (error) {
    console.error("Failed to prepare standalone node binary:", error);
    process.exit(1);
  }
}

main();
