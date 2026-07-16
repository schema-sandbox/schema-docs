function aiSummonSourceLabel(source = "unknown") {
return {
"floating-button": "floating AI key",
"keyboard-shortcut": "Ctrl+Alt+A",
"desktop-command": "desktop summon event"
}[source] ?? "AI summon key";
}
export function createAiSummonPanel({ $, updateAiWillSeePanel, onOpen }) {
async function summonAiGate(options = {}) {
if (typeof onOpen === "function") {
onOpen();
}
const panelTitle = $("aiSendGateTitle");
panelTitle?.scrollIntoView({ behavior: "smooth", block: "start" });
let clipboardMaskFailed = false;
if (options.clipboardText) {
const aiContentInput = $("aiContent");
if (aiContentInput) {
try {
const apiBaseUrl = window.SCHEMA_DOCS_API_BASE_URL || "";
const token = window.AI_DOC_EXCHANGE_TOKEN || "";
const response = await fetch(`${apiBaseUrl}/api/mask`, {
method: "POST",
headers: {
"Content-Type": "application/json",
"x-ai-doc-exchange-token": token
},
body: JSON.stringify({ content: options.clipboardText })
});
if (response.ok) {
const payload = await response.json();
if (typeof payload.data?.maskedText === "string") {
aiContentInput.value = payload.data.maskedText;
} else {
clipboardMaskFailed = true;
}
} else {
clipboardMaskFailed = true;
}
} catch (e) {
clipboardMaskFailed = true;
}
if (clipboardMaskFailed) {
const summary = $("sendGateSummary");
if (summary) {
summary.textContent = "Clipboard not staged: local masking unavailable. Retry after local API health is restored.";
}
} else {
aiContentInput.dispatchEvent(new Event("input"));
}
}
}
const recordId = $("recordId")?.value.trim();
if (recordId) {
try {
await updateAiWillSeePanel();
} catch {
}
}
$("aiContent")?.focus();
const current = $("sendGateSummary")?.textContent ?? "";
if ($("sendGateSummary") && !clipboardMaskFailed && (!current || current === "Send Gate: no preview yet")) {
$("sendGateSummary").textContent = `AI summon key opened (${aiSummonSourceLabel(options.source)}): select a document or dataset to generate an AI send preview.`;
}
}
return {
summonAiGate
};
}