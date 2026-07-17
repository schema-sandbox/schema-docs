export function createImportUploadPanel({
$,
workspacePath,
ensureWorkspace,
localApiBaseUrl,
showAlert,
refreshManifest,
refreshInbox,
print,
onImportedRecord,
setImportProgress
}) {
async function readUploadPayload(response, url) {
try {
return await response.json();
} catch {
return {
ok: false,
error: {
code: "import_upload_non_json_response",
message: `Local API returned a non-JSON response for ${url}.`,
guidance: "Check that the Schema Docs local API server is running, then retry the import."
}
};
}
}
async function uploadFile(file) {
let importFailed = false;
try {
const ext = file.name.split(".").pop().toLowerCase();
const fileSize = Number(file.size || 0);
const mb = fileSize / 1024 / 1024;
const limit = ["csv", "xlsx", "xls"].includes(ext) ? 10 * 1024 * 1024 : 1024 * 1024 * 1024;
if (fileSize > limit) throw new Error(`File is too large (${mb.toFixed(1)}MB). Limits: Datasets <10MB, documents <1024MB.`);
if (typeof ensureWorkspace === "function") {
await ensureWorkspace();
}
if (!window.AI_DOC_EXCHANGE_TOKEN && typeof window.schemaDocsRefreshLocalApiConfig === "function") {
await window.schemaDocsRefreshLocalApiConfig();
}
const wsPath = workspacePath();
const url = `${localApiBaseUrl()}/api/import-upload?workspacePath=${encodeURIComponent(wsPath)}&filename=${encodeURIComponent(file.name)}`;
const largeNotice = mb >= 30 ? ` Large file (${mb.toFixed(1)}MB): keep this window open until the import result appears.` : "";
showAlert("info", `Uploading and parsing file: ${file.name}...${largeNotice}`);
if (typeof setImportProgress === "function") {
setImportProgress(true, `Importing ${file.name}${fileSize ? ` (${mb.toFixed(1)}MB)` : ""}. Large PDFs can take several minutes; keep this window open.`);
}
const arrayBuffer = await file.arrayBuffer();
const response = await fetch(url, {
method: "POST",
headers: {
"content-type": "application/octet-stream",
"x-ai-doc-exchange-token": window.AI_DOC_EXCHANGE_TOKEN ?? ""
},
body: arrayBuffer
});
const payload = await readUploadPayload(response, url);
if (!payload.ok) {
const code = payload.error?.code ?? "import_failed";
const message = payload.error?.message ?? "Import failed";
const guidance = payload.error?.guidance ?? "";
throw new Error(guidance ? `${code}: ${message} ${guidance}` : `${code}: ${message}`);
}
showAlert("success", `File imported: ${file.name}`);
await refreshManifest();
refreshInbox();
if (payload.data?.id) {
$("recordId").value = payload.data.id;
}
if (typeof onImportedRecord === "function") {
await onImportedRecord(payload.data);
}
print(payload.data);
} catch (error) {
importFailed = true;
showAlert("danger", `Import error: ${error.message}`);
print({ ok: false, error: error.message });
if (typeof setImportProgress === "function") {
setImportProgress(true, `Import failed: ${error.message}`, "error");
}
} finally {
if (!importFailed && typeof setImportProgress === "function") {
setImportProgress(false);
}
}
}
function bindImportUpload() {
const dropZone = $("dropZone");
const fileInput = $("fileInput");
if (!dropZone || !fileInput) return { bound: false };
dropZone.addEventListener("click", () => {
fileInput.click();
});
fileInput.addEventListener("change", () => {
if (fileInput.files.length > 0) {
uploadFile(fileInput.files[0]);
}
});
dropZone.addEventListener("dragover", (event) => {
event.preventDefault();
dropZone.classList.add("dragover");
});
["dragleave", "dragend"].forEach((type) => {
dropZone.addEventListener(type, () => {
dropZone.classList.remove("dragover");
});
});
dropZone.addEventListener("drop", (event) => {
event.preventDefault();
dropZone.classList.remove("dragover");
if (event.dataTransfer.files.length > 0) {
uploadFile(event.dataTransfer.files[0]);
}
});
return { bound: true };
}
return {
uploadFile,
bindImportUpload
};
}
