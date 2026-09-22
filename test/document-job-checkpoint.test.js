import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openOrCreateWorkspace, readManifest } from "../src/core/manifest.js";
import { importFileToWorkspace } from "../src/core/records.js";
import { convertDocumentToMarkdown, convertDocumentToMarkdownAsJob } from "../src/core/documents.js";
import { cancelJob } from "../src/core/jobs.js";
import { textMarkdownConverter } from "../src/adapters/textMarkdownConverter.js";
import { pdfMarkdownConverter, markdownToPdfBuffer } from "../src/adapters/pdfMarkdownConverter.js";
import { readConversionCheckpoint } from "../src/core/conversionCheckpoint.js";
import { addMarkdownVersion } from "../src/core/versions.js";

test("document conversion starts and completes a source-hash checkpoint", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-document-checkpoint-"));
  try {
    await openOrCreateWorkspace(workspace);
    const sourcePath = path.join(workspace, "checkpoint.txt");
    await writeFile(sourcePath, "checkpoint content\n", "utf8");
    const record = await importFileToWorkspace(workspace, sourcePath);
    const job = await convertDocumentToMarkdownAsJob(workspace, record.id, textMarkdownConverter);
    const manifest = await readManifest(workspace);
    const savedJob = manifest.jobs.find(candidate => candidate.id === job.id);
    assert.equal(job.status, "succeeded");
    assert.ok(savedJob.checkpointPath);
    const checkpoint = await readConversionCheckpoint(workspace, path.basename(savedJob.checkpointPath, ".json"));
    assert.equal(checkpoint.status, "succeeded");
    assert.equal(checkpoint.documentId, record.id);
    assert.match(checkpoint.sourceHash, /^sha256:/);
    assert.equal(checkpoint.stages.source_validation.status, "completed");
    assert.equal(checkpoint.stages.markdown_extraction.status, "completed");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("PDF conversion records completed DocumentIR pages in its checkpoint", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-pdf-page-checkpoint-"));
  try {
    await openOrCreateWorkspace(workspace);
    const sourcePath = path.join(workspace, "pages.pdf");
    await writeFile(sourcePath, markdownToPdfBuffer(Array.from({ length: 60 }, (_, i) => `Actual physical page content line ${i}.`).join("\n")));
    const record = await importFileToWorkspace(workspace, sourcePath);
    const job = await convertDocumentToMarkdownAsJob(workspace, record.id, pdfMarkdownConverter);
    const manifest = await readManifest(workspace);
    const savedJob = manifest.jobs.find(candidate => candidate.id === job.id);
    const checkpoint = await readConversionCheckpoint(workspace, path.basename(savedJob.checkpointPath, ".json"));
    assert.equal(job.status, "succeeded");
    assert.deepEqual(checkpoint.pages.map((page) => [page.pageNumber, page.status]), [[1, "completed"], [2, "completed"]]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("PDF job forwards resource budgets through the public job entry point", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-pdf-budget-job-"));
  try {
    await openOrCreateWorkspace(workspace);
    const sourcePath = path.join(workspace, "budget.pdf");
    await writeFile(sourcePath, markdownToPdfBuffer("budget"));
    const record = await importFileToWorkspace(workspace, sourcePath);
    const job = await convertDocumentToMarkdownAsJob(workspace, record.id, pdfMarkdownConverter, {
      force: true,
      maxInputBytes: 1,
      maxDecompressedBytes: 2
    });
    const manifest = await readManifest(workspace);
    const savedJob = manifest.jobs.find(candidate => candidate.id === job.id);
    const checkpoint = await readConversionCheckpoint(workspace, path.basename(savedJob.checkpointPath, ".json"));
    assert.equal(job.status, "failed");
    assert.equal(job.error.code, "PDF_INPUT_LIMIT");
    assert.equal(checkpoint.options.maxInputBytes, 1);
    assert.equal(checkpoint.options.maxDecompressedBytes, 2);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("cancellation observed before candidate commit preserves the previous extraction", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-cancel-commit-"));
  try {
    await openOrCreateWorkspace(workspace);
    const sourcePath = path.join(workspace, "cancel.txt");
    await writeFile(sourcePath, "cancel source\n", "utf8");
    const record = await importFileToWorkspace(workspace, sourcePath);
    const converter = {
      name: "cancel-test-converter",
      cacheVersion: "1",
      canHandle: () => true,
      convert: async () => ({ markdown: "# Old\n\nPrevious output.\n", warnings: [] })
    };
    const first = await convertDocumentToMarkdownAsJob(workspace, record.id, converter, { force: true });
    assert.equal(first.status, "succeeded");
    const before = await readManifest(workspace);
    const beforeDocument = before.documents.find((candidate) => candidate.id === record.id);
    const previousText = await readFile(beforeDocument.outputMarkdownPath, "utf8");
    converter.convert = async () => {
      const running = (await readManifest(workspace)).jobs.find((candidate) => candidate.status === "running");
      await cancelJob(workspace, running.id, "cancel before commit");
      return { markdown: "# New\n\nShould never commit.\n", warnings: [] };
    };
    const cancelled = await convertDocumentToMarkdownAsJob(workspace, record.id, converter, { force: true });
    const after = await readManifest(workspace);
    const current = after.documents.find((candidate) => candidate.id === record.id);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(await readFile(current.outputMarkdownPath, "utf8"), previousText);
    assert.equal(current.documentIrMarkdownHash, beforeDocument.documentIrMarkdownHash);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("cancel and disk failure after candidate writes preserve the committed body, assets and metadata", async () => {
 const workspace = await mkdtemp(path.join(os.tmpdir(), "revision-atomic-"));
 try {
  await openOrCreateWorkspace(workspace);
  const source = path.join(workspace, "document.txt");
  await writeFile(source, "A source document.");
  const record = await importFileToWorkspace(workspace, source);
  let generation = "old", failDisk = false;
  const converter = { name: "revision-fixture", cacheVersion: "1", canHandle: () => true,
   convert: async ({ assetDir, assetRelativeBase }) => {
    await mkdir(assetDir, { recursive: true });
    await writeFile(path.join(assetDir, "figure.png"), generation);
    if (failDisk) await mkdir(path.join(path.dirname(path.dirname(assetDir)), "document.quality.json"));
    return { markdown: `# ${generation}\n\n![figure](${assetRelativeBase}/figure.png)\n`, warnings: [] };
   }
  };
  await convertDocumentToMarkdown(workspace, record.id, converter);
  const before = await readManifest(workspace);
  const document = before.documents.find(d => d.id === record.id);
  const body = await readFile(document.outputMarkdownPath, "utf8");
  generation = "new";
  let checks = 0;
  await assert.rejects(convertDocumentToMarkdown(workspace, record.id, converter, {
   force: true, assertNotCancelled: async () => {
    if (++checks === 3) throw Object.assign(new Error("cancel after body write"), { code: "job_cancelled" });
   }
  }), { code: "job_cancelled" });
  failDisk = true;
  await assert.rejects(convertDocumentToMarkdown(workspace, record.id, converter, { force: true }));
  const after = await readManifest(workspace);
  assert.deepEqual(after.documents, before.documents);
  assert.deepEqual(after.markdownVersions, before.markdownVersions);
  assert.equal(await readFile(document.outputMarkdownPath, "utf8"), body);
  assert.equal(await readFile(path.join(path.dirname(document.outputMarkdownPath), "assets/document.txt/figure.png"), "utf8"), "old");
  assert.equal(JSON.parse(await readFile(document.artifactRevisionPath, "utf8")).revision, document.artifactRevisionId);
 } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("edits arriving during candidate writes prevent the revision pointer from changing", async () => {
 const workspace = await mkdtemp(path.join(os.tmpdir(), "revision-edit-race-"));
 try {
  await openOrCreateWorkspace(workspace);
  const source = path.join(workspace, "notes.txt");
  await writeFile(source, "source text");
  const record = await importFileToWorkspace(workspace, source);
  await convertDocumentToMarkdown(workspace, record.id, textMarkdownConverter);
  const current = (await readManifest(workspace)).documents[0];
  let checks = 0;
  await assert.rejects(convertDocumentToMarkdown(workspace, record.id, textMarkdownConverter, {
   force: true, assertNotCancelled: async () => {
    if (++checks === 3) await writeFile(current.outputMarkdownPath, "A concurrent user edit.");
   }
  }), { code: "document_revision_conflict" });
  assert.equal((await readManifest(workspace)).documents[0].artifactRevisionId, current.artifactRevisionId);
  assert.equal(await readFile(current.outputMarkdownPath, "utf8"), "A concurrent user edit.");
 } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("conversion allocates final history numbers after an intervening manual version save", async () => {
 const workspace = await mkdtemp(path.join(os.tmpdir(), "revision-version-race-"));
 try {
  await openOrCreateWorkspace(workspace);
  const source = path.join(workspace, "notes.txt");
  await writeFile(source, "source text");
  const record = await importFileToWorkspace(workspace, source);
  await convertDocumentToMarkdown(workspace, record.id, textMarkdownConverter);
  const current = (await readManifest(workspace)).documents[0];
  let saved = false;
  await convertDocumentToMarkdown(workspace, record.id, textMarkdownConverter, {
   force: true, assertNotCancelled: async () => {
    // A new immutable backup means the candidate already reserved a version.
    if (!saved && (await readdir(path.join(workspace, ".ai-doc-exchange/versions"))).length > 1) {
     saved = true;
     await addMarkdownVersion(workspace, current.outputMarkdownPath, "manual_save", record.id, "Independent history entry");
    }
   }
  });
  assert.ok(saved);
  const versions = (await readManifest(workspace)).markdownVersions;
  assert.deepEqual(versions.map(item => item.version), [1, 2, 3]);
  assert.equal(versions[1].reason, "manual_save");
  assert.equal(await readFile(path.join(workspace, versions[1].versionPath), "utf8"), "Independent history entry");
 } finally { await rm(workspace, { recursive: true, force: true }); }
});
