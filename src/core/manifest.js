import { mkdir, readFile, writeFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { createId, nowIso } from "./ids.js";
import { AppError } from "./errors.js";
export const APP_DIR_NAME = ".ai-doc-exchange";
export const MANIFEST_FILE_NAME = "manifest.json";
const manifestWriteQueues = new Map();
const TRANSIENT_FS_CODES = new Set(["EBUSY", "EACCES", "EPERM", "EMFILE", "ENFILE"]);
function delay(ms) {
return new Promise((resolve) => setTimeout(resolve, ms));
}
async function retryTransientFileOperation(operation, attempts = 6) {
let lastError;
for (let attempt = 0; attempt < attempts; attempt += 1) {
try {
return await operation();
} catch (error) {
lastError = error;
if (!TRANSIENT_FS_CODES.has(error?.code) || attempt === attempts - 1) throw error;
await delay(20 * (attempt + 1));
}
}
throw lastError;
}
function compactStoredJob(job) {
const output = job?.output;
const segments = output?.markdownOutputs?.readableSegments;
if (!segments?.segments?.length) return job;
return {
...job,
output: {
...output,
markdownOutputs: {
...output.markdownOutputs,
readableSegments: {
segmented: Boolean(segments.segmented),
segmentCount: Number(segments.segmentCount || segments.segments.length),
indexPath: segments.indexPath || "",
indexRelativePath: segments.indexRelativePath || "",
sourceMapPath: segments.sourceMapPath || "",
sourceMapRelativePath: segments.sourceMapRelativePath || "",
segments: []
}
}
}
};
}
function manifestForStorage(manifest) {
return {
...manifest,
jobs: Array.isArray(manifest.jobs) ? manifest.jobs.map(compactStoredJob) : []
};
}
export function getAppDir(workspacePath) {
return path.join(workspacePath, APP_DIR_NAME);
}
export function getManifestPath(workspacePath) {
return path.join(getAppDir(workspacePath), MANIFEST_FILE_NAME);
}
export function createEmptyManifest() {
const timestamp = nowIso();
return {
version: 1,
workspaceId: createId("workspace"),
createdAt: timestamp,
updatedAt: timestamp,
documents: [],
datasets: [],
jobs: [],
apiProfiles: [],
exchangeAudits: [],
conversionAudits: [],
evidenceRecords: [],
settings: {
defaultAiModel: "",
defaultQueryLimit: 500,
policyMode: "open-core"
}
};
}
export async function ensureWorkspaceLayout(workspacePath) {
const appDir = getAppDir(workspacePath);
await mkdir(appDir, { recursive: true });
await mkdir(path.join(appDir, "cache"), { recursive: true });
await mkdir(path.join(appDir, "datasets"), { recursive: true });
await mkdir(path.join(appDir, "logs"), { recursive: true });
await mkdir(path.join(appDir, "exports"), { recursive: true });
await mkdir(path.join(appDir, "versions"), { recursive: true });
await mkdir(path.join(workspacePath, "notes"), { recursive: true });
await mkdir(path.join(workspacePath, "imports"), { recursive: true });
await mkdir(path.join(workspacePath, "outputs"), { recursive: true });
}
export async function readManifest(workspacePath) {
const manifestPath = getManifestPath(workspacePath);
let raw;
try {
raw = await retryTransientFileOperation(() => readFile(manifestPath, "utf8"));
} catch (error) {
throw new AppError("manifest_not_found", "Workspace manifest was...", {
manifestPath,
causeCode: error?.code || "unknown"
});
}
try {
const manifest = JSON.parse(raw);
if (manifest.version !== 1 || !Array.isArray(manifest.documents) || !Array.isArray(manifest.datasets)) {
throw new Error("Invalid manifest shape.");
}
return manifest;
} catch {
throw new AppError("manifest_invalid", "Workspace manifest is ...", {
manifestPath
});
}
}
export async function writeManifest(workspacePath, manifest) {
const manifestPath = getManifestPath(workspacePath);
const nextManifest = {
...manifest,
updatedAt: nowIso()
};
const storedManifest = manifestForStorage(nextManifest);
const previous = manifestWriteQueues.get(manifestPath) || Promise.resolve();
const queued = previous.catch(() => {}).then(async () => {
const temporaryPath = `${manifestPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
try {
await writeFile(temporaryPath, `${JSON.stringify(storedManifest, null, 2)}\n`, "utf8");
await retryTransientFileOperation(() => rename(temporaryPath, manifestPath));
} finally {
await rm(temporaryPath, { force: true }).catch(() => {});
}
return nextManifest;
});
manifestWriteQueues.set(manifestPath, queued);
try {
return await queued;
} finally {
if (manifestWriteQueues.get(manifestPath) === queued) manifestWriteQueues.delete(manifestPath);
}
}
export async function createWorkspace(workspacePath) {
await ensureWorkspaceLayout(workspacePath);
const manifest = createEmptyManifest();
return writeManifest(workspacePath, manifest);
}
export async function openOrCreateWorkspace(workspacePath) {
await ensureWorkspaceLayout(workspacePath);
let manifest;
try {
manifest = await readManifest(workspacePath);
} catch (error) {
if (error instanceof AppError && error.code === "manifest_not_found") {
manifest = await createWorkspace(workspacePath);
} else {
throw error;
}
}
let modified = false;
const importsDir = path.join(workspacePath, "imports");
try {
const files = await readdir(importsDir);
for (const doc of manifest.documents ?? []) {
const base = path.basename(doc.sourcePath);
const expectedPath = path.join(importsDir, base);
if (doc.sourcePath !== expectedPath && files.includes(base)) {
doc.sourcePath = expectedPath;
modified = true;
}
}
for (const ds of manifest.datasets ?? []) {
const base = path.basename(ds.sourcePath);
const expectedPath = path.join(importsDir, base);
if (ds.sourcePath !== expectedPath && files.includes(base)) {
ds.sourcePath = expectedPath;
modified = true;
}
}
const DOCUMENT_EXTENSIONS = new Set([".pdf", ".docx", ".pptx", ".md", ".txt"]);
const DATASET_EXTENSIONS = new Set([".xlsx", ".csv"]);
const registeredFiles = new Set([
...(manifest.documents ?? []).map((d) => path.basename(d.sourcePath)),
...(manifest.datasets ?? []).map((d) => path.basename(d.sourcePath))
]);
for (const file of files) {
if (registeredFiles.has(file)) {
continue;
}
const ext = path.extname(file).toLowerCase();
const filePath = path.join(importsDir, file);
const importedAt = nowIso();
if (DOCUMENT_EXTENSIONS.has(ext)) {
manifest.documents.push({
id: createId("doc"),
sourcePath: filePath,
sourceType: ext.slice(1),
title: path.parse(file).name,
status: "imported",
createdAt: importedAt,
updatedAt: importedAt
});
modified = true;
} else if (DATASET_EXTENSIONS.has(ext)) {
manifest.datasets.push({
id: createId("dataset"),
sourcePath: filePath,
sourceType: ext.slice(1),
name: path.parse(file).name,
sheets: [],
localTableNames: [],
status: "imported",
createdAt: importedAt,
updatedAt: importedAt
});
modified = true;
}
}
} catch {
}
if (modified) {
manifest = await writeManifest(workspacePath, manifest);
}
return manifest;
}
