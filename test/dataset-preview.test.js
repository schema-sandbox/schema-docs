import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDatasetPreviewModel,
  createDatasetPreviewPanel,
  findReadyDataset
} from "../public/datasetPreviewPanel.js";
import { createManifestPanel } from "../public/manifestPanel.js";
import { loadOptionalManifestUiData, refreshedDatasetSelection } from "../public/manifestRefresh.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function workbookDataset(overrides = {}) {
  return {
    id: "dataset-workbook",
    kind: "dataset",
    sourceType: "xlsx",
    status: "ready",
    name: "Workbook",
    sheets: [{
      sheetId: "sheet-1",
      name: "Alpha",
      columns: [{ name: "Name" }, { name: "Value" }],
      previewRows: [{ Name: "Alpha", Value: "10" }, { Name: "Beta", Value: "20" }],
      totalRowsEstimate: 2
    }],
    ...overrides
  };
}

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.values = new Set();
  }

  set(value) {
    this.values = new Set(String(value || "").split(/\s+/).filter(Boolean));
  }

  add(...values) {
    values.forEach((value) => this.values.add(value));
  }

  remove(...values) {
    values.forEach((value) => this.values.delete(value));
  }

  contains(value) {
    return this.values.has(value);
  }

  toggle(value, force) {
    const enabled = force === undefined ? !this.values.has(value) : Boolean(force);
    if (enabled) this.values.add(value);
    else this.values.delete(value);
    return enabled;
  }

  toString() {
    return [...this.values].join(" ");
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = new FakeClassList(this);
    this.textContent = "";
    this.scrolled = false;
    this.focused = false;
  }

  set id(value) {
    this._id = value;
    if (value) this.ownerDocument.elements.set(value, this);
  }

  get id() {
    return this._id || "";
  }

  set className(value) {
    this.classList.set(value);
  }

  get className() {
    return this.classList.toString();
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  insertAdjacentElement(position, element) {
    assert.equal(position, "afterend");
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    element.parentElement = this.parentElement;
    siblings.splice(index + 1, 0, element);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  addEventListener(name, callback) {
    this.listeners.set(name, callback);
  }

  scrollIntoView() {
    this.scrolled = true;
  }

  focus() {
    this.focused = true;
  }
}

function fakeBrowser() {
  const document = {
    elements: new Map(),
    queries: new Map(),
    createElement(tagName) {
      return new FakeElement(tagName, document);
    },
    getElementById(id) {
      return document.elements.get(id) || null;
    },
    querySelector(selector) {
      return document.queries.get(selector) || null;
    }
  };
  const body = document.createElement("body");
  body.dataset = {};
  document.body = body;
  const root = document.createElement("main");
  root.className = "grid";
  const flowPanel = document.createElement("article");
  flowPanel.className = "document-flow-panel";
  const importSection = document.createElement("div");
  const status = document.createElement("div");
  status.id = "importStatusContainer";
  importSection.append(status);
  flowPanel.append(importSection);
  root.append(flowPanel);
  body.append(root);
  document.queries.set(".grid", root);
  document.queries.set(".document-flow-panel", flowPanel);
  return { document, root, flowPanel };
}

function descendantText(element) {
  return [element.textContent, ...element.children.flatMap((child) => descendantText(child))].join(" ");
}

test("spreadsheet preview model exposes the first two rows and never exceeds twenty", () => {
  const rows = Array.from({ length: 24 }, (_, index) => ({ Name: `Row ${index + 1}`, Value: index + 1 }));
  const dataset = workbookDataset({
    sheets: [{
      sheetId: "sheet-1",
      name: "Alpha",
      columns: [{ name: "Name" }, { name: "Value" }],
      previewRows: rows,
      totalRowsEstimate: 24
    }]
  });
  const model = createDatasetPreviewModel(dataset, { maxRows: 99 });
  assert.equal(model.rows.length, 20);
  assert.deepEqual(model.rows.slice(0, 2), [{ Name: "Row 1", Value: 1 }, { Name: "Row 2", Value: 2 }]);
});

test("dedicated preview host stays outside the mode-specific document panel", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const browser = fakeBrowser();
  globalThis.document = browser.document;
  globalThis.window = { translateText: (value) => value, requestAnimationFrame: (callback) => callback() };
  try {
    const state = {};
    const panel = createDatasetPreviewPanel({ $: (id) => browser.document.getElementById(id), state });
    panel.render(workbookDataset());
    const host = browser.document.getElementById("datasetPreview");
    const renderedText = descendantText(browser.document.getElementById("datasetPreviewTable"));
    browser.document.body.dataset.productMode = "office";
    browser.document.body.dataset.activeView = "home";
    assert.equal(host.classList.contains("hidden"), false);
    assert.equal(host.classList.contains("advanced-panel"), false);
    assert.equal(host.classList.contains("document-flow-panel"), false);
    assert.equal(host.classList.contains("dataset-preview-panel"), true);
    assert.equal(host.parentElement, browser.root);
    assert.notEqual(host.parentElement, browser.flowPanel);
    assert.match(renderedText, /Alpha/);
    assert.match(renderedText, /Beta/);
    browser.document.body.dataset.productMode = "markdown";
    browser.document.body.dataset.activeView = "editor";
    assert.equal(host.classList.contains("hidden"), false);
    assert.equal(host.parentElement, browser.root);
    const styles = await readFile(path.join(projectRoot, "public", "styles.css"), "utf8");
    assert.match(styles, /\.dataset-preview-panel\{[^}]*grid-column:1\/-1/);
    assert.doesNotMatch(
      styles,
      /body\[data-(?:active-view|product-mode)=[^\]]+\][^{]*\.dataset-preview-panel[^}]*display\s*:\s*none/
    );
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("worksheet tabs switch the preview to the selected sheet", () => {
  const dataset = workbookDataset({
    sheets: [
      { sheetId: "one", name: "First", columns: [{ name: "Name" }], previewRows: [{ Name: "Alpha" }], totalRowsEstimate: 1 },
      { sheetId: "two", name: "Second", columns: [{ name: "Name" }], previewRows: [{ Name: "Beta" }], totalRowsEstimate: 1 }
    ]
  });
  const first = createDatasetPreviewModel(dataset);
  const second = createDatasetPreviewModel(dataset, { sheetId: "two" });
  assert.equal(first.selectedSheetName, "First");
  assert.equal(second.selectedSheetName, "Second");
  assert.deepEqual(second.rows, [{ Name: "Beta" }]);
  assert.deepEqual(second.sheets.map(({ selected }) => selected), [false, true]);
});

test("rendering dataset B replaces dataset A instead of leaving stale rows", () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const browser = fakeBrowser();
  globalThis.document = browser.document;
  globalThis.window = { translateText: (value) => value, requestAnimationFrame: (callback) => callback() };
  try {
    const panel = createDatasetPreviewPanel({ $: (id) => browser.document.getElementById(id), state: {} });
    panel.render(workbookDataset({
      id: "dataset-a",
      name: "Dataset A",
      sheets: [{ sheetId: "a", name: "A", columns: [{ name: "Name" }], previewRows: [{ Name: "Only A" }], totalRowsEstimate: 1 }]
    }));
    panel.render(workbookDataset({
      id: "dataset-b",
      name: "Dataset B",
      sheets: [{ sheetId: "b", name: "B", columns: [{ name: "Name" }], previewRows: [{ Name: "Only B" }], totalRowsEstimate: 1 }]
    }));
    const hostText = descendantText(browser.document.getElementById("datasetPreview"));
    assert.match(hostText, /Dataset B/);
    assert.match(hostText, /Only B/);
    assert.doesNotMatch(hostText, /Dataset A|Only A/);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("zero-row worksheets show an explicit empty-preview message", () => {
  const model = createDatasetPreviewModel(workbookDataset({
    sheets: [{ sheetId: "empty", name: "Empty", columns: [{ name: "Name" }], previewRows: [], totalRowsEstimate: 0 }]
  }));
  assert.equal(model.shownRows, 0);
  assert.equal(model.totalRows, 0);
  assert.equal(model.emptyMessage, "This worksheet has no data rows to preview.");
});

test("manifest selection reveals A then B and clears the table before selecting a document", async () => {
  const previousWindow = globalThis.window;
  const calls = [];
  const state = {};
  const elements = {
    recordId: { value: "" },
    editorWarnings: { classList: { add: (value) => calls.push(`warnings:${value}`) } },
    notePath: { value: "" },
    noteContent: { value: "" }
  };
  globalThis.window = {
    renderMarkdownReadView: () => calls.push("render-document"),
    setMarkdownViewMode: (mode) => calls.push(`view:${mode}`)
  };
  try {
    const datasetPreviewPanel = {
      revealDataset: async (record) => calls.push(`reveal:${record.id}`),
      clear: () => calls.push("clear")
    };
    const panel = createManifestPanel({
      $: (id) => elements[id],
      api: async () => ({}),
      state,
      pill: () => ({}),
      escapeHtml: String,
      run: (action) => action(),
      assertSuccessfulJob: (job) => job,
      showAlert: () => {},
      exchangePackagePanel: {},
      aiContextPanel: {},
      aiSummonPanel: {},
      refreshManifest: async () => ({ documents: [], datasets: [] }),
      refreshTimeline: () => {},
      refreshVersions: () => {},
      rememberConversionAudit: (value) => value,
      showEditorWarningsForRecord: () => {},
      datasetPreviewPanel
    });
    const datasetA = workbookDataset({ id: "dataset-a", name: "A" });
    const datasetB = workbookDataset({ id: "dataset-b", name: "B" });
    await panel.selectRecordForWorkflow(datasetA, "dataset");
    assert.equal(state.currentRecord, datasetA);
    await panel.selectRecordForWorkflow(datasetB, "dataset");
    assert.equal(state.selectedRecord, datasetB);
    await panel.selectRecordForWorkflow({ id: "document-c", kind: "document", status: "pending" }, "document");
    assert.equal(state.currentRecord.id, "document-c");
    assert.deepEqual(calls.slice(0, 3), ["reveal:dataset-a", "warnings:hidden", "reveal:dataset-b"]);
    assert.ok(calls.indexOf("clear") > calls.indexOf("reveal:dataset-b"));
  } finally {
    globalThis.window = previousWindow;
  }
});

test("optional adapter and update failures do not discard manifest refresh data", async () => {
  const errors = [];
  const optional = await loadOptionalManifestUiData({
    loadCapabilities: async () => ({ docx: true }),
    loadAdapterCapabilities: () => { throw new Error("adapter offline"); },
    loadSourceUpdates: async () => { throw new Error("update scan failed"); },
    onError: (name, error) => errors.push(`${name}:${error.message}`)
  });
  assert.deepEqual(optional.capabilities, { docx: true });
  assert.equal(optional.adapterCapabilities, null);
  assert.deepEqual(optional.updates, []);
  assert.deepEqual(errors, [
    "adapter capabilities:adapter offline",
    "source updates:update scan failed"
  ]);

  const source = await readFile(path.join(projectRoot, "public", "app.js"), "utf8");
  const workflow = source.slice(source.indexOf("async function refreshManifest"), source.indexOf("async function ensureWorkspaceForFirstWorkflow"));
  assert.ok(workflow.indexOf("const manifest = await api(\"/api/manifest\")") >= 0);
  assert.ok(workflow.indexOf("manifestPanel.renderManifest(manifest)") < workflow.indexOf("await loadOptionalManifestUiData"));
  assert.match(workflow, /return manifest;/);
});

test("manifest refresh replaces or clears only an active dataset selection", () => {
  const selected = workbookDataset({ id: "dataset-a", name: "Old A" });
  const refreshed = workbookDataset({ id: "dataset-a", name: "Fresh A" });
  assert.equal(refreshedDatasetSelection({ datasets: [refreshed] }, selected), refreshed);
  assert.equal(refreshedDatasetSelection({ datasets: [] }, selected), null);
  assert.equal(
    refreshedDatasetSelection({ datasets: [refreshed] }, { id: "document-a", kind: "document", sourceType: "pdf" }),
    undefined
  );
});

test("workspace and Markdown transitions clear stale spreadsheet previews", async () => {
  const source = await readFile(path.join(projectRoot, "public", "app.js"), "utf8");
  const setWorkspace = source.slice(source.indexOf("function setWorkspacePath"), source.indexOf("function focusPrimaryWorkspaceMode"));
  assert.match(setWorkspace, /if \(changedWorkspace\) clearDatasetPreviewSelection\(\)/);

  const importWorkflow = source.slice(
    source.indexOf("async function selectAndPrepareImportedRecord"),
    source.indexOf("async function desktopDiagnostics")
  );
  assert.ok(importWorkflow.indexOf("clearDatasetPreviewSelection();") < importWorkflow.indexOf("const inspected = assertSuccessfulJob("));

  const workspaceMarkdown = source.slice(source.indexOf("async function loadMarkdownRelativePath"), source.indexOf("async function handleMarkdownImportFile"));
  assert.ok(workspaceMarkdown.indexOf("const content = await api") < workspaceMarkdown.indexOf("clearDatasetPreviewSelection();"));
  const externalMarkdown = source.slice(source.indexOf("async function handleOpenMarkdownFile"), source.indexOf("async function handleMarkdownPrepareForAi"));
  assert.ok(externalMarkdown.indexOf("const content = await readExternalMarkdownFile") < externalMarkdown.indexOf("clearDatasetPreviewSelection();"));
});

test("failed or stale inspections cannot be reported as a ready table", async () => {
  assert.throws(() => findReadyDataset({ datasets: [] }, "missing"), /was not found after inspection/);
  assert.throws(
    () => findReadyDataset({ datasets: [workbookDataset({ status: "pending" })] }, "dataset-workbook"),
    /is not ready after inspection/
  );

  const source = await readFile(path.join(projectRoot, "public", "app.js"), "utf8");
  const workflow = source.slice(
    source.indexOf("async function selectAndPrepareImportedRecord"),
    source.indexOf("async function desktopDiagnostics")
  );
  const assertionIndex = workflow.indexOf("const inspected = assertSuccessfulJob(");
  const refreshedSelectionIndex = workflow.indexOf("const readyDataset = findReadyDataset(");
  const revealIndex = workflow.indexOf("await datasetPreviewPanel.revealDataset(readyDataset);");
  const successIndex = workflow.indexOf("showAlert(\"success\", `Table ready for filtering:");
  assert.ok(assertionIndex >= 0);
  assert.ok(refreshedSelectionIndex > assertionIndex);
  assert.ok(revealIndex > refreshedSelectionIndex);
  assert.ok(successIndex > revealIndex);
  assert.match(workflow, /state\.currentRecord = readyDataset;\s*state\.selectedRecord = readyDataset;/);
});
