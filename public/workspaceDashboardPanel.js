export function createWorkspaceDashboardPanel({ $, api, apiGet, run, showAlert, refreshVersions }) {
function initDashboardTabs() {
const tabs = [
{ tabId: "tabInbox", panelId: "inboxPanel" },
{ tabId: "tabTimeline", panelId: "timelinePanel" },
{ tabId: "tabSettings", panelId: "settingsPanel" },
{ tabId: "tabQuality", panelId: "qualityPanel" }
];
for (const { tabId, panelId } of tabs) {
$(tabId).addEventListener("click", () => {
for (const t of tabs) {
$(t.tabId).classList.remove("active");
$(t.panelId).classList.remove("active");
}
$(tabId).classList.add("active");
$(panelId).classList.add("active");
});
}
}
function renderInbox(items) {
const list = $("inboxList");
const empty = $("inboxEmpty");
list.innerHTML = "";
if (!items || items.length === 0) {
list.style.display = "none";
empty.style.display = "";
return;
}
list.style.display = "";
empty.style.display = "none";
for (const item of items) {
const div = document.createElement("div");
div.className = "inbox-item" + (item.archived ? " archived" : "");
const header = document.createElement("div");
header.className = "inbox-header";
const titleArea = document.createElement("div");
const title = document.createElement("span");
title.className = "inbox-title";
title.textContent = item.title || item.name || item.id;
titleArea.appendChild(title);
if (item.sourceType) {
const badge = document.createElement("span");
badge.className = "record-badge badge-primary";
badge.textContent = item.sourceType;
badge.style.marginLeft = "8px";
titleArea.appendChild(badge);
}
const actions = document.createElement("div");
actions.className = "inbox-actions";
if (item.archived) {
const unarchiveBtn = document.createElement("button");
unarchiveBtn.type = "button";
unarchiveBtn.textContent = "Restore";
unarchiveBtn.addEventListener("click", () => run(async () => {
await api("/api/inbox/unarchive", { itemId: item.id });
await refreshInbox();
return { unarchived: item.id };
}));
actions.appendChild(unarchiveBtn);
} else {
const archiveBtn = document.createElement("button");
archiveBtn.type = "button";
archiveBtn.textContent = "Archive";
archiveBtn.addEventListener("click", () => run(async () => {
await api("/api/inbox/archive", { itemId: item.id });
await refreshInbox();
return { archived: item.id };
}));
actions.appendChild(archiveBtn);
const recsBtn = document.createElement("button");
recsBtn.type = "button";
recsBtn.textContent = "Suggestions";
recsBtn.addEventListener("click", () => run(async () => {
const recs = await api("/api/inbox/recommendations", { itemId: item.id });
const recsDiv = div.querySelector(".inbox-recs");
if (recsDiv) {
recsDiv.remove();
}
if (recs && recs.length > 0) {
const newRecsDiv = document.createElement("div");
newRecsDiv.className = "inbox-recs";
newRecsDiv.textContent = recs.map((r) => r.action || r.description || r).join(" -> ");
div.appendChild(newRecsDiv);
}
return recs;
}));
actions.appendChild(recsBtn);
}
header.appendChild(titleArea);
header.appendChild(actions);
div.appendChild(header);
if (item.sourcePath || item.status) {
const meta = document.createElement("div");
meta.className = "inbox-meta";
const parts = [];
if (item.status) parts.push(`Status: ${item.status}`);
if (item.sourcePath) parts.push(item.sourcePath);
meta.textContent = parts.join(" | ");
div.appendChild(meta);
}
list.appendChild(div);
}
}
async function refreshInbox() {
try {
const items = await apiGet("/api/inbox");
renderInbox(items);
return items;
} catch {
renderInbox([]);
return [];
}
}
function renderTimeline(events) {
const list = $("timelineList");
const empty = $("timelineEmpty");
list.innerHTML = "";
if (!events || events.length === 0) {
list.style.display = "none";
empty.style.display = "";
return;
}
list.style.display = "";
empty.style.display = "none";
const sorted = [...events].sort((a, b) => {
const ta = a.timestamp || a.createdAt || "";
const tb = b.timestamp || b.createdAt || "";
return tb.localeCompare(ta);
});
for (const event of sorted) {
const entry = document.createElement("div");
entry.className = "timeline-entry";
const typeDiv = document.createElement("div");
typeDiv.className = "timeline-event-type";
typeDiv.textContent = event.type || event.eventType || "event";
entry.appendChild(typeDiv);
const descDiv = document.createElement("div");
descDiv.className = "timeline-description";
descDiv.textContent = event.description || event.message || "";
entry.appendChild(descDiv);
const timeDiv = document.createElement("div");
timeDiv.className = "timeline-timestamp";
const ts = event.timestamp || event.createdAt || "";
timeDiv.textContent = ts ? new Date(ts).toLocaleString() : "";
entry.appendChild(timeDiv);
list.appendChild(entry);
}
}
async function refreshTimeline() {
try {
const filter = $("timelineFilter").value.trim() || null;
const events = await apiGet("/api/timeline", filter ? { recordId: filter } : {});
renderTimeline(events);
return events;
} catch {
renderTimeline([]);
return [];
}
}
function renderSettings(settings) {
const list = $("settingsList");
const empty = $("settingsEmpty");
list.innerHTML = "";
if (!settings || typeof settings !== "object") {
list.style.display = "none";
empty.style.display = "";
return;
}
const keys = Object.keys(settings);
if (keys.length === 0) {
list.style.display = "none";
empty.style.display = "";
return;
}
list.style.display = "";
empty.style.display = "none";
for (const key of keys) {
const row = document.createElement("div");
row.className = "settings-row";
const keySpan = document.createElement("span");
keySpan.className = "settings-key";
keySpan.textContent = key;
const valueInput = key === "policyMode" ? document.createElement("select") : document.createElement("input");
valueInput.className = "settings-value";
if (key === "policyMode") {
for (const mode of ["open-core", "team", "enterprise"]) {
const option = document.createElement("option");
option.value = mode;
option.textContent = mode;
valueInput.appendChild(option);
}
valueInput.value = String(settings[key] ?? "open-core");
valueInput.title = "open-core is free for ordinary offline document exchange; team/enterprise mark Schema Sandbox security policy layers.";
} else {
valueInput.type = "text";
valueInput.value = typeof settings[key] === "object" ? JSON.stringify(settings[key]) : String(settings[key]);
}
const saveBtn = document.createElement("button");
saveBtn.type = "button";
saveBtn.className = "settings-save-btn";
saveBtn.textContent = "Save";
saveBtn.addEventListener("click", () => run(async () => {
let parsedValue = valueInput.value;
try { parsedValue = JSON.parse(parsedValue); } catch { }
const result = await api("/api/settings", { key, value: parsedValue });
showAlert("success", `Setting "${key}" saved.`);
return result;
}));
row.appendChild(keySpan);
row.appendChild(valueInput);
row.appendChild(saveBtn);
list.appendChild(row);
}
}
async function refreshSettings() {
try {
const settings = await apiGet("/api/settings");
renderSettings(settings);
return settings;
} catch {
renderSettings({});
return {};
}
}
function renderQuality(summary) {
const grid = $("qualityGrid");
const empty = $("qualityEmpty");
grid.innerHTML = "";
if (!summary || typeof summary !== "object") {
grid.style.display = "none";
empty.style.display = "";
return;
}
grid.style.display = "";
empty.style.display = "none";
const cards = [];
if (summary.total != null) {
cards.push({ stat: summary.total, label: "Total samples", cls: "stat-info" });
}
if (summary.statusCounts) {
const sc = summary.statusCounts;
if (sc.pass != null) cards.push({ stat: sc.pass, label: "Pass", cls: "stat-pass" });
if (sc.known_limit != null) cards.push({ stat: sc.known_limit, label: "Known limits", cls: "stat-warn" });
if (sc.fail != null) cards.push({ stat: sc.fail, label: "Fail", cls: "stat-fail" });
if (sc.blocked != null) cards.push({ stat: sc.blocked, label: "Blocked", cls: "stat-fail" });
}
if (summary.qualityCounts) {
const qc = summary.qualityCounts;
if (qc.high != null) cards.push({ stat: qc.high, label: "High quality", cls: "stat-pass" });
if (qc.medium != null) cards.push({ stat: qc.medium, label: "Medium quality", cls: "stat-warn" });
if (qc.low != null) cards.push({ stat: qc.low, label: "Low quality", cls: "stat-fail" });
}
for (const card of cards) {
const div = document.createElement("div");
div.className = "quality-card";
const stat = document.createElement("div");
stat.className = `quality-stat ${card.cls}`;
stat.textContent = card.stat;
div.appendChild(stat);
const label = document.createElement("div");
label.className = "quality-label";
label.textContent = card.label;
div.appendChild(label);
grid.appendChild(div);
}
if (summary.typeCounts) {
const typeDiv = document.createElement("div");
typeDiv.style.gridColumn = "1 / -1";
typeDiv.style.display = "flex";
typeDiv.style.gap = "8px";
typeDiv.style.flexWrap = "wrap";
typeDiv.style.marginTop = "6px";
for (const [type, count] of Object.entries(summary.typeCounts)) {
const badge = document.createElement("span");
badge.className = "record-badge badge-info";
badge.textContent = `${type.toUpperCase()}: ${count}`;
typeDiv.appendChild(badge);
}
grid.appendChild(typeDiv);
}
}
async function refreshQuality() {
try {
const summary = await apiGet("/api/samples/real-summary");
renderQuality(summary);
return summary;
} catch {
renderQuality(null);
return null;
}
}
async function refreshDashboard() {
await Promise.allSettled([
refreshInbox(),
refreshTimeline(),
refreshSettings(),
refreshQuality(),
refreshVersions()
]);
}
initDashboardTabs();
return {
refreshInbox,
refreshTimeline,
refreshSettings,
refreshQuality,
refreshDashboard
};
}