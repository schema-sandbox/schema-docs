export function createVersionsPanel({ $, api, apiGet, run, showAlert }) {
function renderVersions(versions) {
const list = $("versionList");
const empty = $("versionEmpty");
list.innerHTML = "";
if (!versions || versions.length === 0) {
list.style.display = "none";
empty.style.display = "";
return;
}
list.style.display = "";
empty.style.display = "none";
for (const ver of versions) {
const item = document.createElement("div");
item.className = "version-item" + (ver.current ? " current" : "");
const meta = document.createElement("div");
meta.className = "version-meta";
const reason = document.createElement("div");
reason.className = "version-reason";
reason.textContent = ver.reason || ver.id;
meta.appendChild(reason);
const time = document.createElement("div");
time.className = "version-time";
const ts = ver.timestamp || ver.createdAt || "";
time.textContent = ts ? new Date(ts).toLocaleString() : ver.id;
meta.appendChild(time);
item.appendChild(meta);
if (!ver.current) {
const actions = document.createElement("div");
actions.className = "version-actions";
const promoteBtn = document.createElement("button");
promoteBtn.type = "button";
promoteBtn.textContent = "Restore this version";
promoteBtn.addEventListener("click", () => run(async () => {
const relPath = $("notePath").value.trim();
const result = await api("/api/versions/promote", {
relativePath: relPath,
versionId: ver.id
});
const noteContent = await api("/api/markdown/read", { relativePath: relPath });
$("noteContent").value = noteContent;
await refreshVersions();
showAlert("success", `Restored version "${ver.reason || ver.id}".`);
return result;
}));
actions.appendChild(promoteBtn);
item.appendChild(actions);
}
list.appendChild(item);
}
}
async function refreshVersions() {
try {
const relPath = $("notePath").value.trim();
if (!relPath) {
renderVersions([]);
return [];
}
const versions = await apiGet("/api/versions", { relativePath: relPath });
renderVersions(versions);
return versions;
} catch {
renderVersions([]);
return [];
}
}
return {
renderVersions,
refreshVersions
};
}