export function createSearchResultsPanel({ $, api, run }) {
let lastSearchResults = [];
$("btnReplaceAll")?.addEventListener("click", () => run(async () => {
const keyword = $("searchKeyword")?.value.trim();
const replaceText = $("replaceKeyword")?.value;
if (!keyword) {
if (typeof showAlert === "function") showAlert("info", "Please enter a search keyword first.");
return { message: "Empty keyword" };
}
const results = lastSearchResults;
if (!results || results.length === 0) {
if (typeof showAlert === "function") showAlert("info", "No search results to replace.");
return { message: "No results" };
}
if (typeof showAlert === "function") showAlert("info", `Starting batch replace in ${results.length} files...`);
let replacedCount = 0;
for (const item of results) {
try {
const oldContent = await api("/api/markdown/read", { relativePath: item.relativePath });
if (oldContent && oldContent.includes(keyword)) {
const newContent = oldContent.replaceAll(keyword, replaceText);
await api("/api/markdown/save", { relativePath: item.relativePath, content: newContent });
replacedCount += 1;
}
} catch (err) {
}
}
if (typeof showAlert === "function") {
showAlert("success", `Successfully replaced "${keyword}" with "${replaceText}" in ${replacedCount} files.`);
}
$("searchNotes")?.click();
}));
function renderSearchResults(results) {
lastSearchResults = results || [];
const legacyContainer = $("searchResults");
if (legacyContainer) {
legacyContainer.innerHTML = "";
}
const container = $("sidebarSearchResults");
if (!container) return;
container.innerHTML = "";
if (!results || results.length === 0) {
container.innerHTML = `<p class="sub-text" style="text-align: center; padding: 10px; color: var(--text-muted);">No matching notes found.</p>`;
return;
}
results.forEach((item) => {
const fileGroup = document.createElement("div");
fileGroup.className = "search-file-group";
const fileTitle = document.createElement("div");
fileTitle.className = "search-file-title";
const titleSpan = document.createElement("span");
titleSpan.className = "mono-text";
titleSpan.textContent = item.fileName;
const badge = document.createElement("span");
badge.className = "search-file-badge";
badge.textContent = `${item.matchesCount}`;
fileTitle.appendChild(titleSpan);
fileTitle.appendChild(badge);
fileGroup.appendChild(fileTitle);
fileTitle.addEventListener("click", () => run(async () => {
try {
const noteContent = await api("/api/markdown/read", { relativePath: item.relativePath });
$("notePath").value = item.relativePath;
$("noteContent").value = noteContent;
$("reloadReadView")?.click();
} catch (err) {
fileGroup.style.opacity = "0.5";
titleSpan.textContent = `${item.fileName} `;
const deletedSpan = document.createElement("span");
deletedSpan.style.color = "#ef4444";
deletedSpan.style.fontSize = "10px";
deletedSpan.textContent = "(Deleted)";
titleSpan.appendChild(deletedSpan);
if (typeof showAlert === "function") {
showAlert("error", `File [${item.fileName}] has been deleted externally or path is invalid.`);
}
}
}));
item.hits.forEach((hit) => {
const matchItem = document.createElement("a");
matchItem.className = "search-match-item";
matchItem.href = "javascript:void(0);";
const keyword = $("searchKeyword")?.value.trim();
let safeContent = escapeHtml(hit.lineContent);
if (keyword) {
const regex = new RegExp(`(${escapeRegex(keyword)})`, "gi");
safeContent = safeContent.replace(regex, "<mark>$1</mark>");
}
matchItem.innerHTML = `<strong>L${hit.lineNumber}:</strong> ${safeContent}`;
matchItem.addEventListener("click", (e) => {
e.preventDefault();
e.stopPropagation();
run(async () => {
try {
const noteContent = await api("/api/markdown/read", { relativePath: item.relativePath });
$("notePath").value = item.relativePath;
$("noteContent").value = noteContent;
$("reloadReadView")?.click();
setTimeout(() => {
const targetLine = hit.lineNumber - 1;
const targetEl = document.querySelector(`[data-line-start="${targetLine}"]`);
if (targetEl) {
targetEl.scrollIntoView({ block: "center", behavior: "smooth" });
targetEl.style.backgroundColor = "rgba(16, 185, 129, 0.2)";
setTimeout(() => {
targetEl.style.backgroundColor = "";
}, 2000);
}
}, 250);
} catch (err) {
matchItem.classList.add("deleted-file");
if (typeof showAlert === "function") {
showAlert("error", `File [${item.fileName}] has been deleted externally or path is invalid.`);
}
}
});
});
fileGroup.appendChild(matchItem);
});
container.appendChild(fileGroup);
});
}
function escapeHtml(str) {
return String(str ?? "")
.replace(/&/g, "&amp;")
.replace(/</g, "&lt;")
.replace(/>/g, "&gt;")
.replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  function escapeRegex(str) {
    return str.replace(/[/\-\\^$*+?.()|[\]{}]/g, "\\$&");
  }
  return { renderSearchResults };
}
