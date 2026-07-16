import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("AI assistant exposes API configuration and reports readiness", async () => {
  const source = await readFile(path.join(projectRoot, "public", "aiAssistantPanel.js"), "utf8");
  assert.match(source, /id="schemaAiApiSettings"/);
  assert.match(source, /id="schemaAiApiStatus"/);
  assert.match(source, /AI \\u5c1a\\u672a\\u914d\\u7f6e/);
  assert.match(source, /API \\u5df2\\u5c31\\u7eea/);
  assert.match(source, /function openApiSettings\(\)/);
  assert.match(source, /schemaAiInlineBaseUrl/);
  assert.match(source, /schemaAiInlineModel/);
  assert.match(source, /schemaAiInlineKey/);
  assert.match(source, /async function applyInlineApiSettings\(\)/);
  assert.match(source, /Save and use/);
  assert.match(source, /saveApiConfigurationProfile/);
  assert.match(source, /key is session-only/);
});

test("selection rewrite enters the reviewed AI request flow", async () => {
  const source = await readFile(path.join(projectRoot, "public", "aiAssistantPanel.js"), "utf8");
  assert.match(source, /if \(action === "rewrite"\) prepareRequest\(\{[^\n]+operation: "rewrite"/);
  assert.doesNotMatch(source, /if \(action === "rewrite"\)[^\n]+schemaAiPrompt[^\n]+value/);
});

test("AI response is retained even when there is no mask mapping", async () => {
  const source = await readFile(path.join(projectRoot, "public", "aiSendGatePanel.js"), "utf8");
  assert.match(source, /if \(audited\?\.output\?\.result\?\.text\) \{/);
  assert.match(source, /state\.lastAiResult = responseText/);
});

test("AI assistant surfaces failed asynchronous jobs instead of reporting an empty response", async () => {
  const assistant = await readFile(path.join(projectRoot, "public", "aiAssistantPanel.js"), "utf8");
  const sendGate = await readFile(path.join(projectRoot, "public", "aiSendGatePanel.js"), "utf8");
  assert.match(assistant, /job\?\.status !== "failed"/);
  assert.match(assistant, /failure\.details\?\.status/);
  assert.match(sendGate, /job\?\.status === "failed"/);
  assert.match(sendGate, /failure\.guidance/);
});

test("AI assistant builds direct, context-grounded document questions", async () => {
  const source = await readFile(path.join(projectRoot, "public", "aiAssistantPanel.js"), "utf8");
  assert.match(source, /Answer the exact question directly in the first sentence/);
  assert.match(source, /Do not merely quote, restate, or summarize the context/);
  assert.match(source, /For a yes-or-no or correctness question, begin with a clear judgment/);
  assert.match(source, /Preserve mathematical symbols, formulas, variable names, and LaTeX notation/);
  assert.match(source, /valid KaTeX-compatible LaTeX/);
  assert.match(source, /use \$\.\.\.\$ for inline math and \$\$\.\.\.\$\$ for display math/);
  assert.match(source, /<user_request>/);
  assert.match(source, /<document_context>/);
});

test("AI assistant sends ordinary prompts directly and renders math replies", async () => {
  const source = await readFile(path.join(projectRoot, "public", "aiAssistantPanel.js"), "utf8");
  assert.match(source, /event\.key !== "Enter" \|\| event\.shiftKey \|\| event\.isComposing/);
  assert.match(source, /requestSubmit\(\)/);
  assert.match(source, /sendGate\?\.decision === "selected_context_preview"/);
  assert.match(source, /await sendPreparedRequest\(\)/);
  assert.match(source, /function renderMathInAnswer\(root\)/);
  assert.match(source, /window\.katex\.render/);
  assert.match(source, /class="schema-ai-math/);
});
