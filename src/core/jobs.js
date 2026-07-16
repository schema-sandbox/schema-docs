import { createId, nowIso } from "./ids.js";
import { readManifest, writeManifest } from "./manifest.js";
import { toErrorRecord } from "./errors.js";
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
Object.assign(job, patch, {
updatedAt: nowIso()
});
await writeManifest(workspacePath, manifest);
return job;
}
export async function runJob(workspacePath, type, input, runner) {
let job = await enqueueJob(workspacePath, type, input);
job = await updateJob(workspacePath, job.id, {
status: "running",
progress: 1,
message: "Running",
startedAt: nowIso()
});
try {
const output = await runner({
job,
update: (patch) => updateJob(workspacePath, job.id, patch)
});
const storedJob = await updateJob(workspacePath, job.id, {
status: "succeeded",
progress: 100,
message: "Succeeded",
output,
finishedAt: nowIso()
});
return { ...storedJob, output };
} catch (error) {
return updateJob(workspacePath, job.id, {
status: "failed",
message: "Failed",
error: toErrorRecord(error),
finishedAt: nowIso()
});
}
}
export async function listJobs(workspacePath) {
const manifest = await readManifest(workspacePath);
return ensureJobsList(manifest);
}
