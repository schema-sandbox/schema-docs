export function createExchangePackagePanel({ $, api, escapeHtml, statusClass, run, showAlert, state }) {
function renderTrustList(items, fallback) {
const values = Array.isArray(items) && items.length > 0 ? items : [fallback];
return `<ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}
async function loadExchangePackageReport(packageRelativePath) {
const result = await api("/api/exchange/package/read", {
packageRelativePath
});
const explanation = await api("/api/exchange/package/explain", {
packageRelativePath
});
const trustReport = await api("/api/exchange/package/trust-report", {
packageRelativePath
});
renderExchangePackageReport(result, explanation, trustReport);
return {
readBack: result,
explanation,
trustReport
};
}
function renderExchangePackageReport(result, explanation, trustReport) {
$("packageStatus").textContent = result.valid
? `Package status: ${trustReport.verdict}`
: "Package status: verification failed";
const summaryBox = $("packageSummary");
summaryBox.classList.remove("hidden");
const readiness = explanation.readiness ?? {};
const receiver = explanation.receiverSummary ?? {};
const filesList = (result.files ?? []).map(f => `<div class="trust-file-row"><span>${escapeHtml(f.path)}</span><span class="trust-pass">Verification passed</span></div>`).join("");
const sourceRows = (explanation.sourceRecords ?? []).map((source) => `<div class="trust-source-row"><span>${escapeHtml(source.title || source.id)}</span><span>${escapeHtml(source.kind || "source")} / ${escapeHtml(source.sourceType || "unknown")}</span></div>`).join("") || `<div class="trust-source-row"><span>No source recorded</span><span>warning</span></div>`;
summaryBox.innerHTML = `<div class="trust-report-header"><div><strong>${escapeHtml(result.manifest.title)}</strong><div class="trust-muted">Version ${escapeHtml(result.manifest.packageVersion || "1.0.0")} / Schema Docs ${escapeHtml(result.manifest.createdByVersion || "0.1.0")}</div></div><span class="trust-verdict ${statusClass(trustReport.verdict)}">${escapeHtml(trustReport.verdict)}</span></div><div class="trust-grid"><div><span>AI readiness</span><strong class="${statusClass(readiness.ai || trustReport.aiReadiness)}">${escapeHtml(readiness.ai || trustReport.aiReadiness)}</strong></div><div><span>External sharing readiness</span><strong class="${statusClass(readiness.external || trustReport.externalSharingReadiness)}">${escapeHtml(readiness.external || trustReport.externalSharingReadiness)}</strong></div><div><span>Send Gate</span><strong class="${statusClass(readiness.sendGate || trustReport.sendGateStatus)}">${escapeHtml(readiness.sendGate || trustReport.sendGateStatus)}</strong></div><div><span>Sanitization status</span><strong class="${statusClass(readiness.sanitization || trustReport.sanitizationStatus)}">${escapeHtml(readiness.sanitization || trustReport.sanitizationStatus)}</strong></div><div><span>Source records</span><strong>${Number(receiver.sourceRecordCount ?? trustReport.sourceRecordsCount ?? 0)}</strong></div><div><span>Risk count</span><strong>${Number(receiver.riskCount ?? trustReport.riskSummary?.length ?? 0)}</strong></div></div><div class="trust-section"><strong>Risk summary</strong>${renderTrustList(trustReport.riskSummary || explanation.riskSummary, "No blocking risk found.")}</div><div class="trust-section"><strong>Recommended actions</strong>${renderTrustList(trustReport.recommendedActions || explanation.recommendedActions, "Ready for AI preview or external handoff.")}</div><div class="trust-section"><strong>Sources</strong><div class="trust-source-list">${sourceRows}</div></div><div class="trust-section"><strong>File and evidence-chain verification</strong><div class="trust-file-list">${filesList}</div></div>`;
}
function bindTrustActions() {
const packagePanel = $("packagePath")?.closest(".exchange-package-panel");
if (packagePanel && !$("exchangePackageHelp")) {
const help = document.createElement("p");
help.id = "exchangePackageHelp";
help.className = "sub-text";
help.textContent = "A verified handoff folder for sharing reviewed content, integrity hashes, and trust reports. It is not a software installer, and normal exports do not require it.";
packagePanel.querySelector("h2")?.insertAdjacentElement("afterend", help);
}
$("saveExchangePackage").addEventListener("click", (event) => {
event.preventDefault();
event.stopImmediatePropagation();
run(async () => {
const relPath = $("packagePath").value.trim();
if (!relPath) throw new Error("Enter a package relative path.");
if (typeof showAlert === "function") showAlert("info", "Generating and saving exchange package...");
const result = await api("/api/exchange/package", {
packageRelativePath: relPath,
input: {
title: "API Exchange Package",
body: $("aiContent").value,
apiBaseUrl: $("apiBaseUrl").value.trim(),
model: $("apiModel").value.trim(),
queryResult: state.lastQueryResult || undefined,
aiResult: state.lastAiResult || undefined,
auditId: state.lastAiAuditId || undefined,
exportFormats: ["docx", "pdf"]
}
});
await loadExchangePackageReport(relPath);
if (typeof showAlert === "function") showAlert("success", "Exchange package saved and trust report loaded.");
return result;
});
}, true);
const loadReport = (message) => (event) => {
event.preventDefault(); event.stopImmediatePropagation();
run(async () => {
const relPath = $("packagePath").value.trim();
if (!relPath) throw new Error("Enter a package relative path.");
if (typeof showAlert === "function") showAlert("info", "Loading and verifying exchange package...");
const report = await loadExchangePackageReport(relPath);
if (typeof showAlert === "function") showAlert("success", message);
return report;
});
};
$("readExchangePackage").addEventListener("click", loadReport("Exchange package loaded and verified."), true);
$("trustExchangePackage").addEventListener("click", loadReport("Trust report refreshed."), true);
$("writeReceiverReport").addEventListener("click", (event) => {
event.preventDefault(); event.stopImmediatePropagation();
run(async () => {
const relPath = $("packagePath").value.trim();
if (!relPath) throw new Error("Enter a package relative path.");
if (typeof showAlert === "function") showAlert("info", "Writing receiver report to package...");
const written = await api("/api/exchange/package/receiver-report", {
packageRelativePath: relPath
});
await loadExchangePackageReport(relPath);
if (typeof showAlert === "function") showAlert("success", "Receiver report written to exchange package.");
return written;
});
}, true);
}
return {
loadExchangePackageReport,
renderExchangePackageReport,
bindTrustActions
};
}
