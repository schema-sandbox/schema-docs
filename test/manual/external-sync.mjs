// Manual external-edit synchronization smoke test.
//
// This script creates a temporary workspace, imports files from an external
// directory, mutates the source files, and verifies that refresh-source sees
// and ingests the changes. It is intentionally not part of `npm test`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const CLI = join(ROOT, "src/cli/index.js");
const testWorkspace = join(tmpdir(), `schema-docs-external-sync-test-${Date.now()}`);
const externalDir = join(testWorkspace, "external-office-files");

mkdirSync(externalDir, { recursive: true });

function runCli(...args) {
  const output = execFileSync("node", [CLI, ...args], { encoding: "utf8", cwd: ROOT });
  return JSON.parse(output);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTest() {
  const mdSourcePath = join(externalDir, "sales-report.md");
  const csvSourcePath = join(externalDir, "employee-data.csv");

  writeFileSync(mdSourcePath, [
    "# 2024 Q1 Sales Report",
    "",
    "Initial external Markdown content.",
    ""
  ].join("\n"), "utf8");
  writeFileSync(csvSourcePath, "name,age,department\nAlice,28,Engineering\nBob,35,Sales\n", "utf8");

  console.log("External sync manual smoke");
  console.log("workspace:", testWorkspace);

  const initResult = runCli("init", testWorkspace);
  assert(initResult.workspaceId, "workspace was not initialized");

  const mdRecord = runCli("import", testWorkspace, mdSourcePath);
  const csvRecord = runCli("import", testWorkspace, csvSourcePath);
  assert(mdRecord.id, "Markdown import did not return a record id");
  assert(csvRecord.id, "CSV import did not return a record id");

  const converted = runCli("convert-text", testWorkspace, mdRecord.id);
  assert(existsSync(converted.output.outputMarkdownPath), "Markdown conversion output is missing");
  assert(readFileSync(converted.output.outputMarkdownPath, "utf8").includes("Initial external Markdown content"), "Converted Markdown content mismatch");

  const inspected = runCli("inspect-csv", testWorkspace, csvRecord.id);
  assert(inspected.status === "succeeded", "CSV inspection job did not succeed");
  assert(inspected.output?.status === "ready", "CSV inspection did not mark dataset ready");

  await sleep(1500);
  writeFileSync(mdSourcePath, [
    "# 2024 Q1 Sales Report",
    "",
    "Initial external Markdown content.",
    "",
    "## Added Outside Schema Docs",
    "",
    "This paragraph simulates edits from Word, WPS, or another external editor.",
    ""
  ].join("\n"), "utf8");
  writeFileSync(csvSourcePath, "name,age,department\nAlice,29,Engineering\nBob,35,Sales\nCharlie,31,Marketing\n", "utf8");

  const status = runCli("list-records", testWorkspace, "--status");
  const changedMarkdown = status.find((record) => record.id === mdRecord.id);
  assert(changedMarkdown?.sourceChanged === true, "Markdown source change was not detected");

  const preview = runCli("refresh-source", testWorkspace, "preview", mdRecord.id);
  assert(preview.sourceChanged === true, "Refresh preview did not report a changed source");

  const refreshedMarkdown = runCli("refresh-source", testWorkspace, mdRecord.id);
  assert(refreshedMarkdown.record.hash, "Refreshed Markdown record is missing a hash");
  assert(refreshedMarkdown.job?.status === "succeeded", "Markdown refresh job did not succeed");

  const refreshedCsv = runCli("refresh-source", testWorkspace, csvRecord.id);
  assert(refreshedCsv.record.hash, "Refreshed CSV record is missing a hash");
  assert(refreshedCsv.job?.status === "succeeded", "CSV refresh job did not succeed");
  assert(refreshedCsv.job?.output?.status === "ready", "Refreshed CSV dataset is not ready");

  const aiPreview = runCli("ai-context", testWorkspace, "preview", mdRecord.id);
  assert(aiPreview.markdownSections.includes("# 2024 Q1 Sales Report"), "AI preview lost the document heading");
  assert(aiPreview.markdownSections.includes("## Added Outside Schema Docs"), "AI preview did not include refreshed heading");

  const exchangePackage = runCli(
    "exchange-package",
    testWorkspace,
    "packages/external-sync",
    "External Sync Smoke",
    "--exports=docx,pdf",
    "Manual external sync smoke package"
  );
  assert(exchangePackage.packageRoot, "Exchange package was not created");

  const receiverReport = runCli("exchange-package", testWorkspace, 'receiver-report', "packages/external-sync");
  assert(receiverReport.markdownPath?.endsWith("receiver-report.md"), "Receiver report markdown was not written");
  assert(receiverReport.jsonPath?.endsWith("trust-report.json"), "Trust report JSON was not written");
  assert(receiverReport.markdownHash?.startsWith("sha256:"), "Receiver report hash is missing");
  assert(receiverReport.jsonHash?.startsWith("sha256:"), "Trust report hash is missing");
  assert(existsSync(receiverReport.markdownPath), "Receiver report file is missing on disk");
  assert(existsSync(receiverReport.jsonPath), "Trust report file is missing on disk");
  const trustReportJson = JSON.parse(readFileSync(receiverReport.jsonPath, "utf8"));
  assert(Array.isArray(trustReportJson.trustReport?.recommendedActions), "Trust report JSON is missing recommendedActions");
  console.log("Receiver/trust reports written");

  console.log("External sync manual smoke passed");
}

if (process.env.NODE_TEST_CONTEXT) {
  console.log("External sync manual smoke skipped under node --test. Run this file directly for the manual scenario.");
} else {
  runTest().catch((error) => {
    console.error("External sync manual smoke failed:", error);
    process.exitCode = 1;
  }).finally(() => {
    if (process.env.SCHEMA_DOCS_KEEP_MANUAL_WORKSPACE !== "1") {
      rmSync(testWorkspace, { recursive: true, force: true });
    }
  });
}
