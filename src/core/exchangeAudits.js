import { createId, nowIso } from "./ids.js";
import { readManifest, writeManifest } from "./manifest.js";
import { AppError } from "./errors.js";
export function ensureExchangeAudits(manifest) {
if (!Array.isArray(manifest.exchangeAudits)) {
manifest.exchangeAudits = [];
}
return manifest.exchangeAudits;
}
export async function appendExchangeAudit(workspacePath, input) {
const manifest = await readManifest(workspacePath);
const audits = ensureExchangeAudits(manifest);
const audit = {
id: createId("audit"),
kind: input.kind,
operation: input.operation ?? "",
sourceRef: input.sourceRef ?? "",
apiBaseUrl: input.apiBaseUrl ?? "",
model: input.model ?? "",
contentLength: input.contentLength ?? 0,
contentHash: input.contentHash ?? "",
sendGateDecision: input.sendGateDecision ?? "",
sendGateSignals: input.sendGateSignals ?? [],
estimatedTokens: input.estimatedTokens ?? 0,
sent: Boolean(input.sent),
evidenceId: input.evidenceId ?? "",
createdAt: nowIso()
};
audits.push(audit);
await writeManifest(workspacePath, manifest);
return audit;
}
export async function listExchangeAudits(workspacePath) {
const manifest = await readManifest(workspacePath);
return ensureExchangeAudits(manifest);
}
export async function deleteExchangeAudit(workspacePath, auditId) {
const manifest = await readManifest(workspacePath);
const audits = ensureExchangeAudits(manifest);
const index = audits.findIndex((audit) => audit.id === auditId);
if (index === -1) throw new AppError("exchange_audit_not_found", `Exchange audit not found: ${auditId}`, {
auditId
});
const [deleted] = audits.splice(index, 1);
await writeManifest(workspacePath, manifest);
return deleted;
}
export function renderReceiverReportMarkdown({ manifest, explanation, trustReport }) {
const readiness = explanation.readiness ?? {};
const risks = trustReport.riskSummary?.length
? trustReport.riskSummary
: ["No blocking risk was reported by the local trust checks."];
const actions = trustReport.recommendedActions?.length
? trustReport.recommendedActions
: ["Review the package in Schema Docs before using it with AI or external recipients."];
const sources = explanation.sourceRecords?.length
? explanation.sourceRecords
: [{ id: "unknown", title: "Source provenance is missing.", kind: "unknown", sourceType: "unknown" }];
return [
"# Exchange Package Receiver Report",
"",
"## Package",
"",
`- Title: ${manifest.title ?? "Untitled Exchange"}`,
`- Package type: ${manifest.packageType ?? "unknown"}`,
`- Package version: ${manifest.packageVersion ?? "1.0.0"}`,
`- Created at: ${manifest.createdAt ?? ""}`,
`- Created by: Schema Docs ${manifest.createdByVersion ?? "0.1.1"}`,
"",
"## Verdict",
"",
`- Trust verdict: ${trustReport.verdict}`,
`- AI readiness: ${readiness.ai ?? trustReport.aiReadiness}`,
`- External sharing readiness: ${readiness.external ?? trustReport.externalSharingReadiness}`,
`- Send Gate status: ${readiness.sendGate ?? trustReport.sendGateStatus}`,
`- Sanitization status: ${readiness.sanitization ?? trustReport.sanitizationStatus}`,
`- Source records: ${trustReport.sourceRecordsCount ?? sources.length}`,
"",
"## Source Records",
"",
...sources.map((source) => `- ${source.title || source.id} (${source.kind || "source"} / ${source.sourceType || "unknown"})`),
"",
"## Risks",
"",
...risks.map((risk) => `- ${risk}`),
"",
"## Recommended Actions",
"",
...actions.map((action) => `- ${action}`),
"",
"## Files",
"",
...(explanation.files ?? []).map((file) => `- ${file.path} (${file.bytes} bytes, ${file.hash})`),
"",
"## AI Exposure",
"",
explanation.aiExposureDescription ?? "AI exposure description is not available.",
""
].join("\n");
}
