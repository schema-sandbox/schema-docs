import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { KATEX_WOFF2_FONT_FILES } from "../src/core/katexRuntimeAssets.js";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, "..");

export const REQUIRED_RUNTIME_FILES = [
  "node.exe",
  "package.json",
  "src/cli/desktop-runtime-launcher.js",
  "src/core/katexRuntimeAssets.js",
  "public/index.html",
  "public/libs/markdown-it.min.js",
  "public/libs/docx.js",
  "public/libs/katex/katex.min.js",
  "public/libs/katex/katex.min.css",
  ...KATEX_WOFF2_FONT_FILES.map((fontName) => `public/libs/katex/fonts/${fontName}`)
];

export const POWERSHELL_ARCHIVE_ARGS = [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  [
    "$ErrorActionPreference = 'Stop'",
    "$root = $env:SCHEMA_DOCS_PORTABLE_SOURCE",
    "$items = @('app.exe', 'runtime', 'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md') | ForEach-Object { Join-Path $root $_ }",
    "Compress-Archive -LiteralPath $items -DestinationPath $env:SCHEMA_DOCS_PORTABLE_ARCHIVE -CompressionLevel Optimal -Force"
  ].join("; ")
];

function portablePath(filePath) {
  return filePath.split(path.sep).join("/");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function requireFile(filePath, label) {
  const stats = await lstat(filePath).catch(() => null);
  if (!stats?.isFile()) {
    throw new Error(`Missing required ${label}: ${filePath}`);
  }
}

async function requireDirectory(directoryPath, label) {
  const stats = await lstat(directoryPath).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new Error(`Missing required ${label}: ${directoryPath}`);
  }
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });
  return hash.digest("hex").toLowerCase();
}

async function copyVerified(sourcePath, targetPath) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
  const [sourceHash, targetHash] = await Promise.all([
    sha256File(sourcePath),
    sha256File(targetPath)
  ]);
  if (sourceHash !== targetHash) {
    throw new Error(`Hash mismatch after copying ${sourcePath}`);
  }
  return targetHash;
}

async function listRegularFiles(directoryPath, relativeBase = "") {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeBase, entry.name);
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listRegularFiles(absolutePath, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`Unsupported runtime entry (only regular files/directories are allowed): ${absolutePath}`);
    }
  }
  return files;
}

async function copyRuntimeVerified(sourcePath, targetPath) {
  const sourceFiles = await listRegularFiles(sourcePath);
  await cp(sourcePath, targetPath, { recursive: true, errorOnExist: true, force: false });
  const targetFiles = await listRegularFiles(targetPath);
  assertSameList(sourceFiles, targetFiles, "Runtime file list changed while copying");
  for (const relativePath of sourceFiles) {
    const [sourceHash, targetHash] = await Promise.all([
      sha256File(path.join(sourcePath, relativePath)),
      sha256File(path.join(targetPath, relativePath))
    ]);
    if (sourceHash !== targetHash) {
      throw new Error(`Runtime hash mismatch after copying ${relativePath}`);
    }
  }
  return sourceFiles;
}

function assertSameList(expected, actual, message) {
  if (expected.length !== actual.length || expected.some((item, index) => item !== actual[index])) {
    throw new Error(message);
  }
}

export async function compressPortableArchive({ sourceDir, archivePath }) {
  if (process.platform !== "win32") {
    throw new Error("Windows release preparation requires Windows PowerShell.");
  }
  await execFileAsync("powershell.exe", POWERSHELL_ARCHIVE_ARGS, {
    windowsHide: true,
    env: {
      ...process.env,
      SCHEMA_DOCS_PORTABLE_SOURCE: sourceDir,
      SCHEMA_DOCS_PORTABLE_ARCHIVE: archivePath
    }
  });
}

async function publishAtomically(outputDir, stagedFiles) {
  await mkdir(outputDir, { recursive: true });
  const transactionDir = path.join(outputDir, `.prepare-windows-release-${randomUUID()}`);
  const incomingDir = path.join(transactionDir, "incoming");
  const backupDir = path.join(transactionDir, "backup");
  await mkdir(incomingDir, { recursive: true });
  await mkdir(backupDir, { recursive: true });
  const records = [];
  try {
    for (const item of stagedFiles) {
      const incomingPath = path.join(incomingDir, item.name);
      const hash = await copyVerified(item.path, incomingPath);
      if (hash !== item.sha256) {
        throw new Error(`Staged output hash changed for ${item.name}`);
      }
      records.push({
        ...item,
        targetPath: path.join(outputDir, item.name),
        incomingPath,
        backupPath: path.join(backupDir, item.name),
        hadOriginal: false,
        installed: false
      });
    }
    try {
      for (const record of records) {
        const targetStats = await lstat(record.targetPath).catch(() => null);
        if (targetStats) {
          await rename(record.targetPath, record.backupPath);
          record.hadOriginal = true;
        }
      }
      for (const record of records) {
        await rename(record.incomingPath, record.targetPath);
        record.installed = true;
      }
      for (const record of records) {
        if (await sha256File(record.targetPath) !== record.sha256) {
          throw new Error(`Published output hash mismatch for ${record.name}`);
        }
      }
    } catch (error) {
      for (const record of [...records].reverse()) {
        if (record.installed || record.hadOriginal) {
          await rm(record.targetPath, { recursive: true, force: true });
        }
        if (record.hadOriginal) {
          await rename(record.backupPath, record.targetPath);
        }
      }
      throw error;
    }
  } finally {
    await rm(transactionDir, { recursive: true, force: true });
  }
}

