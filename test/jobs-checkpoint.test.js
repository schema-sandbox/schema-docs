import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readManifest, openOrCreateWorkspace } from "../src/core/manifest.js";
import { readConversionCheckpoint } from "../src/core/conversionCheckpoint.js";
import { cancelJob, runJob } from "../src/core/jobs.js";

test("runJob persists explicit checkpoint progress and completion", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-job-checkpoint-"));
  try {
  await openOrCreateWorkspace(workspace);
  const result = await runJob(workspace, "convert_pdf", {
    documentId: "doc_job_checkpoint",
    checkpoint: {
      documentId: "doc_job_checkpoint",
      sourceHash: "sha256:source",
      pipelineVersion: "pdf-v3",
      options: { dpi: 180 }
    }
  }, async ({ updateCheckpointPage }) => {
    await updateCheckpointPage({ pageNumber: 1, status: "completed", contentHash: "sha256:p1" });
    await updateCheckpointPage({ pageNumber: 2, status: "partial", error: "table unresolved" });
    return { converted: true };
  });
  const manifest = await readManifest(workspace);
  const job = manifest.jobs.find((candidate) => candidate.id === result.id);
  const checkpoint = await readConversionCheckpoint(workspace, result.id);
  assert.equal(result.status, "succeeded");
  assert.equal(job.status, "succeeded");
  assert.ok(job.checkpointPath);
  assert.equal(checkpoint.status, "succeeded");
  assert.deepEqual(checkpoint.pages.map((page) => page.status), ["completed", "partial"]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("runJob marks checkpoint failed while preserving the failure reason", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-job-checkpoint-"));
  try {
  await openOrCreateWorkspace(workspace);
  const result = await runJob(workspace, "convert_pdf", {
    checkpoint: {
      documentId: "doc_job_failure",
      sourceHash: "sha256:source",
      pipelineVersion: "pdf-v3"
    }
  }, async () => {
    throw new Error("page worker stopped");
  });
  const checkpoint = await readConversionCheckpoint(workspace, result.id);
  assert.equal(result.status, "failed");
  assert.equal(checkpoint.status, "failed");
  assert.match(checkpoint.error.message, /page worker stopped/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("cancelJob marks a running conversion and its checkpoint cancelled", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-job-cancel-"));
  try {
    await openOrCreateWorkspace(workspace);
    let startedResolve;
    const started = new Promise(resolve => { startedResolve = resolve; });
    let releaseResolve;
    const release = new Promise(resolve => { releaseResolve = resolve; });
    const running = runJob(workspace, "convert_pdf", {
      checkpoint: { documentId: "doc_cancel", sourceHash: "sha256:source", pipelineVersion: "pdf-v3" }
    }, async ({ job, assertNotCancelled }) => {
      startedResolve(job.id);
      await release;
      await assertNotCancelled();
      return { converted: true };
    });
    const jobId = await started;
    const cancelled = await cancelJob(workspace, jobId, "stop requested");
    assert.equal(cancelled.status, "cancelled");
    releaseResolve();
    const result = await running;
    const checkpoint = await readConversionCheckpoint(workspace, jobId);
    assert.equal(result.status, "cancelled");
    assert.equal(checkpoint.status, "cancelled");
    assert.equal(checkpoint.error.code, "job_cancelled");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
