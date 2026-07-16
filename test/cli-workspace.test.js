import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { cliPath, execFileAsync, projectRoot } from "./helpers/cliHarness.js";
import { markdownToDocxBuffer } from "../src/adapters/markdownDocxExporter.js";
test("CLI search command scans workspace markdown files", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-cli-search-"));
  await execFileAsync(process.execPath, [cliPath, "init", workspace], { cwd: projectRoot });
  await execFileAsync(process.execPath, [
    cliPath,
    "note",
    workspace,
    "notes/searchable.md",
    "This is a note with unique_cli_search_term keyword."
  ], { cwd: projectRoot });
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "search",
    workspace,
    "unique_cli_search_term"
  ], { cwd: projectRoot });
  const result = JSON.parse(stdout);
  assert.equal(result.length, 1);
  assert.equal(result[0].fileName, "searchable.md");
  assert.equal(result[0].matchesCount, 1);
  assert.equal(result[0].hits[0].lineContent, "This is a note with unique_cli_search_term keyword.");
});
test("CLI ai-preview supports local PII masking", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-cli-mask-"));
  await execFileAsync(process.execPath, [cliPath, "init", workspace], { cwd: projectRoot });
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "ai-preview",
    workspace,
    "summarize",
    "--mask",
    "Please check email test@example.com and token sk-abc123xyz for secrets."
  ], { cwd: projectRoot });
  const result = JSON.parse(stdout);
  assert.equal(result.status, "succeeded");
  assert.ok(result.output.preview.includes("[MASK_EMAIL_1]"));
  assert.ok(result.output.preview.includes("[MASK_SECRET_1]"));
  assert.equal(result.output.preview.includes("sk-abc123xyz"), false);
  assert.equal(result.maskMapping["[MASK_EMAIL_1]"], "test@example.com");
  assert.equal(result.maskMapping["[MASK_SECRET_1]"], "sk-abc123xyz");
});
test("CLI adapter-capabilities reports optional system adapter boundary", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-cli-adapters-"));
  await execFileAsync(process.execPath, [cliPath, "init", workspace], { cwd: projectRoot });
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "adapter-capabilities",
    workspace
  ], { cwd: projectRoot });
  const result = JSON.parse(stdout);
  assert.equal(result.soffice.required, false);
  assert.equal(result.pandoc.mode, "optional-system-adapter");
  assert.equal(result.tesseract.name, "Tesseract OCR");
  assert.equal(typeof result.tesseract.available, "boolean");
});
test("CLI import resolves missing relative source paths inside workspace", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-cli-import-relative-"));
  await execFileAsync(process.execPath, [cliPath, "init", workspace], { cwd: projectRoot });
  await writeFile(path.join(workspace, "workspace-doc.docx"), markdownToDocxBuffer("# Workspace Relative\n\nImport me."));
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "import",
    workspace,
    "workspace-doc.docx"
  ], { cwd: projectRoot });
  const result = JSON.parse(stdout);
  assert.equal(result.sourceType, "docx");
  assert.equal(result.title, "workspace-doc");
});
test("CLI commands for inbox, timeline, versions, settings, and real samples work", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-cli-new-commands-"));
  await execFileAsync(process.execPath, [cliPath, "init", workspace], { cwd: projectRoot });
  const { stdout: getSettings } = await execFileAsync(process.execPath, [cliPath, "settings", workspace, "get"], { cwd: projectRoot });
  const settingsData = JSON.parse(getSettings);
  assert.equal(settingsData.defaultQueryLimit, 500);
  assert.equal(settingsData.policyMode, "open-core");
  const { stdout: setSettings } = await execFileAsync(process.execPath, [cliPath, "settings", workspace, "set", "defaultQueryLimit", "200"], { cwd: projectRoot });
  assert.equal(JSON.parse(setSettings).defaultQueryLimit, 200);
  const { stdout: setPolicyMode } = await execFileAsync(process.execPath, [cliPath, "settings", workspace, "set", "policyMode", "team"], { cwd: projectRoot });
  assert.equal(JSON.parse(setPolicyMode).policyMode, "team");
  const { stdout: getInbox } = await execFileAsync(process.execPath, [cliPath, "inbox", workspace, "list"], { cwd: projectRoot });
  assert.ok(Array.isArray(JSON.parse(getInbox)));
  const docPath = path.join(workspace, "test-cli-doc.txt");
  await writeFile(docPath, "Hello from CLI inbox test", "utf8");
  const { stdout: importRes } = await execFileAsync(process.execPath, [cliPath, "import", workspace, docPath], { cwd: projectRoot });
  const docId = JSON.parse(importRes).id;
  const { stdout: inboxWithDoc } = await execFileAsync(process.execPath, [cliPath, "inbox", workspace, "list"], { cwd: projectRoot });
  const itemId = JSON.parse(inboxWithDoc)[0].id;
  const { stdout: archiveRes } = await execFileAsync(process.execPath, [cliPath, "inbox", workspace, "archive", itemId], { cwd: projectRoot });
  assert.equal(JSON.parse(archiveRes).status, "archived");
  const { stdout: unarchiveRes } = await execFileAsync(process.execPath, [cliPath, "inbox", workspace, "unarchive", itemId], { cwd: projectRoot });
  assert.equal(JSON.parse(unarchiveRes).status, "imported");
  const { stdout: recsRes } = await execFileAsync(process.execPath, [cliPath, "inbox", workspace, "recommendations", itemId], { cwd: projectRoot });
  assert.ok(Array.isArray(JSON.parse(recsRes).recommendedActions));
  const { stdout: timelineAll } = await execFileAsync(process.execPath, [cliPath, "timeline", workspace], { cwd: projectRoot });
  assert.ok(JSON.parse(timelineAll).length > 0);
  const { stdout: timelineSpecific } = await execFileAsync(process.execPath, [cliPath, "timeline", workspace, docId], { cwd: projectRoot });
  assert.ok(JSON.parse(timelineSpecific).length > 0);
  await execFileAsync(process.execPath, [cliPath, "convert-text", workspace, docId], { cwd: projectRoot });
  const { stdout: versionsList } = await execFileAsync(process.execPath, [cliPath, "versions", workspace, "list", "outputs/test-cli-doc.md"], { cwd: projectRoot });
  const versions = JSON.parse(versionsList);
  assert.ok(versions.length > 0);
  const { stdout: allVersionsList } = await execFileAsync(process.execPath, [cliPath, "versions", workspace, "all"], { cwd: projectRoot });
  assert.ok(JSON.parse(allVersionsList).some((version) => version.path === "outputs/test-cli-doc.md"));
  const { stdout: versionsListShorthand } = await execFileAsync(process.execPath, [cliPath, "versions", workspace, "outputs/test-cli-doc.md"], { cwd: projectRoot });
  assert.deepEqual(JSON.parse(versionsListShorthand), versions);
  const { stdout: promoteRes } = await execFileAsync(process.execPath, [cliPath, "versions", workspace, "promote", "outputs/test-cli-doc.md", versions[0].id], { cwd: projectRoot });
  assert.ok(JSON.parse(promoteRes).id);
  await writeFile(path.join(workspace, "diff-a.md"), "A", "utf8");
  await writeFile(path.join(workspace, "diff-b.md"), "B", "utf8");
  const { stdout: diffRes } = await execFileAsync(process.execPath, [cliPath, "versions", workspace, "diff", "diff-a.md", "diff-b.md"], { cwd: projectRoot });
  assert.equal(JSON.parse(diffRes).different, true);
  const { stdout: sampleCheck } = await execFileAsync(process.execPath, [cliPath, "real-sample-check", workspace, "--report-only"], { cwd: projectRoot });
  const sampleSummary = JSON.parse(sampleCheck);
  assert.equal(sampleSummary.total, 20);
  assert.ok(sampleSummary.capabilityCoverage.ai_intake >= 7);
  assert.ok(sampleSummary.capabilityCoverage.safety_gate >= 5);
  assert.ok(sampleSummary.capabilityCoverage.format_exchange >= 7);
  assert.equal(sampleSummary.missingCapabilitySamples.length, 0);
  const { stdout: sampleReportCheck } = await execFileAsync(process.execPath, [cliPath, "real-sample-check", workspace], { cwd: projectRoot });
  const sampleReport = JSON.parse(sampleReportCheck);
  assert.match(sampleReport.reportPath, /real-sample-report\.md$/);
  assert.ok(sampleReport.report.bytes > 0);
  assert.match(await readFile(sampleReport.reportPath, "utf8"), /Capabilities/);
  const { stdout: workspaceSummary } = await execFileAsync(process.execPath, [cliPath, "workspace", workspace, "summary"], { cwd: projectRoot });
  assert.match(workspaceSummary, /Workspace Summary:/);
  assert.match(workspaceSummary, /Recent AI Context Selections/);
  assert.match(workspaceSummary, /Recent AI Handoff Bundles/);
  const { stdout: workspaceSummaryShort } = await execFileAsync(process.execPath, [cliPath, "workspace", "summary"], { cwd: workspace });
  assert.match(workspaceSummaryShort, /Workspace Summary:/);
  assert.match(workspaceSummaryShort, /Recent Refreshes/);
  const { stdout: exportManifestRes } = await execFileAsync(process.execPath, [cliPath, "workspace", workspace, "export-manifest"], { cwd: projectRoot });
  const exportManifestData = JSON.parse(exportManifestRes);
  assert.equal(exportManifestData.ok, true);
  assert.match(await readFile(exportManifestData.exportedPath, "utf8"), /"workspaceId"/);
});
test("CLI mask and unmask commands", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-cli-mask-"));
  await execFileAsync(process.execPath, [cliPath, "init", workspace], { cwd: projectRoot });
  const rawText = "My email is developer@example.com and my secret is token: 1234-abcd";
  const { stdout: maskRes } = await execFileAsync(process.execPath, [cliPath, "mask", workspace, rawText], { cwd: projectRoot });
  const maskData = JSON.parse(maskRes);
  assert.ok(maskData.maskedText.includes("[MASK_EMAIL_1]"));
  assert.ok(maskData.maskedText.includes("[MASK_SECRET_1]"));
  const { stdout: unmaskRes } = await execFileAsync(process.execPath, [
    cliPath,
    "unmask",
    workspace,
    maskData.maskedText,
    JSON.stringify(maskData.mapping)
  ], { cwd: projectRoot });
  assert.equal(JSON.parse(unmaskRes).unmaskedText, rawText);
});