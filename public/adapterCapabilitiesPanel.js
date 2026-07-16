export function createAdapterCapabilitiesPanel({ $, apiGet, pill }) {
function renderAdapterCapabilities(capabilities) {
const container = $("adapterCapabilities");
container.replaceChildren();
const entries = Object.entries(capabilities ?? {});
if (entries.length === 0) {
container.append(pill("No optional adapters detected", { required: false }));
return;
}
for (const [key, adapter] of entries) {
container.append(pill(`${adapter.name ?? key}: ${adapter.available ? "available" : "missing"}`, {
key,
required: adapter.required === true,
mode: adapter.mode ?? "optional-system-adapter",
version: adapter.version ?? "not installed",
fallback: adapter.fallback ?? "",
sendGateImpact: adapter.sendGateImpact ?? ""
}));
}
}
async function refreshAdapterCapabilities() {
const capabilities = await apiGet("/api/adapter/capabilities");
renderAdapterCapabilities(capabilities);
return capabilities;
}
return {
renderAdapterCapabilities,
refreshAdapterCapabilities
};
}