import { createId, nowIso } from "./ids.js";
import { readManifest, writeManifest } from "./manifest.js";
import { toErrorRecord } from "./errors.js";
import { AppError } from "./errors.js";
import { createConversionCheckpoint, readConversionCheckpoint, upsertCheckpointPage, writeConversionCheckpoint } from "./conversionCheckpoint.js";
export const JOB_TYPES = new Set([
"convert_pdf",
"convert_docx",
"parse_xlsx",
"parse_csv",
"local_sql_query",
"ai_request"
]);
export function ensureJobsList(manifest) {
if (!Array.isArray(manifest.jobs)) {
manifest.jobs = [];
}
return manifest.jobs;
}
export function createJobRecord(type, input = {}) {
if (!JOB_TYPES.has(type)) {
throw new Error(`Unsupported job type: ${type}`);
}
const timestamp = nowIso();
return {
id: createId("job"),
type,
status: "queued",
progress: 0,
message: "Queued",
input,
createdAt: timestamp,
updatedAt: timestamp
};
}
export async function enqueueJob(workspacePath, type, input = {}) {
const manifest = await readManifest(workspacePath);
const jobs = ensureJobsList(manifest);
const job = createJobRecord(type, input);
jobs.push(job);
await writeManifest(workspacePath, manifest);
return job;
}
export async function updateJob(workspacePath, jobId, patch) {
const manifest = await readManifest(workspacePath);
const jobs = ensureJobsList(manifest);
const job = jobs.find((candidate) => candidate.id === jobId);
if (!job) throw new Error(`Job not found: ${jobId}`);
if (job.status === "cancelled" && patch?.status && patch.status !== "cancelled") return job;
Object.assign(job, patch, {
updatedAt: nowIso()
});
await writeManifest(workspacePath, manifest);
return job;
}
export async function cancelJob(workspacePath, jobId, reason = "Cancelled by user") {
const manifest = await readManifest(workspacePath);
const jobs = ensureJobsList(manifest);
const job = jobs.find((candidate) => candidate.id === jobId);
if (!job) throw new Error(`Job not found: ${jobId}`);
if (["succeeded", "failed", "cancelled"].includes(job.status) || job.commitCompletedAt) return job;
Object.assign(job, {
 status: "cancelled",
 progress: Math.min(Number(job.progress || 0), 99),
 message: "Cancelled",
 cancelReason: String(reason),
 cancelledAt: nowIso(),
 updatedAt: nowIso()
});
await writeManifest(workspacePath, manifest);
if (job.checkpointPath) {
 try {
  const checkpointId = String(job.checkpointPath).split(/[\\/]/).pop().replace(/\.json$/i, "");
  const checkpoint = await readConversionCheckpoint(workspacePath, checkpointId);
  checkpoint.status = "cancelled";
  checkpoint.error = { code: "job_cancelled", message: String(reason) };
  checkpoint.updatedAt = nowIso();
  await writeConversionCheckpoint(workspacePath, checkpoint);
 } catch {}
}
return job;
}
export async function runJob(workspacePath, type, input, runner) {
let job = await enqueueJob(workspacePath, type, input);
let checkpoint = null;
const checkpointInput = input?.checkpoint;
const startCheckpoint = async (overrides = {}) => {
if (checkpoint) return checkpoint;
if (!checkpointInput) return null;
const sourceHash = overrides.sourceHash || checkpointInput.sourceHash;
if (!sourceHash) throw new Error("A source hash is required before a conversion checkpoint can start.");
checkpoint = createConversionCheckpoint({
jobId: job.id,
documentId: overrides.documentId || checkpointInput.documentId,
sourceHash,
pipelineVersion: overrides.pipelineVersion || checkpointInput.pipelineVersion,
options: overrides.options || checkpointInput.options,
optionsFingerprint: overrides.optionsFingerprint || checkpointInput.optionsFingerprint
});
const checkpointPath = await writeConversionCheckpoint(workspacePath, checkpoint);
job = await updateJob(workspacePath, job.id, { checkpointPath });
return checkpoint;
};
if (checkpointInput && !checkpointInput.defer) await startCheckpoint();
job = await updateJob(workspacePath, job.id, {
status: "running",
progress: 1,
message: "Running",
startedAt: nowIso()
});
try {
const output = await runner({
job,
 update: (patch) => updateJob(workspacePath, job.id, patch),
 checkpoint,
 startCheckpoint,
 assertNotCancelled: async () => {
  const currentManifest = await readManifest(workspacePath);
  const currentJob = ensureJobsList(currentManifest).find(candidate => candidate.id === job.id);
  if (currentJob?.status === "cancelled") {
   const error = new AppError("job_cancelled", currentJob.cancelReason || "Job was cancelled.");
   throw error;
  }
  return true;
 },
 updateCheckpoint: async (patch = {}) => {
  if (!checkpoint) return null;
  const nextPatch = {
   ...patch,
   ...(patch.stages ? { stages: { ...(checkpoint.stages || {}), ...patch.stages } } : {})
  };
  Object.assign(checkpoint, nextPatch, { updatedAt: nowIso() });
  await writeConversionCheckpoint(workspacePath, checkpoint);
  return checkpoint;
 },
 updateCheckpointPage: async (page) => {
  if (!checkpoint) return null;
  upsertCheckpointPage(checkpoint, page);
  await writeConversionCheckpoint(workspacePath, checkpoint);
  return checkpoint;
 }
});
const latestBeforeCommit = await readManifest(workspacePath).catch(() => ({ jobs: [] }));
const latestJobBeforeCommit = ensureJobsList(latestBeforeCommit).find(candidate => candidate.id === job.id);
if (latestJobBeforeCommit?.status === "cancelled") {
 throw new AppError("job_cancelled", latestJobBeforeCommit.cancelReason || "Job was cancelled.");
}
if (checkpoint) {
checkpoint.status = "succeeded";
checkpoint.updatedAt = nowIso();
await writeConversionCheckpoint(workspacePath, checkpoint);
}
const storedJob = await updateJob(workspacePath, job.id, {
status: "succeeded",
progress: 100,
message: "Succeeded",
output,
finishedAt: nowIso()
});
return { ...storedJob, output };
} catch (error) {
const currentManifest = await readManifest(workspacePath).catch(() => ({ jobs: [] }));
const currentJob = ensureJobsList(currentManifest).find(candidate => candidate.id === job.id);
const cancelled = error?.code === "job_cancelled" || currentJob?.status === "cancelled";
if (currentJob?.commitCompletedAt) {
 return updateJob(workspacePath, job.id, { status: "succeeded", progress: 100,
  message: "Conversion committed; follow-up logging needs review", postCommitWarning: toErrorRecord(error), finishedAt: nowIso() });
}
if (checkpoint) {
 checkpoint.status = cancelled ? "cancelled" : "failed";
 checkpoint.error = cancelled ? { code: "job_cancelled", message: currentJob?.cancelReason || error.message } : toErrorRecord(error);
 checkpoint.updatedAt = nowIso();
 await writeConversionCheckpoint(workspacePath, checkpoint).catch(() => {});
}
return updateJob(workspacePath, job.id, {
status: cancelled ? "cancelled" : "failed",
message: cancelled ? "Cancelled" : "Failed",
error: cancelled ? { code: "job_cancelled", message: currentJob?.cancelReason || error.message } : toErrorRecord(error),
finishedAt: nowIso()
});
}
}
export async function listJobs(workspacePath) {
const manifest = await readManifest(workspacePath);
return ensureJobsList(manifest);
}
