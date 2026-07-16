import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createI18nPanel } from "../public/i18nPanel.js";
const projectRoot = path.resolve(import.meta.dirname, "..");
const mojibakeGuardPattern = /[\u951f\u934f\u95ab\u6769\u5997\u7ec0\u7035\u8930\u93c8\u5bb8\u93c2\u6d5c\u705e\u923f\u93c4\u9359\u9422\u5be4\u93ad\u9983\u6d93\ue15f\u6783\u9423\u5c84\u6f70\ufffd]/u;
class FakeTextNode {
  constructor(value) {
    this.nodeType = 3;
    this.nodeValue = value;
    this.parentElement = null;
  }
}
class FakeElement {
  constructor(tagName) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.childNodes = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.dataset = {};
    this.classList = {
      values: new Set(),
      toggle: (name, enabled) => {
        if (enabled) {
          this.classList.values.add(name);
        } else {
          this.classList.values.delete(name);
        }
      }
    };
  }
  appendChild(node) {
    node.parentElement = this;
    this.childNodes.push(node);
    return node;
  }
  get textContent() {
    return this.childNodes.map((node) => node.nodeType === 3 ? node.nodeValue : node.textContent).join("");
  }
  set textContent(value) {
    this.childNodes = [new FakeTextNode(value)];
    this.childNodes[0].parentElement = this;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name) {
    return this.attributes.has(name);
  }
  closest(selector) {
    const selectors = selector.split(",").map((item) => item.trim());
    let current = this;
    while (current) {
      if (selectors.includes(current.tagName.toLowerCase())) {
        return current;
      }
      if (selectors.includes("[data-i18n-skip]") && current.hasAttribute?.("data-i18n-skip")) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }
}
function createFakeDocument() {
  const body = new FakeElement("body");
  const documentElement = new FakeElement("html");
  function collect(root) {
    const nodes = [];
    function visit(node) {
      for (const child of node.childNodes ?? []) {
        nodes.push(child);
        if (child.nodeType === 1) {
          visit(child);
        }
      }
    }
    visit(root);
    return nodes;
  }
  return {
    nodeType: 9,
    body,
    documentElement,
    createTreeWalker(root) {
      const nodes = collect(root);
      let index = -1;
      return {
        currentNode: null,
        nextNode() {
          index += 1;
          this.currentNode = nodes[index] ?? null;
          return Boolean(this.currentNode);
        }
      };
    }
  };
}
function withFakeBrowserGlobals(callback) {
  const previous = {
    document: globalThis.document,
    Node: globalThis.Node,
    NodeFilter: globalThis.NodeFilter,
    localStorage: globalThis.localStorage,
    MutationObserver: globalThis.MutationObserver
  };
  const document = createFakeDocument();
  const storage = new Map();
  globalThis.document = document;
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1, DOCUMENT_NODE: 9 };
  globalThis.NodeFilter = { SHOW_TEXT: 4, SHOW_ELEMENT: 1 };
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value))
  };
  globalThis.MutationObserver = class {
    constructor(callbackFn) {
      this.callbackFn = callbackFn;
      this.connected = false;
    }
    observe() {
      this.connected = true;
    }
    disconnect() {
      this.connected = false;
    }
  };
  try {
    return callback(document);
  } finally {
    Object.assign(globalThis, previous);
  }
}
test("Chinese locale translates core user-facing UI text without mojibake", async () => {
  const source = await readFile(path.join(projectRoot, "public", "i18nPanel.js"), "utf8");
  assert.doesNotMatch(source, mojibakeGuardPattern);
  const panel = createI18nPanel({ $: () => null });
  assert.equal(
    panel._test.translateText("Before sending a document to AI, see what AI will see. Do not send raw files directly to AI."),
    "\u53d1\u9001\u524d\u5148\u9884\u89c8\u3002"
  );
  assert.equal(panel._test.translateText("Extract to Markdown"), "\u63d0\u53d6\u4e3a Markdown");
  assert.equal(panel._test.translateText("AI Will See & Send Gate"), "AI \u5c06\u770b\u5230 / Send Gate");
  assert.equal(panel._test.translateText("Save clean AI-ready copy"), "\u4fdd\u5b58\u5e72\u51c0 AI-ready \u526f\u672c");
  assert.equal(panel._test.translateText("Redact"), "\u8131\u654f");
  assert.equal(panel._test.translateText("Redaction tool"), "\u8131\u654f\u5de5\u5177");
  assert.equal(panel._test.translateText("Preview redaction"), "\u9884\u89c8\u8131\u654f");
  assert.equal(panel._test.translateText("Redacted sensitive values: EMAIL 1, PHONE 1"), "\u5df2\u8131\u654f\u654f\u611f\u4fe1\u606f\uff1aEMAIL 1, PHONE 1");
  assert.equal(panel._test.translateText("Close"), "\u5173\u95ed");
  assert.equal(panel._test.translateText("✎ Click to edit"), "✎ \u5355\u51fb\u7f16\u8f91");
  assert.equal(panel._test.translateText("To PDF"), "\u5bfc\u51fa\u4e3a PDF");
  assert.equal(panel._test.translateText("Exporting PDF..."), "\u6b63\u5728\u5bfc\u51fa PDF...");
  assert.equal(
    panel._test.translateText("PDF: styled A4 export with offline formulas, tables, and local images (Edge or Chromium required)"),
    "PDF\uff1aA4 \u6837\u5f0f\u5bfc\u51fa\uff0c\u79bb\u7ebf\u6e32\u67d3\u516c\u5f0f\u3001\u8868\u683c\u548c\u672c\u5730\u56fe\u7247\uff08\u9700\u8981 Edge \u6216 Chromium\uff09"
  );
  assert.equal(panel._test.translateText("Save exchange package"), "\u751f\u6210\u53ef\u6821\u9a8c\u4ea4\u6362\u5305");
  assert.equal(panel._test.translateText("Read and verify package"), "\u6253\u5f00\u5e76\u6821\u9a8c\u4ea4\u6362\u5305");
  assert.equal(
    panel._test.translateText("A verified handoff folder for sharing reviewed content, integrity hashes, and trust reports. It is not a software installer, and normal exports do not require it."),
    "\u8fd9\u662f\u7528\u4e8e\u4ea4\u63a5\u5df2\u5ba1\u6838\u5185\u5bb9\u3001\u5b8c\u6574\u6027\u54c8\u5e0c\u548c\u4fe1\u4efb\u62a5\u544a\u7684\u53ef\u6821\u9a8c\u6587\u4ef6\u5939\u3002\u5b83\u4e0d\u662f\u8f6f\u4ef6\u5b89\u88c5\u5305\uff0c\u666e\u901a\u5bfc\u51fa\u4e0d\u9700\u8981\u4f7f\u7528\u3002"
  );
  assert.equal(panel._test.translateText("Found a value that looks like an API key or cloud access key."), "\u53d1\u73b0\u7591\u4f3c API \u5bc6\u94a5\u6216\u4e91\u8bbf\u95ee\u5bc6\u94a5\u3002");
  assert.equal(panel._test.translateText("Remove or mask credentials, API keys, tokens, and secrets."), "\u5220\u9664\u6216\u8131\u654f\u51ed\u636e\u3001API \u5bc6\u94a5\u3001\u4ee4\u724c\u548c\u53e3\u4ee4\u3002");
  assert.equal(panel._test.translateText("Imported: contract.pdf"), "\u5df2\u5bfc\u5165\uff1acontract.pdf");
});
test("Chinese locale can apply to the DOM and restore the default English UI", () => {
  withFakeBrowserGlobals((document) => {
    const button = new FakeElement("button");
    button.setAttribute("id", "uiLanguageToggle");
    button.textContent = "Chinese help";
    const action = new FakeElement("button");
    action.setAttribute("title", "Extract to Markdown");
    action.textContent = "Save clean AI-ready copy";
    document.body.appendChild(button);
    document.body.appendChild(action);
    const panel = createI18nPanel({
      $: (id) => id === "uiLanguageToggle" ? button : null
    });
    panel.applyLanguage("zh-CN");
    assert.equal(document.documentElement.lang, "zh-CN");
    assert.equal(document.body.dataset.uiLanguage, "zh-CN");
    assert.equal(button.textContent, "English UI");
    assert.equal(button.dataset.languageState, "zh-CN");
    assert.equal(button.getAttribute("aria-pressed"), "true");
    assert.equal(globalThis.localStorage.getItem("uiLanguage"), "zh-CN");
    assert.equal(globalThis.localStorage.getItem("schemaDocsUiLanguage"), "zh-CN");
    assert.equal(action.textContent, "\u4fdd\u5b58\u5e72\u51c0 AI-ready \u526f\u672c");
    assert.equal(action.getAttribute("title"), "\u63d0\u53d6\u4e3a Markdown");
    panel.applyLanguage("en");
    assert.equal(document.documentElement.lang, "en");
    assert.equal(document.body.dataset.uiLanguage, "en");
    assert.equal(button.textContent, "\u4e2d\u6587\u754c\u9762");
    assert.equal(button.dataset.languageState, "en");
    assert.equal(button.getAttribute("aria-pressed"), "false");
    assert.equal(globalThis.localStorage.getItem("uiLanguage"), "en");
    assert.equal(globalThis.localStorage.getItem("schemaDocsUiLanguage"), "en");
    assert.equal(action.textContent, "Save clean AI-ready copy");
    assert.equal(action.getAttribute("title"), "Extract to Markdown");
  });
});
