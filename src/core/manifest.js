import { mkdir, readFile, writeFile, readdir, rename, rm, realpath } from "node:fs/promises";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { createId, nowIso } from "./ids.js";
import { AppError } from "./errors.js";
export const APP_DIR_NAME = ".ai-doc-exchange";
export const MANIFEST_FILE_NAME = "manifest.json";
const manifestWriteQueues = new Map();
const manifestSnapshots = new WeakMap();
const commitContext = new AsyncLocalStorage();
const cloneJson = value => JSON.parse(JSON.stringify(value));

// Kernel-owned endpoints disappear when a writer exits, including forced kills.
// No age/PID-based lock stealing: a slow live writer must retain exclusivity.
async function acquireManifestLock(manifestPath, timeoutMs = 30000) {
 const canonical = await realpath(path.dirname(manifestPath));
 const key = createHash("sha256").update(process.platform === "win32" ? canonical.toLowerCase() : canonical).digest("hex");
 const endpoint = process.platform === "win32" ? { path: `\\\\.\\pipe\\schema-docs-manifest-${key}` }
  : process.platform === "linux" ? { path: `\0schema-docs-manifest-${key}` }
  : { host: "127.0.0.1", port: 20000 + (parseInt(key.slice(0, 8), 16) % 40000) };
 const deadline = Date.now() + timeoutMs;
 for (;;) {
  const server = createServer(socket => socket.destroy());
  try {
   await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ ...endpoint, exclusive: true }, resolve);
   });
   return () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } catch (error) {
   server.close();
   if (error.code !== "EADDRINUSE") throw error;
   if (Date.now() >= deadline) throw new AppError("manifest_busy", "Another process is committing this workspace. Retry shortly.");
   await delay(25 + Math.floor(Math.random() * 25));
  }
 }
}

// Body edits and pointer commits share the same lock. Nested version/manifest
// operations reuse only a still-active owner, never an expired async context.
export async function withWorkspaceCommit(workspacePath, operation) {
 const appDir = getAppDir(workspacePath);
 await mkdir(appDir, { recursive: true });
 const canonical = await realpath(appDir);
 const key = process.platform === "win32" ? canonical.toLowerCase() : canonical;
 const owner = commitContext.getStore();
 if (owner?.active && owner.key === key) return operation();
 const previous = manifestWriteQueues.get(key) || Promise.resolve();
 const queued = previous.catch(() => {}).then(async () => {
  const release = await acquireManifestLock(path.join(canonical, MANIFEST_FILE_NAME));
  const context = { key, active: true };
  try { return await commitContext.run(context, operation); }
  finally { context.active = false; await release(); }
 });
 manifestWriteQueues.set(key, queued);
 try { return await queued; }
 finally { if (manifestWriteQueues.get(key) === queued) manifestWriteQueues.delete(key); }
}

