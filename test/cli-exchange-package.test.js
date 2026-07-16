import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { cliPath, execFileAsync, projectRoot } from "./helpers/cliHarness.js";
test("CLI exchange-package can create DOCX and PDF package exports", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-cli-package-"));
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "exchange-package",
    workspace,
    "packages/cli-demo",
    "CLI Demo",
    "--exports=docx,pdf",
    "Markdown centered package"
  ], {
    cwd: projectRoot
  });
  const result = JSON.parse(stdout);
  assert.equal(result.packageExports.length, 2);
  assert.equal(result.packageExports[0].format, "docx");
  assert.equal(result.packageExports[1].format, "pdf");
  const packageRoot = path.join(workspace, "packages", "cli-demo");
  assert.equal(existsSync(path.join(packageRoot, "document.md")), true);
  assert.equal(existsSync(path.join(packageRoot, "document.schema.json")), true);
  assert.equal(existsSync(path.join(packageRoot, "manifest.json")), true);
  assert.equal(existsSync(path.join(packageRoot, "exports", "document.docx")), true);
  assert.equal(existsSync(path.join(packageRoot, "exports", "document.pdf")), true);
  const manifest = JSON.parse(await readFile(path.join(packageRoot, "manifest.json"), "utf8"));
  assert.equal(manifest.packageType, "markdown.exchange");
  assert.equal(manifest.documentSchema.path, "document.schema.json");
  assert.match(manifest.documentSchema.hash, /^sha256:/);
  assert.deepEqual(manifest.exports.map((entry) => entry.format), ["docx", "pdf"]);
  assert.match(manifest.exports[0].hash, /^sha256:/);
  assert.match(manifest.exports[1].hash, /^sha256:/);
  const readBack = await execFileAsync(process.execPath, [
    cliPath,
    "exchange-package-read",
    workspace,
    "packages/cli-demo"
  ], {
    cwd: projectRoot
  });
  const packageRead = JSON.parse(readBack.stdout);
  assert.equal(packageRead.valid, true);
  assert.equal(packageRead.manifest.title, "CLI Demo");
  assert.equal(packageRead.document.frontmatter.title, "CLI Demo");
  assert.ok(packageRead.files.some((file) => file.path === "document.schema.json"));
  const receiverReportOut = await execFileAsync(process.execPath, [
    cliPath,
    "exchange-package",
    workspace,
    "receiver-report",
    "packages/cli-demo"
  ], {
    cwd: projectRoot
  });
  const receiverReport = JSON.parse(receiverReportOut.stdout);
  assert.equal(receiverReport.verdict, "trusted_with_warnings");
  assert.equal(existsSync(path.join(packageRoot, "receiver-report.md")), true);
  assert.equal(existsSync(path.join(packageRoot, "trust-report.json")), true);
  assert.match(await readFile(path.join(packageRoot, "receiver-report.md"), "utf8"), /Exchange Package Receiver Report/);
  const pathFirstVerifyOut = await execFileAsync(process.execPath, [
    cliPath,
    "exchange-package",
    workspace,
    "packages/cli-demo",
    "verify"
  ], {
    cwd: projectRoot
  });
  assert.equal(JSON.parse(pathFirstVerifyOut.stdout).ok, true);
  const pathFirstExplainOut = await execFileAsync(process.execPath, [
    cliPath,
    "exchange-package",
    workspace,
    "packages/cli-demo",
    "explain"
  ], {
    cwd: projectRoot
  });
  const pathFirstExplain = JSON.parse(pathFirstExplainOut.stdout);
  assert.equal(pathFirstExplain.title, "CLI Demo");
  assert.equal(pathFirstExplain.valid, true);
});
test("CLI exchange-package defaults to DOCX and PDF exports", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-cli-package-default-"));
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "exchange-package",
    workspace,
    "packages/default-exports",
    "Default Exports",
    "Package should include portable exports by default"
  ], {
    cwd: projectRoot
  });
  const result = JSON.parse(stdout);
  assert.deepEqual(result.packageExports.map((entry) => entry.format), ["docx", "pdf"]);
  const packageRoot = path.join(workspace, "packages", "default-exports");
  assert.equal(existsSync(path.join(packageRoot, "exports", "document.docx")), true);
  assert.equal(existsSync(path.join(packageRoot, "exports", "document.pdf")), true);
  const manifest = JSON.parse(await readFile(path.join(packageRoot, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.exports.map((entry) => entry.format), ["docx", "pdf"]);
});