export async function prepareWindowsRelease({
  root = projectRoot,
  tempRoot = os.tmpdir(),
  compressArchive = compressPortableArchive
} = {}) {
  const packageJson = await readJson(path.join(root, "package.json"));
  const tauriConfig = await readJson(path.join(root, "src-tauri", "tauri.conf.json"));
  if (!packageJson.version || packageJson.version !== tauriConfig.version) {
    throw new Error(`Version mismatch: package.json=${packageJson.version ?? "missing"}, tauri.conf.json=${tauriConfig.version ?? "missing"}`);
  }
  if (!tauriConfig.productName) {
    throw new Error("src-tauri/tauri.conf.json is missing productName.");
  }

  const version = packageJson.version;
  const productName = tauriConfig.productName;
  const releaseDir = path.join(root, "src-tauri", "target", "release");
  const runtimeSource = path.join(releaseDir, "runtime");
  const names = {
    msi: `${productName}_${version}_x64_en-US.msi`,
    nsis: `${productName}_${version}_x64-setup.exe`,
    portable: `${productName}_${version}_x64-portable.zip`,
    checksums: "SHA256SUMS.txt"
  };
  const sources = {
    app: path.join(releaseDir, "app.exe"),
    runtime: runtimeSource,
    msi: path.join(releaseDir, "bundle", "msi", names.msi),
    nsis: path.join(releaseDir, "bundle", "nsis", names.nsis),
    docs: ["LICENSE", "README.md", "THIRD_PARTY_NOTICES.md"].map((name) => ({
      name,
      path: path.join(root, name)
    }))
  };

  await requireFile(sources.app, "desktop executable");
  await requireDirectory(sources.runtime, "desktop runtime directory");
  for (const relativePath of REQUIRED_RUNTIME_FILES) {
    await requireFile(path.join(runtimeSource, ...relativePath.split("/")), `runtime file ${relativePath}`);
  }
  await requireFile(sources.msi, "MSI installer");
  await requireFile(sources.nsis, "NSIS installer");
  for (const doc of sources.docs) {
    await requireFile(doc.path, doc.name);
  }

  await mkdir(tempRoot, { recursive: true });
  let workDir;
  try {
    workDir = await mkdtemp(path.join(tempRoot, "schema-docs-windows-release-"));
    const portableDir = path.join(workDir, "portable");
    const assetsDir = path.join(workDir, "assets");
    await mkdir(portableDir, { recursive: true });
    await mkdir(assetsDir, { recursive: true });

    await copyVerified(sources.app, path.join(portableDir, "app.exe"));
    const runtimeFiles = await copyRuntimeVerified(sources.runtime, path.join(portableDir, "runtime"));
    for (const doc of sources.docs) {
      await copyVerified(doc.path, path.join(portableDir, doc.name));
    }

    const stagedMsi = path.join(assetsDir, names.msi);
    const stagedNsis = path.join(assetsDir, names.nsis);
    const stagedPortable = path.join(assetsDir, names.portable);
    const msiHash = await copyVerified(sources.msi, stagedMsi);
    const nsisHash = await copyVerified(sources.nsis, stagedNsis);
    await compressArchive({ sourceDir: portableDir, archivePath: stagedPortable });
    await requireFile(stagedPortable, "portable ZIP output");
    const portableHash = await sha256File(stagedPortable);

    const artifactSpecs = [
      { name: names.msi, path: stagedMsi, sha256: msiHash },
      { name: names.nsis, path: stagedNsis, sha256: nsisHash },
      { name: names.portable, path: stagedPortable, sha256: portableHash }
    ];
    const checksumText = `${artifactSpecs.map((item) => `${item.sha256}  ${item.name}`).join("\n")}\n`;
    const stagedChecksums = path.join(assetsDir, names.checksums);
    await writeFile(stagedChecksums, checksumText, "utf8");
    const checksumsHash = await sha256File(stagedChecksums);
    const outputDir = path.join(root, "release", "windows");
    await publishAtomically(outputDir, [
      ...artifactSpecs,
      { name: names.checksums, path: stagedChecksums, sha256: checksumsHash }
    ]);

    return {
      ok: true,
      version,
      releaseTarget: `v${version}`,
      productName,
      generatedBy: "npm run release:windows:prepare",
      outputDirectory: portablePath(path.relative(root, outputDir)),
      portable: {
        runtimeFileCount: runtimeFiles.length,
        requiredRuntimeFiles: [...REQUIRED_RUNTIME_FILES],
        topLevelEntries: ["app.exe", "runtime", "LICENSE", "README.md", "THIRD_PARTY_NOTICES.md"]
      },
      artifacts: await Promise.all(artifactSpecs.map(async (item) => {
        const outputPath = path.join(outputDir, item.name);
        return {
          path: portablePath(path.relative(root, outputPath)),
          bytes: (await lstat(outputPath)).size,
          sha256: item.sha256
        };
      })),
      checksums: portablePath(path.relative(root, path.join(outputDir, names.checksums)))
    };
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await prepareWindowsRelease(), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  }
}
