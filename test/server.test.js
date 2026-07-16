import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getJson, getToken, post, withServer } from "./helpers/serverHarness.js";
test("serves the web UI", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();
    const appResponse = await fetch(`${baseUrl}/app.js`);
    const appScript = await appResponse.text();
    const aiSendGateResponse = await fetch(`${baseUrl}/aiSendGatePanel.js`);
    const aiSendGateScript = await aiSendGateResponse.text();
    const healthResponse = await fetch(`${baseUrl}/api/health`);
    const health = await healthResponse.json();
    const preflight = await fetch(`${baseUrl}/api/health`, {
      method: "OPTIONS",
      headers: {
        origin: "http://tauri.localhost",
        "access-control-request-method": "GET"
      }
    });
    const appConfig = await fetch(`${baseUrl}/app-config.js`);
    const appConfigScript = await appConfig.text();
    assert.equal(response.status, 200);
    assert.match(html, /Schema Docs/);
    assert.match(html, /sendGateSummary/);
    assert.equal(aiSendGateResponse.status, 200);
    assert.match(aiSendGateScript, /renderSendGateSummary/);
    assert.match(appScript, /SCHEMA_DOCS_API_BASE_URL/);
    assert.match(appScript, /ensureLocalApiConfig/);
    assert.match(appScript, /discoverLocalApiConfig/);
    assert.match(appScript, /tryApplyLocalApiConfig/);
    assert.match(appScript, /fetchBlockedPorts/);
    assert.match(appScript, /startPort:\s*4177/);
    assert.match(appScript, /endPort:\s*4199/);
    assert.match(appScript, /\/api\/health/);
    assert.equal(health.ok, true);
    assert.equal(health.data.service, "schema-docs-local-api");
    assert.equal(healthResponse.headers.get("access-control-allow-origin"), "*");
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
    assert.match(appConfigScript, /SCHEMA_DOCS_API_BASE_URL/);
    assert.match(appConfigScript, /AI_DOC_EXCHANGE_TOKEN/);
    assert.match(appConfigScript, new RegExp(baseUrl.replaceAll(".", "\\.")));
  });
});
test("blocks cross-site app config token reads", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/app-config.js`, {
      headers: {
        "sec-fetch-site": "cross-site",
        referer: "https://example.invalid/page"
      }
    });
    const text = await response.text();
    assert.equal(response.status, 403);
    assert.doesNotMatch(text, /AI_DOC_EXCHANGE_TOKEN/);
  });
});
test("serves only token-authorized image assets inside the active workspace", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-workspace-asset-"));
  const markdownDir = path.join(workspace, "outputs", "readable");
  const assetDir = path.join(workspace, "outputs", "assets");
  await mkdir(markdownDir, { recursive: true });
  await mkdir(assetDir, { recursive: true });
  await writeFile(path.join(markdownDir, "note.md"), "![Figure](../assets/figure.png)");
  const image = Buffer.from("89504e470d0a1a0a", "hex");
  await writeFile(path.join(assetDir, "figure.png"), image);
  await withServer(async (baseUrl) => {
    const token = await getToken(baseUrl);
    const url = new URL(`${baseUrl}/api/workspace-asset`);
    url.searchParams.set("workspacePath", workspace);
    url.searchParams.set("markdownPath", "outputs/readable/note.md");
    url.searchParams.set("assetPath", "../assets/figure.png");
    url.searchParams.set("token", token);
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
    url.searchParams.set("assetPath", "../../../outside.png");
    assert.equal((await fetch(url)).status, 404);
  });
});
test("workspace image assets cannot escape through a symlink", async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-workspace-asset-link-"));
  const outsideDir = await mkdtemp(path.join(os.tmpdir(), "schema-docs-workspace-asset-outside-"));
  const markdownDir = path.join(workspace, "notes");
  await mkdir(markdownDir);
  await writeFile(path.join(markdownDir, "note.md"), "![Outside](../linked/secret.png)");
  await writeFile(path.join(outsideDir, "secret.png"), Buffer.from("89504e470d0a1a0a", "hex"));
  try {
    await symlink(outsideDir, path.join(workspace, "linked"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "UNKNOWN"].includes(error.code)) {
      t.skip(`Symlink creation is unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  await withServer(async (baseUrl) => {
    const token = await getToken(baseUrl);
    const url = new URL(`${baseUrl}/api/workspace-asset`);
    url.searchParams.set("workspacePath", workspace);
    url.searchParams.set("markdownPath", "notes/note.md");
    url.searchParams.set("assetPath", "../linked/secret.png");
    url.searchParams.set("token", token);
    assert.equal((await fetch(url)).status, 404);
  });
});
test("serves adjacent assets for an explicitly opened external Markdown file", async () => {
  const activeWorkspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-active-workspace-"));
  const externalDir = await mkdtemp(path.join(os.tmpdir(), "schema-docs-external-note-"));
  const markdownPath = path.join(externalDir, "report.md");
  const assetDir = path.join(externalDir, "report.assets");
  const imagePath = path.join(assetDir, "formula.png");
  await mkdir(assetDir);
  await writeFile(markdownPath, "![Formula](<./report.assets/formula.png>)");
  const image = Buffer.from("89504e470d0a1a0a", "hex");
  await writeFile(imagePath, image);
  await withServer(async (baseUrl) => {
    const token = await getToken(baseUrl);
    const url = new URL(`${baseUrl}/api/workspace-asset`);
    url.searchParams.set("workspacePath", activeWorkspace);
    url.searchParams.set("markdownPath", markdownPath);
    url.searchParams.set("assetPath", "./report.assets/formula.png");
    url.searchParams.set("token", token);
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
    url.searchParams.set("assetPath", "../outside.png");
    assert.equal((await fetch(url)).status, 404);
  });
});
test("allows desktop local app config reads from tauri localhost", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/app-config.js`, {
      headers: {
        origin: "tauri://localhost",
        "sec-fetch-site": "cross-site"
      }
    });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(text, /AI_DOC_EXCHANGE_TOKEN/);
    assert.match(text, /SCHEMA_DOCS_API_BASE_URL/);
  });
});
test("opens workspace and saves markdown through API", async () => {
  await withServer(async (baseUrl) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "lft-server-"));
    const opened = await post(baseUrl, "/api/workspace/open", { workspacePath });
    const saved = await post(baseUrl, "/api/markdown/save", {
      workspacePath,
      relativePath: path.join("notes", "server.md"),
      content: "# Server\n"
    });
    const manifest = await post(baseUrl, "/api/manifest", { workspacePath });
    assert.equal(opened.ok, true);
    assert.equal(saved.ok, true);
    assert.equal(manifest.ok, true);
    assert.equal(manifest.data.version, 1);
  });
});

test("opens and saves an external Markdown file without importing a workspace copy", async () => {
  await withServer(async (baseUrl) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "lft-server-external-md-workspace-"));
    const externalPath = path.join(await mkdtemp(path.join(os.tmpdir(), "lft-server-external-md-")), "source.md");
    await writeFile(externalPath, "# External\n\nOriginal body.\n", "utf8");
    await post(baseUrl, "/api/workspace/open", { workspacePath });

    const opened = await post(baseUrl, "/api/markdown/read-external", {
      workspacePath,
      sourcePath: externalPath
    });
    const saved = await post(baseUrl, "/api/markdown/save-external", {
      workspacePath,
      sourcePath: externalPath,
      content: "# External\n\nEdited body.\n"
    });

    assert.equal(opened.ok, true);
    assert.match(opened.data, /Original body/);
    assert.equal(saved.ok, true);
    assert.match(await readFile(externalPath, "utf8"), /Edited body/);
  });
});

test("rejects relative document paths before attempting to open them", async () => {
  await withServer(async (baseUrl) => {
    const response = await post(baseUrl, "/api/document/open-original", { originalPath: "notes/example.md" });
    assert.equal(response.ok, false);
    assert.match(response.error.message, /absolute originalPath/i);
  });
});
test("creates a temporary workspace through API without a preselected workspace path", async () => {
  await withServer(async (baseUrl) => {
    const created = await post(baseUrl, "/api/workspace/create-temp", {});
    const manifest = await post(baseUrl, "/api/manifest", {
      workspacePath: created.data.workspacePath
    });
    assert.equal(created.ok, true);
    assert.match(created.data.workspacePath, /schema-docs-workspace-/);
    assert.equal(created.data.manifest.version, 1);
    assert.equal(manifest.ok, true);
    assert.equal(manifest.data.workspaceId, created.data.manifest.workspaceId);
  });
});
test("returns structured errors from API", async () => {
  await withServer(async (baseUrl) => {
    const response = await post(baseUrl, "/api/workspace/open", {});
    assert.equal(response.ok, false);
    assert.equal(response.error.code, "workspace_required");
    assert.match(response.error.guidance, /workspace path/i);
  });
});
test("returns guided errors from upload import API", async () => {
  await withServer(async (baseUrl) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "lft-server-upload-error-"));
    await post(baseUrl, "/api/workspace/open", { workspacePath });
    const token = await getToken(baseUrl);
    const response = await fetch(`${baseUrl}/api/import-upload?workspacePath=${encodeURIComponent(workspacePath)}&filename=bad.bin`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-ai-doc-exchange-token": token
      },
      body: new Uint8Array([1, 2, 3])
    });
    const payload = await response.json();
    assert.equal(response.status, 500);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "unsupported_file_type");
    assert.match(payload.error.guidance, /DOCX, PPTX, PDF, XLSX, CSV, MD, or TXT/);
  });
});
test("rejects API calls without local token", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/workspace/open`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({})
    });
    const payload = await response.json();
    assert.equal(response.status, 403);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "invalid_local_token");
  });
});
test("saves markdown exchange package through API", async () => {
  await withServer(async (baseUrl) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "lft-server-exchange-"));
    await post(baseUrl, "/api/workspace/open", { workspacePath });
    const saved = await post(baseUrl, "/api/exchange/save", {
      workspacePath,
      relativePath: path.join("notes", "exchange.md"),
      input: {
        title: "Exchange",
        body: "Markdown body",
        apiBaseUrl: "https://api.example.test",
        model: "model-a",
        aiResult: "API result"
      }
    });
    assert.equal(saved.ok, true);
    assert.match(saved.data, /exchange\.md$/);
  });
});
test("saves markdown exchange package with API audit by id", async () => {
  await withServer(async (baseUrl) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "lft-server-exchange-audit-"));
    await post(baseUrl, "/api/workspace/open", { workspacePath });
    const preview = await post(baseUrl, "/api/ai/preview", {
      workspacePath,
      input: {
        operation: "summarize",
        content: "alpha beta",
        apiBaseUrl: "https://api.example.test/v1",
        model: "model-a",
        sourceRef: "server-test"
      }
    });
    const saved = await post(baseUrl, "/api/exchange/save", {
      workspacePath,
      relativePath: path.join("notes", "exchange-with-audit.md"),
      input: {
        title: "Audited Exchange",
        body: "Markdown body",
        auditId: preview.data.output.auditId
      }
    });
    const markdown = await readFile(saved.data, "utf8");
    assert.equal(saved.ok, true);
    assert.match(markdown, /Exchange Audit/);
    assert.match(markdown, /api_preview/);
    assert.match(markdown, /https:\/\/api\.example\.test\/v1/);
  });
});
test("saves directory-based exchange package through API", async () => {
  await withServer(async (baseUrl) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "lft-server-exchange-package-"));
    await post(baseUrl, "/api/workspace/open", { workspacePath });
    const saved = await post(baseUrl, "/api/exchange/package", {
      workspacePath,
      packageRelativePath: path.join("packages", "api-package"),
      input: {
        title: "API Package",
        body: "Package body.",
        exportFormats: ["pdf"],
        evidence: {
          id: "evidence_api",
          policyDecision: "local_only"
        }
      }
    });
    const normalized = await post(baseUrl, "/api/normalize", {
      workspacePath,
      packageRelativePath: path.join("packages", "normalized-package"),
      input: {
        title: "Normalized Package",
        body: "Normalized body."
      }
    });
    assert.equal(saved.ok, true);
    assert.match(saved.data.documentPath, /document\.md$/);
    const packageManifest = JSON.parse(await readFile(saved.data.manifestPath, "utf8"));
    assert.equal(packageManifest.packageType, "markdown.exchange");
    assert.match(packageManifest.canonicalDocument.hash, /^sha256:/);
    assert.equal(packageManifest.documentSchema.path, "document.schema.json");
    assert.match(packageManifest.documentSchema.hash, /^sha256:/);
    assert.equal(packageManifest.capability.type, "document.exchange");
    assert.equal(packageManifest.exports[0].path, "exports/document.pdf");
    assert.match(packageManifest.exports[0].hash, /^sha256:/);
    assert.equal(packageManifest.evidence.id, "evidence_api");
    assert.equal(packageManifest.policies.storesRawPrompt, false);
    const pluralSaved = await post(baseUrl, "/api/exchange-packages", {
      workspacePath,
      packagePath: path.join("packages", "plural-api-package"),
      title: "Plural API Package",
      body: "Package body through the public plural route.",
      exportFormats: ["docx"]
    });
    assert.equal(pluralSaved.ok, true);
    assert.match(pluralSaved.data.documentPath, /document\.md$/);
    const receiverReport = await post(baseUrl, "/api/exchange/package/receiver-report", {
      workspacePath,
      packageRelativePath: path.join("packages", "api-package")
    });
    assert.equal(receiverReport.ok, true);
    assert.match(receiverReport.data.markdownPath, /receiver-report\.md$/);
    assert.match(receiverReport.data.jsonPath, /trust-report\.json$/);
    assert.match(receiverReport.data.markdownHash, /^sha256:/);
    assert.match(await readFile(saved.data.evidencePath, "utf8"), /"evidence_api"/);
    assert.equal(normalized.ok, true);
    assert.match(normalized.data.packageRoot, /normalized-package$/);
  });
});
test("saves and lists API profiles through API without keys", async () => {
  await withServer(async (baseUrl) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "lft-server-profile-"));
    await post(baseUrl, "/api/workspace/open", { workspacePath });
    const saved = await post(baseUrl, "/api/profiles/save", {
      workspacePath,
      input: {
        name: "default",
        apiBaseUrl: "https://api.example.test/v1",
        model: "model-a",
        apiKey: "not-persisted"
      }
    });
    const list = await post(baseUrl, "/api/profiles/list", { workspacePath });
    assert.equal(saved.ok, true);
    assert.equal(list.ok, true);
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0].apiKey, undefined);
    const deleted = await post(baseUrl, "/api/profiles/delete", {
      workspacePath,
      profileId: saved.data.id
    });
    const afterDelete = await post(baseUrl, "/api/profiles/list", { workspacePath });
    assert.equal(deleted.ok, true);
    assert.equal(deleted.data.id, saved.data.id);
    assert.equal(afterDelete.data.length, 0);
  });
});
test("masks and unmasks sensitive data through local API", async () => {
  await withServer(async (baseUrl) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "lft-server-mask-"));
    const raw = "Contact alice@example.com for secrets.";
    const maskResult = await post(baseUrl, "/api/mask", { workspacePath, content: raw });
    assert.equal(maskResult.ok, true);
    assert.ok(maskResult.data.maskedText.includes("[MASK_EMAIL_1]"));
    assert.equal(maskResult.data.mapping["[MASK_EMAIL_1]"], "alice@example.com");
    const unmaskResult = await post(baseUrl, "/api/unmask", {
      workspacePath,
      content: maskResult.data.maskedText,
      mapping: maskResult.data.mapping
    });
    assert.equal(unmaskResult.ok, true);
    assert.equal(unmaskResult.data, raw);
  });
});
test("masks clipboard text through local API without a workspace path", async () => {
  await withServer(async (baseUrl) => {
    const raw = "Contact alice@example.com with token: sk-12345678901234567890";
    const maskResult = await post(baseUrl, "/api/mask", { content: raw });
    assert.equal(maskResult.ok, true);
    assert.ok(maskResult.data.maskedText.includes("[MASK_EMAIL_1]"));
    assert.ok(maskResult.data.maskedText.includes("[MASK_SECRET_1]"));
    assert.ok(!maskResult.data.maskedText.includes("alice@example.com"));
    assert.ok(!maskResult.data.maskedText.includes("sk-12345678901234567890"));
    const response = await fetch(`${baseUrl}/api/mask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: raw })
    });
    const payload = await response.json();
    assert.equal(response.status, 403);
    assert.equal(payload.error.code, "invalid_local_token");
  });
});
test("serves inbox, timeline, versioning, settings, explain-package, and real-samples APIs", async () => {
  await withServer(async (baseUrl) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "lft-server-new-apis-"));
    await post(baseUrl, "/api/workspace/open", { workspacePath });

    const getSettings = await getJson(baseUrl, "/api/settings", { workspacePath });
    assert.equal(getSettings.ok, true);
    assert.equal(getSettings.data.defaultQueryLimit, 500);
    const updateSettings = await post(baseUrl, "/api/settings", {
      workspacePath,
      key: "defaultQueryLimit",
      value: 100
    });
    assert.equal(updateSettings.ok, true);
    assert.equal(updateSettings.data.defaultQueryLimit, 100);

    const inbox = await getJson(baseUrl, "/api/inbox", { workspacePath });
    assert.equal(inbox.ok, true);
    assert.ok(Array.isArray(inbox.data));

    const docPath = path.join(workspacePath, "test-doc.txt");
    await writeFile(docPath, "Hello World from inbox test", "utf8");
    const importRes = await post(baseUrl, "/api/import", { workspacePath, sourcePath: docPath });
    assert.equal(importRes.ok, true);
    const docRecordId = importRes.data.id;
    const inboxItems = await getJson(baseUrl, "/api/inbox", { workspacePath });
    assert.ok(inboxItems.data.length > 0);
    const itemId = inboxItems.data[0].id;
    const archiveRes = await post(baseUrl, "/api/inbox/archive", { workspacePath, itemId });
    assert.equal(archiveRes.ok, true);
    assert.equal(archiveRes.data.status, "archived");
    const unarchiveRes = await post(baseUrl, "/api/inbox/unarchive", { workspacePath, itemId });
    assert.equal(unarchiveRes.ok, true);
    assert.equal(unarchiveRes.data.status, "imported");
    const recs = await getJson(baseUrl, "/api/inbox/recommendations", { workspacePath, itemId });
    assert.equal(recs.ok, true);
    assert.ok(Array.isArray(recs.data.recommendedActions));

    const timeline = await getJson(baseUrl, "/api/timeline", { workspacePath });
    assert.equal(timeline.ok, true);
    assert.ok(timeline.data.length > 0);
    const specificTimeline = await getJson(baseUrl, `/api/timeline/${docRecordId}`, { workspacePath });
    assert.equal(specificTimeline.ok, true);

    const convertRes = await post(baseUrl, "/api/document/convert", { workspacePath, documentId: docRecordId });
    assert.equal(convertRes.ok, true);
    const versions = await getJson(baseUrl, "/api/versions", { workspacePath, relativePath: "outputs/test-doc.md" });
    assert.equal(versions.ok, true);
    assert.ok(versions.data.length > 0);
    const verId = versions.data[0].id;
    const promoteRes = await post(baseUrl, "/api/versions/promote", { workspacePath, relativePath: "outputs/test-doc.md", versionId: verId });
    assert.equal(promoteRes.ok, true);
    await writeFile(path.join(workspacePath, "diff-a.md"), "Line 1\nLine 2", "utf8");
    await writeFile(path.join(workspacePath, "diff-b.md"), "Line 1\nLine 3", "utf8");
    const diffRes = await getJson(baseUrl, "/api/versions/diff", { workspacePath, pathA: "diff-a.md", pathB: "diff-b.md" });
    assert.equal(diffRes.ok, true);
    assert.equal(diffRes.data.different, true);

    const samples = await getJson(baseUrl, "/api/samples/real-summary", { workspacePath });
    assert.equal(samples.ok, true);
    assert.equal(samples.data.total, 20);

    const pkgRes = await post(baseUrl, "/api/exchange/package", {
      workspacePath,
      packageRelativePath: "test-package",
      input: {
        title: "Test Pack",
        body: "Exchange Package Body",
        exportFormats: ["docx", "pdf"]
      }
    });
    assert.equal(pkgRes.ok, true);
    const explain = await getJson(baseUrl, "/api/exchange-packages/explain", {
      workspacePath,
      packagePath: "test-package"
    });
    assert.equal(explain.ok, true);
    assert.equal(explain.data.title, "Test Pack");

    const limits = await getJson(baseUrl, "/api/known-limits", { workspacePath, format: "pdf" });
    assert.equal(limits.ok, true);
    assert.ok(Array.isArray(limits.data));
    const audit = await post(baseUrl, "/api/security/secrets-audit", { workspacePath });
    assert.equal(audit.ok, true);
    assert.equal(audit.data.ok, true); // no mock secrets yet in settings
    const feedback = await post(baseUrl, "/api/feedback-bundle", { workspacePath, redact: true });
    assert.equal(feedback.ok, true);
    assert.ok(feedback.data.bundlePath);
  });
});
test("/api/mask and /api/unmask require session token but no workspace path", async () => {
  await withServer(async (baseUrl) => {
    const token = await getToken(baseUrl);

    const maskRes = await fetch(`${baseUrl}/api/mask`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ai-doc-exchange-token": token
      },
      body: JSON.stringify({ content: "Contact test@example.com" })
    });
    const maskData = await maskRes.json();
    assert.equal(maskRes.status, 200);
    assert.equal(maskData.ok, true);
    assert.match(maskData.data.maskedText, /\[MASK_EMAIL_1\]/);
    const unmaskRes = await fetch(`${baseUrl}/api/unmask`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ai-doc-exchange-token": token
      },
      body: JSON.stringify({ content: maskData.data.maskedText, mapping: maskData.data.mapping })
    });
    const unmaskData = await unmaskRes.json();
    assert.equal(unmaskRes.status, 200);
    assert.equal(unmaskData.ok, true);
    assert.equal(unmaskData.data, "Contact test@example.com");

    const missingTokenRes = await fetch(`${baseUrl}/api/mask`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ content: "Contact test@example.com" })
    });
    assert.equal(missingTokenRes.status, 403);
  });
});
