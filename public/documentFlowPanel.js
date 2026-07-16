function outputPathWithExtension(value, extension) {
const fallback = `exports/converted.${extension}`;
const raw = String(value || fallback).trim() || fallback;
return raw.replace(/\.[a-z0-9]+$/i, `.${extension}`);
}
const largeEditorLoadSourceBytes = 5 * 1024 * 1024;
function shouldUseChunkedEditorLoad(record = {}) {
const readableCharacters = Number(record.markdownOutputs?.readableStats?.characters || 0);
if (readableCharacters > 0) return readableCharacters >= largeEditorLoadSourceBytes;
return Number(record.sourceSize || 0) >= largeEditorLoadSourceBytes;
}
function showChunkedEditorPlaceholder($, record, relativePath) {
const segments = record.markdownOutputs?.readableSegments;
const firstSegment = segments?.segments?.[0]?.relativePath || "";
$("noteContent").value = [
`# ${record.title || record.name || record.id}`,
"",
"> Large document split into numbered parts.",
"> Open the index or a part file; use AI Will See for AI chunks.",
"",
`- Record: ${record.id}`,
`- Readable index: ${segments?.indexRelativePath || relativePath}`,
`- First part: ${firstSegment || "not segmented"}`,
""
].join("\n");
}
function relativeHumanMarkdownPath(record, workspacePath) {
let relPath = record?.markdownOutputs?.defaultForHumans || record?.readableMarkdownPath || record?.markdownOutputs?.readable || record?.outputMarkdownPath || "";
if (workspacePath && relPath.startsWith(workspacePath)) {
relPath = relPath.slice(workspacePath.length).replace(/^[\\\/]+/, "").replace(/\\/g, "/");
}
return relPath;
}
function relativeAiReadyMarkdownPath(record, workspacePath) {
let relPath = record?.outputMarkdownPath || record?.markdownOutputs?.aiReady || "";
if (workspacePath && relPath.startsWith(workspacePath)) {
relPath = relPath.slice(workspacePath.length).replace(/^[\\\/]+/, "").replace(/\\/g, "/");
}
return relPath;
}
function nextFrame() {
return new Promise((resolve) => requestAnimationFrame(resolve));
}
function setExtractionProgress($, active, text = "Extracting to Markdown. This might take a while.") {
const panel = $("extractionProgress"), label = $("extractionProgressText"); if (!panel) return; panel.classList.toggle("hidden", !active); panel.dataset.active = active ? "true" : "false"; if (label) label.textContent = text;
}
export function createDocumentFlowPanel({
$,
api,
run,
state,
tauriInvoke,
refreshManifest,
refreshInbox,
refreshTimeline,
refreshVersions,
ensureWorkspace,
aiContextPanel,
rememberConversionAudit,
renderConversions,
renderEvidence,
showEditorWarningsForRecord,
showAlert,
onImportedRecord
}) {
async function ensureWorkspaceIfNeeded() {
if (typeof ensureWorkspace === "function") {
await ensureWorkspace();
}
}
let lastExportedFileDir = "";
let lastImportedFileDir = "";
function getParentDir(fullPath) {
const clean = String(fullPath || "").replace(/\\/g, "/");
const lastSlash = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  return lastSlash !== -1 ? clean.substring(0, lastSlash) : clean;
 }
 function updateIntakeStatus(titleTxt, pathTxt, showOpen) {
  const container = $("importStatusContainer");
  if (container) container.classList.remove("hidden");
  const t = $("importStatusTitle"), p = $("importStatusPath"), o = $("btnOpenImportedFolder");
  if (t) t.textContent = titleTxt;
  if (p) p.textContent = pathTxt;
  if (o) o.style.display = showOpen ? "inline-block" : "none";
 }
 function setButtonState(btn, s, origTxt = "") {
  if (!btn) return;
  const key = "originalText";
  if (!btn.dataset[key]) btn.dataset[key] = btn.textContent || origTxt || btn.value;
  const orig = btn.dataset[key];
  const style = btn.style;
  if (s === "loading") {
   btn.disabled = true; btn.textContent = `⏳ ${orig}...`; style.opacity = "0.7";
  } else if (s === "success" || s === "error") {
   btn.disabled = false; btn.textContent = (s === "success" ? "✔ " : "✘ ") + orig;
   style.backgroundColor = s === "success" ? "#10b981" : "#ef4444";
   style.color = s === "success" ? "#09090b" : "#fff"; style.opacity = "1";
   setTimeout(() => {
    btn.textContent = orig; style.backgroundColor = ""; style.color = "";
   }, s === "success" ? 2000 : 3000);
  } else {
   btn.disabled = false; btn.textContent = orig; style.backgroundColor = ""; style.color = ""; style.opacity = "1";
  }
 }
 async function exportRecordAs(format) {
  await ensureWorkspaceIfNeeded();
  const docId = $("recordId").value.trim();
  if (!docId) throw new Error("Select a document ID first.");
  const outputRelativePath = outputPathWithExtension($("recordExportPath").value, format);
  const formatBtnMap = {
   docx: $("recordToDocx"),
   pdf: $("recordToPdf"),
   html: $("recordToHtml")
  };
  const btn = formatBtnMap[format];
  setButtonState(btn, "loading");
  const container = $("exportStatusContainer");
  const title = $("exportStatusTitle");
  const pathText = $("exportStatusPath");
  const btnOpenFolder = $("btnOpenExportedFolder");
  if (container) {
   container.classList.remove("hidden");
   container.style.borderColor = "var(--border-color)";
  }
  if (title) {
   title.textContent = format === "html" ? "Exporting HTML..." : (format === "docx" ? "Exporting Word..." : "Exporting PDF...");
  }
  if (pathText) pathText.textContent = outputRelativePath;
  if (btnOpenFolder) btnOpenFolder.style.display = "none";
  setExtractionProgress($, true, `Exporting ${format.toUpperCase()}...`);
  await nextFrame();
  try {
   const result = await api("/api/document/export", { documentId: docId, outputRelativePath, format });
   rememberConversionAudit(result);
   const fullPath = result.outputPath || outputRelativePath;
   if (title) title.textContent = "Export complete";
   if (pathText) pathText.textContent = fullPath;
   lastExportedFileDir = result.outputPath || "";
   if (btnOpenFolder && lastExportedFileDir) {
    btnOpenFolder.style.display = "inline-block";
   }
   setButtonState(btn, "success");
   if (typeof showAlert === "function") {
    showAlert("success", `Export complete: ${fullPath}`);
   }
   return result;
  } catch (err) {
   setButtonState(btn, "error");
   if (title) {
    title.textContent = "Export failed";
    if (container) container.style.borderColor = "#ef4444";
   }
   if (pathText) pathText.textContent = err.message || String(err);
   if (btnOpenFolder) btnOpenFolder.style.display = "none";
   throw err;
  } finally {
   setExtractionProgress($, false);
  }
 }
 function bindDocumentFlowEvents() {
  $("chooseLocalFile").addEventListener("click", () => run(async () => {
   const selected = await tauriInvoke("select_import_file_path");
   if (!selected) return { cancelled: true };
   $("sourcePath").value = selected;
   return { sourcePath: selected };
  }));
  $("chooseLocalDir").addEventListener("click", () => run(async () => {
   const selected = await tauriInvoke("select_import_directory_path");
   if (!selected) return { cancelled: true };
   $("sourcePath").value = selected;
   return { sourcePath: selected };
  }));
  $("importFile").addEventListener("click", () => run(async () => {
   const srcPath = $("sourcePath").value.trim();
   if (!srcPath) return;
   await ensureWorkspaceIfNeeded();
   const btn = $("importFile");
   setButtonState(btn, "loading");
   updateIntakeStatus("Importing...", srcPath, false);
   if (typeof showAlert === "function") showAlert("info", "Importing document path...");
   try {
    const result = await api("/api/import", {
     sourcePath: srcPath
    });
    await refreshManifest();
    refreshInbox(); refreshTimeline();
    if (typeof onImportedRecord === "function") {
     await onImportedRecord(result);
    } else if (result?.id) {
     $("recordId").value = result.id;
    }
    const outPath = result.outputPath || srcPath;
    lastImportedFileDir = getParentDir(outPath);
    updateIntakeStatus("Import complete", outPath, true);
    setButtonState(btn, "success");
    if (typeof showAlert === "function") {
     showAlert("success", `Imported: ${result.title || result.name || result.id || "file"}`);
    }
    return result;
   } catch (err) {
    setButtonState(btn, "error");
    updateIntakeStatus("Import failed", err.message || String(err), false);
    throw err;
   }
  }));
  $("createSampleDocx").addEventListener("click", () => run(async () => {
   await ensureWorkspaceIfNeeded();
   const result = await api("/api/samples/docx");
   $("sourcePath").value = result.sourcePath;
   $("recordId").value = result.document.id;
   await refreshManifest(); refreshInbox();
   return result;
  }));
  $("inspectDataset").addEventListener("click", () => run(async () => {
   await ensureWorkspaceIfNeeded();
   const datasetId = $("recordId").value.trim();
   if (!datasetId) throw new Error("Select a document ID first.");
   const btn = $("inspectDataset");
   setButtonState(btn, "loading");
   updateIntakeStatus("Inspecting dataset...", datasetId, false);
   if (typeof showAlert === "function") showAlert("info", "Inspecting dataset...");
   try {
    const result = await api("/api/dataset/inspect", { datasetId });
    await refreshManifest();
    const outPath = result.schemaPath || result.path || datasetId;
    lastImportedFileDir = getParentDir(outPath);
    updateIntakeStatus("Dataset inspected", outPath, true);
    setButtonState(btn, "success");
    if (typeof showAlert === "function") showAlert("success", "Dataset inspected successfully.");
    return result;
   } catch (err) {
    setButtonState(btn, "error");
    updateIntakeStatus("Inspection failed", err.message || String(err), false);
    throw err;
   }
  }));
  $("convertDocument").addEventListener("click", () => run(async () => {
   await ensureWorkspaceIfNeeded();
   const docId = $("recordId").value.trim();
   if (!docId) throw new Error("Select a document ID first.");
   const btn = $("convertDocument");
   setButtonState(btn, "loading");
   updateIntakeStatus("Extracting to Markdown...", docId, false);
   $("noteContent").value = "Extracting to Markdown. This might take a while.";
   setExtractionProgress($, true);
   if (typeof showAlert === "function") {
    showAlert("info", "Extracting document to Markdown...");
   }
   await nextFrame();
   let completed = false;
   try {
    const result = await api("/api/document/convert", { documentId: docId });
    const manifest = await refreshManifest();
    const doc = (manifest.documents ?? []).find((d) => d.id === docId);
    if (doc && doc.outputMarkdownPath) {
     const workspacePath = state.workspacePath || "";
     const indexPath = relativeHumanMarkdownPath(doc, workspacePath);
     const firstSegmentPath = doc.markdownOutputs?.readableSegments?.segments?.[0]?.relativePath || "";
     const relPath = firstSegmentPath || indexPath;
     $("notePath").value = relPath;
     if (firstSegmentPath) {
      const noteContent = await api("/api/markdown/read", { relativePath: firstSegmentPath });
      $("noteContent").value = noteContent;
      if (typeof showAlert === "function") {
       showAlert("info", `Split ${doc.markdownOutputs.readableSegments.segmentCount}. Opened 1. Index: ${indexPath}`);
      }
     } else if (shouldUseChunkedEditorLoad(doc)) {
      showChunkedEditorPlaceholder($, doc, indexPath);
      if (typeof showAlert === "function") {
       showAlert("info", "Large file: AI chunks are in AI Will See.");
      }
     } else {
      const noteContent = await api("/api/markdown/read", { relativePath: relPath });
      $("noteContent").value = noteContent;
     }
     document.body.dataset.markdownView = "read";
     document.getElementById("reloadReadView")?.click();
     const fullOutPath = doc.outputMarkdownPath;
     lastImportedFileDir = getParentDir(fullOutPath);
     updateIntakeStatus("Extraction complete", fullOutPath, true);
     if (typeof showAlert === "function") {
      showAlert("success", [
       "Document extracted.",
       `Readable Markdown: ${relPath || "not available"}`,
       `AI-ready Markdown: ${relativeAiReadyMarkdownPath(doc, workspacePath) || "not available"}`
      ].join("\n"));
     }
     showEditorWarningsForRecord(doc);
     aiContextPanel.updateAiWillSeePanel();
    }
    refreshTimeline();
    refreshVersions();
    completed = true;
    setExtractionProgress($, false);
    setButtonState(btn, "success");
    return result;
   } catch (err) {
    setButtonState(btn, "error");
    updateIntakeStatus("Extraction failed", err.message || String(err), false);
    throw err;
   } finally {
    setExtractionProgress($, false);
   }
  }));
  $("convertAllDocuments").addEventListener("click", () => run(async () => {
   await ensureWorkspaceIfNeeded();
   const btn = $("convertAllDocuments");
   setButtonState(btn, "loading");
   updateIntakeStatus("Batch extracting...", "All unconverted files in workspace", false);
   setExtractionProgress($, true, "Batch extracting documents. This might take a while.");
   await nextFrame();
   try {
    const result = await api("/api/document/convert-all");
    await refreshManifest();
    refreshTimeline();
    const workspacePath = state.workspacePath || "";
    const notesDir = workspacePath ? `${workspacePath}/notes` : "notes";
    lastImportedFileDir = notesDir;
    updateIntakeStatus("Batch extraction complete", notesDir, true);
    setButtonState(btn, "success");
    return result;
   } catch (err) {
    setButtonState(btn, "error");
    updateIntakeStatus("Batch extraction failed", err.message || String(err), false);
    throw err;
   } finally {
    setExtractionProgress($, false);
   }
  }));
  $("recordToMd").addEventListener("click", () => run(async () => {
   await ensureWorkspaceIfNeeded();
   const docId = $("recordId").value.trim();
   if (!docId) throw new Error("Select a document ID first.");
   const outputRelativePath = outputPathWithExtension($("recordExportPath").value, "md");
   const btn = $("recordToMd");
   setButtonState(btn, "loading");
   const container = $("exportStatusContainer");
   const title = $("exportStatusTitle");
   const pathText = $("exportStatusPath");
   const btnOpenFolder = $("btnOpenExportedFolder");
   if (container) {
    container.classList.remove("hidden");
    container.style.borderColor = "var(--border-color)";
   }
   if (title) title.textContent = "Exporting MD...";
   if (pathText) pathText.textContent = outputRelativePath;
   if (btnOpenFolder) btnOpenFolder.style.display = "none";
   if (typeof showAlert === "function") showAlert("info", `Exporting MD to ${outputRelativePath}...`);
   await nextFrame();
   try {
    const result = await api("/api/record/export-md", {
     recordId: docId,
     outputRelativePath
    });
    rememberConversionAudit(result);
    $("notePath").value = outputRelativePath;
    $("noteContent").value = await api("/api/markdown/read", { relativePath: outputRelativePath });
    document.body.dataset.markdownView = "read";
    document.getElementById("reloadReadView")?.click();
    const fullPath = result.outputPath || outputRelativePath;
    if (title) title.textContent = "Export complete";
    if (pathText) pathText.textContent = fullPath;
    lastExportedFileDir = result.outputPath || "";
    if (btnOpenFolder && lastExportedFileDir) {
     btnOpenFolder.style.display = "inline-block";
    }
    setButtonState(btn, "success");
    if (typeof showAlert === "function") {
     showAlert("success", `Markdown exported and opened: ${outputRelativePath}`);
    }
    return result;
   } catch (err) {
    setButtonState(btn, "error");
    if (title) {
     title.textContent = "Export failed";
     if (container) container.style.borderColor = "#ef4444";
    }
    if (pathText) pathText.textContent = err.message || String(err);
    if (btnOpenFolder) btnOpenFolder.style.display = "none";
    throw err;
   }
  }));
  $("recordToDocx").addEventListener("click", () => run(() => exportRecordAs("docx")));
  $("recordToPdf").addEventListener("click", () => run(() => exportRecordAs("pdf")));
  $("recordToHtml").addEventListener("click", () => run(() => exportRecordAs("html")));
  $("btnOpenExportedFolder").addEventListener("click", () => run(async () => {
   if (!lastExportedFileDir) return;
   let dirPath = lastExportedFileDir;
   const lastSlash = Math.max(dirPath.lastIndexOf("/"), dirPath.lastIndexOf("\\"));
   if (lastSlash !== -1) {
    dirPath = dirPath.substring(0, lastSlash);
   }
   await api("/api/document/open-original", { originalPath: dirPath });
  }));
  $("btnOpenImportedFolder").addEventListener("click", () => run(async () => {
   if (!lastImportedFileDir) return;
   await api("/api/document/open-original", { originalPath: lastImportedFileDir });
  }));
  $("listConversions").addEventListener("click", () => run(async () => {
   const conversions = await api("/api/conversions/list");
   renderConversions(conversions);
   return conversions;
  }));
  $("deleteConversion").addEventListener("click", () => run(async () => {
   if (!state.selectedConversionAuditId) throw new Error("Select a conversion record first.");
   const deleted = await api("/api/conversions/delete", {
    auditId: state.selectedConversionAuditId
   });
   state.selectedConversionAuditId = "";
   $("lastConversion").textContent = "Current conversion record: none selected";
   const conversions = await api("/api/conversions/list");
   renderConversions(conversions);
   return deleted;
  }));
  $("listEvidence").addEventListener("click", () => run(async () => {
   const records = await api("/api/evidence/list");
   renderEvidence(records);
   return records;
  }));
  $("deleteEvidence").addEventListener("click", () => run(async () => {
   if (!state.selectedEvidenceId) throw new Error("Select an evidence record first.");
   const deleted = await api("/api/evidence/delete", {
    evidenceId: state.selectedEvidenceId
   });
   state.selectedEvidenceId = "";
   $("lastEvidence").textContent = "Current evidence: none selected";
   const records = await api("/api/evidence/list");
   renderEvidence(records);
   return deleted;
  }));
  $("btnChooseSanitizeFolder").addEventListener("click", () => run(async () => {
   if (typeof tauriInvoke !== "function") throw new Error("Folder browser is only supported in desktop mode. Please type the absolute path directly.");
   const selected = await tauriInvoke("select_import_directory_path");
   if (!selected) return { cancelled: true };
   $("sanitizeFolderPath").value = selected;
   return { sanitizeFolderPath: selected };
  }));
  $("btnSanitizeFolder").addEventListener("click", () => run(async () => {
   const sourceFolderPath = $("sanitizeFolderPath").value.trim();
   if (!sourceFolderPath) throw new Error("Please enter or choose a folder path first.");
   const btn = $("btnSanitizeFolder");
   setButtonState(btn, "loading");
   const progress = $("folderSanitizeProgress");
   const outputContainer = $("folderSanitizeOutputContainer");
   progress.classList.remove("hidden");
   outputContainer.classList.add("hidden");
   let isDone = false;
   const steps = ["scanning...", "importing...", "extracting...", "masking...", "writing output..."];
   let stepIdx = 0;
   progress.textContent = steps[0];
   const interval = setInterval(() => {
    if (isDone) return;
    progress.textContent = steps[stepIdx];
    stepIdx = Math.min(steps.length - 1, stepIdx + 1);
   }, 1200);
   try {
    const result = await api("/api/folder/sanitize", { sourceFolderPath });
    isDone = true;
    clearInterval(interval);
    progress.textContent = "";
    progress.classList.add("hidden");
    $("folderSanitizeOutputPath").textContent = result.outputFolderPath;
    outputContainer.classList.remove("hidden");
    await refreshManifest();
    refreshTimeline();
    setButtonState(btn, "success");
    if (typeof showAlert === "function") {
     showAlert("success", `Sanitization completed. Processed: ${result.processedCount}, Skipped: ${result.skippedCount}`);
    }
    return result;
   } catch (err) {
    isDone = true;
    clearInterval(interval);
    progress.textContent = "";
    progress.classList.add("hidden");
    setButtonState(btn, "error");
    throw err;
   }
  }));
  $("btnOpenSanitizedFolder").addEventListener("click", () => run(async () => {
   const targetPath = $("folderSanitizeOutputPath").textContent.trim();
   if (!targetPath) return;
   return api("/api/document/open-original", { originalPath: targetPath });
  }));
 }
 return { bindDocumentFlowEvents };
}
