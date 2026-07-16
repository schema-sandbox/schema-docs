import { pdfBufferToMarkdown } from "../src/adapters/pdfMarkdownConverter.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import { createAiSummonPanel } from "../public/aiSummonPanel.js";
import { createAiSendGatePanel } from "../public/aiSendGatePanel.js";
import { createImportUploadPanel } from "../public/importUploadPanel.js";
import path from "node:path";
import { openOrCreateWorkspace } from "../src/core/manifest.js";
import { buildAiPrompt, buildConfirmedAiRequest, previewAiPayload, previewAiPayloadAsJob, sendAiRequestAsJob, detectSendGateSignals, sendGateDecision } from "../src/core/ai.js";
import { buildOpenAiChatRequest, createOpenAiCompatibleClient, extractProviderText } from "../src/adapters/openAiCompatibleClient.js";
import { deleteExchangeAudit, listExchangeAudits } from "../src/core/exchangeAudits.js";
import { deleteEvidenceRecord, getEvidenceLogPath, listEvidenceRecords } from "../src/core/evidence.js";
async function tempDir(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}
function assertIncludes(actual, values) {
  for (const value of values) {
    assert.ok(actual.includes(value));
  }
}
function assertSomeIncludes(actual, values) {
  for (const value of values) {
    assert.ok(actual.some((item) => item.includes(value)));
  }
}
function joinSecret(parts, separator = "") {
  return parts.join(separator);
}
test("builds AI payload previews without exposing API key", () => {
  const preview = previewAiPayload({
    operation: "summarize",
    content: "alpha beta gamma",
    model: "test-model",
    apiBaseUrl: "https://example.test",
    sourceRef: "doc_1"
  });
  assert.equal(preview.operation, "summarize");
  assert.equal(preview.contentLength, "alpha beta gamma".length);
  assert.equal(preview.estimatedTokens > 0, true);
  assert.equal(preview.sendGate.decision, "selected_context_preview");
  assert.equal(preview.sendGate.apiKeySource, "not_provided");
  assert.equal(preview.willSend.apiKey, false);
  assert.equal(preview.willSend.workspaceFiles, false);
  assert.match(buildAiPrompt("summarize", "hello"), /Summarize/);
  assert.match(buildAiPrompt("ask", "Question and context"), /user's request/);
  assert.match(buildAiPrompt("rewrite", "Draft"), /Rewrite/);
});
test("flags sensitive and local-only AI payload preview signals", () => {
  const preview = previewAiPayload({
    operation: "extract",
    content: "Contact: person@example.com\nsecret: abc\n<!-- local-only -->",
    model: "test-model",
    apiBaseUrl: "https://example.test",
    apiKey: "not-stored"
  });
  assert.equal(preview.sendGate.decision, "never_send");
  assert.deepEqual(preview.sendGate.signals.sort(), ["credential_like_text", "email", "local_only_marker"].sort());
  assert.equal(preview.sendGate.apiKeySource, "request_body_not_stored");
  assert.equal(JSON.stringify(preview).includes("not-stored"), false);
});
test("detects Chinese credentials, DevOps tokens, and private keys before AI send", () => {
  const githubToken = joinSecret(["ghp", "1234567890abcdefghijklmnopqrstuvwxyzABCDEF"], "_");
  const slackToken = joinSecret(["xoxb", "123456789012", "1234567890123", "abcdefghijklmnopqrstuvwx"], "-");
  const content = [
    "密码：do-not-send",
    githubToken,
    slackToken,
    "-----BEGIN OPENSSH PRIVATE KEY-----",
    "private-key-body",
    "-----END OPENSSH PRIVATE KEY-----"
  ].join("\n");
  const signals = detectSendGateSignals(content);
  assert.ok(signals.includes("credential_like_text"));
  assert.ok(signals.includes("api_key_like"));
  assert.equal(sendGateDecision(signals), "review_required");
});
test("AI assistant masks locally before preview/send and unmasks the response locally", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const elements = {
    aiContent: { value: "Contact alice@example.com" },
    aiOperation: { value: "summarize" },
    apiBaseUrl: { value: "https://api.example.test" },
    apiModel: { value: "model-a" },
    apiKey: { value: "session-secret" },
    aiMaskEnabled: { checked: true },
    aiConfirmed: { checked: true },
    sendGateSummary: { textContent: "" },
    sendGateGuidance: { classList: { add() {}, remove() {} }, innerHTML: "" },
    lastAuditId: { textContent: "" },
    aiChunkLedger: { textContent: "AI chunk ledger: one local chunk" }
  };
  globalThis.document = { querySelector: () => null, body: { dataset: { uiLanguage: "en" } } };
  globalThis.window = {};
  const calls = [];
  const api = async (route, payload) => {
    calls.push({ route, payload });
    if (route === "/api/mask") {
      return { maskedText: "Contact [MASK_EMAIL_1]", mapping: { "[MASK_EMAIL_1]": "alice@example.com" } };
    }
    if (route === "/api/ai/preview") {
      assert.equal(payload.input.content, "Contact [MASK_EMAIL_1]");
      return { output: { auditId: "audit_preview", estimatedTokens: 8, sendGate: { decision: "selected_context_preview", signals: [], apiKeySource: "session_key_present" }, reasons: [], requiredActions: [], optionalActions: [] } };
    }
    if (route === "/api/ai/send") {
      assert.equal(payload.input.content, "Contact [MASK_EMAIL_1]");
      return { output: { auditId: "audit_send", estimatedTokens: 8, sendGate: { decision: "selected_context_preview", signals: [], apiKeySource: "session_key_present" }, reasons: [], requiredActions: [], optionalActions: [], result: { text: "Summary for [MASK_EMAIL_1]" } } };
    }
    if (route === "/api/unmask") {
      assert.equal(payload.content, "Summary for [MASK_EMAIL_1]");
      return "Summary for alice@example.com";
    }
    throw new Error(`Unexpected route: ${route}`);
  };
  try {
    const panel = createAiSendGatePanel({
      $: id => elements[id],
      api,
      run: fn => fn(),
      state: {},
      timestampForPath: () => "now",
      aiContextPanel: { renderAiChunkLedger() {} },
      refreshManifest: async () => {},
      renderAudits() {},
      escapeHtml: value => String(value),
      showAlert() {},
      onReviewedAiContext: async () => {},
      onSentAiContext: async () => {}
    });
    await panel.previewStagedAiContext("test-source");
    const sent = await panel.sendReviewedAiContext();
    assert.equal(sent.output.result.text, "Summary for alice@example.com");
    assert.deepEqual(calls.map(call => call.route), ["/api/mask", "/api/ai/preview", "/api/mask", "/api/ai/send", "/api/unmask"]);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});
test("rejects empty AI payload previews", () => {
  assert.throws(() => previewAiPayload({ operation: "summarize", content: " " }), {
    code: "ai_content_empty"
  });
});
test("runs AI preview as dry-run job", async () => {
  const workspace = await tempDir("lft-ai-preview-");
  await openOrCreateWorkspace(workspace);
  const job = await previewAiPayloadAsJob(workspace, {
    operation: "extract",
    content: "Contact: person@example.com",
    sourceRef: "manual"
  });
  assert.equal(job.status, "succeeded");
  assert.equal(job.input.dryRun, true);
  assert.equal(job.output.operation, "extract");
  assert.ok(job.output.auditId.startsWith("audit_"));
  assert.ok(job.output.evidenceId.startsWith("evidence_"));
  const evidenceRecords = await listEvidenceRecords(workspace);
  assert.equal(evidenceRecords.length, 1);
  assert.equal(evidenceRecords[0].kind, "ai_preview");
  assert.equal(evidenceRecords[0].aiSent, false);
  assert.equal(evidenceRecords[0].sentContentHash.startsWith("sha256:"), true);
  assert.equal(evidenceRecords[0].sendGateDecision, "review_recommended");
  assert.deepEqual(evidenceRecords[0].sendGateSignals, ["email"]);
  assert.equal(evidenceRecords[0].estimatedTokens > 0, true);
  const previewAudits = await listExchangeAudits(workspace);
  assert.equal(previewAudits[0].sendGateDecision, "review_recommended");
  assert.equal(previewAudits[0].estimatedTokens, evidenceRecords[0].estimatedTokens);
  assert.match(await readFile(getEvidenceLogPath(workspace), "utf8"), /"kind":"ai_preview"/);
});
test("requires confirmation before building API request", () => {
  assert.throws(() => buildConfirmedAiRequest({
    operation: "summarize",
    content: "hello",
    apiBaseUrl: "https://api.example.test",
    apiKey: "secret",
    model: "model"
  }), {
    code: "ai_confirmation_required"
  });
});
test("blocks confirmed AI send when Send Gate requires local review", () => {
  assert.throws(() => buildConfirmedAiRequest({
    operation: "summarize",
    content: "secret: abc\n<!-- local-only -->",
    apiBaseUrl: "https://api.example.test",
    apiKey: "secret",
    model: "model",
    confirmed: true
  }), {
    code: "ai_send_gate_review_required"
  });
});
test("records blocked AI send attempts as audit evidence without sending", async () => {
  const workspace = await tempDir("lft-ai-send-blocked-");
  await openOrCreateWorkspace(workspace);
  const calls = [];
  const client = {
    async send(request) {
      calls.push(request);
      return { provider: "mock", model: "model-a", text: "should not send" };
    }
  };
  const job = await sendAiRequestAsJob(workspace, {
    operation: "summarize",
    content: "secret: abc\n<!-- local-only -->",
    sourceRef: "blocked-test",
    apiBaseUrl: "https://api.example.test",
    apiKey: "secret",
    model: "model-a",
    confirmed: true
  }, client);
  assert.equal(job.status, "failed");
  assert.equal(job.error.code, "ai_send_gate_review_required");
  assert.equal(calls.length, 0);
  const audits = await listExchangeAudits(workspace);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].kind, "api_send_blocked");
  assert.equal(audits[0].sent, false);
  assert.equal(audits[0].sendGateDecision, "never_send");
  assert.ok(audits[0].sendGateSignals.includes("local_only_marker"));
  assert.equal(JSON.stringify(audits).includes("secret: abc"), false);
  assert.equal(JSON.stringify(audits).includes("apiKey"), false);
  const evidenceRecords = await listEvidenceRecords(workspace);
  assert.equal(evidenceRecords.length, 1);
  assert.equal(evidenceRecords[0].kind, "ai_send_blocked");
  assert.equal(evidenceRecords[0].aiSent, false);
  assert.equal(evidenceRecords[0].userConfirmed, true);
  assert.equal(evidenceRecords[0].policyDecision, "blocked_never_send");
  assert.equal(evidenceRecords[0].sendGateDecision, "never_send");
  assert.ok(evidenceRecords[0].sentContentHash.startsWith("sha256:"));
  assert.equal(JSON.stringify(evidenceRecords).includes("secret: abc"), false);
});
test("builds OpenAI-compatible request", () => {
  const request = buildOpenAiChatRequest({
    apiBaseUrl: "https://api.example.test/",
    apiKey: "secret",
    model: "model-a",
    prompt: "hello"
  });
  assert.equal(request.url, "https://api.example.test/chat/completions");
  assert.equal(request.headers.authorization, "Bearer secret");
  assert.equal(request.body.model, "model-a");
  assert.equal(request.body.messages[0].content, "hello");
});
test("sends confirmed AI request through injected client", async () => {
  const workspace = await tempDir("lft-ai-send-");
  await openOrCreateWorkspace(workspace);
  const calls = [];
  const client = createOpenAiCompatibleClient(async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: "mock response"
              }
            }
          ]
        };
      }
    };
  });
  const job = await sendAiRequestAsJob(workspace, {
    operation: "summarize",
    content: "hello",
    sourceRef: "test",
    apiBaseUrl: "https://api.example.test",
    apiKey: "secret",
    model: "model-a",
    confirmed: true
  }, client);
  assert.equal(job.status, "succeeded");
  assert.equal(job.output.result.text, "mock response");
  assert.ok(job.output.auditId.startsWith("audit_"));
  assert.ok(job.output.evidenceId.startsWith("evidence_"));
  assert.equal(calls.length, 1);
  assert.match(calls[0].init.body, /hello/);
  const audits = await listExchangeAudits(workspace);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].sent, true);
  assert.equal(audits[0].contentHash.length, 64);
  assert.ok(audits[0].evidenceId.startsWith("evidence_"));
  assert.equal(audits[0].sendGateDecision, "selected_context_preview");
  assert.equal(audits[0].estimatedTokens > 0, true);
  assert.equal(audits[0].apiKey, undefined);
  assert.equal(JSON.stringify(audits).includes("secret"), false);
  const evidenceRecords = await listEvidenceRecords(workspace);
  assert.equal(evidenceRecords.length, 1);
  assert.equal(evidenceRecords[0].kind, "ai_send");
  assert.equal(evidenceRecords[0].aiSent, true);
  assert.equal(evidenceRecords[0].userConfirmed, true);
  assert.equal(evidenceRecords[0].sendGateDecision, "selected_context_preview");
  assert.equal(evidenceRecords[0].estimatedTokens, audits[0].estimatedTokens);
  assert.equal(JSON.stringify(evidenceRecords).includes("secret"), false);
  const deleted = await deleteExchangeAudit(workspace, audits[0].id);
  assert.equal(deleted.id, audits[0].id);
  assert.equal((await listExchangeAudits(workspace)).length, 0);
  const deletedEvidence = await deleteEvidenceRecord(workspace, evidenceRecords[0].id);
  assert.equal(deletedEvidence.id, evidenceRecords[0].id);
  assert.equal((await listEvidenceRecords(workspace)).length, 0);
});
test("extracts text from OpenAI arrays, Responses API, and Gemini native responses", () => {
  assert.equal(extractProviderText({
    choices: [{ message: { content: [{ type: "text", text: "array response" }] } }]
  }), "array response");
  assert.equal(extractProviderText({
    output: [{ content: [{ type: "output_text", text: "responses api" }] }]
  }), "responses api");
  assert.equal(extractProviderText({
    candidates: [{ content: { parts: [{ text: "gemini native" }] } }]
  }), "gemini native");
});
test("successful provider responses without text report empty or blocked response errors", async () => {
  const emptyClient = createOpenAiCompatibleClient(async () => ({
    ok: true,
    status: 200,
    async json() { return { candidates: [{ finishReason: "STOP" }] }; }
  }));
  await assert.rejects(
    () => emptyClient.send({ apiBaseUrl: "https://api.example.test", apiKey: "secret", model: "model-a", prompt: "hello" }),
    (error) => error.code === "api_response_empty" && error.details.status === 200
  );
  const blockedClient = createOpenAiCompatibleClient(async () => ({
    ok: true,
    status: 200,
    async json() { return { promptFeedback: { blockReason: "SAFETY" } }; }
  }));
  await assert.rejects(
    () => blockedClient.send({ apiBaseUrl: "https://api.example.test", apiKey: "secret", model: "model-a", prompt: "hello" }),
    (error) => error.code === "api_response_blocked" && error.details.blockReason === "SAFETY"
  );
});
test("OpenAI-compatible client reports provider JSON and non-JSON failures as AppError", async () => {
  const failedJsonClient = createOpenAiCompatibleClient(async () => ({
    ok: false,
    status: 429,
    async json() {
      return {
        error: {
          message: "rate limit reached",
          code: "rate_limit",
          type: "quota"
        }
      };
    }
  }));
  await assert.rejects(
    () => failedJsonClient.send({
      apiBaseUrl: "https://api.example.test",
      apiKey: "secret",
      model: "model-a",
      prompt: "hello"
    }),
    (error) => (
      error.code === "api_rate_limited"
      && error.message === "rate limit reached"
      && error.details.status === 429
      && error.details.providerErrorCode === "rate_limit"
      && error.details.providerErrorType === "quota"
    )
  );
  const nonJsonClient = createOpenAiCompatibleClient(async () => ({
    ok: true,
    status: 200,
    async json() {
      throw new SyntaxError("Unexpected token <");
    }
  }));
  await assert.rejects(
    () => nonJsonClient.send({
      apiBaseUrl: "https://api.example.test",
      apiKey: "secret",
      model: "model-a",
      prompt: "hello"
    }),
    (error) => (
      error.code === "api_response_non_json"
      && error.details.status === 200
      && /non-JSON response/.test(error.message)
    )
  );
});
test("AI send gate signals, metadata, and policies", async () => {
  const workspace = await tempDir("lft-ai-sendgate-");
  await openOrCreateWorkspace(workspace);
  const signals1 = detectSendGateSignals("Contact sk-12345678901234567890 at test@example.com");
  assertIncludes(signals1, ["email", "api_key_like"]);
  const bearerSignals = detectSendGateSignals("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.super-secret-token");
  assertIncludes(bearerSignals, ["credential_like_text", "bearer_token_like"]);
  const awsKey = joinSecret(["AKIA", "1234567890ABCDEF"]);
  const cloudKeySignals = detectSendGateSignals(`Cloud access key ${awsKey}`);
  assert.ok(cloudKeySignals.includes("api_key_like"));
  const uuidTokenSignals = detectSendGateSignals("session_token: 550e8400-e29b-41d4-a716-446655440000");
  assert.ok(uuidTokenSignals.includes("credential_like_text"));
  assert.ok(uuidTokenSignals.includes("uuid_token_like"));
  const signals2 = detectSendGateSignals("Local only secret: <!-- local-only -->");
  assert.ok(signals2.includes("local_only_marker"));
  const signals3 = detectSendGateSignals("ID number: 110101199003072345");
  assert.ok(signals3.includes("id_number_like"));
  assert.equal(sendGateDecision(["local_only_marker"]), "never_send");
  assert.equal(sendGateDecision(["credential_like_text"]), "review_required");
  assert.equal(sendGateDecision(["email"]), "review_recommended");
  const mockDocRecord = {
    id: "doc-1",
    sourcePath: "doc.pdf",
    quality: { confidence: "low" }
  };
  const signals4 = detectSendGateSignals("Ordinary content", mockDocRecord);
  assert.ok(signals4.includes("low_quality_extraction"));
  assert.equal(sendGateDecision(signals4), "review_required");
  const payload = previewAiPayload({
    operation: "summarize",
    content: "| col1 | col2 |\n| --- | --- |\n| a | b |",
    sourceRef: "doc-1"
  }, mockDocRecord);
  assert.equal(payload.isLowQualityExtraction, true);
  assert.equal(payload.markdownCharCount > 0, true);
  assert.equal(payload.tableRowCountEstimate, 3);
});
test("Send Gate explains sensitive signals with actionable guidance", () => {
  const awsKey = joinSecret(["AKIA", "1234567890ABCDEF"]);
  const preview = previewAiPayload({
    operation: "summarize",
    content: [
      "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.super-secret-token",
      `Cloud access key ${awsKey}`,
      "Contact: person@example.com",
      "| name | value |",
      "| --- | --- |",
      "| alpha | 1 |",
      "x".repeat(10050)
    ].join("\n"),
    model: "test-model",
    apiBaseUrl: "https://example.test"
  });
  assert.equal(preview.decision, "review_required");
  assert.equal(preview.sendGate.decision, "review_required");
  assertIncludes(preview.sendGate.signals, ["api_key_like", "bearer_token_like", "long_context", "table_included"]);
  assertSomeIncludes(preview.reasons, ["API key", "Bearer token"]);
  assertSomeIncludes(preview.requiredActions, ["Remove or mask credentials"]);
  assertSomeIncludes(preview.optionalActions, ["chunk or range review", "Filter the table locally"]);
});
test("Send Gate explains low quality extraction as required review", () => {
  const preview = previewAiPayload({
    operation: "summarize",
    content: "Extracted text from a scanned document.",
    model: "test-model",
    apiBaseUrl: "https://example.test"
  }, {
    id: "doc_low_quality",
    originalSourcePath: "imports/scanned.pdf",
    extractionQuality: {
      scannedLikely: true,
      confidence: "low"
    }
  });
  assert.equal(preview.sendGate.decision, "review_required");
  assert.ok(preview.sendGate.signals.includes("low_quality_extraction"));
  assertSomeIncludes(preview.reasons, ["low confidence"]);
  assertSomeIncludes(preview.requiredActions, ["Review extraction quality"]);
  assertSomeIncludes(preview.optionalActions, ["source file is approved"]);
});
test("aiSummonPanel summonAiGate correctly masks clipboard content or fails gracefully without raw clipboard fallback", async () => {
  const originalFetch = global.fetch;
  global.window = global;
  try {
    let fetchUrl = null;
    let fetchOptions = null;
    let fetchResult = null;
    global.fetch = async (url, options) => {
      fetchUrl = url;
      fetchOptions = options;
      return {
        ok: fetchResult.ok,
        json: async () => fetchResult.json
      };
    };
    const elements = {};
    const $ = (id) => elements[id];
    let updateCalled = false;
    const updateAiWillSeePanel = async () => {
      updateCalled = true;
    };
    elements.aiSendGateTitle = { scrollIntoView: () => {} };
    elements.aiContent = {
      value: "",
      dispatchEvent: (e) => {
        assert.equal(e.type, "input");
      },
      focus: () => {}
    };
    elements.sendGateSummary = { textContent: "" };
    elements.recordId = { value: "rec_1" };
    global.SCHEMA_DOCS_API_BASE_URL = "http://localhost:1234";
    global.AI_DOC_EXCHANGE_TOKEN = "test-token";
    const { summonAiGate } = createAiSummonPanel({ $, updateAiWillSeePanel });

    fetchResult = {
      ok: true,
      json: { ok: true, data: { maskedText: "masked clipboard content" } }
    };
    await summonAiGate({ clipboardText: "raw secret text", source: "keyboard-shortcut" });
    assert.equal(fetchUrl, "http://localhost:1234/api/mask");
    assert.equal(fetchOptions.method, "POST");
    assert.equal(fetchOptions.headers["x-ai-doc-exchange-token"], "test-token");
    assert.equal(JSON.parse(fetchOptions.body).content, "raw secret text");
    assert.equal(elements.aiContent.value, "masked clipboard content");
    assert.equal(updateCalled, true);

    elements.aiContent.value = "previous value";
    updateCalled = false;
    fetchResult = {
      ok: false,
      json: {}
    };
    await summonAiGate({ clipboardText: "raw secret text 2", source: "keyboard-shortcut" });

    assert.equal(elements.aiContent.value, "previous value"); // stays unchanged
    assert.match(elements.sendGateSummary.textContent, /local masking unavailable/);
  } finally {
    global.fetch = originalFetch;
    delete global.window;
    delete global.SCHEMA_DOCS_API_BASE_URL;
    delete global.AI_DOC_EXCHANGE_TOKEN;
  }
});
test("importUploadPanel reports non-JSON upload responses without refreshing workspace state", async () => {
  const originalFetch = global.fetch;
  global.window = { AI_DOC_EXCHANGE_TOKEN: "test-token" };
  try {
    let fetchUrl = "";
    let fetchOptions = null;
    const alerts = [];
    const printed = [];
    let manifestRefreshCount = 0;
    let inboxRefreshCount = 0;
    global.fetch = async (url, options) => {
      fetchUrl = url;
      fetchOptions = options;
      return {
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError("Unexpected token <");
        }
      };
    };
    const elements = {
      recordId: {
        value: ""
      }
    };
    const file = {
      name: "broken.pdf",
      arrayBuffer: async () => new ArrayBuffer(4)
    };
    const panel = createImportUploadPanel({
      $: (id) => elements[id],
      workspacePath: () => "C:/workspace",
      ensureWorkspace: async () => {},
      localApiBaseUrl: () => "http://127.0.0.1:4177",
      showAlert: (level, message) => alerts.push({ level, message }),
      refreshManifest: async () => {
        manifestRefreshCount += 1;
      },
      refreshInbox: () => {
        inboxRefreshCount += 1;
      },
      print: (value) => printed.push(value)
    });
    await panel.uploadFile(file);
    assert.match(fetchUrl, /\/api\/import-upload\?/);
    assert.equal(fetchOptions.headers["x-ai-doc-exchange-token"], "test-token");
    assert.equal(manifestRefreshCount, 0);
    assert.equal(inboxRefreshCount, 0);
    assert.equal(elements.recordId.value, "");
    assert.equal(alerts.at(-1).level, "danger");
    assert.match(alerts.at(-1).message, /import_upload_non_json_response/);
    assert.match(alerts.at(-1).message, /local API server is running/);
    assert.equal(printed.at(-1).ok, false);
  } finally {
    global.fetch = originalFetch;
    delete global.window;
  }
});
test("importUploadPanel selects successful imports and runs post-import preparation", async () => {
  const originalFetch = global.fetch;
  global.window = { AI_DOC_EXCHANGE_TOKEN: "test-token" };
  try {
    const alerts = [];
    const printed = [];
    let preparedRecord = null;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        data: {
          id: "doc_pdf_1",
          sourceType: "pdf",
          title: "sample"
        }
      })
    });
    const elements = {
      recordId: {
        value: ""
      }
    };
    const file = {
      name: "sample.pdf",
      arrayBuffer: async () => new ArrayBuffer(8)
    };
    const panel = createImportUploadPanel({
      $: (id) => elements[id],
      workspacePath: () => "C:/workspace",
      ensureWorkspace: async () => {},
      localApiBaseUrl: () => "http://127.0.0.1:4177",
      showAlert: (level, message) => alerts.push({ level, message }),
      refreshManifest: async () => {},
      refreshInbox: () => {},
      print: (value) => printed.push(value),
      onImportedRecord: async (record) => {
        preparedRecord = record;
      }
    });
    await panel.uploadFile(file);
    assert.equal(elements.recordId.value, "doc_pdf_1");
    assert.equal(preparedRecord.id, "doc_pdf_1");
    assert.equal(alerts.some((alert) => alert.level === "success"), true);
    assert.equal(printed.at(-1).id, "doc_pdf_1");
  } finally {
    global.fetch = originalFetch;
    delete global.window;
  }
});
test("importUploadPanel opens Markdown and converts other files", async () => {
  const originalFetch = global.fetch;
  global.window = { AI_DOC_EXCHANGE_TOKEN: "test-token" };
  try {
    const imported = [];
    const alerts = [];
    global.fetch = async (url) => {
      imported.push(new URL(url).searchParams.get("filename"));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          data: { id: "doc_1", sourceType: "pdf", title: "sample" }
        })
      };
    };
    const panel = createImportUploadPanel({
      $: () => ({ value: "" }),
      workspacePath: () => "C:/workspace",
      ensureWorkspace: async () => {},
      localApiBaseUrl: () => "http://127.0.0.1:4177",
      showAlert: (level, message) => alerts.push({ level, message }),
      refreshManifest: async () => {},
      refreshInbox: () => {},
      print: () => {}
    });
    await panel.uploadFile(new File(["# Note"], "note.md", { type: "text/markdown" }));
    await panel.uploadFile(new File(["pdf"], "report.pdf", { type: "application/pdf" }));
    assert.deepEqual(imported, ["note.md", "report.pdf"]);
    assert.equal(alerts.some((alert) => alert.level === "danger"), false);
  } finally {
    global.fetch = originalFetch;
    delete global.window;
  }
});
