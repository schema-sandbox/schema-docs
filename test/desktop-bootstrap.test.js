import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const BOOTSTRAP_SCRIPT_URL = new URL("../public/app-config.js", import.meta.url);
const script = await readFile(BOOTSTRAP_SCRIPT_URL, "utf8");

function encodedMarker(descriptor) {
  return Buffer.from(JSON.stringify(descriptor), "utf8").toString("base64url");
}

function marker(descriptor) {
  return `SCHEMA_DOCS_BOOTSTRAP ${encodedMarker(descriptor)}`;
}

function bootstrapResponse(baseUrl, token = "current") {
  return new Response(JSON.stringify({
    ok: true,
    data: {
      apiBaseUrl: baseUrl,
      token: `${token}-api-token`,
      assetToken: `${token}-asset-token`
    }
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function runBootstrapScript({
  originalFetch,
  invoke,
  hash = "",
  requestTimeoutMs = 100,
  deadlineMs = 500,
  pollIntervalMs = 1
}) {
  const window = {
    fetch: originalFetch,
    __SCHEMA_DOCS_BOOTSTRAP_REQUEST_TIMEOUT_MS__: requestTimeoutMs,
    __SCHEMA_DOCS_BOOTSTRAP_DEADLINE_MS__: deadlineMs,
    __SCHEMA_DOCS_BOOTSTRAP_POLL_INTERVAL_MS__: pollIntervalMs,
    __TAURI_INTERNALS__: { invoke },
    location: {
      hash,
      pathname: "/index.html",
      search: "",
      href: `tauri://localhost/index.html${hash}`
    },
    history: {
      replaceState(_state, _title, url) {
        window.location.hash = "";
        window.location.href = `tauri://localhost${url}`;
      }
    }
  };
  const context = vm.createContext({
    window,
    URL,
    URLSearchParams,
    Request,
    Response,
    Headers,
    AbortController,
    atob,
    setTimeout,
    clearTimeout
  });
  vm.runInContext(script, context, { filename: "app-config.js" });
  return window;
}

test("desktop bootstrap binds a static multi-marker log to the managed runtime", async () => {
  const stale = {
    baseUrl: "http://127.0.0.1:4177",
    bootstrapToken: "stale-token",
    pid: 101,
    sessionNonce: "session-stale"
  };
  const wrongNonce = {
    baseUrl: "http://127.0.0.1:4180",
    bootstrapToken: "wrong-nonce-token",
    pid: 303,
    sessionNonce: "session-other"
  };
  const current = {
    baseUrl: "http://127.0.0.1:4181",
    bootstrapToken: "current-token",
    pid: 303,
    sessionNonce: "session-current"
  };
  const calls = [];
  const originalFetch = async (input, init = {}) => {
    const url = String(input);
    const headers = new Headers(init.headers || {});
    calls.push({ url, method: init.method || "GET", headers: Object.fromEntries(headers.entries()) });
    if (url.endsWith("/bootstrap")) {
      assert.equal(headers.get("x-schema-docs-bootstrap-token"), current.bootstrapToken);
      return bootstrapResponse(current.baseUrl);
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const diagnostics = {
    runtimePid: current.pid,
    sessionNonce: current.sessionNonce,
    logs: {
      stderr: {
        tail: [marker(stale), "SCHEMA_DOCS_BOOTSTRAP not-base64", marker(wrongNonce), marker(current)].join("\n")
      },
      stdout: { tail: marker(stale) }
    }
  };
  const window = runBootstrapScript({
    originalFetch,
    invoke: async (command) => {
      assert.equal(command, "get_desktop_runtime_diagnostics");
      return diagnostics;
    }
  });

  assert.equal(calls.length, 0, "bootstrap must stay lazy until the first local request");

  const health = await window.fetch("http://127.0.0.1:4177/api/health", { cache: "no-store" });
  assert.equal(health.status, 200);
  assert.equal(calls.filter((call) => call.url.endsWith("/bootstrap")).length, 1);
  assert.equal(calls.at(-1).url, "http://127.0.0.1:4181/api/health");

  await window.fetch("http://127.0.0.1:4177/api/manifest", {
    method: "POST",
    headers: { "content-type": "application/json", "x-ai-doc-exchange-token": "stale-api-token" },
    body: "{}"
  });
  assert.equal(calls.at(-1).headers["x-ai-doc-exchange-token"], "current-api-token");

  await window.fetch("http://127.0.0.1:4177/api/workspace-asset?workspacePath=C%3A%5Cwork", {
    headers: { "x-ai-doc-exchange-token": "must-be-removed" }
  });
  const assetCall = calls.at(-1);
  assert.match(assetCall.url, /token=current-asset-token/);
  assert.equal(assetCall.headers["x-ai-doc-exchange-token"], undefined);
});

test("fragment bootstrap survives a transient connection failure and is not exposed in the URL", async () => {
  const descriptor = { baseUrl: "http://127.0.0.1:4191", bootstrapToken: "fragment-token" };
  let bootstrapCalls = 0;
  const window = runBootstrapScript({
    hash: `#bootstrap=${encodedMarker(descriptor)}`,
    originalFetch: async (input) => {
      const url = String(input);
      if (url.endsWith("/bootstrap")) {
        bootstrapCalls += 1;
        if (bootstrapCalls === 1) throw new Error("runtime is still starting");
        return bootstrapResponse(descriptor.baseUrl, "fragment");
      }
      return new Response("ok");
    },
    invoke: async () => {
      throw new Error("Tauri diagnostics are unavailable in fragment mode");
    }
  });

  await window.fetch("http://127.0.0.1:4177/api/health");
  assert.equal(bootstrapCalls, 2);
  assert.equal(window.location.hash, "");
  assert.doesNotMatch(window.location.href, /bootstrap=/);
});

test("a hung bootstrap request times out and a later request can bootstrap afresh", async () => {
  const descriptor = {
    baseUrl: "http://127.0.0.1:4192",
    bootstrapToken: "timeout-token",
    pid: 404,
    sessionNonce: "session-timeout"
  };
  let mode = "hang";
  let bootstrapCalls = 0;
  const window = runBootstrapScript({
    requestTimeoutMs: 20,
    deadlineMs: 500,
    originalFetch: async (input) => {
      const url = String(input);
      if (url.endsWith("/bootstrap")) {
        bootstrapCalls += 1;
        if (mode === "hang") return new Promise(() => {});
        return bootstrapResponse(descriptor.baseUrl, "retry");
      }
      return new Response("ok");
    },
    invoke: async () => ({
      runtimePid: descriptor.pid,
      sessionNonce: descriptor.sessionNonce,
      logs: { stderr: { tail: marker(descriptor) }, stdout: { tail: "" } }
    })
  });

  const started = Date.now();
  await assert.rejects(
    window.fetch("http://127.0.0.1:4177/api/health"),
    /bootstrap request timed out/
  );
  assert.ok(Date.now() - started < 2_000, "a hung fetch must not hang the desktop shell");
  assert.ok(bootstrapCalls >= 2, "a timed-out descriptor should be retried until the bounded deadline");

  mode = "ready";
  const response = await window.fetch("http://127.0.0.1:4177/api/health");
  assert.equal(response.status, 200);
});

test("desktop bootstrap rejects non-loopback markers without contacting them", async () => {
  const descriptor = {
    baseUrl: "https://example.com",
    bootstrapToken: "external-token",
    pid: 505,
    sessionNonce: "session-external"
  };
  const calls = [];
  const window = runBootstrapScript({
    requestTimeoutMs: 10,
    deadlineMs: 25,
    originalFetch: async (input) => {
      calls.push(String(input));
      return new Response("unexpected");
    },
    invoke: async () => ({
      runtimePid: descriptor.pid,
      sessionNonce: descriptor.sessionNonce,
      logs: { stderr: { tail: marker(descriptor) }, stdout: { tail: "" } }
    })
  });

  await assert.rejects(
    window.fetch("http://127.0.0.1:4177/api/health"),
    /did not publish a usable bootstrap marker/
  );
  assert.deepEqual(calls, []);
});

test("desktop bootstrap rejects an API origin that differs from its bound descriptor", async () => {
  const descriptor = {
    baseUrl: "http://127.0.0.1:4193",
    bootstrapToken: "origin-token",
    pid: 606,
    sessionNonce: "session-origin"
  };
  let bootstrapCalls = 0;
  const window = runBootstrapScript({
    requestTimeoutMs: 10,
    deadlineMs: 30,
    originalFetch: async (input) => {
      if (String(input).endsWith("/bootstrap")) {
        bootstrapCalls += 1;
        return bootstrapResponse("http://127.0.0.1:4999", "wrong-origin");
      }
      return new Response("unexpected");
    },
    invoke: async () => ({
      runtimePid: descriptor.pid,
      sessionNonce: descriptor.sessionNonce,
      logs: { stderr: { tail: marker(descriptor) }, stdout: { tail: "" } }
    })
  });

  await assert.rejects(
    window.fetch("http://127.0.0.1:4177/api/health"),
    /untrusted API origin/
  );
  assert.equal(bootstrapCalls, 1);
});
