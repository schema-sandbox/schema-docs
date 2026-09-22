import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createConversionCheckpoint,
  getCheckpointResumePageRange,
  getConversionCheckpointPath,
  isCheckpointReusable,
  readConversionCheckpoint,
  upsertCheckpointPage,
  writeConversionCheckpoint
} from "../src/core/conversionCheckpoint.js";

test("conversion checkpoint round-trips page progress atomically", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-checkpoint-"));
  try {
    const checkpoint = createConversionCheckpoint({
      jobId: "job_checkpoint",
      documentId: "doc_checkpoint",
      sourceHash: "sha256:source",
      pipelineVersion: "pdf-v2",
      options: { lang: "en", dpi: 180 }
    });
    upsertCheckpointPage(checkpoint, { pageNumber: 2, status: "completed", contentHash: "sha256:p2" });
    upsertCheckpointPage(checkpoint, { pageNumber: 1, status: "failed", error: "OCR unavailable" });
    const filePath = await writeConversionCheckpoint(workspace, checkpoint);
    const restored = await readConversionCheckpoint(workspace, "job_checkpoint");
    assert.equal(filePath, getConversionCheckpointPath(workspace, "job_checkpoint"));
    assert.deepEqual(restored.pages.map((page) => page.pageNumber), [1, 2]);
    assert.equal(restored.pages[0].status, "failed");
    assert.equal(isCheckpointReusable(restored, { documentId: "doc_checkpoint", sourceHash: "sha256:source", pipelineVersion: "pdf-v2", options: { dpi: 180, lang: "en" } }), true);
    assert.equal(isCheckpointReusable(restored, { documentId: "doc_checkpoint", sourceHash: "sha256:source", pipelineVersion: "pdf-v2", options: { dpi: 180, lang: "en" }, requiredPageNumbers: [2] }), false);
    assert.equal(isCheckpointReusable(restored, { documentId: "doc_checkpoint", sourceHash: "sha256:changed", pipelineVersion: "pdf-v2", options: { dpi: 180 } }), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("checkpoint resume range excludes only pages with verified artifacts", () => {
  const checkpoint = createConversionCheckpoint({ documentId: "doc", sourceHash: "sha256:source", pipelineVersion: "pdf-v2", options: {} });
  upsertCheckpointPage(checkpoint, { pageNumber: 1, status: "completed", artifactPath: "pages/000001.json", contentHash: "sha256:p1" });
  upsertCheckpointPage(checkpoint, { pageNumber: 2, status: "completed", artifactPath: "", contentHash: "" });
  assert.deepEqual(getCheckpointResumePageRange(checkpoint, 3), { start: 2, end: 3, pages: [2, 3] });
});

test("conversion checkpoint rejects unsafe job identifiers", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-checkpoint-"));
  try {
    const checkpoint = createConversionCheckpoint({ jobId: "../outside", documentId: "doc_checkpoint", sourceHash: "sha256:source" });
    await assert.rejects(() => writeConversionCheckpoint(workspace, checkpoint), /unsafe path characters/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
