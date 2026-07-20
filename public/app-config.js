// Packaged desktop bootstrap. The real API token is exchanged through a
// one-time token emitted by the child runtime and is kept only inside this
// script's fetch-wrapper closure. It is never placed in a URL or global.
(() => {
  const originalFetch = window.fetch.bind(window);
  window.__SCHEMA_DOCS_ORIGINAL_FETCH__ = originalFetch;
  window.AI_DOC_EXCHANGE_TOKEN = "desktop-bootstrap-pending";
  window.SCHEMA_DOCS_API_BASE_URL = "http://127.0.0.1:4177";

  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const decodeBase64Url = (value) => {
    const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    return atob(padded);
  };
  const parseLatestBootstrapMarker = (tail = "") => {
    const line = String(tail).split(/\r?\n/).reverse().find((item) => item.startsWith("SCHEMA_DOCS_BOOTSTRAP "));
    if (!line) return null;
    try {
      return JSON.parse(decodeBase64Url(line.slice("SCHEMA_DOCS_BOOTSTRAP ".length).trim()));
    } catch {
      return null;
    }
  };
  const tauriInvoke = (command, args = {}) => {
    const invoke = window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== "function") throw new Error("Secure desktop runtime bridge is unavailable.");
    return invoke(command, args);
  };
  const readBootstrapDescriptor = async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const diagnostics = await tauriInvoke("get_desktop_runtime_diagnostics");
      const descriptor = parseLatestBootstrapMarker(diagnostics?.logs?.stdout?.tail || "");
      if (descriptor?.baseUrl && descriptor?.bootstrapToken) return descriptor;
      await delay(100);
    }
    throw new Error("Schema Docs secure runtime did not publish a bootstrap marker.");
  };
  const bootstrapRuntime = async () => {
    const descriptor = await readBootstrapDescriptor();
    const response = await originalFetch(`${descriptor.baseUrl}/bootstrap`, {
      method: "POST",
      headers: { "x-schema-docs-bootstrap-token": descriptor.bootstrapToken },
      cache: "no-store"
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true || !payload?.data?.token || !payload?.data?.assetToken) {
      throw new Error(payload?.error?.message || "Secure desktop bootstrap failed.");
    }
    const config = payload.data;
    window.SCHEMA_DOCS_API_BASE_URL = config.apiBaseUrl;
    window.AI_DOC_EXCHANGE_TOKEN = config.assetToken;
    return config;
  };
  const runtimeConfig = bootstrapRuntime();

  window.fetch = async (input, init = {}) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    let target;
    try {
      target = new URL(rawUrl, window.location.href);
    } catch {
      return originalFetch(input, init);
    }
    if (!["127.0.0.1", "localhost"].includes(target.hostname)) {
      return originalFetch(input, init);
    }
    const config = await runtimeConfig;
    const base = new URL(config.apiBaseUrl);
    target.protocol = base.protocol;
    target.hostname = base.hostname;
    target.port = base.port;
    if (target.pathname === "/app-config.js") {
      const script = `window.SCHEMA_DOCS_API_BASE_URL=${JSON.stringify(config.apiBaseUrl)};window.AI_DOC_EXCHANGE_TOKEN=${JSON.stringify(config.assetToken)};`;
      return new Response(script, {
        status: 200,
        headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" }
      });
    }
    const headers = new Headers(input instanceof Request ? input.headers : (init.headers || {}));
    if (target.pathname === "/api/workspace-asset") {
      target.searchParams.set("token", config.assetToken);
      headers.delete("x-ai-doc-exchange-token");
    } else if (target.pathname.startsWith("/api/") && target.pathname !== "/api/health") {
      target.searchParams.delete("token");
      headers.set("x-ai-doc-exchange-token", config.token);
    }
    if (input instanceof Request) {
      const method = init.method || input.method;
      let body = init.body;
      if (body === undefined && !["GET", "HEAD"].includes(method.toUpperCase())) body = await input.clone().blob();
      return originalFetch(target.toString(), { ...init, method, headers, body, signal: init.signal || input.signal });
    }
    return originalFetch(target.toString(), { ...init, headers });
  };
})();