function mergeSnapshot(base, incoming, current, location = "manifest") {
 if (isDeepStrictEqual(incoming, base)) return current;
 if (isDeepStrictEqual(current, base) || isDeepStrictEqual(incoming, current)) return incoming;
 const recordList = value => Array.isArray(value) && value.every(item => item && typeof item.id === "string")
  && new Set(value.map(item => item.id)).size === value.length;
 if ((base === undefined || recordList(base)) && recordList(incoming) && recordList(current)) {
  const before = new Map((base || []).map(item => [item.id, item]));
  const proposed = new Map(incoming.map(item => [item.id, item]));
  const latest = new Map(current.map(item => [item.id, item]));
  return [...new Set([...latest.keys(), ...proposed.keys(), ...before.keys()])].flatMap(id => {
   const a = before.get(id), b = proposed.get(id), c = latest.get(id);
   // A record is indivisible: never mix revision pointers from competing edits.
   if (isDeepStrictEqual(a, b)) return c === undefined ? [] : [c];
   if (isDeepStrictEqual(a, c) || isDeepStrictEqual(b, c)) return b === undefined ? [] : [b];
   throw new AppError("manifest_write_conflict", "This record changed in another operation. Reload before saving.", { location: `${location}.${id}` });
  });
 }
 const object = value => value && typeof value === "object" && !Array.isArray(value);
 if (object(base) && object(incoming) && object(current)) {
  return Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(incoming), ...Object.keys(current)])]
   .filter(key => location !== "manifest" || !["jobs", "updatedAt", "manifestRevision"].includes(key))
   .map(key => [key, mergeSnapshot(base[key], incoming[key], current[key], `${location}.${key}`)])
   .filter(([, value]) => value !== undefined));
 }
 throw new AppError("manifest_write_conflict", "The workspace changed in another operation. Reload before saving.", { location });
}
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
throw new AppError(error?.code === "ENOENT" ? "manifest_not_found" : "manifest_read_failed", "Workspace manifest could not be read.", {
manifestPath,
causeCode: error?.code || "unknown"
});
}
try {
const manifest = JSON.parse(raw);
if (manifest.version !== 1 || !Array.isArray(manifest.documents) || !Array.isArray(manifest.datasets)) {
throw new Error("Invalid manifest shape.");
}
manifestSnapshots.set(manifest, cloneJson(manifest));
return manifest;
} catch {
throw new AppError("manifest_invalid", "Workspace manifest is ...", {
manifestPath
});
}
}
export async function writeManifest(workspacePath, manifest, options = {}) {
const manifestPath = getManifestPath(workspacePath);
const nextManifest = {
...cloneJson(manifest),
updatedAt: nowIso()
};
const base = manifestSnapshots.get(manifest);
return withWorkspaceCommit(workspacePath, async () => {
let mergedManifest = nextManifest;
let latestManifest = null;
try {
 const latest = JSON.parse(await retryTransientFileOperation(() => readFile(manifestPath, "utf8")));
 if (latest.version !== 1 || !Array.isArray(latest.documents) || !Array.isArray(latest.datasets)) {
  throw new AppError("manifest_invalid", "Existing manifest is invalid; it was preserved.");
 }
 latestManifest = latest;
 if (options.initialize) {
  manifestSnapshots.set(latest, cloneJson(latest));
  return latest;
 }
 if (!options.beforeCommit) {
  if (base) mergedManifest = { ...mergeSnapshot(base, nextManifest, latest), jobs: nextManifest.jobs };
  else if (nextManifest.manifestRevision !== latest.manifestRevision || !Number.isSafeInteger(latest.manifestRevision)) {
   throw new AppError("manifest_write_conflict", "Reload the workspace before replacing its manifest.");
  }
 }
  if (Array.isArray(latest?.jobs) && Array.isArray(nextManifest.jobs)) {
  const incomingById = new Map(nextManifest.jobs.map((candidate) => [candidate.id, candidate]));
  const latestById = new Map(latest.jobs.map((candidate) => [candidate.id, candidate]));
  for (const [jobId, latestJob] of latestById) {
   const incomingJob = incomingById.get(jobId);
   if (latestJob.commitCompletedAt && incomingJob?.status === "cancelled") {
    incomingById.set(jobId, latestJob);
    continue;
   }
   const terminal = new Set(["succeeded", "failed", "cancelled"]);
   const latestIsTerminal = terminal.has(String(latestJob.status));
   const incomingIsTerminal = terminal.has(String(incomingJob?.status));
   const latestWinsByTerminal = incomingJob && latestIsTerminal && !incomingIsTerminal;
   const bothTerminal = incomingJob && latestIsTerminal && incomingIsTerminal;
   const latestWinsByTime = Date.parse(String(latestJob.updatedAt || "")) >= Date.parse(String(incomingJob?.updatedAt || ""));
   if (!incomingJob || latestWinsByTerminal || (bothTerminal && latestWinsByTime) || (!incomingIsTerminal && latestWinsByTime)) {
    incomingById.set(jobId, latestJob);
   }
  }
  mergedManifest = { ...mergedManifest, jobs: [...incomingById.values()] };
 }
} catch (error) {
 if (error.code !== "ENOENT") throw error;
 if (base) throw new AppError("manifest_write_conflict", "The workspace manifest was removed; stale data was not restored.");
}
await options.beforeCommit?.(mergedManifest, latestManifest);
mergedManifest.manifestRevision = (latestManifest?.manifestRevision || 0) + 1;
mergedManifest.updatedAt = nowIso();
const storedMergedManifest = manifestForStorage(mergedManifest);
const temporaryPath = `${manifestPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
try {
await writeFile(temporaryPath, `${JSON.stringify(storedMergedManifest, null, 2)}\n`, "utf8");
await retryTransientFileOperation(() => rename(temporaryPath, manifestPath));
} finally {
await rm(temporaryPath, { force: true }).catch(() => {});
}
manifest.manifestRevision = mergedManifest.manifestRevision;
manifestSnapshots.set(manifest, { ...cloneJson(nextManifest), manifestRevision: mergedManifest.manifestRevision });
manifestSnapshots.set(mergedManifest, cloneJson(mergedManifest));
return mergedManifest;
});
}
export async function createWorkspace(workspacePath) {
await ensureWorkspaceLayout(workspacePath);
const manifest = createEmptyManifest();
return writeManifest(workspacePath, manifest, { initialize: true });
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
