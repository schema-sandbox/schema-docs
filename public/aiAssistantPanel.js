function escapeHtml(value) {
 return String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");
}

function resultText(job, fallback = "") {
 const result = job?.output?.result;
 if (typeof result === "string") return result;
 if (typeof result?.text === "string") return result.text;
 return String(fallback || "");
}

function assertSuccessfulJob(job) {
 if (job?.status !== "failed") return job;
 const failure = job.error ?? {};
 const status = failure.details?.status;
 const zh = typeof document !== "undefined" && document.body?.dataset?.uiLanguage === "zh-CN";
 const knownMessage = ({
  api_authentication_failed: zh ? "API Key \u88ab\u670d\u52a1\u5546\u62d2\u7edd\uff0c\u8bf7\u786e\u8ba4 Key \u5c5e\u4e8e\u5f53\u524d\u670d\u52a1\u5546\u548c\u9879\u76ee\u3002" : "The provider rejected this API key.",
  api_permission_denied: zh ? "\u5f53\u524d API \u9879\u76ee\u65e0\u6743\u4f7f\u7528\u8be5\u6a21\u578b\u6216\u7aef\u70b9\u3002" : "This API project cannot use the selected model or endpoint.",
  api_endpoint_or_model_not_found: zh ? "\u627e\u4e0d\u5230\u8be5\u6a21\u578b\u6216 API \u7aef\u70b9\uff0c\u8bf7\u6838\u5bf9\u6a21\u578b\u7684\u7cbe\u786e ID\u3002" : "The model or API endpoint was not found. Check the exact model ID.",
  api_rate_limited: zh ? "\u8bf7\u6c42\u5df2\u5230\u8fbe\u670d\u52a1\u5546\uff0c\u4f46\u5f53\u524d\u9879\u76ee\u8d85\u51fa\u9891\u7387\u6216\u914d\u989d\u9650\u5236\u3002\u5730\u5740\u3001\u6a21\u578b\u548c Key \u4ecd\u53ef\u80fd\u662f\u6b63\u786e\u7684\u3002" : "The request reached the provider, but this project exceeded its rate limit or quota.",
  api_service_unavailable: zh ? "AI \u670d\u52a1\u5546\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002" : "The AI provider is temporarily unavailable. Retry later."
 })[failure.code] || ({
  401: zh ? "API Key \u88ab\u670d\u52a1\u5546\u62d2\u7edd\u3002" : "The provider rejected this API key.",
  403: zh ? "\u5f53\u524d API \u9879\u76ee\u65e0\u6743\u4f7f\u7528\u8be5\u6a21\u578b\u6216\u7aef\u70b9\u3002" : "This API project cannot use the selected model or endpoint.",
  404: zh ? "\u627e\u4e0d\u5230\u8be5\u6a21\u578b\u6216 API \u7aef\u70b9\uff0c\u8bf7\u6838\u5bf9\u6a21\u578b\u7684\u7cbe\u786e ID\u3002" : "The model or API endpoint was not found. Check the exact model ID.",
  429: zh ? "\u5f53\u524d API \u9879\u76ee\u8d85\u51fa\u9891\u7387\u6216\u914d\u989d\u9650\u5236\uff1b\u8bbe\u7f6e\u4ecd\u53ef\u80fd\u6b63\u786e\u3002" : "This API project exceeded its rate limit or quota; the settings may still be correct.",
  503: zh ? "AI \u670d\u52a1\u5546\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002" : "The AI provider is temporarily unavailable. Retry later."
 })[status];
 if (knownMessage) throw new Error(`${knownMessage}${status ? ` (HTTP ${status})` : ""}`);
 const statusSuffix = status && !String(failure.message || "").includes(String(status)) ? ` (HTTP ${status})` : "";
 const guidance = failure.guidance ? ` ${failure.guidance}` : "";
 throw new Error(`${failure.code || "ai_request_failed"}: ${failure.message || "AI request failed."}${statusSuffix}${guidance}`);
}

