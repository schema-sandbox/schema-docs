import test from "node:test";
import assert from "node:assert/strict";
import { createManifestPanel } from "../public/manifestPanel.js";

class FakeClassList {
  constructor() {
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

  toString() {
    return [...this.values].join(" ");
  }
}

class FakeTextNode {
  constructor(text, ownerDocument) {
    this.nodeType = 3;
    this.textContent = String(text);
    this.ownerDocument = ownerDocument;
    this.parentElement = null;
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentElement = null;
    this.listeners = new Map();
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.dataset = {};
    this.style = {};
    this.textContent = "";
    this.value = "";
    this.disabled = false;
  }

  set id(value) {
    this._id = String(value || "");
    if (this._id) this.ownerDocument.elements.set(this._id, this);
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
    for (const rawChild of children) {
      const child = rawChild instanceof FakeElement || rawChild instanceof FakeTextNode
        ? rawChild
        : new FakeTextNode(rawChild, this.ownerDocument);
      child.parentElement = this;
      this.children.push(child);
    }
  }

  appendChild(child) {
    this.append(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  addEventListener(name, callback) {
    const listeners = this.listeners.get(name) || [];
    listeners.push(callback);
    this.listeners.set(name, listeners);
  }

  async click() {
    const event = { currentTarget: this, target: this, type: "click" };
    const results = [];
    for (const callback of this.listeners.get("click") || []) {
      results.push(await callback(event));
    }
    return results.at(-1);
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function readyDocument(overrides = {}) {
  return {
    id: "document-ready",
    kind: "document",
    title: "Ready document",
    sourceType: "docx",
    status: "ready",
    outputMarkdownPath: "outputs/ready.md",
    readableMarkdownPath: "outputs/ready.md",
    sourcePath: "imports/ready.docx",
    createdAt: "2026-08-05T00:00:00.000Z",
    ...overrides
  };
}

function dataset(overrides = {}) {
  return {
    id: "dataset-ready",
    kind: "dataset",
    name: "Ready dataset",
    sourceType: "xlsx",
    status: "ready",
    sourcePath: "imports/data.xlsx",
    createdAt: "2026-08-05T00:00:00.000Z",
    ...overrides
  };
}

function selectionHarness({
  documents = [],
  datasets = [],
  api = async () => "markdown content",
  beforeDocumentSelected,
  onDocumentSelected
} = {}) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const document = {
    elements: new Map(),
    createElement(tagName) {
      return new FakeElement(tagName, document);
    }
  };
  document.body = document.createElement("body");
  globalThis.document = document;

  const windowCalls = [];
  globalThis.window = {
    translateText: (value) => value,
    renderMarkdownReadView: () => windowCalls.push("render"),
    setMarkdownViewMode: (mode) => windowCalls.push(`mode:${mode}`)
  };

  const elements = {};
  for (const id of ["manifestSummary", "recordId", "notePath", "noteContent", "editorWarnings"]) {
    const element = document.createElement(id === "noteContent" ? "textarea" : "div");
    element.id = id;
    elements[id] = element;
  }

  const state = {
    currentRecord: { id: "original-current" },
    selectedRecord: { id: "original-selected" },
    workspacePath: "C:/workspace"
  };
  const selectionButtons = new Map();
  const previewCalls = [];
  let lastRun;
  const panel = createManifestPanel({
    $: (id) => elements[id],
    api,
    state,
    pill: (label, data = {}) => {
      const button = document.createElement("button");
      button.textContent = label;
      Object.assign(button.dataset, data);
      if (label === "Select") selectionButtons.set(data.recordId, button);
      return button;
    },
    escapeHtml: String,
    run: (action) => {
      lastRun = Promise.resolve().then(action);
      return lastRun;
    },
    assertSuccessfulJob: (job) => job,
    showAlert: () => {},
    exchangePackagePanel: {},
    aiContextPanel: { updateAiWillSeePanel: async () => ({}) },
    aiSummonPanel: {},
    refreshManifest: async () => ({ documents: [], datasets: [] }),
    refreshTimeline: () => {},
    refreshVersions: () => {},
    rememberConversionAudit: (value) => value,
    showEditorWarningsForRecord: () => {},
    datasetPreviewPanel: {
      revealDataset: async (record) => previewCalls.push(`reveal:${record.id}`),
      clear: () => previewCalls.push("clear")
    },
    beforeDocumentSelected,
    onDocumentSelected
  });
  panel.renderManifest({ documents, datasets, exchangePackages: [], aiHandoffBundles: [], jobs: [] });

  return {
    elements,
    lastRun: () => lastRun,
    previewCalls,
    restore() {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
    },
    select(recordId) {
      const button = selectionButtons.get(recordId);
      assert.ok(button, `missing Select button for ${recordId}`);
      return button.click();
    },
    state,
    windowCalls
  };
}

test("ready document Select runs the guard before mutation and cancellation returns explicitly", async () => {
  const record = readyDocument();
  const gate = deferred();
  const events = [];
  const harness = selectionHarness({
    documents: [record],
    beforeDocumentSelected: async () => {
      events.push("guard:start");
      const allowed = await gate.promise;
      events.push("guard:end");
      return allowed;
    },
    onDocumentSelected: () => events.push("callback")
  });
  try {
    const initialCurrent = harness.state.currentRecord;
    const initialSelected = harness.state.selectedRecord;
    const click = harness.select(record.id);
    await Promise.resolve();
    assert.deepEqual(events, ["guard:start"]);
    assert.equal(harness.state.currentRecord, initialCurrent);
    assert.equal(harness.state.selectedRecord, initialSelected);
    assert.equal(harness.elements.recordId.value, "");
    assert.equal(harness.elements.notePath.value, "");
    assert.equal(harness.elements.noteContent.value, "");

    gate.resolve(false);
    assert.deepEqual(await click, { cancelled: true });
    assert.deepEqual(await harness.lastRun(), { cancelled: true });
    assert.deepEqual(events, ["guard:start", "guard:end"]);
    assert.equal(harness.state.currentRecord, initialCurrent);
    assert.equal(harness.state.selectedRecord, initialSelected);
  } finally {
    harness.restore();
  }
});

test("ready document Select awaits Markdown read before navigation callback", async () => {
  const record = readyDocument();
  const markdown = deferred();
  const events = [];
  let harness;
  harness = selectionHarness({
    documents: [record],
    beforeDocumentSelected: async () => {
      events.push("guard");
      return true;
    },
    api: async (route, body) => {
      assert.equal(route, "/api/markdown/read");
      assert.deepEqual(body, { relativePath: "outputs/ready.md" });
      events.push("read:start");
      const content = await markdown.promise;
      events.push("read:end");
      return content;
    },
    onDocumentSelected: ({ record: selected, result }) => {
      events.push("callback");
      assert.equal(selected, record);
      assert.deepEqual(result, { selectedRecordId: record.id, kind: "document" });
      assert.equal(harness.elements.noteContent.value, "# Loaded");
    }
  });
  try {
    const click = harness.select(record.id);
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(events, ["guard", "read:start"]);
    assert.equal(harness.state.currentRecord.id, "original-current");
    assert.equal(harness.state.selectedRecord.id, "original-selected");
    assert.equal(harness.elements.notePath.value, "");
    assert.equal(harness.elements.noteContent.value, "");

    markdown.resolve("# Loaded");
    assert.deepEqual(await click, { selectedRecordId: record.id, kind: "document" });
    assert.deepEqual(events, ["guard", "read:start", "read:end", "callback"]);
    assert.equal(harness.state.currentRecord, record);
    assert.equal(harness.state.selectedRecord, record);
    assert.equal(harness.elements.recordId.value, record.id);
    assert.equal(harness.elements.notePath.value, "outputs/ready.md");
    assert.equal(harness.elements.noteContent.value, "# Loaded");
    assert.deepEqual(harness.windowCalls, ["render", "mode:edit"]);
  } finally {
    harness.restore();
  }
});

test("segmented PDF Select reads and opens the first readable part", async () => {
  const record = readyDocument({
    id: "segmented-pdf",
    title: "Segmented PDF",
    sourceType: "pdf",
    outputMarkdownPath: "outputs/segmented.ai.md",
    readableMarkdownPath: "outputs/segmented.readable.md",
    markdownOutputs: {
      defaultForHumans: "outputs/segmented.readable.md",
      readableSegments: {
        segmented: true,
        segmentCount: 2,
        sourceMapRelativePath: "outputs/readable/segmented.map.json",
        segments: [
          { relativePath: "outputs/readable/segmented.readable_1.md" },
          { relativePath: "outputs/readable/segmented.readable_2.md" }
        ]
      }
    }
  });
  const calls = [];
  let harness;
  harness = selectionHarness({
    documents: [record],
    beforeDocumentSelected: () => {
      calls.push("guard");
      return true;
    },
    api: async (route, body) => {
      calls.push(`read:${body.relativePath}`);
      return "Part one content";
    },
    onDocumentSelected: () => {
      calls.push(`callback:${harness.elements.notePath.value}:${harness.elements.noteContent.value}`);
    }
  });
  try {
    await harness.select(record.id);
    assert.equal(harness.elements.notePath.value, "outputs/readable/segmented.readable_1.md");
    assert.equal(harness.elements.noteContent.value, "Part one content");
    assert.deepEqual(calls, [
      "guard",
      "read:outputs/readable/segmented.readable_1.md",
      "callback:outputs/readable/segmented.readable_1.md:Part one content"
    ]);
  } finally {
    harness.restore();
  }
});

test("dataset and pending document Select skip editor navigation guard and callback", async () => {
  const data = dataset();
  const pending = readyDocument({
    id: "document-pending",
    title: "Pending document",
    status: "pending",
    outputMarkdownPath: ""
  });
  const callbacks = [];
  const harness = selectionHarness({
    documents: [pending],
    datasets: [data],
    beforeDocumentSelected: () => callbacks.push("guard"),
    onDocumentSelected: () => callbacks.push("callback")
  });
  try {
    assert.deepEqual(await harness.select(data.id), { selectedRecordId: data.id, kind: "dataset" });
    assert.equal(harness.state.selectedRecord, data);
    assert.deepEqual(harness.previewCalls, [`reveal:${data.id}`]);
    assert.deepEqual(callbacks, []);

    assert.deepEqual(await harness.select(pending.id), { selectedRecordId: pending.id, kind: "document" });
    assert.equal(harness.state.selectedRecord, pending);
    assert.deepEqual(harness.previewCalls, [`reveal:${data.id}`, "clear"]);
    assert.deepEqual(callbacks, []);
  } finally {
    harness.restore();
  }
});

test("Markdown read rejection prevents the document navigation callback", async () => {
  const record = readyDocument();
  const failure = new Error("read failed");
  const events = [];
  const harness = selectionHarness({
    documents: [record],
    beforeDocumentSelected: () => {
      events.push("guard");
      return true;
    },
    api: async () => {
      events.push("read");
      throw failure;
    },
    onDocumentSelected: () => events.push("callback")
  });
  try {
    await assert.rejects(harness.select(record.id), (error) => error === failure);
    await assert.rejects(harness.lastRun(), (error) => error === failure);
    assert.deepEqual(events, ["guard", "read"]);
    assert.equal(harness.state.currentRecord.id, "original-current");
    assert.equal(harness.state.selectedRecord.id, "original-selected");
    assert.equal(harness.elements.notePath.value, "");
    assert.equal(harness.elements.noteContent.value, "");
  } finally {
    harness.restore();
  }
});
