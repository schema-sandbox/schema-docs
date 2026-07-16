import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openOrCreateWorkspace } from "../core/manifest.js";
import { saveMarkdown, readMarkdown } from "../core/markdown.js";
import { importFileToWorkspace } from "../core/records.js";
import { inspectDatasetAsJob } from "../core/datasets.js";
import { csvImporter } from "../adapters/csvImporter.js";
import { listJobs } from "../core/jobs.js";
import { createMemoryQueryEngine, tableNameForDataset } from "../adapters/memoryQueryEngine.js";
import { runQueryAsJob } from "../core/queries.js";
import { previewAiPayloadAsJob } from "../core/ai.js";
import { convertDocumentToMarkdownAsJob } from "../core/documents.js";
import { textMarkdownConverter } from "../adapters/textMarkdownConverter.js";
import { pdfMarkdownConverter } from "../adapters/pdfMarkdownConverter.js";
import { readManifest } from "../core/manifest.js";
import { deleteApiProfile, listApiProfiles, saveApiProfile } from "../core/apiProfiles.js";
import { deleteExchangeAudit, listExchangeAudits } from "../core/exchangeAudits.js";
import { exportMarkdownDocument } from "../core/documentExports.js";
import { createAppService } from "../core/appService.js";

const workspace = await mkdtemp(path.join(os.tmpdir(), "ai-doc-exchange-"));
const service = createAppService(workspace);
const manifest = await openOrCreateWorkspace(workspace);
const capabilityManifest = service.getDocumentCapabilityManifest();
await saveMarkdown(workspace, path.join("notes", "hello.md"), "# Hello\n\nAI document exchange smoke test.\n");
const content = await readMarkdown(workspace, path.join("notes", "hello.md"));

const sampleCsv = path.join(workspace, "sample.csv");
await writeFile(sampleCsv, "name,value\nalpha,1\n", "utf8");
const imported = await importFileToWorkspace(workspace, sampleCsv);
const job = await inspectDatasetAsJob(workspace, imported.id, csvImporter);
const manifestAfterDataset = await readManifest(workspace);
const dataset = manifestAfterDataset.datasets.find((candidate) => candidate.id === imported.id);
const tableName = tableNameForDataset(dataset);
const queryJob = await runQueryAsJob(workspace, `select name,value from ${tableName} limit 1`, createMemoryQueryEngine);
const aiPreviewJob = await previewAiPayloadAsJob(workspace, {
  operation: "summarize",
  content: "alpha beta",
  sourceRef: "smoke"
});
const profile = await saveApiProfile(workspace, {
  name: "smoke",
  apiBaseUrl: "https://api.example.test/v1",
  model: "model-a"
});
const profilesBeforeDelete = await listApiProfiles(workspace);
await deleteApiProfile(workspace, profile.id);
const profilesAfterDelete = await listApiProfiles(workspace);

const sampleText = path.join(workspace, "sample.txt");
await writeFile(sampleText, "plain text document\n", "utf8");
const importedText = await importFileToWorkspace(workspace, sampleText);
const textJob = await convertDocumentToMarkdownAsJob(workspace, importedText.id, textMarkdownConverter);
const exportedDocx = await exportMarkdownDocument(workspace, path.join("notes", "hello.md"), path.join("exports", "hello.docx"), "docx");
const exportedPdf = await exportMarkdownDocument(workspace, path.join("notes", "hello.md"), path.join("exports", "hello.pdf"), "pdf");
const importedPdf = await importFileToWorkspace(workspace, exportedPdf);
const pdfJob = await convertDocumentToMarkdownAsJob(workspace, importedPdf.id, pdfMarkdownConverter);
const pdfToDocx = await service.convertDocumentToFormat(importedPdf.id, path.join("exports", "pdf-to-docx.docx"), "docx");
const conversionAudits = await service.listConversionAudits();
const evidenceRecords = await service.listEvidenceRecords();
const exchangeMarkdown = await service.createExchangeMarkdown({
  title: "Smoke Exchange",
  body: "Markdown is the center.",
  queryResult: queryJob.output,
  aiResult: aiPreviewJob.output.preview,
  auditId: aiPreviewJob.output.auditId
});
const exchangePackage = await service.saveExchangePackage(path.join("packages", "smoke"), {
  title: "Smoke Package",
  body: "Markdown exchange package.",
  queryResult: queryJob.output,
  exportFormats: ["docx", "pdf"],
  auditId: aiPreviewJob.output.auditId
});
const exchangePackageRead = await service.readExchangePackage(path.join("packages", "smoke"));
const receiverReport = await service.writeExchangePackageReceiverReport(path.join("packages", "smoke"));
const auditsBeforeDelete = await listExchangeAudits(workspace);
await deleteExchangeAudit(workspace, aiPreviewJob.output.auditId);
const auditsAfterDelete = await listExchangeAudits(workspace);
const jobs = await listJobs(workspace);

