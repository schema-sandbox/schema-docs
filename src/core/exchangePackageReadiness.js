function summarizeSourceRecord(record) {
return {
id: record.id ?? "",
kind: record.kind ?? "",
title: record.title ?? record.name ?? "",
sourceType: record.sourceType ?? "",
status: record.status ?? "",
outputMarkdownPath: record.outputMarkdownPath ?? "",
rowCountEstimate: record.rowCountEstimate ?? null
};
}
function normalizeSendGateDecision(decision) {
return String(decision ?? "").trim().toLowerCase();
}
export function summarizeSendGate(summaries) {
const decisions = (summaries ?? []).map((summary) => normalizeSendGateDecision(summary.decision));
if (decisions.some((decision) => ["blocked", "never_send", "review_required"].includes(decision))) {
return "fail";
}
if (decisions.some((decision) => ["review", "review_recommended"].includes(decision))) {
return "warning";
}
return decisions.length > 0 ? "pass" : "unknown";
}
export function buildExchangePackageGuidance({
packageIntegrity = "pass",
sourceProvenance = "pass",
markdownAvailability = true,
auditTrailCompleteness = "pass",
qualityStatus = "pass",
knownLimitStatus = [],
sanitizationStatus = "pass",
sendGateStatus = "unknown"
}) {
const riskSummary = [];
const recommendedActions = [];
const addRisk = (risk, action) => {
riskSummary.push(risk);
recommendedActions.push(action);
};
if (packageIntegrity !== "pass") {
addRisk("Package hashes or manifest validation failed.", "Reject the package and ask the sender to regenerate it.");
}
if (sourceProvenance !== "pass") {
addRisk("Source record provenance is missing.", "Verify the source file before accepting the package.");
}
if (!markdownAvailability) {
addRisk("Canonical document.md is missing or empty.", "Regenerate the package with a non-empty Markdown document.");
}
if (auditTrailCompleteness !== "pass") {
addRisk("Audit trail is missing.", "Keep this package as preview-only until audit evidence is attached.");
}
if (qualityStatus === "warning") {
addRisk("One or more conversions have low-confidence extraction quality.", "Review the Markdown before sending it to AI or exporting it externally.");
}
if ((knownLimitStatus ?? []).length > 0) {
addRisk("Known format limits are declared for this package.", "Inspect knownLimits before relying on tables, images, formulas, or layout-sensitive content.");
}
if (sanitizationStatus !== "pass") {
addRisk("Sensitive raw files or credential-like values were detected.", "Do not share externally until the sensitive content is removed.");
}
if (sendGateStatus === "fail") {
addRisk("AI Send Gate marked this content as blocked or requiring review.", "Do not send to AI until Send Gate issues are resolved.");
} else if (sendGateStatus === "warning") {
addRisk("AI Send Gate recommends human review.", "Review the AI preview before confirming a send.");
} else if (sendGateStatus === "unknown") {
addRisk("No AI Send Gate summary is attached.", "Run AI preparation or preview before using this package with a model.");
}
if (recommendedActions.length === 0) {
recommendedActions.push("Package is ready for AI preview and external handoff under the declared policies.");
}
return {
riskSummary,
recommendedActions: [...new Set(recommendedActions)]
};
}
export function getPackageReadiness(pkg, sanitizationStatus) {
const m = pkg.manifest;
const sourceRecords = (m.sourceRecords || []).map(summarizeSourceRecord);
const qualityReports = m.conversionQuality || [];
const hasLowConfidence = qualityReports.some((report) => report.confidence === "low");
const sendGateStatus = summarizeSendGate(m.aiSendGateSummaries || []);
const markdownFile = pkg.files.find((file) => file.path === "document.md");
const markdownAvailable = Boolean(markdownFile && markdownFile.bytes > 0);
const qualityStatus = hasLowConfidence ? "warning" : "pass";
return {
sourceRecords,
sourceProvenance: sourceRecords.length > 0 ? "pass" : "fail",
qualityReports,
hasLowConfidence,
qualityStatus,
knownLimitStatus: m.knownLimits || [],
sendGateStatus,
markdownAvailability: markdownAvailable,
markdownReadiness: markdownAvailable ? "pass" : "fail",
auditTrailCompleteness: m.audit ? "pass" : "fail",
sanitizationStatus
};
}