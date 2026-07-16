export function createImportUploadPanel({
$,
workspacePath,
ensureWorkspace,
localApiBaseUrl,
showAlert,
refreshManifest,
refreshInbox,
print,
onImportedRecord
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
try {
const ext = file.name.split(".").pop().toLowerCase();
const limit = ["csv", "xlsx", "xls"].includes(ext) ? 10 * 1024 * 1024 : 30 * 1024 * 1024;
if (file.size > limit) throw new Error(`File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Limits: Datasets <10MB, Docs <30MB.`);
if (typeof ensureWorkspace === "function") {
await ensureWorkspace();
}
const wsPath = workspacePath();
const url = `${localApiBaseUrl()}/api/import-upload?workspacePath=${encodeURIComponent(wsPath)}&filename=${encodeURIComponent(file.name)}`;
showAlert("info", `Uploading and parsing file: ${file.name}...`);
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
showAlert("danger", `Import error: ${error.message}`);
print({ ok: false, error: error.message });
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