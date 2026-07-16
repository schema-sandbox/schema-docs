import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { cliPath, execFileAsync, projectRoot } from "./helpers/cliHarness.js";
test("CLI import auto-inspects CSV and supports WHERE filters", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-cli-query-"));
  const sampleCsv = path.join(projectRoot, "samples", "quickstart-workspace", "imports", "sample-table.csv");
  const { stdout: importOut } = await execFileAsync(process.execPath, [
    cliPath,
    "import",
    workspace,
    sampleCsv
  ], { cwd: projectRoot });
  const imported = JSON.parse(importOut);
  assert.equal(imported.sourceType, "csv");
  assert.equal(imported.kind, "dataset");
  assert.equal(imported.autoInspectJob.status, "succeeded");
  const { stdout: preparedOut } = await execFileAsync(process.execPath, [
    cliPath,
    "prepare-ai",
    workspace,
    imported.id
  ], { cwd: projectRoot });
  const prepared = JSON.parse(preparedOut);
  assert.equal(prepared.kind, "dataset");
  assert.equal(prepared.preview.sendGateDecision, "allow");
  assert.ok(prepared.preview.markdownSections.includes("# sample-table"));
  const { stdout: intakeSummaryOut } = await execFileAsync(process.execPath, [
    cliPath,
    "ai-context",
    workspace,
    "plan",
    imported.id,
    "--summary"
  ], { cwd: projectRoot });
  assert.match(intakeSummaryOut, /AI context plan/);
  assert.match(intakeSummaryOut, /feeding: .* \| priority: .* \| continuousLoop: /);
  assert.match(intakeSummaryOut, /batchPreview: \d+\/\d+ \| omitted: \d+/);
  assert.match(intakeSummaryOut, /continuation: ready \| remainingBatches: 1/);
  assert.match(intakeSummaryOut, /nextRange: ai-context <workspace> range/);
  assert.doesNotMatch(intakeSummaryOut, /\| name \| age \|/);
  const { stdout: chunkSummaryOut } = await execFileAsync(process.execPath, [
    cliPath,
    "ai-context",
    workspace,
    "chunk",
    imported.id,
    "1",
    "--summary"
  ], { cwd: projectRoot });
  assert.match(chunkSummaryOut, /AI context chunk/);
  assert.match(chunkSummaryOut, /progress: 1\/1 chunks \(100%\)/);
  assert.match(chunkSummaryOut, /continuation: complete \| remainingBatches: 0/);
  assert.doesNotMatch(chunkSummaryOut, /\| name \| age \|/);
  const { stdout: rangeSummaryOut } = await execFileAsync(process.execPath, [
    cliPath,
    "ai-context",
    workspace,
    "range",
    imported.id,
    "1",
    "1",
    "9000",
    "--summary"
  ], { cwd: projectRoot });
  assert.match(rangeSummaryOut, /AI context range/);
  assert.match(rangeSummaryOut, /progress: 1\/1 chunks \(100%\)/);
  assert.match(rangeSummaryOut, /continuation: complete \| remainingBatches: 0/);
  assert.doesNotMatch(rangeSummaryOut, /\| name \| age \|/);
  const handoffRelativePath = path.join("notes", "sample-table-handoff.md");
  const { stdout: handoffSummaryOut } = await execFileAsync(process.execPath, [
    cliPath,
    "ai-context",
    workspace,
    "handoff",
    imported.id,
    handoffRelativePath,
    "--range=1:1",
    "--budget=9000",
    "--summary"
  ], { cwd: projectRoot });
  assert.match(handoffSummaryOut, /AI handoff bundle/);
  assert.match(handoffSummaryOut, /path: notes[\\/]sample-table-handoff\.md/);
  assert.doesNotMatch(handoffSummaryOut, /\| name \| age \|/);
  assert.equal(existsSync(path.join(workspace, handoffRelativePath)), true);
  const { stdout: runbookSummaryOut } = await execFileAsync(process.execPath, [
    cliPath,
    "ai-context",
    workspace,
    "runbook",
    imported.id,
    "4000",
    "--summary"
  ], { cwd: projectRoot });
  assert.match(runbookSummaryOut, /AI feed runbook/);
  assert.match(runbookSummaryOut, /batches: 1 \| chunks: 1 \| tokenBudget: 4000/);
  assert.match(runbookSummaryOut, /markdown: ai-feed/);
  assert.match(runbookSummaryOut, /json: ai-feed/);
  assert.doesNotMatch(runbookSummaryOut, /\| name \| age \|/);
  assert.equal(existsSync(path.join(workspace, "ai-feed", `${imported.id}-runbook.md`)), true);
  assert.equal(existsSync(path.join(workspace, "ai-feed", `${imported.id}-runbook.json`)), true);
  const { stdout: runbookBatchOut } = await execFileAsync(process.execPath, [
    cliPath,
    "ai-context",
    workspace,
    "runbook-batch",
    path.join("ai-feed", `${imported.id}-runbook.json`),
    "1",
    "reviewed",
    "cli reviewed",
    "--summary"
  ], { cwd: projectRoot });
  assert.match(runbookBatchOut, /status: completed 1 \| blocked 0 \| next none/);
  const { stdout: runbookStatusOut } = await execFileAsync(process.execPath, [
    cliPath,
    "ai-context",
    workspace,
    "runbook-status",
    path.join("ai-feed", `${imported.id}-runbook.json`),
    "--summary"
  ], { cwd: projectRoot });
  assert.match(runbookStatusOut, /AI feed runbook/);
  assert.match(runbookStatusOut, /status: completed 1 \| blocked 0 \| next none/);
  assert.doesNotMatch(runbookStatusOut, /\| name \| age \|/);
  const { stdout: packageOut } = await execFileAsync(process.execPath, [
    cliPath,
    "exchange-package",
    workspace,
    "from-record",
    "packages/sample-table-record",
    imported.id
  ], { cwd: projectRoot });
  const recordPackage = JSON.parse(packageOut);
  assert.equal(recordPackage.kind, "dataset");
  assert.equal(existsSync(path.join(workspace, "packages", "sample-table-record", "document.md")), true);
  const packageMarkdown = await import("node:fs/promises").then(({ readFile }) => readFile(path.join(workspace, "packages", "sample-table-record", "document.md"), "utf8"));
  const packageManifest = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(path.join(workspace, "packages", "sample-table-record", "manifest.json"), "utf8")));
  assert.match(packageMarkdown, /# sample-table/);
  assert.match(packageMarkdown, /\| name \| age \| department \| start_date \|/);
  assert.equal(packageManifest.sourceRecords[0].id, imported.id);
  assert.equal(packageManifest.sourceRecords[0].kind, "dataset");
  assert.equal(packageManifest.aiSendGateSummaries[0].decision, "allow");
  const { stdout: queryOut } = await execFileAsync(process.execPath, [
    cliPath,
    "query",
    workspace,
    "SELECT * FROM sample_table WHERE age > 25"
  ], { cwd: projectRoot });
  const query = JSON.parse(queryOut);
  assert.equal(query.status, "succeeded");
  assert.equal(query.output.rowCount, 4);
  const { stdout: queryContextOut } = await execFileAsync(process.execPath, [
    cliPath,
    "query-ai-context",
    workspace,
    "SELECT * FROM sample_table LIMIT 2"
  ], { cwd: projectRoot });
  const queryContext = JSON.parse(queryContextOut);
  assert.equal(queryContext.rowCount, 2);
  assert.equal(queryContext.includedRowCount, 2);
  assert.equal(queryContext.truncatedRows, false);
  assert.ok(queryContext.evidenceId.startsWith("evidence_"));
  assert.match(queryContext.contextMarkdown, /Filtered Table Context For AI/);
  assert.match(queryContext.contextMarkdown, /SELECT \* FROM sample_table LIMIT 2/);
  assert.ok(queryContext.tokenEstimate > 0);
  const { stdout: queryHandoffOut } = await execFileAsync(process.execPath, [
    cliPath,
    "query-ai-handoff",
    workspace,
    "notes/query-handoff.md",
    "SELECT * FROM sample_table LIMIT 2"
  ], { cwd: projectRoot });
  const queryHandoff = JSON.parse(queryHandoffOut);
  assert.equal(queryHandoff.queryContext.rowCount, 2);
  assert.equal(queryHandoff.handoffBundle.relativePath, "notes/query-handoff.md");
  assert.equal(queryHandoff.handoffBundle.evidenceId, queryHandoff.queryContext.evidenceId);
  const queryHandoffMarkdown = await import("node:fs/promises").then(({ readFile }) => readFile(path.join(workspace, "notes", "query-handoff.md"), "utf8"));
  assert.match(queryHandoffMarkdown, /AI Handoff Bundle/);
  assert.match(queryHandoffMarkdown, /Filtered Table Context For AI/);
  assert.match(queryHandoffMarkdown, /Send Gate: local_query_context_selected/);
  assert.match(queryHandoffMarkdown, /AI chunk ledger: filtered table context/);
  assert.deepEqual(query.output.rows.map((row) => row.name), ["Alice Morgan", "Ben Carter", "Daniel Reed", "Priya Shah"]);
});