export function createAiAssistantPanel({
 $,
 state,
 aiSendGatePanel,
 renderMarkdownReadView,
 saveCurrentNote,
 showAlert,
 setAdvancedToolsVisible,
 setAiPanelOpen
}) {
 let selectionContext = null;
 let pendingResult = null;
 let lastRequest = null;
 let lastReviewJob = null;
 let busy = false;

 function isZh() {
  return document.body.dataset.uiLanguage === "zh-CN";
 }

 function text(zh, en) {
  return isZh() ? zh : en;
 }

 function renderRichText(value) {
  const mathTokens = [];
  let source = String(value || "").replace(/\$\$([\s\S]+?)\$\$/g, (_match, formula) => {
   const token = `SCHEMA_AI_MATH_${mathTokens.length}`;
   mathTokens.push({ formula: formula.trim(), displayMode: true });
   return token;
  });
  source = source.replace(/\$([^$\n]+?)\$/g, (_match, formula) => {
   const token = `SCHEMA_AI_MATH_${mathTokens.length}`;
   mathTokens.push({ formula: formula.trim(), displayMode: false });
   return token;
  });
  let rendered = "";
  try {
   if (typeof window.markdownit === "function") {
    rendered = window.markdownit({ html: false, breaks: true, linkify: true }).render(source);
   }
  } catch {
  }
  if (!rendered) rendered = `<p>${escapeHtml(source).replaceAll("\n", "<br>")}</p>`;
  mathTokens.forEach((item, index) => {
   const tag = item.displayMode ? "div" : "span";
   const mode = item.displayMode ? "display-mode" : "inline-mode";
   rendered = rendered.replace(
    `SCHEMA_AI_MATH_${index}`,
    `<${tag} class="schema-ai-math ${mode}" data-math="${escapeHtml(item.formula)}">${escapeHtml(item.formula)}</${tag}>`
   );
  });
  return rendered;
 }

 function renderMathInAnswer(root) {
  root?.querySelectorAll(".schema-ai-math").forEach((element) => {
   const formula = element.getAttribute("data-math") || "";
   const displayMode = element.classList.contains("display-mode");
   if (!window.katex) return;
   try {
    window.katex.render(formula, element, { displayMode, throwOnError: false });
   } catch {
    element.textContent = displayMode ? `$$${formula}$$` : `$${formula}$`;
   }
  });
 }

 function ensureUi() {
  let panel = $("schemaAiAssistant");
  if (!panel) {
   panel = document.createElement("aside");
   panel.id = "schemaAiAssistant";
   panel.className = "schema-ai-assistant";
   panel.setAttribute("aria-label", "Schema Docs AI");
   panel.innerHTML = `
    <header class="schema-ai-header">
     <div><strong>Schema AI</strong><span id="schemaAiScopeLabel"></span></div>
     <div class="schema-ai-header-actions">
      <button id="schemaAiApiSettings" type="button" class="schema-ai-header-settings">API</button>
      <button id="schemaAiClose" type="button" class="schema-ai-icon-button" aria-label="Close">\u00d7</button>
     </div>
    </header>
    <div id="schemaAiApiStatus" class="schema-ai-api-status" role="status"></div>
    <section id="schemaAiApiForm" class="schema-ai-api-form hidden" aria-label="AI API settings">
     <label>
      <span id="schemaAiApiBaseLabel">API base URL</span>
      <input id="schemaAiInlineBaseUrl" type="url" autocomplete="url">
     </label>
     <label>
      <span id="schemaAiApiModelLabel">Model name</span>
      <input id="schemaAiInlineModel" type="text" autocomplete="off">
     </label>
     <label>
      <span>API Key</span>
      <input id="schemaAiInlineKey" type="password" autocomplete="off">
     </label>
     <p id="schemaAiApiFormHint"></p>
     <div class="schema-ai-api-form-actions">
      <button id="schemaAiApiAdvanced" type="button">Advanced profiles</button>
      <button id="schemaAiApiCancel" type="button">Cancel</button>
      <button id="schemaAiApiApply" type="button" class="primary">Apply</button>
     </div>
    </section>
    <div id="schemaAiMessages" class="schema-ai-messages"></div>
    <section id="schemaAiReview" class="schema-ai-review hidden"></section>
    <div id="schemaAiContextBar" class="schema-ai-context-bar hidden"></div>
    <form id="schemaAiComposer" class="schema-ai-composer">
     <textarea id="schemaAiPrompt" rows="2" placeholder="Ask about this document"></textarea>
     <div class="schema-ai-composer-actions">
      <button id="schemaAiAdvanced" type="button" class="schema-ai-text-button">Advanced</button>
      <button id="schemaAiSubmit" type="submit" class="schema-ai-send-button" aria-label="Send">\u2191</button>
     </div>
    </form>`;
   document.body.appendChild(panel);
   panel.querySelector("#schemaAiClose").addEventListener("click", close);
   panel.querySelector("#schemaAiApiSettings").addEventListener("click", openApiSettings);
   panel.querySelector("#schemaAiApiApply").addEventListener("click", () => {
    applyInlineApiSettings().catch((error) => {
     showAlert?.("error", error?.message || String(error));
     openApiSettings();
    });
   });
   panel.querySelector("#schemaAiApiCancel").addEventListener("click", closeApiSettings);
   panel.querySelector("#schemaAiApiAdvanced").addEventListener("click", openAdvancedApiSettings);
   panel.querySelector("#schemaAiComposer").addEventListener("submit", (event) => {
    event.preventDefault();
    const prompt = panel.querySelector("#schemaAiPrompt").value.trim();
    if (prompt) prepareRequest({ prompt, operation: "ask" });
   });
   panel.querySelector("#schemaAiPrompt").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    panel.querySelector("#schemaAiComposer").requestSubmit();
   });
   panel.querySelector("#schemaAiAdvanced").addEventListener("click", openApiSettings);
   panel.querySelector("#schemaAiMessages").addEventListener("click", handleMessageAction);
   panel.querySelector("#schemaAiReview").addEventListener("click", handleReviewAction);
  }
  ensureSelectionToolbar();
  bindApiConfigurationListeners();
  localizeUi();
  return panel;
 }

 function localizeUi() {
  const panel = $("schemaAiAssistant");
  if (!panel) return;
  panel.querySelector("#schemaAiPrompt").placeholder = text("\u8be2\u95ee\u5f53\u524d\u6587\u6863\u6216\u9009\u4e2d\u5185\u5bb9", "Ask about this document or selection");
  panel.querySelector("#schemaAiAdvanced").textContent = text("API \u8bbe\u7f6e", "API settings");
  panel.querySelector("#schemaAiApiSettings").textContent = text("API \u8bbe\u7f6e", "API settings");
  panel.querySelector("#schemaAiApiBaseLabel").textContent = text("API \u670d\u52a1\u5730\u5740", "API base URL");
  panel.querySelector("#schemaAiApiModelLabel").textContent = text("\u6a21\u578b\u540d\u79f0", "Model name");
  panel.querySelector("#schemaAiInlineBaseUrl").placeholder = text("\u4f8b\u5982 https://api.example.com/v1", "For example, https://api.example.com/v1");
  panel.querySelector("#schemaAiInlineModel").placeholder = text("\u8f93\u5165\u670d\u52a1\u5546\u63d0\u4f9b\u7684\u6a21\u578b ID", "Enter the model ID from your provider");
  panel.querySelector("#schemaAiInlineKey").placeholder = text("\u8f93\u5165 API Key", "Enter API key");
  panel.querySelector("#schemaAiApiFormHint").textContent = text("API \u5730\u5740\u548c\u6a21\u578b\u4f1a\u4fdd\u5b58\u5230\u5f53\u524d\u5de5\u4f5c\u533a\u3002API Key \u53ea\u4fdd\u7559\u5728\u5f53\u524d\u8fd0\u884c\u4f1a\u8bdd\uff0c\u4e0d\u4f1a\u5199\u5165\u78c1\u76d8\u3002", "The API URL and model are saved to the current workspace. The API key remains only for this running session and is never written to disk.");
  panel.querySelector("#schemaAiApiAdvanced").textContent = text("\u9ad8\u7ea7\u914d\u7f6e", "Advanced profiles");
  panel.querySelector("#schemaAiApiCancel").textContent = text("\u53d6\u6d88", "Cancel");
  panel.querySelector("#schemaAiApiApply").textContent = text("\u4fdd\u5b58\u5e76\u4f7f\u7528", "Save and use");
  const selectionLabels = {
   ask: text("\u95ee AI", "Ask AI"),
   translate: text("\u7ffb\u8bd1", "Translate"),
   summarize: text("\u603b\u7ed3", "Summarize"),
   copy: text("\u590d\u5236", "Copy"),
   rewrite: text("\u6da6\u8272", "Rewrite")
  };
  Object.entries(selectionLabels).forEach(([action, label]) => {
   const button = $("schemaAiSelectionToolbar")?.querySelector(`[data-ai-action="${action}"]`);
   if (button) button.textContent = label;
  });
  const messageLabels = {
   copy: text("\u590d\u5236", "Copy"),
   insert: text("\u63d2\u5165\u6587\u672b", "Insert at end"),
   retry: text("\u91cd\u65b0\u751f\u6210", "Regenerate")
  };
  Object.entries(messageLabels).forEach(([action, label]) => {
   panel.querySelectorAll(`[data-message-action="${action}"]`).forEach((button) => { button.textContent = label; });
  });
  if (panel.querySelector(".schema-ai-welcome")) {
   panel.querySelector("#schemaAiMessages").innerHTML = "";
   renderWelcome();
  }
  if (lastReviewJob && !panel.querySelector("#schemaAiReview")?.classList.contains("hidden")) renderReview(lastReviewJob);
  const inlineResult = $("markdownReadView")?.querySelector(".schema-ai-inline-result");
  if (inlineResult) {
   inlineResult.remove();
   restoreInlineResult();
  }
  renderScope();
  renderApiStatus();
 }

 function apiConfiguration() {
  return {
   baseUrl: $("apiBaseUrl")?.value.trim() || "",
   model: $("apiModel")?.value.trim() || "",
   apiKey: $("apiKey")?.value.trim() || ""
  };
 }

 function missingApiConfiguration() {
  const config = apiConfiguration();
  const missing = [];
  if (!config.baseUrl) missing.push(text("API \u670d\u52a1\u5730\u5740", "API base URL"));
  if (!config.model) missing.push(text("\u6a21\u578b\u540d\u79f0", "model"));
  if (!config.apiKey) missing.push("API Key");
  return { config, missing };
 }

 function bindApiConfigurationListeners() {
  for (const id of ["apiBaseUrl", "apiModel", "apiKey"]) {
   const input = $(id);
   if (!input || input.dataset.schemaAiStatusBound === "true") continue;
   input.dataset.schemaAiStatusBound = "true";
   input.addEventListener("input", renderApiStatus);
   input.addEventListener("change", renderApiStatus);
  }
  if (document.body.dataset.schemaAiConfigEventBound !== "true") {
   document.body.dataset.schemaAiConfigEventBound = "true";
   document.addEventListener("schema-docs:api-config-changed", renderApiStatus);
  }
 }

 function renderApiStatus() {
  const status = $("schemaAiApiStatus");
  if (!status) return;
  const { config, missing } = missingApiConfiguration();
  status.dataset.ready = missing.length ? "false" : "true";
  status.innerHTML = missing.length
   ? `<span><strong>${text("AI \u5c1a\u672a\u914d\u7f6e", "AI is not configured")}</strong><small>${text("\u7f3a\u5c11", "Missing")}: ${escapeHtml(missing.join(" / "))}</small></span><button type="button" data-api-status-action="settings">${text("\u914d\u7f6e API", "Configure API")}</button>`
   : `<span><strong>${text("API \u5df2\u5c31\u7eea", "API ready")}</strong><small>${escapeHtml(config.model)} \u00b7 ${text("Key \u4ec5\u5728\u5f53\u524d\u4f1a\u8bdd\u4f7f\u7528", "Key is session-only")}</small></span><button type="button" data-api-status-action="settings">${text("\u4fee\u6539", "Change")}</button>`;
  status.querySelector("button")?.addEventListener("click", openApiSettings);
 }

 function openApiSettings() {
  const form = $("schemaAiApiForm");
  if (!form) return;
  syncInlineApiSettings();
  form.classList.remove("hidden");
  const { missing } = missingApiConfiguration();
  const target = missing.includes(text("API \u670d\u52a1\u5730\u5740", "API base URL"))
   ? $("schemaAiInlineBaseUrl")
   : missing.includes(text("\u6a21\u578b\u540d\u79f0", "model"))
    ? $("schemaAiInlineModel")
    : missing.includes("API Key")
     ? $("schemaAiInlineKey")
     : $("schemaAiInlineModel");
  window.setTimeout(() => target?.focus(), 40);
 }

 function closeApiSettings() {
  $("schemaAiApiForm")?.classList.add("hidden");
 }

 function syncInlineApiSettings() {
  const config = apiConfiguration();
  const baseUrl = $("schemaAiInlineBaseUrl");
  const model = $("schemaAiInlineModel");
  const apiKey = $("schemaAiInlineKey");
  if (baseUrl) baseUrl.value = config.baseUrl;
  if (model) model.value = config.model;
  if (apiKey) apiKey.value = config.apiKey;
 }

 function apiProfileName(values) {
  let provider = text("AI \u670d\u52a1", "AI provider");
  try {
   provider = new URL(values.baseUrl).hostname.replace(/^www\./, "") || provider;
  } catch {
  }
  return `${provider} \u00b7 ${values.model}`;
 }

 async function applyInlineApiSettings() {
  const values = {
   baseUrl: $("schemaAiInlineBaseUrl")?.value.trim() || "",
   model: $("schemaAiInlineModel")?.value.trim() || "",
   apiKey: $("schemaAiInlineKey")?.value.trim() || ""
  };
  const fields = [
   ["apiBaseUrl", values.baseUrl],
   ["apiModel", values.model],
   ["apiKey", values.apiKey]
  ];
  for (const [id, value] of fields) {
   const input = $(id);
   if (!input) continue;
   input.value = value;
   input.dispatchEvent(new Event("input", { bubbles: true }));
   input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const { missing } = missingApiConfiguration();
  renderApiStatus();
  if (missing.length) {
   showAlert?.("warning", `${text("\u8bf7\u8865\u5168", "Complete")}: ${missing.join(" / ")}`);
   openApiSettings();
   return;
  }
  const profile = await aiSendGatePanel.saveApiConfigurationProfile({
   name: $("apiProfileName")?.value.trim() || apiProfileName(values),
   apiBaseUrl: values.baseUrl,
   model: values.model
  });
  closeApiSettings();
  showAlert?.("success", `${text("AI \u8bbe\u7f6e\u5df2\u4fdd\u5b58\u5e76\u542f\u7528\uff1bKey \u4ec5\u5728\u5f53\u524d\u4f1a\u8bdd\u4f7f\u7528", "AI settings saved and enabled; the key is session-only")}: ${profile.name}`);
 }

 function openAdvancedApiSettings() {
  setAdvancedToolsVisible?.(true);
  setAiPanelOpen?.(true);
  close();
  const { missing } = missingApiConfiguration();
  const target = missing.includes(text("API \u670d\u52a1\u5730\u5740", "API base URL"))
   ? $("apiBaseUrl")
   : missing.includes(text("\u6a21\u578b\u540d\u79f0", "model"))
    ? $("apiModel")
    : missing.includes("API Key")
     ? $("apiKey")
     : $("apiProfileName");
  target?.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => target?.focus(), 180);
  showAlert?.("info", text("\u8bf7\u586b\u5199 API \u670d\u52a1\u5730\u5740\u3001\u6a21\u578b\u540d\u79f0\u548c API Key\u3002API Key \u53ea\u7528\u4e8e\u5f53\u524d\u8fd0\u884c\u4f1a\u8bdd\uff0c\u4e0d\u4f1a\u4fdd\u5b58\u3002", "Enter the API base URL, model, and API key. The API key is session-only and is not saved."));
 }

 function ensureSelectionToolbar() {
  if ($("schemaAiSelectionToolbar")) return;
  const toolbar = document.createElement("div");
  toolbar.id = "schemaAiSelectionToolbar";
  toolbar.className = "schema-ai-selection-toolbar hidden";
  toolbar.setAttribute("role", "toolbar");
  toolbar.innerHTML = `
   <button type="button" data-ai-action="ask">${text("\u95ee AI", "Ask AI")}</button>
   <button type="button" data-ai-action="translate">${text("\u7ffb\u8bd1", "Translate")}</button>
   <button type="button" data-ai-action="summarize">${text("\u603b\u7ed3", "Summarize")}</button>
   <button type="button" data-ai-action="copy">${text("\u590d\u5236", "Copy")}</button>
   <button type="button" data-ai-action="rewrite">${text("\u6da6\u8272", "Rewrite")}</button>`;
  toolbar.addEventListener("mousedown", (event) => event.preventDefault());
  toolbar.addEventListener("click", (event) => {
   const button = event.target.closest("[data-ai-action]");
   if (button) handleSelectionAction(button.dataset.aiAction);
  });
  document.body.appendChild(toolbar);
 }

 function renderWelcome() {
  const messages = $("schemaAiMessages");
  if (!messages || messages.dataset.started === "true") return;
  messages.innerHTML = `
   <div class="schema-ai-welcome">
    <div class="schema-ai-mark">AI</div>
    <h3>${text("\u4f60\u597d\uff0c\u6211\u662f Schema AI", "Hello, I am Schema AI")}</h3>
    <p>${text("\u6211\u53ea\u4f7f\u7528\u5f53\u524d\u6587\u6863\u6216\u4f60\u9009\u4e2d\u7684\u5185\u5bb9\u56de\u7b54\u3002\u53d1\u9001\u524d\u4ecd\u4f1a\u5728\u672c\u5730\u8131\u654f\u5e76\u7531\u4f60\u786e\u8ba4\u3002", "I answer from the current document or selection. Local masking and confirmation still happen before anything is sent.")}</p>
    <div class="schema-ai-suggestions">
     <button type="button" data-ai-quick="summarize"><strong>${text("\u5185\u5bb9\u603b\u7ed3", "Summarize")}</strong><span>${text("\u63d0\u70bc\u4e3b\u8981\u5185\u5bb9\u4e0e\u7ed3\u8bba", "Extract the main ideas and conclusions")}</span></button>
     <button type="button" data-ai-quick="outline"><strong>${text("\u6574\u7406\u7ed3\u6784", "Build outline")}</strong><span>${text("\u751f\u6210\u53ef\u7ee7\u7eed\u7f16\u8f91\u7684\u5c42\u7ea7\u5927\u7eb2", "Create an editable hierarchical outline")}</span></button>
     <button type="button" data-ai-quick="insight"><strong>${text("\u53d1\u73b0\u95ee\u9898", "Find gaps")}</strong><span>${text("\u6307\u51fa\u77db\u76fe\u3001\u7f3a\u53e3\u4e0e\u5f85\u6838\u5b9e\u5185\u5bb9", "Identify contradictions and missing evidence")}</span></button>
     <button type="button" data-ai-quick="polish"><strong>${text("\u6da6\u8272\u5199\u4f5c", "Polish")}</strong><span>${text("\u6539\u5584\u8868\u8fbe\u4f46\u4e0d\u6539\u53d8\u4e8b\u5b9e", "Improve clarity without changing facts")}</span></button>
    </div>
   </div>`;
  messages.querySelectorAll("[data-ai-quick]").forEach((button) => {
   button.addEventListener("click", () => handleQuickAction(button.dataset.aiQuick));
  });
 }

 function renderScope() {
  const label = $("schemaAiScopeLabel");
  const bar = $("schemaAiContextBar");
  if (!label || !bar) return;
  if (selectionContext?.text) {
   label.textContent = text("\u5f53\u524d\u9009\u533a", "Current selection");
   bar.classList.remove("hidden");
   bar.innerHTML = `<span>${text("\u9009\u533a", "Selection")} \u00b7 ${selectionContext.text.length.toLocaleString()} ${text("\u5b57\u7b26", "characters")}</span><button type="button" id="schemaAiClearSelection">\u00d7</button>`;
   bar.querySelector("button").addEventListener("click", () => {
    selectionContext = null;
    renderScope();
   });
  } else {
   label.textContent = text("\u5f53\u524d\u6587\u6863", "Current document");
   bar.classList.add("hidden");
   bar.innerHTML = "";
  }
 }

 function open(options = {}) {
  ensureUi();
  setAiPanelOpen?.(false);
  document.body.dataset.schemaAiAssistant = "open";
  if (options.selection) selectionContext = options.selection;
  renderScope();
  renderWelcome();
  if (options.focus !== false) window.setTimeout(() => $("schemaAiPrompt")?.focus(), 80);
 }

 function close() {
  document.body.dataset.schemaAiAssistant = "closed";
  hideSelectionToolbar();
 }

 function toggle() {
  if (document.body.dataset.schemaAiAssistant === "open") close();
  else open();
 }

 function currentContext() {
  if (selectionContext?.text) return selectionContext.text;
  return $("noteContent")?.value || "";
 }

 function requestContent(prompt, operation, context) {
  const sharedRules = [
   "Use only the supplied document context as evidence.",
   "Do not invent missing facts. State clearly when the context is insufficient or ambiguous.",
   "Preserve mathematical symbols, formulas, variable names, and LaTeX notation when discussing them.",
   "Write every formula as valid KaTeX-compatible LaTeX: use $...$ for inline math and $$...$$ for display math, keep LaTeX commands inside those delimiters, and use complete forms such as \\frac{numerator}{denominator}.",
   "Reply in the same language as the user's request unless the task explicitly asks for another language."
  ];
  const taskRules = operation === "summarize"
   ? [
      "Task: Summarize the supplied document context.",
      "Identify the main claim, supporting reasoning, and important qualifications instead of copying passages."
     ]
   : operation === "translate"
    ? [
       `Task: Translate the supplied document context according to this request: ${prompt}`,
       "Translate faithfully without adding commentary or omitting technical details."
      ]
    : operation === "rewrite"
     ? [
        `Task: Rewrite the supplied document context according to this request: ${prompt}`,
        "Return the rewritten text directly. Preserve the original meaning and factual claims."
       ]
     : [
        "Task: Answer the user's question about the supplied document context.",
        "Answer the exact question directly in the first sentence. For a yes-or-no or correctness question, begin with a clear judgment such as yes, no, partly correct, or cannot be determined.",
        "Then explain the reasoning from the selected context. Do not merely quote, restate, or summarize the context.",
        "When evaluating an explanation or formula, identify what is correct, what is incorrect or uncertain, and why."
       ];
  return [
   ...taskRules,
   ...sharedRules,
   "",
   "<user_request>",
   prompt,
   "</user_request>",
   "",
   "<document_context>",
   context,
   "</document_context>"
  ].join("\n");
 }

 function setBusy(value) {
  busy = Boolean(value);
  $("schemaAiSubmit")?.toggleAttribute("disabled", busy);
  $("schemaAiAssistant")?.classList.toggle("is-busy", busy);
 }

 function appendUserMessage(prompt) {
  const messages = $("schemaAiMessages");
  if (!messages) return;
  messages.dataset.started = "true";
  const welcome = messages.querySelector(".schema-ai-welcome");
  welcome?.remove();
  const item = document.createElement("div");
  item.className = "schema-ai-message schema-ai-message-user";
  item.textContent = prompt;
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
 }

 async function prepareRequest({ prompt, operation = "ask" }) {
  if (busy) return;
  const context = currentContext().trim();
  if (!context) {
   showAlert?.("warning", text("\u8bf7\u5148\u6253\u5f00\u6587\u6863\u6216\u9009\u62e9\u4e00\u6bb5\u6587\u5b57\u3002", "Open a document or select some text first."));
   return;
  }
  open({ focus: false });
  const { missing } = missingApiConfiguration();
  if (missing.length) {
   renderApiStatus();
   showAlert?.("warning", text(`\u8bf7\u5148\u914d\u7f6e AI\uff1a\u7f3a\u5c11 ${missing.join(" / ")}`, `Configure AI first. Missing: ${missing.join(" / ")}`));
   return;
  }
  appendUserMessage(prompt);
  $("schemaAiPrompt").value = "";
  const sourceRef = selectionContext
   ? `markdown-selection:${selectionContext.startLine + 1}-${selectionContext.endLine + 1}`
   : `markdown-document:${$("notePath")?.value || "current"}`;
  lastRequest = { prompt, operation, context, sourceRef, selection: selectionContext ? { ...selectionContext } : null };
  setBusy(true);
  const review = $("schemaAiReview");
  review.classList.add("hidden");
  try {
   const job = await aiSendGatePanel.prepareAssistantRequest({
    content: requestContent(prompt, operation, context),
    operation,
    sourceRef
   });
   lastReviewJob = job;
   const preview = job?.output?.preview ?? job?.output ?? {};
   if (preview.sendGate?.decision === "selected_context_preview") {
    await sendPreparedRequest();
   } else {
    renderReview(job);
   }
  } catch (error) {
   review.classList.remove("hidden");
   review.innerHTML = `<div class="schema-ai-error">${escapeHtml(error.message || String(error))}</div>`;
  } finally {
   setBusy(false);
  }
 }

 function renderReview(job) {
  const preview = job?.output?.preview ?? job?.output ?? {};
  const gate = preview.sendGate ?? {};
  const maskCount = Object.keys(state.lastMaskMapping || {}).length;
  const blocked = gate.decision === "never_send";
  const review = $("schemaAiReview");
  review.classList.remove("hidden");
  review.innerHTML = `
   <div class="schema-ai-review-heading"><strong>${blocked ? text("\u5f53\u524d\u5185\u5bb9\u88ab\u53d1\u9001\u95e8\u963b\u6b62", "Send gate blocked this content") : text("\u53d1\u9001\u524d\u786e\u8ba4", "Confirm before sending")}</strong><button type="button" data-review-action="cancel">\u00d7</button></div>
   <p>${lastRequest?.selection ? text("\u4ec5\u53d1\u9001\u5f53\u524d\u9009\u533a", "Only the current selection will be sent") : text("\u53d1\u9001\u5f53\u524d\u6587\u6863\u4e0a\u4e0b\u6587", "Current document context will be sent")} \u00b7 ~${Number(preview.estimatedTokens || 0).toLocaleString()} tokens</p>
   <div class="schema-ai-review-facts"><span>${text("\u672c\u5730\u8131\u654f", "Masked locally")} ${maskCount}</span><span>${text("\u6a21\u578b", "Model")} ${escapeHtml($("apiModel")?.value || text("\u672a\u8bbe\u7f6e", "not set"))}</span></div>
   ${blocked ? `<p class="schema-ai-block-reason">${escapeHtml((preview.reasons || []).join(" \u00b7 ") || text("\u8bf7\u5728\u9ad8\u7ea7\u8bbe\u7f6e\u4e2d\u5904\u7406\u963b\u6b62\u9879\u3002", "Resolve the blocking issue in Advanced settings."))}</p>` : ""}
   <div class="schema-ai-review-actions"><button type="button" data-review-action="advanced">${text("\u67e5\u770b\u8be6\u60c5", "View details")}</button><button type="button" data-review-action="confirm" class="primary" ${blocked ? "disabled" : ""}>${text("\u786e\u8ba4\u53d1\u9001", "Confirm and send")}</button></div>`;
 }

 async function handleReviewAction(event) {
  const action = event.target.closest("[data-review-action]")?.dataset.reviewAction;
  if (!action) return;
  if (action === "cancel") {
   $("schemaAiReview").classList.add("hidden");
   return;
  }
  if (action === "advanced" || action === "settings") {
   openApiSettings();
   return;
  }
  if (action !== "confirm" || busy) return;
  setBusy(true);
  event.target.textContent = text("\u53d1\u9001\u4e2d\u2026", "Sending...");
  try {
   await sendPreparedRequest();
  } catch (error) {
   $("schemaAiReview").innerHTML = `<div class="schema-ai-error">${escapeHtml(error.message || String(error))}</div><div class="schema-ai-review-actions"><button type="button" data-review-action="settings">${text("\u68c0\u67e5 API \u8bbe\u7f6e", "Check API settings")}</button><button type="button" data-review-action="cancel">${text("\u5173\u95ed", "Close")}</button></div>`;
  } finally {
   setBusy(false);
  }
 }

 async function sendPreparedRequest() {
  const job = assertSuccessfulJob(await aiSendGatePanel.confirmAssistantRequest());
  const answer = resultText(job, state.lastAiResult);
  if (!answer.trim()) throw new Error(text("\u6a21\u578b\u5df2\u54cd\u5e94\uff0c\u4f46\u6ca1\u6709\u8fd4\u56de\u53ef\u663e\u793a\u7684\u5185\u5bb9\u3002\u8bf7\u68c0\u67e5 API \u5730\u5740\u3001\u6a21\u578b\u540d\u79f0\u548c\u54cd\u5e94\u683c\u5f0f\u3002", "The model responded without displayable content. Check the API URL, model name, and response format."));
  $("schemaAiReview").classList.add("hidden");
  appendAssistantMessage(answer);
  if (lastRequest?.selection) showInlineResult(answer, lastRequest);
 }

 function appendAssistantMessage(answer) {
  const messages = $("schemaAiMessages");
  const item = document.createElement("article");
  item.className = "schema-ai-message schema-ai-message-assistant";
  item.innerHTML = `<div class="schema-ai-answer">${renderRichText(answer)}</div><div class="schema-ai-message-actions"><button type="button" data-message-action="copy">${text("\u590d\u5236", "Copy")}</button><button type="button" data-message-action="insert">${text("\u63d2\u5165\u6587\u672b", "Insert at end")}</button><button type="button" data-message-action="retry">${text("\u91cd\u65b0\u751f\u6210", "Regenerate")}</button></div>`;
  item.dataset.answer = answer;
  messages.appendChild(item);
  renderMathInAnswer(item);
  messages.scrollTop = messages.scrollHeight;
 }

 function handleMessageAction(event) {
  const button = event.target.closest("[data-message-action]");
  if (!button) return;
  const article = button.closest(".schema-ai-message-assistant");
  const answer = article?.dataset.answer || "";
  if (button.dataset.messageAction === "copy") navigator.clipboard?.writeText(answer);
  if (button.dataset.messageAction === "insert") applyResult(answer, "append", null);
  if (button.dataset.messageAction === "retry" && lastRequest) prepareRequest(lastRequest);
 }

 function showInlineResult(answer, request) {
  pendingResult = { answer, request };
  restoreInlineResult();
 }

 function restoreInlineResult() {
  if (!pendingResult?.request?.selection) return;
  const view = $("markdownReadView");
  if (!view || view.querySelector(".schema-ai-inline-result")) return;
  const selection = pendingResult.request.selection;
  const anchor = [...view.querySelectorAll("[data-line-start]")]
   .filter((node) => Number(node.dataset.lineStart) <= selection.endLine && Number(node.dataset.lineEnd ?? node.dataset.lineStart) >= selection.startLine)
   .pop();
  if (!anchor) return;
  const card = document.createElement("section");
  card.className = "schema-ai-inline-result";
  card.innerHTML = `<div class="schema-ai-inline-answer">${renderRichText(pendingResult.answer)}</div><div class="schema-ai-inline-actions"><button type="button" data-inline-action="replace">\u2713 ${text("\u63a5\u53d7", "Accept")}</button><button type="button" data-inline-action="discard">\u00d7 ${text("\u5f03\u7528", "Discard")}</button><button type="button" data-inline-action="after">\u2261 ${text("\u5728\u539f\u6587\u540e\u63d2\u5165", "Insert after")}</button><button type="button" data-inline-action="retry">\u21bb ${text("\u91cd\u65b0\u751f\u6210", "Regenerate")}</button></div>`;
  renderMathInAnswer(card);
  card.addEventListener("click", handleInlineAction);
  anchor.insertAdjacentElement("afterend", card);
  card.scrollIntoView({ behavior: "smooth", block: "center" });
 }

 function handleInlineAction(event) {
  const action = event.target.closest("[data-inline-action]")?.dataset.inlineAction;
  if (!action || !pendingResult) return;
  if (action === "discard") {
   pendingResult = null;
   event.currentTarget.remove();
  } else if (action === "retry") {
   const request = pendingResult.request;
   pendingResult = null;
   event.currentTarget.remove();
   prepareRequest(request);
  } else {
   const { answer, request } = pendingResult;
   applyResult(answer, action === "replace" ? "replace" : "after", request.selection);
  }
 }

 async function applyResult(answer, mode, selection) {
  const editor = $("noteContent");
  if (!editor) return;
  const current = editor.value;
  let next = current;
  if (mode === "append" || !selection) {
   next = `${current.trimEnd()}\n\n${answer.trim()}\n`;
  } else {
   const lines = current.split("\n");
   const start = Math.max(0, selection.startLine);
   const end = Math.max(start, selection.endLine);
   const block = lines.slice(start, end + 1).join("\n");
   let replacement;
   if (mode === "after") {
    replacement = `${block}\n\n${answer.trim()}`;
   } else {
    const exactIndex = block.indexOf(selection.text);
    replacement = exactIndex >= 0
     ? `${block.slice(0, exactIndex)}${answer.trim()}${block.slice(exactIndex + selection.text.length)}`
     : answer.trim();
   }
   lines.splice(start, end - start + 1, replacement);
   next = lines.join("\n");
  }
  pendingResult = null;
  editor.value = next;
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  renderMarkdownReadView();
  await saveCurrentNote();
  showAlert?.("success", text("AI \u7ed3\u679c\u5df2\u5199\u5165\u5e76\u4fdd\u5b58\u3002", "AI result inserted and saved."));
 }

 function selectionBlocks(range, view) {
  return [...view.querySelectorAll("[data-line-start]")].filter((node) => {
   try { return range.intersectsNode(node); } catch { return false; }
  });
 }

 function captureSelection() {
  const view = $("markdownReadView");
  const selection = window.getSelection?.();
  if (!view || !selection || selection.isCollapsed || !selection.rangeCount || !view.contains(selection.anchorNode) || !view.contains(selection.focusNode)) {
   hideSelectionToolbar();
   return;
  }
  const selectedText = selection.toString().trim();
  if (selectedText.length < 2) {
   hideSelectionToolbar();
   return;
  }
  const range = selection.getRangeAt(0);
  const blocks = selectionBlocks(range, view);
  if (!blocks.length) return;
  const starts = blocks.map((node) => Number(node.dataset.lineStart)).filter(Number.isFinite);
  const ends = blocks.map((node) => Number(node.dataset.lineEnd ?? node.dataset.lineStart)).filter(Number.isFinite);
  if (!starts.length || !ends.length) return;
  selectionContext = {
   text: selectedText,
   startLine: Math.min(...starts),
   endLine: Math.max(...ends)
  };
  const rect = range.getBoundingClientRect();
  showSelectionToolbar(rect);
  renderScope();
 }

 function showSelectionToolbar(rect) {
  ensureSelectionToolbar();
  const toolbar = $("schemaAiSelectionToolbar");
  toolbar.classList.remove("hidden");
  const width = toolbar.offsetWidth || 420;
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left));
  const below = rect.bottom + 8;
  toolbar.style.left = `${left}px`;
  toolbar.style.top = `${below + toolbar.offsetHeight < window.innerHeight ? below : Math.max(12, rect.top - toolbar.offsetHeight - 8)}px`;
 }

 function hideSelectionToolbar() {
  $("schemaAiSelectionToolbar")?.classList.add("hidden");
 }

 function handleSelectionAction(action) {
  if (!selectionContext) return;
  if (action === "copy") {
   navigator.clipboard?.writeText(selectionContext.text);
   hideSelectionToolbar();
   return;
  }
  open({ selection: selectionContext, focus: action === "ask" });
  hideSelectionToolbar();
  if (action === "translate") prepareRequest({ prompt: text("\u7ffb\u8bd1\u4e3a\u4e2d\u6587\uff1b\u5982\u679c\u539f\u6587\u662f\u4e2d\u6587\uff0c\u5219\u7ffb\u8bd1\u4e3a\u82f1\u6587\u3002", "Translate to English; if already English, translate to Chinese."), operation: "translate" });
  if (action === "summarize") prepareRequest({ prompt: text("\u603b\u7ed3\u9009\u4e2d\u5185\u5bb9", "Summarize the selection"), operation: "summarize" });
  if (action === "rewrite") prepareRequest({ prompt: text("\u6da6\u8272\u9009\u4e2d\u5185\u5bb9\uff0c\u6539\u5584\u6e05\u6670\u5ea6\u5e76\u4fdd\u6301\u539f\u610f", "Polish the selection for clarity while preserving its meaning"), operation: "rewrite" });
 }

 function handleQuickAction(action) {
  const actions = {
   summarize: { prompt: text("\u603b\u7ed3\u5f53\u524d\u5185\u5bb9\uff0c\u5217\u51fa\u4e3b\u8981\u7ed3\u8bba", "Summarize the current content and list the main conclusions"), operation: "summarize" },
   outline: { prompt: text("\u5c06\u5f53\u524d\u5185\u5bb9\u6574\u7406\u6210\u5c42\u7ea7\u6e05\u6670\u7684 Markdown \u5927\u7eb2", "Turn the current content into a clear hierarchical Markdown outline"), operation: "ask" },
   insight: { prompt: text("\u627e\u51fa\u5f53\u524d\u5185\u5bb9\u4e2d\u7684\u77db\u76fe\u3001\u7f3a\u53e3\u548c\u9700\u8981\u6838\u5b9e\u7684\u4fe1\u606f", "Find contradictions, gaps, and claims that need verification"), operation: "ask" },
   polish: { prompt: text("\u6da6\u8272\u5f53\u524d\u5185\u5bb9\uff0c\u4fdd\u6301\u4e8b\u5b9e\u548c\u7ed3\u6784\u4e0d\u53d8", "Polish the current content without changing facts or structure"), operation: "rewrite" }
  };
  prepareRequest(actions[action]);
 }

 function bind() {
  ensureUi();
  const view = $("markdownReadView");
  view?.addEventListener("mouseup", () => window.setTimeout(captureSelection, 0));
  view?.addEventListener("keyup", () => window.setTimeout(captureSelection, 0));
  document.addEventListener("mousedown", (event) => {
   if (!event.target.closest("#schemaAiSelectionToolbar") && !event.target.closest("#markdownReadView")) hideSelectionToolbar();
  });
  document.addEventListener("schema-docs:markdown-rendered", restoreInlineResult);
  document.addEventListener("schema-docs:language-changed", localizeUi);
  window.addEventListener("resize", hideSelectionToolbar);
  window.addEventListener("scroll", hideSelectionToolbar, true);
 }

 return { bind, open, close, toggle, captureSelection, restoreInlineResult };
}
