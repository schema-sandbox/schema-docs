export function createActivityListsPanel({ $, state, pill, showAlert }) {
function renderApiProfiles(profiles) {
const container = $("apiProfiles");
container.replaceChildren();
if (!profiles || profiles.length === 0) {
const empty = document.createElement("div");
empty.className = "empty-state";
empty.style.padding = "16px";
empty.innerHTML = `<p style="font-size: 13px; color: var(--text-muted);">No API profiles yet</p>`;
container.append(empty);
return;
}
for (const profile of profiles) {
container.append(pill(`${profile.name}: ${profile.model}`, {
apiProfileId: profile.id,
apiProfileName: profile.name,
apiBaseUrl: profile.apiBaseUrl,
apiModel: profile.model
}));
}
for (const button of container.querySelectorAll("[data-api-base-url]")) {
button.addEventListener("click", () => {
state.selectedApiProfileId = button.dataset.apiProfileId;
$("apiProfileName").value = button.dataset.apiProfileName;
$("apiBaseUrl").value = button.dataset.apiBaseUrl;
$("apiModel").value = button.dataset.apiModel;
$("selectedApiProfile").textContent = `Current profile: ${button.dataset.apiProfileName}#${state.selectedApiProfileId}`;
document.dispatchEvent(new CustomEvent("schema-docs:api-config-changed"));
});
}
}
function renderAudits(audits) {
const container = $("audits");
container.replaceChildren();
if (!audits || audits.length === 0) {
const empty = document.createElement("div");
empty.className = "empty-state";
empty.style.padding = "16px";
empty.innerHTML = `<p style="font-size: 13px; color: var(--text-muted);">No API audit logs yet</p>`;
container.append(empty);
return;
}
for (const audit of audits) {
const label = `${audit.operation} / ${audit.model || "model unset"} / ${audit.sent ? "sent" : "preview"}`;
const button = pill(label, { auditId: audit.id });
button.addEventListener("click", () => {
state.lastAiAuditId = audit.id;
$("lastAuditId").textContent = `Last audit: ${audit.id}`;
});
container.append(button);
}
}
function renderEvidence(records) {
const container = $("evidenceRecords");
container.replaceChildren();
if (!records || records.length === 0) {
const empty = document.createElement("div");
empty.className = "empty-state";
empty.style.padding = "16px";
empty.innerHTML = `<p style="font-size: 13px; color: var(--text-muted);">No evidence records yet</p>`;
container.append(empty);
return;
}
for (const record of records) {
const label = `${record.kind} / ${record.policyDecision} / ${record.aiSent ? "sent" : "local"}`;
const button = pill(label, { evidenceId: record.id });
button.addEventListener("click", () => {
state.selectedEvidenceId = record.id;
$("lastEvidence").textContent = `Current evidence: ${record.id}`;
});
container.append(button);
}
}
function rememberConversionAudit(result) {
if (result?.auditId) {
state.selectedConversionAuditId = result.auditId;
const pathText = result.outputPath ? ` | Saved to: ${result.outputPath}` : "";
$("lastConversion").textContent = `Current conversion record: ${result.auditId}${pathText}`;
}
if (result?.outputPath && typeof showAlert === "function") {
showAlert("success", `Saved to: ${result.outputPath}`);
}
return result;
}
function renderConversions(conversions) {
const container = $("conversions");
container.replaceChildren();
if (!conversions || conversions.length === 0) {
const empty = document.createElement("div");
empty.className = "empty-state";
empty.style.padding = "16px";
empty.innerHTML = `<p style="font-size: 13px; color: var(--text-muted);">No document extraction or conversion records yet</p>`;
container.append(empty);
return;
}
for (const conversion of conversions) {
const label = `${conversion.sourceType} -> ${conversion.targetFormat} / ${conversion.mode} / ${conversion.quality}`;
const button = pill(label, { conversionAuditId: conversion.id });
button.addEventListener("click", () => {
state.selectedConversionAuditId = conversion.id;
$("lastConversion").textContent = `Current conversion record: ${conversion.id} | ${conversion.intermediateMarkdownPath} -> ${conversion.outputPath}`;
});
container.append(button);
}
}
function renderFormatMatrix(capabilities) {
const container = $("formatMatrix");
container.replaceChildren();
for (const conversion of capabilities.conversions ?? []) {
const label = document.createElement("span");
label.className = "pill capability-label";
label.textContent = `${conversion.from} -> ${conversion.to}`;
label.title = `${conversion.mode || "conversion"} / ${conversion.quality || "quality unspecified"}`;
container.append(label);
}
}
return {
renderApiProfiles,
renderAudits,
renderEvidence,
rememberConversionAudit,
renderConversions,
renderFormatMatrix
};
}
