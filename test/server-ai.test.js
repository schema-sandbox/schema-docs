import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSchemaDocsLocalClient } from "../src/sdk/localApiClient.js";
import { getToken, post, withServer } from "./helpers/serverHarness.js";
test("imports csv, inspects dataset, lists tables, and queries through API", async () => {
  await withServer(async (baseUrl) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "lft-server-flow-"));
    const csvPath = path.join(workspacePath, "input.csv");
    await writeFile(csvPath, "name,value\nalpha,1\nbeta,2\n", "utf8");
    await post(baseUrl, "/api/workspace/open", { workspacePath });
    const imported = await post(baseUrl, "/api/import", { workspacePath, sourcePath: csvPath });
    const prepared = await post(baseUrl, "/api/ai/prepare-record", {
      workspacePath,
      recordId: imported.data.id
    });
    const inspected = await post(baseUrl, "/api/dataset/inspect", {
      workspacePath,
      datasetId: imported.data.id
    });
    const tables = await post(baseUrl, "/api/tables", { workspacePath });
    const queried = await post(baseUrl, "/api/query", {
      workspacePath,
      sql: `select name,value from ${tables.data[0].tableName} limit 1`
    });
    const queryContext = await post(baseUrl, "/api/ai/query-context", {
      workspacePath,
      sql: `select name,value from ${tables.data[0].tableName} limit 1`
    });
    const queryHandoff = await post(baseUrl, "/api/ai/query-handoff", {
      workspacePath,
      relativePath: "notes/query-handoff.md",
      sql: `select name,value from ${tables.data[0].tableName} limit 1`
    });
    const token = await getToken(baseUrl);
    const client = createSchemaDocsLocalClient({ baseUrl, token, workspacePath });
    const sdkQueryHandoff = await client.saveQueryAiHandoffBundle(
      "notes/sdk-query-handoff.md",
      `select name,value from ${tables.data[0].tableName} limit 1`
    );
    assert.equal(imported.ok, true);
    assert.equal(prepared.ok, true);
    assert.equal(prepared.data.kind, "dataset");
    assert.equal(prepared.data.preview.sendGateDecision, "allow");
    assert.ok(prepared.data.preview.markdownSections.includes("# input"));
    assert.equal(inspected.data.status, "succeeded");
    assert.equal(tables.data.length, 1);
    assert.equal(queried.data.status, "succeeded");
    assert.deepEqual(queried.data.output.rows, [{ name: "alpha", value: "1" }]);
    assert.equal(queryContext.ok, true);
    assert.equal(queryContext.data.rowCount, 1);
    assert.ok(queryContext.data.evidenceId.startsWith("evidence_"));
    assert.match(queryContext.data.contextMarkdown, /Filtered Table Context For AI/);
    assert.match(queryContext.data.contextMarkdown, /\| name \| value \|/);
    assert.equal(queryHandoff.ok, true);
    assert.equal(queryHandoff.data.queryContext.rowCount, 1);
    assert.equal(queryHandoff.data.handoffBundle.relativePath, "notes/query-handoff.md");
    assert.equal(queryHandoff.data.handoffBundle.evidenceId, queryHandoff.data.queryContext.evidenceId);
    const handoffMarkdown = await readFile(path.join(workspacePath, "notes", "query-handoff.md"), "utf8");
    assert.match(handoffMarkdown, /AI Handoff Bundle/);
    assert.match(handoffMarkdown, /Filtered Table Context For AI/);
    assert.match(handoffMarkdown, /AI chunk ledger: filtered table context/);
    assert.equal(sdkQueryHandoff.queryContext.rowCount, 1);
    assert.equal(sdkQueryHandoff.handoffBundle.relativePath, "notes/sdk-query-handoff.md");
    assert.equal(sdkQueryHandoff.handoffBundle.evidenceId, sdkQueryHandoff.queryContext.evidenceId);
    const queryEvidence = await post(baseUrl, "/api/evidence/get", {
      workspacePath,
      evidenceId: queryContext.data.evidenceId
    });
    assert.equal(queryEvidence.data.kind, "ai_query_context_selected");
    assert.equal(queryEvidence.data.aiSent, false);
    assert.equal(queryEvidence.data.storeRawPrompt, false);
    assert.equal(JSON.stringify(queryEvidence.data).includes("select name"), false);
  });
});
test("creates AI preview through API without sending network requests", async () => {
  await withServer(async (baseUrl) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "lft-server-ai-"));
    await post(baseUrl, "/api/workspace/open", { workspacePath });
    const preview = await post(baseUrl, "/api/ai/preview", {
      workspacePath,
      input: {
        operation: "summarize",
        content: "alpha beta",
        sourceRef: "server-test"
      }
    });
    assert.equal(preview.ok, true);
    assert.equal(preview.data.status, "succeeded");
    assert.equal(preview.data.output.willSend.apiKey, false);
    assert.equal(preview.data.output.willSend.workspaceFiles, false);
    const audits = await post(baseUrl, "/api/audits/list", { workspacePath });
    assert.equal(audits.ok, true);
    assert.equal(audits.data.length, 1);
    assert.equal(audits.data[0].sent, false);
    const deleted = await post(baseUrl, "/api/audits/delete", {
      workspacePath,
      auditId: audits.data[0].id
    });
    const afterDelete = await post(baseUrl, "/api/audits/list", { workspacePath });
    assert.equal(deleted.ok, true);
    assert.equal(deleted.data.id, audits.data[0].id);
    assert.equal(afterDelete.data.length, 0);
  });
});
test("rejects unconfirmed AI send through API", async () => {
  await withServer(async (baseUrl) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "lft-server-ai-send-"));
    await post(baseUrl, "/api/workspace/open", { workspacePath });
    const response = await post(baseUrl, "/api/ai/send", {
      workspacePath,
      input: {
        operation: "summarize",
        content: "alpha beta",
        apiBaseUrl: "https://api.example.test",
        apiKey: "secret",
        model: "model-a"
      }
    });
    assert.equal(response.ok, true);
    assert.equal(response.data.status, "failed");
    assert.equal(response.data.error.code, "ai_confirmation_required");
  });
});
test("blocks confirmed AI send when Send Gate requires review through API", async () => {
  await withServer(async (baseUrl) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "lft-server-ai-send-gate-"));
    await post(baseUrl, "/api/workspace/open", { workspacePath });
    const response = await post(baseUrl, "/api/ai/send", {
      workspacePath,
      input: {
        operation: "summarize",
        content: "secret: abc\n<!-- local-only -->",
        apiBaseUrl: "https://api.example.test",
        apiKey: "secret",
        model: "model-a",
        confirmed: true
      }
    });
    assert.equal(response.ok, true);
    assert.equal(response.data.status, "failed");
    assert.equal(response.data.error.code, "ai_send_gate_review_required");
    const evidence = await post(baseUrl, "/api/evidence/list", { workspacePath });
    const audits = await post(baseUrl, "/api/audits/list", { workspacePath });
    assert.equal(evidence.data.length, 1);
    assert.equal(evidence.data[0].kind, "ai_send_blocked");
    assert.equal(evidence.data[0].aiSent, false);
    assert.equal(evidence.data[0].sendGateDecision, "never_send");
    assert.equal(audits.data.length, 1);
    assert.equal(audits.data[0].kind, "api_send_blocked");
    assert.equal(audits.data[0].sent, false);
    assert.equal(audits.data[0].evidenceId, evidence.data[0].id);
    assert.equal(JSON.stringify(evidence.data).includes("secret: abc"), false);
    assert.equal(JSON.stringify(audits.data).includes("secret: abc"), false);
  });
});
test("writes AI result back to markdown exchange record through API", async () => {
  await withServer(async (baseUrl) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "lft-server-ai-result-writeback-"));
    await post(baseUrl, "/api/workspace/open", { workspacePath });
    const preview = await post(baseUrl, "/api/ai/preview", {
      workspacePath,
      input: {
        operation: "summarize",
        content: "reviewed context for AI",
        apiBaseUrl: "https://api.example.test/v1",
        model: "model-a",
        sourceRef: "server-writeback-test"
      }
    });
    const saved = await post(baseUrl, "/api/ai/result/write-back", {
      workspacePath,
      relativePath: path.join("notes", "ai-result.md"),
      input: {
        title: "AI Result Write-back",
        source: "server-test-ai-result-writeback",
        body: "reviewed context for AI",
        aiResult: "AI generated answer",
        auditId: preview.data.output.auditId,
        apiBaseUrl: "https://api.example.test/v1",
        model: "model-a"
      }
    });
    const markdown = await readFile(saved.data.path, "utf8");
    assert.equal(saved.ok, true);
    assert.equal(saved.data.relativePath, path.join("notes", "ai-result.md"));
    assert.match(markdown, /AI Result Write-back/);
    assert.match(markdown, /reviewed context for AI/);
    assert.match(markdown, /API Result/);
    assert.match(markdown, /AI generated answer/);
    assert.match(markdown, /Exchange Audit/);
    assert.match(markdown, /api_preview/);
  });
});