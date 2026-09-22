// Packaged desktop bootstrap. The real API token is exchanged through a
// one-time token emitted by the child runtime and is kept only inside this
// script's fetch-wrapper closure. It is never placed in a URL or global.
(() => {
  const originalFetch = window.fetch.bind(window);
  window.__SCHEMA_DOCS_ORIGINAL_FETCH__ = originalFetch;
  window.AI_DOC_EXCHANGE_TOKEN = "desktop-bootstrap-pending";
  window.SCHEMA_DOCS_API_BASE_URL = "http://127.0.0.1:4177";

  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const positiveNumber = (value, fallback, minimum = 1) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
  };
  const requestTimeoutMs = positiveNumber(window.__SCHEMA_DOCS_BOOTSTRAP_REQUEST_TIMEOUT_MS__, 1500, 10);
  const bootstrapDeadlineMs = positiveNumber(window.__SCHEMA_DOCS_BOOTSTRAP_DEADLINE_MS__, 12000, requestTimeoutMs);
  const pollIntervalMs = positiveNumber(window.__SCHEMA_DOCS_BOOTSTRAP_POLL_INTERVAL_MS__, 100, 1);
  const decodeBase64Url = (value) => {
    const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    return atob(padded);
  };
  const parseBootstrapMarkers = (tail = "") => {
    const descriptors = [];
    for (const line of String(tail).split(/\r?\n/).reverse()) {
      if (!line.startsWith("SCHEMA_DOCS_BOOTSTRAP ")) continue;
      try {
        descriptors.push(JSON.parse(decodeBase64Url(line.slice("SCHEMA_DOCS_BOOTSTRAP ".length).trim())));
      } catch {
        // A partial or malformed log line must not hide another valid marker.
      }
    }
    return descriptors;
  };
  const loopbackBaseUrl = (value) => {
    try {
      const url = new URL(String(value));
      const hostname = url.hostname.toLowerCase();
      const loopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1";
      if (url.protocol !== "http:" || !loopback || url.username || url.password || url.search || url.hash) return null;
      if (url.pathname !== "/" && url.pathname !== "") return null;
      return url;
    } catch {
      return null;
    }
  };
  const validDescriptor = (descriptor) => {
    const base = loopbackBaseUrl(descriptor?.baseUrl);
    const bootstrapToken = typeof descriptor?.bootstrapToken === "string" ? descriptor.bootstrapToken : "";
    if (!base || !bootstrapToken) return null;
    return { ...descriptor, baseUrl: base.origin, bootstrapToken };
  };
  const tauriInvoke = (command, args = {}) => {
    const invoke = window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== "function") throw new Error("Secure desktop runtime bridge is unavailable.");
    return invoke(command, args);
  };
  const readFragmentBootstrapDescriptor = () => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const encoded = params.get("bootstrap");
    if (!encoded) return null;
    const descriptor = validDescriptor(parseBootstrapMarkers(`SCHEMA_DOCS_BOOTSTRAP ${encoded}`)[0]);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    return descriptor;
  };
  const descriptorKey = (descriptor) => `${descriptor.baseUrl}\n${descriptor.bootstrapToken}`;
  const descriptorsForRuntime = (diagnostics) => {
    const expectedPid = diagnostics?.runtimePid;
    const expectedNonce = diagnostics?.sessionNonce;
    if (expectedPid === null || expectedPid === undefined || !expectedNonce) return [];
    const descriptors = [
      ...parseBootstrapMarkers(diagnostics?.logs?.stderr?.tail || ""),
      ...parseBootstrapMarkers(diagnostics?.logs?.stdout?.tail || "")
    ];
    return descriptors
      .map(validDescriptor)
      .filter(Boolean)
      .filter((descriptor) => String(descriptor.pid) === String(expectedPid)
        && descriptor.sessionNonce === expectedNonce);
  };
  const fetchWithTimeout = async (url, init) => {
    const controller = new AbortController();
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error("Secure desktop bootstrap request timed out."));
      }, requestTimeoutMs);
    });
    try {
      return await Promise.race([originalFetch(url, { ...init, signal: controller.signal }), timeout]);
    } finally {
      clearTimeout(timeoutId);
    }
  };
  const bootstrapRuntime = async () => {
    const fragmentDescriptor = readFragmentBootstrapDescriptor();
    const rejectedDescriptors = new Set();
    const deadline = Date.now() + bootstrapDeadlineMs;
    let lastError = null;
    while (Date.now() < deadline) {
      const candidates = fragmentDescriptor ? [fragmentDescriptor] : [];
      try {
        const diagnostics = await tauriInvoke("get_desktop_runtime_diagnostics");
        candidates.push(...descriptorsForRuntime(diagnostics));
      } catch (error) {
        if (!fragmentDescriptor) lastError = error;
      }
      const seen = new Set();
      for (const descriptor of candidates) {
        const key = descriptorKey(descriptor);
        if (seen.has(key) || rejectedDescriptors.has(key)) continue;
        seen.add(key);
        try {
          const response = await fetchWithTimeout(`${descriptor.baseUrl}/bootstrap`, {
            method: "POST",
            headers: { "x-schema-docs-bootstrap-token": descriptor.bootstrapToken },
            cache: "no-store"
          });
          const payload = await response.json().catch(() => null);
          if (response.ok && payload?.ok === true && payload?.data?.token && payload?.data?.assetToken) {
            const config = payload.data;
            const apiBase = loopbackBaseUrl(config.apiBaseUrl);
            const descriptorBase = loopbackBaseUrl(descriptor.baseUrl);
            if (!apiBase || !descriptorBase || apiBase.origin !== descriptorBase.origin) {
              throw Object.assign(new Error("Desktop bootstrap returned an untrusted API origin."), { permanent: true });
            }
            config.apiBaseUrl = apiBase.origin;
            window.SCHEMA_DOCS_API_BASE_URL = config.apiBaseUrl;
            window.AI_DOC_EXCHANGE_TOKEN = config.assetToken;
            return config;
          }
          lastError = new Error(payload?.error?.message || "Secure desktop bootstrap failed.");
          if (response.status >= 400 && response.status < 500 && ![408, 425, 429].includes(response.status)) {
            rejectedDescriptors.add(key);
          }
        } catch (error) {
          lastError = error;
          if (error?.permanent) rejectedDescriptors.add(key);
        }
      }
      const remaining = deadline - Date.now();
      if (remaining > 0) await delay(Math.min(pollIntervalMs, remaining));
    }
    throw new Error(lastError?.message || "Schema Docs secure runtime did not publish a usable bootstrap marker.");
  };
  let runtimeConfig = null;
  const getRuntimeConfig = () => {
    runtimeConfig ||= bootstrapRuntime().catch((error) => {
      runtimeConfig = null;
      throw error;
    });
    return runtimeConfig;
  };

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
    const config = await getRuntimeConfig();
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