const result = {
  workspace,
  workspaceId: manifest.workspaceId,
  capabilityManifestOk: capabilityManifest.capability_type === "document.exchange" && capabilityManifest.validation.stores_api_key === false && capabilityManifest.api_contract.semantic_routes.includes("POST /api/normalize") && capabilityManifest.api_contract.semantic_routes.includes("POST /api/exchange/package/read") && capabilityManifest.api_contract.routes.some((route) => route.path === "/api/ai/preview") && capabilityManifest.api_contract.routes.some((route) => route.path === "/api/ai/intake-plan") && capabilityManifest.api_contract.routes.some((route) => route.path === "/api/ai/context-chunk"),
  markdownOk: content.includes("Hello"),
  importedType: imported.sourceType,
  importedStatus: imported.status,
  jobStatus: job.status,
  queryStatus: queryJob.status,
  queryRows: queryJob.output.rows.length,
  aiPreviewStatus: aiPreviewJob.status,
  textConvertStatus: textJob.status,
  pdfConvertStatus: pdfJob.status,
  docxExportOk: exportedDocx.endsWith(".docx"),
  pdfExportOk: exportedPdf.endsWith(".pdf"),
  directDocumentExportOk: pdfToDocx.outputPath.endsWith(".docx"),
  conversionAuditOk: conversionAudits.some((audit) => audit.id === textJob.output.auditId && audit.targetFormat === "md")
    && conversionAudits.some((audit) => audit.id === pdfJob.output.auditId && audit.targetFormat === "md")
    && conversionAudits.some((audit) => audit.id === pdfToDocx.auditId && audit.targetFormat === "docx"),
  evidenceOk: evidenceRecords.some((record) => record.id === pdfToDocx.evidenceId && record.outputArtifactHash.startsWith("sha256:")),
  exchangeMarkdownOk: exchangeMarkdown.includes("## Query Result") && exchangeMarkdown.includes("## API Result") && exchangeMarkdown.includes("## Evidence"),
  exchangePackageOk: exchangePackage.documentPath.endsWith("document.md") && exchangePackage.manifestPath.endsWith("manifest.json") && exchangePackage.evidencePath.endsWith("evidence.jsonl") && exchangePackage.queryCsvPath.endsWith("query_result.csv") && exchangePackage.queryMarkdownPath.endsWith("query_result.md") && exchangePackage.packageExports.length === 2,
  exchangePackageReadOk: exchangePackageRead.valid && exchangePackageRead.files.some((file) => file.path === "document.schema.json") && exchangePackageRead.files.some((file) => file.path === "evidence.jsonl" && file.hash.startsWith("sha256:")) && exchangePackageRead.files.some((file) => file.path === "exports/document.pdf"),
  receiverReportOk: receiverReport.markdownPath.endsWith("receiver-report.md") && receiverReport.jsonPath.endsWith("trust-report.json") && receiverReport.markdownHash.startsWith("sha256:") && receiverReport.jsonHash.startsWith("sha256:"),
  profileDeleteOk: profilesBeforeDelete.length === 1 && profilesAfterDelete.length === 0,
  auditDeleteOk: auditsBeforeDelete.length === 1 && auditsAfterDelete.length === 0,
  jobCount: jobs.length
};

const requiredChecks = [
  "capabilityManifestOk",
  "markdownOk",
  "docxExportOk",
  "pdfExportOk",
  "directDocumentExportOk",
  "conversionAuditOk",
  "evidenceOk",
  "exchangeMarkdownOk",
  "exchangePackageOk",
  "exchangePackageReadOk",
  "receiverReportOk",
  "profileDeleteOk",
  "auditDeleteOk"
];
const failedChecks = requiredChecks.filter((check) => result[check] !== true);

console.log(JSON.stringify({
  ...result,
  ok: failedChecks.length === 0,
  failedChecks
}, null, 2));

if (failedChecks.length > 0) {
  process.exitCode = 1;
}
