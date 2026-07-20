import { createHash } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { rowsToCsv, rowsToMarkdownTable } from "./exporters.js";
import { assertInsideRoot, assertSafeWritePath } from "./pathGuard.js";
import { createDocumentCapabilityManifest } from "./capabilityManifest.js";
import { normalizeDocumentFormat } from "./documentExchangeMatrix.js";
import { exportMarkdownToDocx, exportMarkdownToPdf, exportMarkdownToHtml } from "./markdownExportPipeline.js";
import { AppError } from "./errors.js";
import { appendTimelineEvent } from "./timeline.js";
import { renderReceiverReportMarkdown } from "./exchangeAudits.js";
import { buildExchangePackageGuidance, getPackageReadiness } from "./exchangePackageReadiness.js";
function hashBuffer(content) {
return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
async function listFilesRecursive(dir) {
const entries = await readdir(dir, { withFileTypes: true });
const files = await Promise.all(entries.map(async (entry) => {
const resolved = path.resolve(dir, entry.name);
return entry.isDirectory() ? listFilesRecursive(resolved) : resolved;
}));
return files.flat();
}
export function frontMatter(metadata) {
const lines = ["---"];
for (const [key, value] of Object.entries(metadata)) {
if (value === undefined || value === "") continue;
lines.push(`${key}: ${JSON.stringify(value)}`);
}
lines.push("---");
return lines.join("\n");
}
export function createExchangeMarkdown(input) {
const sections = [
frontMatter({
title: input.title ?? "Untitled Exchange",
source: input.source ?? "",
api_base_url: input.apiBaseUrl ?? "",
model: input.model ?? "",
policy_mode: input.policyMode ?? "open-core",
created_at: input.createdAt ?? new Date().toISOString()
}),
"",
`# ${input.title ?? "Untitled Exchange"}`,
"",
input.body ?? ""
];
if (input.queryResult) {
sections.push(
"",
"## Query Result",
"",
rowsToMarkdownTable(input.queryResult.columns ?? [], input.queryResult.rows ?? [])
);
}
if (input.aiResult) {
sections.push(
"",
"## API Result",
"",
input.aiResult
);
}
if (input.audit) {
sections.push(
"",
"## Exchange Audit",
"",
"```json",
JSON.stringify(input.audit, null, 2),
"```"
);
}
if (input.evidence) {
sections.push(
"",
"## Evidence",
"",
"```json",
JSON.stringify(input.evidence, null, 2),
"```"
);
}
return `${sections.join("\n").trimEnd()}\n`;
}
export function createExchangeDocumentSchema() {
return {$schema:"https://json-schema.org/draft/2020-12/schema",$id:"https://schema-docs.local/schemas/markdown-exchange-document.schema.json",title:"Markdown Exchange Document",type:"object",additionalProperties:false,required:["frontmatter","body"],properties:{frontmatter:{type:"object",additionalProperties:true,required:["title","created_at"],properties:{title:{type:"string",minLength:1},source:{type:"string"},api_base_url:{type:"string"},model:{type:"string"},policy_mode:{type:"string",enum:["open-core","team","enterprise"]},created_at:{type:"string"}}},body:{type:"string",minLength:1},sections:{type:"array",items:{type:"object",additionalProperties:false,required:["heading","kind"],properties:{heading:{type:"string",minLength:1},kind:{type:"string",enum:["body","query_result","api_result","audit","evidence","custom"]},sourcePath:{type:"string"},evidenceId:{type:"string"}}}}}};
}
export function parseExchangeMarkdownDocument(markdown) {
const text = String(markdown ?? "");
if (!text.startsWith("---\n")) {
throw new AppError("exchange_document_frontmatter_missing", "Exchange document is m...");
}
const endIndex = text.indexOf("\n---", 4);
if (endIndex === -1) throw new AppError("exchange_document_frontmatter_invalid", "Exchange document fron...");
const frontmatter = {};
const rawFrontmatter = text.slice(4, endIndex).trim();
for (const line of rawFrontmatter.split("\n")) {
const separatorIndex = line.indexOf(":");
if (separatorIndex === -1) continue;
const key = line.slice(0, separatorIndex).trim();
const rawValue = line.slice(separatorIndex + 1).trim();
try {
frontmatter[key] = JSON.parse(rawValue);
} catch {
frontmatter[key] = rawValue;
}
}
const body = text.slice(endIndex + "\n---".length).trim();
const headings = body
.split("\n")
.filter((line) => /^#{1,6}\s+\S/.test(line))
.map((line) => {
const [, marker, title] = /^(#{1,6})\s+(.+)$/.exec(line);
return {
level: marker.length,
title: title.trim()
};
});
if (!frontmatter.title || !body) throw new AppError("exchange_document_schema_invalid", "Exchange document does...", {
hasTitle: Boolean(frontmatter.title),
hasBody: Boolean(body)
});
return {
frontmatter,
headings,
bodyLength: body.length
};
}
export function createExchangePackageManifest(input) {
const capability = createDocumentCapabilityManifest();
const tables = input.packageTables ?? [];
const audit = input.audit ? {
id: input.audit.id ?? "",
kind: input.audit.kind ?? "",
operation: input.audit.operation ?? "",
sourceRef: input.audit.sourceRef ?? "",
contentHash: input.audit.contentHash ?? "",
sendGateDecision: input.audit.sendGateDecision ?? "",
sendGateSignals: input.audit.sendGateSignals ?? [],
estimatedTokens: input.audit.estimatedTokens ?? 0,
evidenceId: input.audit.evidenceId ?? "",
sent: Boolean(input.audit.sent)
} : null;
const evidence = input.evidence ? {
id: input.evidence.id ?? "",
traceId: input.evidence.traceId ?? "",
kind: input.evidence.kind ?? "",
sourceRef: input.evidence.sourceRef ?? "",
inputFileHash: input.evidence.inputFileHash ?? "",
outputArtifactHash: input.evidence.outputArtifactHash ?? "",
sentContentHash: input.evidence.sentContentHash ?? "",
policyDecision: input.evidence.policyDecision ?? "",
policyVersion: input.evidence.policyVersion ?? "",
policyMode: input.evidence.policyMode ?? input.evidence.policySnapshot?.mode ?? "",
policySnapshot: input.evidence.policySnapshot ?? null,
sendGateDecision: input.evidence.sendGateDecision ?? "",
sendGateSignals: input.evidence.sendGateSignals ?? [],
estimatedTokens: input.evidence.estimatedTokens ?? 0,
aiSent: Boolean(input.evidence.aiSent)
} : null;
return {
version: 1,
packageVersion: input.packageVersion ?? "1.0.0",
packageType: "markdown.exchange",
title: input.title ?? "Untitled Exchange",
canonicalDocument: {
path: "document.md",
hash: input.documentHash ?? ""
},
documentSchema: {
path: "document.schema.json",
hash: input.documentSchemaHash ?? ""
},
createdAt: input.createdAt ?? new Date().toISOString(),
source: input.source ?? "",
apiBaseUrl: input.apiBaseUrl ?? "",
model: input.model ?? "",
includes: {
document: true,
evidence: Boolean(input.evidence),
audit: Boolean(input.audit),
queryResult: Boolean(input.queryResult),
aiResult: Boolean(input.aiResult)
},
capability: {
type: capability.capability_type,
name: capability.name,
version: capability.version,
canonicalFormat: capability.output_contract.canonical_format,
exportFormats: capability.output_contract.export_formats,
requiredEvidence: capability.validation.required_evidence
},
tables,
audit,
evidence,
policies: {
policyMode: input.policyMode ?? input.evidence?.policyMode ?? input.evidence?.policySnapshot?.mode ?? "open-core",
openCoreFree: true,
freeUseScope: ["personal", "government", "military", "finance", "ordinary_offline_use"],
enterpriseOnly: [
"dlp_policy_packs",
"send_gate_custom_rules",
"audit_retention",
"private_deployment",
"access_control",
"model_routing",
"compliance_evidence"
],
storesRawPrompt: false,
storesApiKey: false,
defaultNetworkScope: "user_confirmed_ai_endpoint_only"
},
exports: input.packageExports ?? [],
evidenceFile: {
path: "evidence.jsonl",
hash: input.evidenceHash ?? ""
},
tablesDir: "tables",
assetsDir: "assets",
exportsDir: "exports",
sourceRecords: input.sourceRecords ?? [],
conversionQuality: input.conversionQuality ?? [],
aiSendGateSummaries: input.aiSendGateSummaries ?? [],
evidenceHashes: input.evidenceHashes ?? [],
knownLimits: input.knownLimits ?? [],
createdByVersion: "0.1.2"
};
}
async function renderPackageExport(markdown, format) {
if (format === "docx") return exportMarkdownToDocx(markdown);
if (format === "pdf") return exportMarkdownToPdf(markdown);
if (format === "html") return exportMarkdownToHtml(markdown);
return Buffer.from(markdown, "utf8");
}
function isSensitivePackagePath(filePath) {
const base = path.basename(filePath).toLowerCase();
return base === ".env"
|| /\.env$/i.test(base)
|| /(^|[._-])(key|secret|token|credential|credentials)([._-]|$)/i.test(base);
}
const manifestSecretValueRegex = /(?:sk-[a-zA-Z0-9_-]{20,}|key-[a-zA-Z0-9_-]{20,}|Bearer\s+[a-zA-Z0-9._=-]{12,}|(?:AKIA|ASIA|LTAI|AIza)[a-zA-Z0-9_-]{12,}|(?:api[_-]?key|password|token|client[_-]?secret)\s*[:=]\s*[^\s"'`]{8,})/i;
async function readPackageFile(packageRoot, relativePath) {
 const filePath = await assertInsideRoot(path.join(packageRoot, relativePath), packageRoot);
 return {
  path: relativePath,
  absolutePath: filePath,
  content: await readFile(filePath)
 };
}
async function verifyPackageHash(packageRoot, relativePath, expectedHash, label) {
 const file = await readPackageFile(packageRoot, relativePath);
 const actualHash = hashBuffer(file.content);
 if (expectedHash && actualHash !== expectedHash) throw new AppError("exchange_package_hash_mismatch", `Exchange package hash mismatch for ${label}.`, {
   path: relativePath,
   expectedHash,
   actualHash
  });
 return {
  path: relativePath,
  absolutePath: file.absolutePath,
  hash: actualHash,
  bytes: file.content.length
 };
}
export async function readExchangePackage(workspacePath, packageRelativePath) {
 const packageRoot = await assertInsideRoot(path.join(workspacePath, packageRelativePath), workspacePath);
 const manifestFile = await readPackageFile(packageRoot, "manifest.json");
 const manifest = JSON.parse(manifestFile.content.toString("utf8"));
 const requiredKeys = ["packageType", "canonicalDocument", "documentSchema", "createdAt"];
 for (const key of requiredKeys) {
  if (manifest[key] === undefined) throw new AppError("exchange_package_schema_invalid", `Exchange package manifest is missing required property: ${key}`);
 }
 if (manifest.packageType !== "markdown.exchange") throw new AppError("exchange_package_type_invalid", "Directory is not a Mar...", {
   packageType: manifest.packageType
  });
 const files = [];
 const canonicalFile = await verifyPackageHash(
  packageRoot,
  manifest.canonicalDocument?.path ?? "document.md",
  manifest.canonicalDocument?.hash,
  "canonical document"
 );
 files.push(canonicalFile);
 files.push(await verifyPackageHash(
  packageRoot,
  manifest.documentSchema?.path ?? "document.schema.json",
  manifest.documentSchema?.hash,
  "document schema"
 ));
 if (manifest.evidenceFile) {
  const evidencePath = typeof manifest.evidenceFile === "string"
   ? manifest.evidenceFile
   : manifest.evidenceFile.path;
  const evidenceHash = typeof manifest.evidenceFile === "string"
   ? ""
   : manifest.evidenceFile.hash;
  files.push(await verifyPackageHash(packageRoot, evidencePath, evidenceHash, "evidence log"));
 }
 for (const table of manifest.tables ?? []) {
  for (const format of table.formats ?? []) {
   files.push(await verifyPackageHash(packageRoot, format.path, format.hash, `table ${table.id ?? format.path}`));
  }
 }
 for (const entry of manifest.exports ?? []) {
  files.push(await verifyPackageHash(packageRoot, entry.path, entry.hash, `export ${entry.format ?? entry.path}`));
 }
 const canonicalContent = await readFile(canonicalFile.absolutePath, "utf8");
 await appendTimelineEvent(workspacePath, packageRelativePath, "exchange_package", `Read and verified exchange package at "${packageRelativePath}"`, {
  artifactPath: packageRoot
 });
 return {
  packageRoot,
  manifest,
  document: parseExchangeMarkdownDocument(canonicalContent),
  files,
  valid: true
 };
}
export async function writeExchangePackage(workspacePath, packageRelativePath, input) {
 const packageRoot = await assertSafeWritePath(path.join(workspacePath, packageRelativePath), workspacePath);
 await mkdir(packageRoot, { recursive: true });
 await mkdir(path.join(packageRoot, "exports"), { recursive: true });
 await mkdir(path.join(packageRoot, "tables"), { recursive: true });
 await mkdir(path.join(packageRoot, "assets"), { recursive: true });
 const markdown = createExchangeMarkdown(input);
 const documentSchema = `${JSON.stringify(createExchangeDocumentSchema(), null, 2)}\n`;
 const evidenceLines = input.evidence ? `${JSON.stringify(input.evidence)}\n` : "";
 const documentHash = hashBuffer(Buffer.from(markdown, "utf8"));
 const documentSchemaHash = hashBuffer(Buffer.from(documentSchema, "utf8"));
 const evidenceHash = hashBuffer(Buffer.from(evidenceLines, "utf8"));
 const packageExports = [];
 const packageTables = [];
 const documentPath = await assertSafeWritePath(path.join(packageRoot, "document.md"), workspacePath, [".md"]);
 const documentSchemaPath = await assertSafeWritePath(path.join(packageRoot, "document.schema.json"), workspacePath, [".json"]);
 const manifestPath = await assertSafeWritePath(path.join(packageRoot, "manifest.json"), workspacePath, [".json"]);
 const evidencePath = await assertSafeWritePath(path.join(packageRoot, "evidence.jsonl"), workspacePath, [".jsonl"]);
 const queryCsvPath = input.queryResult
  ? await assertSafeWritePath(path.join(packageRoot, "tables", "query_result.csv"), workspacePath, [".csv"])
  : "";
 const queryMarkdownPath = input.queryResult
  ? await assertSafeWritePath(path.join(packageRoot, "tables", "query_result.md"), workspacePath, [".md"])
  : "";
 await writeFile(documentPath, markdown, "utf8");
 await writeFile(documentSchemaPath, documentSchema, "utf8");
 await writeFile(evidencePath, evidenceLines, "utf8");
 if (input.queryResult) {
  const columns = input.queryResult.columns ?? [];
  const rows = input.queryResult.rows ?? [];
  const csvContent = rowsToCsv(columns, rows);
  const markdownTableContent = `${rowsToMarkdownTable(columns, rows)}\n`;
  await writeFile(queryCsvPath, csvContent, "utf8");
  await writeFile(queryMarkdownPath, markdownTableContent, "utf8");
  packageTables.push({
   id: "query_result",
   title: "Query Result",
   formats: [
    { format: "csv", path: "tables/query_result.csv", hash: hashBuffer(Buffer.from(csvContent, "utf8")) },
    { format: "markdown", path: "tables/query_result.md", hash: hashBuffer(Buffer.from(markdownTableContent, "utf8")) }
   ],
   columns,
   rowCount: rows.length
  });
 }
 for (const requestedFormat of input.exportFormats ?? []) {
  const format = normalizeDocumentFormat(requestedFormat);
  const exportPath = format === "md"
   ? documentPath
   : await assertSafeWritePath(path.join(packageRoot, "exports", `document.${format}`), workspacePath, [`.${format}`]);
  const rendered = await renderPackageExport(markdown, format);
  if (format !== "md") {
   await writeFile(exportPath, rendered);
  }
  packageExports.push({
   format,
   path: format === "md" ? "document.md" : `exports/document.${format}`,
   hash: hashBuffer(rendered)
  });
 }
 const manifest = createExchangePackageManifest({
  ...input,
  documentHash,
  documentSchemaHash,
  evidenceHash,
  packageTables,
  packageExports
 });
 await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
 await appendTimelineEvent(workspacePath, packageRelativePath, "exchange_package", `Created exchange package at "${packageRelativePath}"`, {
  artifactPath: packageRoot
 });
 return {
  packageRoot,
  documentPath,
  documentSchemaPath,
  manifestPath,
  evidencePath,
  queryCsvPath,
  queryMarkdownPath,
  packageExports,
  exportsDir: path.join(packageRoot, "exports"),
  tablesDir: path.join(packageRoot, "tables"),
  assetsDir: path.join(packageRoot, "assets")
 };
}
export async function explainExchangePackage(workspacePath, packageRelativePath) {
 const pkg = await readExchangePackage(workspacePath, packageRelativePath);
 const m = pkg.manifest;
 const filesSummary = pkg.files.map(f => ({
  path: f.path,
  bytes: f.bytes,
  hash: f.hash,
  verified: true
 }));
 const readinessState = getPackageReadiness(pkg, m.policies?.storesApiKey === false ? "pass" : "warning");
 const sourceRecords = readinessState.sourceRecords;
 const aiSendGateSummaries = m.aiSendGateSummaries || [];
 const { qualityStatus, sendGateStatus, markdownReadiness } = readinessState;
 const sanitizationReadiness = readinessState.sanitizationStatus;
 const aiReadiness = markdownReadiness === "pass" && qualityStatus === "pass" && sendGateStatus !== "fail" ? "pass" : "warning";
 const externalReadiness = sanitizationReadiness === "pass" ? "pass" : "warning";
 const guidance = buildExchangePackageGuidance({
  sourceProvenance: readinessState.sourceProvenance,
  markdownAvailability: readinessState.markdownAvailability,
  auditTrailCompleteness: readinessState.auditTrailCompleteness,
  qualityStatus,
  knownLimitStatus: readinessState.knownLimitStatus,
  sanitizationStatus: sanitizationReadiness,
  sendGateStatus
 });
 const receiverVerdict = sendGateStatus === "fail"
  ? "blocked"
  : guidance.riskSummary.length > 0
   ? "trusted_with_warnings"
   : "trusted";
 return {
  title: m.title ?? "Untitled Exchange",
  packageType: m.packageType,
  createdAt: m.createdAt,
  source: m.source || "N/A",
  apiBaseUrl: m.apiBaseUrl || "N/A",
  model: m.model || "N/A",
  capability: m.capability ? {
   name: m.capability.name,
   type: m.capability.type,
   version: m.capability.version,
   canonicalFormat: m.capability.canonicalFormat,
   exportFormats: m.capability.exportFormats,
   requiredEvidence: m.capability.requiredEvidence
  } : null,
  includes: m.includes || {},
  tables: (m.tables || []).map(t => ({
   id: t.id,
   title: t.title,
   rowCount: t.rowCount,
   formats: (t.formats || []).map(f => f.format)
  })),
  exports: (m.exports || []).map(e => e.format),
  exportsCount: (m.exports || []).length,
  knownLimitsCount: (m.knownLimits || []).length,
  policies: m.policies || {},
  files: filesSummary,
  valid: pkg.valid,
  createdByVersion: m.createdByVersion || "0.1.2",
  aiExposureDescription: "AI will see the frontmatter metadata (title, model, source), the complete markdown content of document.md, and any query result tables.",
  sanitizationStatus: m.policies?.storesApiKey === false ? "Active (API keys and sensitive tokens redacted)" : "Inactive",
  rawVsMarkdownMapping: {
   fromRaw: sourceRecords,
   fromMarkdown: ["title", "body", "headings"]
  },
  qualityRisks: m.conversionQuality || [],
  sourceRecords,
  aiSendGateSummaries,
  readiness: {
   provenance: sourceRecords.length > 0 ? "pass" : "missing",
   markdown: markdownReadiness,
   quality: qualityStatus,
   sendGate: sendGateStatus,
   sanitization: sanitizationReadiness,
   ai: aiReadiness,
   external: externalReadiness
  },
  receiverSummary: {
   verdict: receiverVerdict,
   sourceRecordCount: sourceRecords.length,
   sendGateSummaryCount: aiSendGateSummaries.length,
   riskCount: guidance.riskSummary.length
  },
  riskSummary: guidance.riskSummary,
  recommendedActions: guidance.recommendedActions,
  suitableForAi: qualityStatus === "pass" && sendGateStatus !== "fail",
  suitableForExternal: m.policies?.storesApiKey === false && sendGateStatus !== "fail"
 };
}
export async function verifyExchangePackage(workspacePath, packageRelativePath) {
 const pkg = await readExchangePackage(workspacePath, packageRelativePath);
 const m = pkg.manifest;
 if (!m.packageVersion || !m.packageType || !m.canonicalDocument || !m.documentSchema) throw new AppError("exchange_package_incomplete", "Exchange package manif...");
 const hasMarkdown = pkg.files.some(f => f.path === "document.md");
 if (!hasMarkdown) throw new AppError("exchange_package_missing_markdown", "Exchange package docum...");
 if (m.includes?.audit && !m.audit) throw new AppError("exchange_package_missing_audit", "Exchange package audit...");
 let allPackageFiles = [];
 try {
  allPackageFiles = await listFilesRecursive(pkg.packageRoot);
 } catch {}
 const hasRawSensitiveFile = [...pkg.files.map(f => f.path), ...allPackageFiles].some(isSensitivePackagePath);
 if (hasRawSensitiveFile) throw new AppError("exchange_package_unsafe_raw_file", "Exchange package contains unsafe raw source files");
 if (m.version !== 1) throw new AppError("exchange_package_schema_version_mismatch", "Exchange package schem...");
 return {
  ok: true,
  manifestComplete: true,
  hasMarkdown: true,
  hasAuditTrail: !!m.audit,
  hasQualityReport: (m.conversionQuality || []).length > 0,
  noRawSensitiveFiles: !hasRawSensitiveFile,
  apiConsumptionReady: true,
  schemaVersion: m.version
 };
}
export async function generateTrustReport(workspacePath, packageRelativePath) {
 let pkg;
 try {
  pkg = await readExchangePackage(workspacePath, packageRelativePath);
 } catch (err) {
  return {
   packageIntegrity: "fail",
   sourceProvenance: "fail",
   markdownAvailability: false,
   auditTrailCompleteness: "fail",
   qualityStatus: "fail",
   knownLimitStatus: [],
   sanitizationStatus: "fail",
   sendGateStatus: "fail",
   aiReadiness: "fail",
   externalSharingReadiness: "fail",
   sourceRecordsCount: 0,
   aiSendGateSummaryCount: 0,
   riskSummary: ["Package hashes or manifest validation failed."],
   recommendedActions: ["Reject the package and ask the sender to regenerate it."],
   verdict: "blocked",
   reason: err.message
  };
 }
 const m = pkg.manifest;
 let packageIntegrity = "pass";
 if (!pkg.valid) {
  packageIntegrity = "fail";
 }
 let allAbsoluteFiles = [];
 try {
  allAbsoluteFiles = await listFilesRecursive(pkg.packageRoot);
 } catch {}
 const hasRawSensitiveFile = allAbsoluteFiles.some(isSensitivePackagePath);
 const hasSecretInManifest = manifestSecretValueRegex.test(JSON.stringify(m));
 const sanitizationStatus = (hasRawSensitiveFile || hasSecretInManifest) ? "fail" : "pass";
 const readinessState = getPackageReadiness(pkg, sanitizationStatus);
 const {
  sourceProvenance,
  markdownAvailability,
  auditTrailCompleteness,
  qualityStatus,
  knownLimitStatus,
  sendGateStatus,
  hasLowConfidence
 } = readinessState;
 const aiReadiness = (markdownAvailability && !hasLowConfidence && sendGateStatus !== "fail") ? "pass" : "warning";
 const externalSharingReadiness = (sanitizationStatus === "pass" && packageIntegrity === "pass" && sendGateStatus !== "fail") ? "pass" : "fail";
 const guidance = buildExchangePackageGuidance({
  packageIntegrity,
  sourceProvenance,
  markdownAvailability,
  auditTrailCompleteness,
  qualityStatus,
  knownLimitStatus,
  sanitizationStatus,
  sendGateStatus
 });
 let verdict = "trusted";
 if (packageIntegrity === "fail" || sanitizationStatus === "fail" || sendGateStatus === "fail" || m.version !== 1) {
  verdict = "blocked";
 } else if (qualityStatus === "warning" || auditTrailCompleteness === "fail" || sourceProvenance === "fail" || sendGateStatus !== "pass" || knownLimitStatus.length > 0) {
  verdict = "trusted_with_warnings";
 }
 return {
  packageIntegrity,
  sourceProvenance,
  markdownAvailability,
  auditTrailCompleteness,
  qualityStatus,
  knownLimitStatus,
  sanitizationStatus,
  sendGateStatus,
  aiReadiness,
  externalSharingReadiness,
  sourceRecordsCount: (m.sourceRecords || []).length,
  aiSendGateSummaryCount: (m.aiSendGateSummaries || []).length,
  riskSummary: guidance.riskSummary,
  recommendedActions: guidance.recommendedActions,
  verdict
 };
}
export async function writeExchangePackageReceiverReport(workspacePath, packageRelativePath) {
 const pkg = await readExchangePackage(workspacePath, packageRelativePath);
 const explanation = await explainExchangePackage(workspacePath, packageRelativePath);
 const trustReport = await generateTrustReport(workspacePath, packageRelativePath);
 const reportJson = {
  generatedAt: new Date().toISOString(),
  packageRelativePath,
  title: pkg.manifest.title,
  explanation,
  trustReport
 };
 const reportMarkdown = renderReceiverReportMarkdown({
  manifest: pkg.manifest,
  explanation,
  trustReport
 });
 const jsonPath = await assertSafeWritePath(path.join(pkg.packageRoot, "trust-report.json"), workspacePath, [".json"]);
 const markdownPath = await assertSafeWritePath(path.join(pkg.packageRoot, "receiver-report.md"), workspacePath, [".md"]);
 const jsonContent = `${JSON.stringify(reportJson, null, 2)}\n`;
 const markdownContent = `${reportMarkdown.trimEnd()}\n`;
 await writeFile(jsonPath, jsonContent, "utf8");
 await writeFile(markdownPath, markdownContent, "utf8");
 await appendTimelineEvent(workspacePath, packageRelativePath, "exchange_package", `Wrote receiver report for exchange package "${packageRelativePath}"`, {
  artifactPath: pkg.packageRoot
 });
 return {
  packageRoot: pkg.packageRoot,
  packageRelativePath,
  markdownPath,
  jsonPath,
  markdownHash: hashBuffer(Buffer.from(markdownContent, "utf8")),
  jsonHash: hashBuffer(Buffer.from(jsonContent, "utf8")),
  verdict: trustReport.verdict,
  riskCount: trustReport.riskSummary?.length ?? 0
 };
}
