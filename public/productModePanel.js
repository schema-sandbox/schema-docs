export function createProductModePanel({ $, state, onModeSelected }) {
function setProductMode(mode, configured = true) {
const normalizedMode = mode === "markdown" ? "markdown" : "office";
state.productMode = normalizedMode;
state.productModeConfigured = configured || state.productModeConfigured;
document.body.dataset.productMode = normalizedMode;
document.body.dataset.productModeConfigured = state.productModeConfigured ? "true" : "false";
localStorage.setItem("schemaDocsProductMode", normalizedMode);
if (state.productModeConfigured) {
localStorage.setItem("schemaDocsProductModeConfigured", "true");
}
const officeButton = $("productModeOffice");
const markdownButton = $("productModeMarkdown");
if (officeButton && markdownButton) {
officeButton.classList.toggle("secondary", normalizedMode !== "office");
markdownButton.classList.toggle("secondary", normalizedMode !== "markdown");
}
const hint = $("productModeHint");
if (hint) {
hint.textContent = normalizedMode === "office"
? "Office / PDF / Excel is the current primary mode. Markdown powers AI preview, audit, API, and reviewed handoff packages behind the scenes."
: "Markdown / API is the current primary mode. Office / PDF / Excel can still be imported, refreshed, reviewed for AI, and exported as original-format entry points.";
}
const dialog = $("firstRunModeDialog");
if (dialog && state.productModeConfigured) {
dialog.classList.add("hidden");
}
if (configured && typeof onModeSelected === "function") {
onModeSelected(normalizedMode);
}
}
function showFirstRunModeDialogIfNeeded() {
setProductMode(state.productMode, false);
const dialog = $("firstRunModeDialog");
if (dialog && !state.productModeConfigured) {
dialog.classList.remove("hidden");
}
}
return {
setProductMode,
showFirstRunModeDialogIfNeeded
};
}