import path from "node:path";
import { copyFile, mkdir, stat, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createId, nowIso } from "./ids.js";
import { readManifest, writeManifest } from "./manifest.js";
import { AppError } from "./errors.js";
import { appendTimelineEvent } from "./timeline.js";
export function computeBufferHash(buffer) {
return createHash("sha256").update(buffer).digest("hex");
}
export async function computeFileHash(filePath) {
try {
const buffer = await readFile(filePath);
return computeBufferHash(buffer);
} catch {
return "";
}
}
const DOCUMENT_EXTENSIONS = new Set([".pdf", ".docx", ".pptx", ".md", ".txt"]);
const DATASET_EXTENSIONS = new Set([".xlsx", ".csv"]);
const LEGACY_OFFICE_EXTENSIONS = new Set([".doc", ".xls", ".ppt", ".odt", ".ods", ".odp", ".wps"]);
function legacyOfficeAdapterDetails(extension) {
return {
extension,
adapterRequired: "soffice",
adapterName: "LibreOffice (soffice)",
mode: "optional-system-adapter",
reason: "Legacy Office formats must be converted to DOCX/XLSX/PDF by an optional local system adapter before the zero-dependency core can parse them.",
userAction: "Install LibreOffice or export the file to .docx, .xlsx, .pdf, or .md before importing."
};
}
export function classifySource(sourcePath) {
const extension = path.extname(sourcePath).toLowerCase();
if (DOCUMENT_EXTENSIONS.has(extension)) {
return {
kind: "document",
sourceType: extension.slice(1)
};
}
if (DATASET_EXTENSIONS.has(extension)) {
return {
kind: "dataset",
sourceType: extension.slice(1)
};
}
if (LEGACY_OFFICE_EXTENSIONS.has(extension)) {
throw new AppError("optional_adapter_required", `Optional adapter required for ${extension}: LibreOffice (soffice).`, legacyOfficeAdapterDetails(extension));
}
throw new AppError("unsupported_file_type", `Unsupported file type: ${extension}`, {
extension
});
}
export function safeFileName(fileName) {
return fileName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim() || "untitled";
}
async function scanDirectoryRecursively(dirPath) {
  const results = [];
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await scanDirectoryRecursively(fullPath)));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (DOCUMENT_EXTENSIONS.has(ext) || DATASET_EXTENSIONS.has(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}
async function importSingleFile(workspacePath, sourcePath, manifest) {
  const classification = classifySource(sourcePath);
  const importedAt = nowIso();
  const originalName = path.basename(sourcePath);
  const fileStat = await stat(sourcePath);
  const hash = await computeFileHash(sourcePath);
  const resolvedOriginalPath = path.resolve(sourcePath);
  const records = classification.kind === "document" ? manifest.documents : manifest.datasets;
  const existing = records.find((record) => (
    path.resolve(record.originalSourcePath || record.sourcePath) === resolvedOriginalPath
    && (record.sourceHash || record.hash) === hash
  ));
  if (existing) {
    let importedCopyExists = true;
    try {
      await stat(existing.sourcePath);
    } catch {
      importedCopyExists = false;
    }
    if (!importedCopyExists) {
      await mkdir(path.dirname(existing.sourcePath), { recursive: true });
      await copyFile(sourcePath, existing.sourcePath);
      existing.importedCopyPath = existing.sourcePath;
      existing.mtime = fileStat.mtime.toISOString();
      existing.sourceMtime = fileStat.mtime.toISOString();
      existing.sourceSize = fileStat.size;
      existing.hash = hash;
      existing.sourceHash = hash;
      existing.status = "imported";
      existing.updatedAt = importedAt;
      return { ...existing, reusedImport: true, restoredImportedCopy: true };
    }
    return { ...existing, reusedImport: true };
  }
  const copiedName = `${Date.now()}-${safeFileName(originalName)}`;
  const copiedPath = path.join(workspacePath, "imports", copiedName);
  await mkdir(path.dirname(copiedPath), { recursive: true });
  await copyFile(sourcePath, copiedPath);
  if (classification.kind === "document") {
    const record = {
      id: createId("doc"),
      sourcePath: copiedPath,
      importedCopyPath: copiedPath,
      sourceType: classification.sourceType,
      title: path.parse(originalName).name,
      status: "imported",
      createdAt: importedAt,
      updatedAt: importedAt,
      originalSourcePath: resolvedOriginalPath,
      mtime: fileStat.mtime.toISOString(),
      sourceMtime: fileStat.mtime.toISOString(),
      sourceSize: fileStat.size,
      hash,
      sourceHash: hash,
      lastExtractedAt: null
    };
    manifest.documents.push(record);
    return record;
  }
  const record = {
    id: createId("dataset"),
    sourcePath: copiedPath,
    importedCopyPath: copiedPath,
    sourceType: classification.sourceType,
    name: path.parse(originalName).name,
    sheets: [],
    localTableNames: [],
    status: "imported",
    createdAt: importedAt,
    updatedAt: importedAt,
    originalSourcePath: resolvedOriginalPath,
    mtime: fileStat.mtime.toISOString(),
    sourceMtime: fileStat.mtime.toISOString(),
    sourceSize: fileStat.size,
    hash,
    sourceHash: hash,
    lastExtractedAt: null
  };
  manifest.datasets.push(record);
  return record;
}
export async function importFileToWorkspace(workspacePath, sourcePath) {
  const s = await stat(sourcePath);
  if (s.isDirectory()) {
    const filePaths = await scanDirectoryRecursively(sourcePath);
    const records = [];
    const manifest = await readManifest(workspacePath);
    for (const filePath of filePaths) {
      try {
        const record = await importSingleFile(workspacePath, filePath, manifest);
        records.push(record);
      } catch {
      }
    }
    await writeManifest(workspacePath, manifest);
    for (const record of records) {
      await appendTimelineEvent(workspacePath, record.id, "import", `Imported directory file "${record.title || record.name}"`);
    }
    return records;
  }
  const manifest = await readManifest(workspacePath);
  const record = await importSingleFile(workspacePath, sourcePath, manifest);
  await writeManifest(workspacePath, manifest);
  await appendTimelineEvent(workspacePath, record.id, "import", `Imported file "${record.title || record.name}"`);
  return record;
}
export async function importFileBufferToWorkspace(workspacePath, buffer, originalName) {
  const classification = classifySource(originalName);
  const importedAt = nowIso();
  const copiedName = `${Date.now()}-${safeFileName(originalName)}`;
  const copiedPath = path.join(workspacePath, "imports", copiedName);
  await mkdir(path.dirname(copiedPath), { recursive: true });
  await writeFile(copiedPath, buffer);
  const hash = computeBufferHash(buffer);
  const manifest = await readManifest(workspacePath);
  if (classification.kind === "document") {
    const record = {
      id: createId("doc"),
      sourcePath: copiedPath,
      importedCopyPath: copiedPath,
      sourceType: classification.sourceType,
      title: path.parse(originalName).name,
      status: "imported",
      createdAt: importedAt,
      updatedAt: importedAt,
      originalSourcePath: null,
      mtime: importedAt,
      sourceMtime: importedAt,
      sourceSize: buffer.byteLength,
      hash,
      sourceHash: hash,
      lastExtractedAt: null
    };
    manifest.documents.push(record);
    await writeManifest(workspacePath, manifest);
    await appendTimelineEvent(workspacePath, record.id, "import", `Imported file buffer "${record.title}"`);
    return record;
  }
  const record = {
    id: createId("dataset"),
    sourcePath: copiedPath,
    importedCopyPath: copiedPath,
    sourceType: classification.sourceType,
    name: path.parse(originalName).name,
    sheets: [],
    localTableNames: [],
    status: "imported",
    createdAt: importedAt,
    updatedAt: importedAt,
    originalSourcePath: null,
    mtime: importedAt,
    sourceMtime: importedAt,
    sourceSize: buffer.byteLength,
    hash,
    sourceHash: hash,
    lastExtractedAt: null
  };
  manifest.datasets.push(record);
  await writeManifest(workspacePath, manifest);
  await appendTimelineEvent(workspacePath, record.id, "import", `Imported dataset buffer "${record.name}"`);
  return record;
}
export async function checkWorkspaceUpdates(workspacePath) {
  const manifest = await readManifest(workspacePath);
  const updates = [];
  for (const doc of manifest.documents) {
    if (doc.originalSourcePath) {
      try {
        const fileStat = await stat(doc.originalSourcePath);
        const currentMtime = fileStat.mtime.toISOString();
        const recordedMtime = doc.mtime || doc.createdAt;
        if (currentMtime !== recordedMtime) {
          const currentHash = await computeFileHash(doc.originalSourcePath);
          if (currentHash !== doc.hash) {
            updates.push({
              id: doc.id,
              kind: "document",
              title: doc.title,
              originalSourcePath: doc.originalSourcePath,
              changed: true,
              reason: "File updated externally"
            });
          }
        }
      } catch (err) {
        updates.push({
          id: doc.id,
          kind: "document",
          title: doc.title,
          originalSourcePath: doc.originalSourcePath,
          changed: false,
          missing: true,
          reason: "External file missing or inaccessible"
        });
      }
    }
  }
  for (const ds of manifest.datasets) {
    if (ds.originalSourcePath) {
      try {
        const fileStat = await stat(ds.originalSourcePath);
        const currentMtime = fileStat.mtime.toISOString();
        const recordedMtime = ds.mtime || ds.createdAt;
        if (currentMtime !== recordedMtime) {
          const currentHash = await computeFileHash(ds.originalSourcePath);
          if (currentHash !== ds.hash) {
            updates.push({
              id: ds.id,
              kind: "dataset",
              name: ds.name,
              originalSourcePath: ds.originalSourcePath,
              changed: true,
              reason: "File updated externally"
            });
          }
        }
      } catch (err) {
        updates.push({
          id: ds.id,
          kind: "dataset",
          name: ds.name,
          originalSourcePath: ds.originalSourcePath,
          changed: false,
          missing: true,
          reason: "External file missing or inaccessible"
        });
      }
    }
  }
  return updates;
}
export async function refreshWorkspaceRecord(workspacePath, recordId) {
  const manifest = await readManifest(workspacePath);
  const docIndex = manifest.documents.findIndex(d => d.id === recordId);
  if (docIndex >= 0) {
    const doc = manifest.documents[docIndex];
    if (!doc.originalSourcePath) throw new AppError("refresh_failed", "No original source pat...");
    let fileStat;
    try {
      fileStat = await stat(doc.originalSourcePath);
    } catch (err) {
      throw new AppError("refresh_failed", `Cannot access the external source file ${doc.originalSourcePath}; refresh was cancelled.`, {
        originalPath: doc.originalSourcePath,
        error: err.message
      });
    }
    const hash = await computeFileHash(doc.originalSourcePath);
    await copyFile(doc.originalSourcePath, doc.sourcePath);
    doc.mtime = fileStat.mtime.toISOString();
    doc.sourceMtime = fileStat.mtime.toISOString();
    doc.hash = hash;
    doc.sourceHash = hash;
    doc.sourceSize = fileStat.size;
    doc.updatedAt = nowIso();
    doc.lastRefreshedAt = nowIso();
    doc.status = "imported";
    await writeManifest(workspacePath, manifest);
    await appendTimelineEvent(workspacePath, doc.id, "refresh", `Refreshed document "${doc.title}" from source`);
    return { kind: "document", record: doc };
  }
  const dsIndex = manifest.datasets.findIndex(d => d.id === recordId);
  if (dsIndex >= 0) {
    const ds = manifest.datasets[dsIndex];
    if (!ds.originalSourcePath) throw new AppError("refresh_failed", "No original source pat...");
    let fileStat;
    try {
      fileStat = await stat(ds.originalSourcePath);
    } catch (err) {
      throw new AppError("refresh_failed", `Cannot access the external source file ${ds.originalSourcePath}; refresh was cancelled.`, {
        originalPath: ds.originalSourcePath,
        error: err.message
      });
    }
    const hash = await computeFileHash(ds.originalSourcePath);
    await copyFile(ds.originalSourcePath, ds.sourcePath);
    ds.mtime = fileStat.mtime.toISOString();
    ds.sourceMtime = fileStat.mtime.toISOString();
    ds.hash = hash;
    ds.sourceHash = hash;
    ds.sourceSize = fileStat.size;
    ds.updatedAt = nowIso();
    ds.lastRefreshedAt = nowIso();
    ds.status = "imported";
    ds.sheets = [];
    await writeManifest(workspacePath, manifest);
    await appendTimelineEvent(workspacePath, ds.id, "refresh", `Refreshed dataset "${ds.name}" from source`);
    return { kind: "dataset", record: ds };
  }
  throw new AppError("record_not_found", `Record not found: ${recordId}`);
}
export async function getRecordStatuses(workspacePath) {
  const manifest = await readManifest(workspacePath);
  const statuses = [];
  for (const doc of manifest.documents) {
    const status = await getSingleRecordStatus(workspacePath, doc, "document");
    statuses.push(status);
  }
  for (const ds of manifest.datasets) {
    const status = await getSingleRecordStatus(workspacePath, ds, "dataset");
    statuses.push(status);
  }
  return statuses;
}
export async function getSingleRecordStatus(workspacePath, record, kind) {
  const originalSourcePath = record.originalSourcePath;
  let sourceAvailable = false;
  let sourceChanged = false;
  if (originalSourcePath) {
    try {
      await stat(originalSourcePath);
      sourceAvailable = true;
      const currentHash = await computeFileHash(originalSourcePath);
      const recordedHash = record.sourceHash || record.hash;
      if (currentHash !== recordedHash) {
        sourceChanged = true;
      }
    } catch {
      sourceAvailable = false;
    }
  }
  const importedCopyPath = record.importedCopyPath || record.sourcePath;
  let importedCopyAvailable = false;
  if (importedCopyPath) {
    try {
      await stat(importedCopyPath);
      importedCopyAvailable = true;
    } catch {
      importedCopyAvailable = false;
    }
  }
  let userEditedMarkdownAfterExtract = false;
  if (kind === "document" && record.outputMarkdownPath) {
    try {
      const currentContent = await readFile(record.outputMarkdownPath, "utf8");
      const currentHash = computeBufferHash(Buffer.from(currentContent, "utf8"));
      if (record.lastExtractedHash && currentHash !== record.lastExtractedHash) {
        userEditedMarkdownAfterExtract = true;
      }
    } catch {
    }
  }
  return {
    id: record.id,
    kind,
    title: record.title || record.name || "",
    sourcePath: record.originalSourcePath || null,
    importedCopyPath: record.importedCopyPath || record.sourcePath || null,
    sourceAvailable,
    sourceChanged,
    importedCopyAvailable,
    lastExtractedAt: record.lastExtractedAt || null,
    lastRefreshedAt: record.lastRefreshedAt || null,
    refreshRecommended: sourceChanged,
    userEditedMarkdownAfterExtract
  };
}
export async function previewRecordRefresh(workspacePath, recordId) {
  const manifest = await readManifest(workspacePath);
  const doc = manifest.documents.find(d => d.id === recordId) || manifest.datasets.find(d => d.id === recordId);
  if (!doc) throw new AppError("record_not_found", `Record not found: ${recordId}`);
  if (!doc.originalSourcePath) throw new AppError("refresh_failed", "No original source pat...");
  let sourceAvailable = false;
  let fileStat;
  try {
    fileStat = await stat(doc.originalSourcePath);
    sourceAvailable = true;
  } catch {
    sourceAvailable = false;
  }
  if (!sourceAvailable) throw new AppError("refresh_failed", `Cannot access the external source file ${doc.originalSourcePath}.`);
  const currentHash = await computeFileHash(doc.originalSourcePath);
  const recordedHash = doc.sourceHash || doc.hash;
  const sourceChanged = currentHash !== recordedHash;
  let userEditedMarkdownAfterExtract = false;
  if (doc.outputMarkdownPath) {
    try {
      const currentContent = await readFile(doc.outputMarkdownPath, "utf8");
      const currentHashMd = computeBufferHash(Buffer.from(currentContent, "utf8"));
      if (doc.lastExtractedHash && currentHashMd !== doc.lastExtractedHash) {
        userEditedMarkdownAfterExtract = true;
      }
    } catch {
    }
  }
  const riskLevel = userEditedMarkdownAfterExtract ? "high" : "low";
  const expectedImpact = userEditedMarkdownAfterExtract
    ? "Overwrite local markdown changes (local modifications will be lost)"
    : (sourceChanged ? "Re-extract file and update markdown copy" : "Clean sync (no changes detected)");
  const suggestedAction = userEditedMarkdownAfterExtract
    ? "Backup modified markdown before refreshing"
    : "Proceed with sync";
  return {
    sourceChanged,
    lastExtractedTime: doc.lastExtractedAt || null,
    currentSourceFingerprint: currentHash,
    previousSourceFingerprint: recordedHash,
    expectedImpact,
    riskLevel,
    suggestedAction
  };
}
