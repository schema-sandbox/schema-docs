function makeDetails(title, description = "") {
 const details = document.createElement("details");
 details.className = "first-release-details";
 const summary = document.createElement("summary");
 const copy = document.createElement("span");
 const strong = document.createElement("strong");
 strong.textContent = title;
 copy.append(strong);
 if (description) {
  const small = document.createElement("small");
  small.textContent = description;
  copy.append(small);
 }
 summary.append(copy);
 details.append(summary);
 return details;
}

function move(target, ...nodes) {
 nodes.filter(Boolean).forEach((node) => target.append(node));
}

export function configureFirstReleaseUi({ $ }) {
 const flowPanel = document.querySelector(".document-flow-panel");
 const manualPathBox = flowPanel?.querySelector(".manual-path-box");
 const sourcePath = $("sourcePath");
 const importButton = $("importFile");
 const chooseFile = $("chooseLocalFile");
 const chooseFolder = $("chooseLocalDir");

 const workspacePath = $("workspacePath");
 const chooseWorkspace = $("chooseWorkspace");
 if (workspacePath) {
  workspacePath.readOnly = true;
  workspacePath.placeholder = "Current workspace location";
  workspacePath.setAttribute("aria-label", "Current workspace location");
 }
 if (chooseWorkspace) chooseWorkspace.textContent = "Choose or create workspace...";
 [$("openWorkspace"), $("createTempWorkspace"), $("runFirstWorkflow"), $("desktopDiagnostics")]
  .filter(Boolean)
  .forEach((button) => {
   button.classList.add("hidden");
   button.setAttribute("aria-hidden", "true");
   button.tabIndex = -1;
  });

 const flowHeading = flowPanel?.querySelector("h2");
 if (flowHeading) flowHeading.textContent = "Open Markdown or import a document";
 const flowDescription = flowPanel?.querySelector(".section-description");
 if (flowDescription) {
  flowDescription.textContent = "Open Markdown unchanged for editing, or import another document and convert it to Markdown.";
 }

 const openMarkdown = $("openMarkdownFile");
 const dropZone = $("dropZone");
 const fileInput = $("fileInput");
 if (openMarkdown && dropZone) {
  const entryActions = document.createElement("div");
  entryActions.className = "first-release-entry-actions";
  openMarkdown.classList.remove("flex-button");
  openMarkdown.classList.add("first-release-open-markdown");
  openMarkdown.textContent = "Open Markdown";
  entryActions.append(openMarkdown);
  dropZone.before(entryActions);
 }
 if (dropZone) {
  dropZone.querySelector(".drop-title")?.replaceChildren("Import document");
  dropZone.querySelector(".drop-subtitle")?.replaceChildren("Drop a file here or click to choose");
  dropZone.querySelector(".drop-formats")?.replaceChildren("Word, PDF, PowerPoint, Excel, CSV, or TXT");
 }
 if (fileInput) fileInput.accept = ".docx,.pdf,.pptx,.xlsx,.xls,.csv,.txt";

 if (manualPathBox && sourcePath && importButton && chooseFile && chooseFolder) {
  const pickerRow = chooseFile.parentElement;
  const pathRow = sourcePath.parentElement;
  pickerRow?.classList.add("first-release-picker-row");
  pathRow?.classList.add("first-release-selected-row");
  manualPathBox.prepend(pickerRow);
  pickerRow?.after(pathRow);
  const label = manualPathBox.querySelector("label");
  if (label) {
   label.textContent = "Choose a file or folder first.";
   pickerRow?.before(label);
  }
  chooseFile.textContent = "Choose file";
  chooseFolder.textContent = "Choose folder";
  importButton.textContent = "Import selected item";
  sourcePath.readOnly = true;
  sourcePath.placeholder = "Nothing selected";
  sourcePath.setAttribute("aria-label", "Selected file or folder");
 }

 const historyContent = $("manifestSummary")?.closest(".subsection");
 if (historyContent && flowPanel) {
  const history = makeDetails("Document history", "Imported documents and past conversions");
  history.id = "documentHistory";
  history.classList.add("document-history");
  historyContent.querySelector(":scope > span")?.remove();
  history.append(historyContent);
  const insertAfter = flowPanel.querySelector("#dropZone");
  insertAfter?.after(history);
 }

 const markdown = document.querySelector(".markdown-workbench");
 const markdownSection = markdown?.closest("section") || markdown;
 const workbench = document.createElement("section");
 workbench.id = "developerWorkbench";
 workbench.className = "panel developer-workbench advanced-panel";
 workbench.innerHTML = `<header><h2>Developer workbench</h2><p>Internal maintenance, SQL, verified exchange packages, and diagnostics.</p></header>`;

 const runtime = makeDetails("Runtime and audit", "Adapters, evidence records, and system capabilities");
 move(runtime,
  $("formatMatrix"),
  $("refreshAdapters")?.closest(".section-row"),
  $("adapterCapabilities"),
  $("listEvidence")?.closest(".section-row"),
  $("evidenceRecords")
 );

 const diagnostics = makeDetails("Workspace diagnostics", "Inbox, timeline, settings, and quality checks");
 move(diagnostics, document.querySelector(".dashboard-panel"));

 const conversion = makeDetails("Internal conversion tools", "Record IDs, batch extraction, and conversion records");
 move(conversion, $("recordId")?.closest(".subsection"));

 const advancedImport = makeDetails("File and folder import controls", "Manual paths and folder batch import");
 move(advancedImport, manualPathBox);

 const dataTools = makeDetails("SQL and verified exchange packages", "Specialist data queries and audited handoff packages");
 move(dataTools,
  $("runQuery")?.closest("article"),
  $("saveExchangePackage")?.closest("article")
 );

 const testTools = makeDetails("Sample and test tools", "Sample documents and diagnostic output");
 $("createSampleDocx")?.classList.add("hidden");
 move(testTools,
  $("createSampleDocx"),
  document.querySelector(".output-console-panel")
 );

 move(workbench, advancedImport, runtime, diagnostics, conversion, dataTools, testTools);
 markdownSection?.parentElement?.insertBefore(workbench, markdownSection);

 return { workbench };
}
