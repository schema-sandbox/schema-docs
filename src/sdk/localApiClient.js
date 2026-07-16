export class SchemaDocsApiError extends Error {
  constructor(error, response) {
    super(error?.message ?? "Schema Docs API request failed.");
    this.name = "SchemaDocsApiError";
    this.code = error?.code ?? "schema_docs_api_error";
    this.details = error?.details;
    this.guidance = error?.guidance;
    this.status = response?.status;
  }
}

function trimSlash(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function requireValue(value, name) {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function readPayload(response, { raw = false } = {}) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = {
      ok: false,
      error: {
        code: "schema_docs_api_non_json_response",
        message: `Schema Docs API returned a non-JSON response with status ${response.status}.`,
        guidance: "Check that the local Schema Docs API runtime is running and that the base URL points to the local API server."
      }
    };
  }
  if (!response.ok || payload.ok === false) throw new SchemaDocsApiError(payload.error, response);
  return raw ? payload : payload.data;
}

export function createSchemaDocsLocalClient(options = {}) {
  const baseUrl = trimSlash(requireValue(options.baseUrl, "baseUrl"));
  const workspacePath = options.workspacePath;
  const token = options.token;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (typeof fetchImpl !== "function") throw new Error("fetch implementation i...");

  async function request(route, body = {}, requestOptions = {}) {
    const response = await fetchImpl(`${baseUrl}${route}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-ai-doc-exchange-token": token } : {})
      },
      body: JSON.stringify({
        ...(workspacePath ? { workspacePath } : {}),
        ...body
      })
    });
    return readPayload(response, requestOptions);
  }

  async function requestWithoutWorkspace(route, body = {}, requestOptions = {}) {
    const response = await fetchImpl(`${baseUrl}${route}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-ai-doc-exchange-token": token } : {})
      },
      body: JSON.stringify(body)
    });
    return readPayload(response, requestOptions);
  }

  async function get(route, params = {}) {
    const url = new URL(`${baseUrl}${route}`);
    if (workspacePath) {
      url.searchParams.set("workspacePath", workspacePath);
    }
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, value);
      }
    }
    const response = await fetchImpl(url, {
      headers: token ? { "x-ai-doc-exchange-token": token } : {}
    });
    return readPayload(response);
  }

  return {
    request,
    requestWithoutWorkspace,
    createTempWorkspace: () => requestWithoutWorkspace("/api/workspace/create-temp"),
    openWorkspace: () => request("/api/workspace/open"),
    compileWorkspaceManifest: () => request("/api/workspace/manifest"),
    adapterCapabilities: () => request("/api/adapter/capabilities"),
    capabilityManifest: () => request("/api/capability/manifest"),
    createSampleDocx: () => request("/api/samples/docx"),
    ingest: (sourcePath) => request("/api/ingest", { sourcePath }),
    extract: (input) => request("/api/extract", input),
    normalize: (input) => request("/api/normalize", input),
    writePackage: (packageRelativePath, input = {}) => request("/api/exchange-packages", {
      packageRelativePath,
      input
    }),
    readPackage: (packageRelativePath) => request("/api/exchange/package/read", { packageRelativePath }),
    explainPackage: (packageRelativePath) => request("/api/exchange-packages/explain", { packageRelativePath }),
    verifyPackage: (packageRelativePath) => request("/api/exchange-packages/verify", { packageRelativePath }),
    writeReceiverReport: (packageRelativePath) => request("/api/exchange/package/receiver-report", { packageRelativePath }),
    createPackageFromRecord: (recordId, packageRelativePath, input = {}) => request("/api/exchange/package/from-record", {
      recordId,
      packageRelativePath,
      input
    }),
    createExchangePackageFromRecord: (recordId, packageRelativePath, input = {}) => request("/api/exchange-packages/from-record", {
      recordId,
      packageRelativePath,
      input
    }),
    exportDocument: (format, input) => request(`/api/export/${format}`, input),
    prepareRecordForAi: (recordId) => request("/api/ai/prepare-record", { recordId }),
    compileAiIntakeManifest: (recordIdOrPackagePath) => request("/api/ai/intake-plan", { recordIdOrPackagePath }),
    compileAiFeedRunbook: (recordIdOrPackagePath, options = {}) => request("/api/ai/feed-runbook", { recordIdOrPackagePath, options }),
    readAiFeedRunbook: (jsonRelativePath) => request("/api/ai/feed-runbook/status", { jsonRelativePath }),
    updateAiFeedRunbookBatch: (jsonRelativePath, batchIndex, status, note = "") => request("/api/ai/feed-runbook/batch", { jsonRelativePath, batchIndex, status, note }),
    resolveAiContextChunk: (recordIdOrPackagePath, chunkIndex = 1) => request("/api/ai/context-chunk", { recordIdOrPackagePath, chunkIndex }),
    resolveAiContextChunkRange: (recordIdOrPackagePath, startChunkIndex = 1, endChunkIndex = startChunkIndex, tokenBudget = undefined) => request("/api/ai/context-range", { recordIdOrPackagePath, startChunkIndex, endChunkIndex, tokenBudget }),
    saveAiHandoffBundle: (relativePath, input = {}) => request("/api/ai/handoff-bundle", { relativePath, input }),
    prepareQueryForAi: (sql, options = {}) => request("/api/ai/query-context", { sql, options }),
    saveQueryAiHandoffBundle: (relativePath, sql, options = {}) => request("/api/ai/query-handoff", { relativePath, sql, options }),
    previewAiPayload: (input) => request("/api/ai/preview", { input }),
    sendAiRequest: (input) => request("/api/ai/send", { input }),
    writeBackAiResult: (relativePath, input) => request("/api/ai/result/write-back", { relativePath, input }),
    getEvidence: (evidenceId) => get(`/api/evidence/${encodeURIComponent(evidenceId)}`),
    listEvidence: () => request("/api/evidence/list")
  };
}
