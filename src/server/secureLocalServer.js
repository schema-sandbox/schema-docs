import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { createLocalServer } from "./localServer.js";
import {
  HTTP_SECURITY_LIMITS,
  HttpSecurityError,
  errorPayload,
  hasTrustedBrowserContext,
  isTrustedHostHeader,
  parseJsonBody,
  readBoundedBody,
  trustedCorsOrigin,
  validatePublicApiPayload
} from "./httpSecurity.js";

const API_TOKEN_HEADER = "x-ai-doc-exchange-token";
const BOOTSTRAP_TOKEN_HEADER = "x-schema-docs-bootstrap-token";
const ASSET_ROUTE = "/api/workspace-asset";
const ALLOWED_REQUEST_HEADERS = [
  "content-type",
  API_TOKEN_HEADER,
  BOOTSTRAP_TOKEN_HEADER,
  "x-schema-docs-workspace-path",
  "x-schema-docs-filename"
].join(",");

function randomToken(bytes = 24) {
  return randomBytes(bytes).toString("hex");
}

function internalSocketPath() {
  const suffix = `${process.pid}-${randomBytes(12).toString("hex")}`;
  if (process.platform === "win32") return `\\\\.\\pipe\\schema-docs-${suffix}`;
  return path.join(os.tmpdir(), `schema-docs-${suffix}.sock`);
}

function applyCorsHeaders(request, headers) {
  const origin = trustedCorsOrigin(request.headers);
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  return headers;
}

function applyCommonSecurityHeaders(headers, { staticAsset = false } = {}) {
  headers["x-content-type-options"] = "nosniff";
  headers["referrer-policy"] = "strict-origin-when-cross-origin";
  if (staticAsset) {
    headers["cross-origin-resource-policy"] = "same-origin";
    headers["content-security-policy"] = "default-src 'self'; connect-src 'self' http://127.0.0.1:* http://localhost:*; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; media-src 'self' data: blob:";
  }
  return headers;
}

function sendJson(request, response, statusCode, payload) {
  const headers = applyCommonSecurityHeaders(applyCorsHeaders(request, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }));
  response.writeHead(statusCode, headers);
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(request, response, statusCode, contentType, body, options = {}) {
  const headers = applyCommonSecurityHeaders(applyCorsHeaders(request, {
    "content-type": contentType,
    "cache-control": options.cacheControl || "no-store"
  }), { staticAsset: options.staticAsset });
  response.writeHead(statusCode, headers);
  response.end(body);
}

function browserConfigScript({ apiBaseUrl, apiToken, assetToken }) {
  return `(() => {
  const apiBaseUrl = ${JSON.stringify(apiBaseUrl)};
  const apiToken = ${JSON.stringify(apiToken)};
  const assetToken = ${JSON.stringify(assetToken)};
  const originalFetch = window.__SCHEMA_DOCS_ORIGINAL_FETCH__ || window.fetch.bind(window);
  window.__SCHEMA_DOCS_ORIGINAL_FETCH__ = originalFetch;
  window.SCHEMA_DOCS_API_BASE_URL = apiBaseUrl;
  window.AI_DOC_EXCHANGE_TOKEN = assetToken;
  if (window.__SCHEMA_DOCS_SECURE_FETCH_INSTALLED__) return;
  window.__SCHEMA_DOCS_SECURE_FETCH_INSTALLED__ = true;
  window.fetch = async (input, init = {}) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    let target;
    try { target = new URL(rawUrl, window.location.href); } catch { return originalFetch(input, init); }
    if (!["127.0.0.1", "localhost"].includes(target.hostname)) return originalFetch(input, init);
    const base = new URL(apiBaseUrl);
    target.protocol = base.protocol;
    target.hostname = base.hostname;
    target.port = base.port;
    if (target.pathname === "/app-config.js") {
      return new Response(
        "window.SCHEMA_DOCS_API_BASE_URL=" + JSON.stringify(apiBaseUrl) + ";window.AI_DOC_EXCHANGE_TOKEN=" + JSON.stringify(assetToken) + ";",
        { status: 200, headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" } }
      );
    }
    const headers = new Headers(input instanceof Request ? input.headers : (init.headers || {}));
    if (target.pathname === "/api/workspace-asset") {
      target.searchParams.set("token", assetToken);
      headers.delete("x-ai-doc-exchange-token");
    } else if (target.pathname.startsWith("/api/") && target.pathname !== "/api/health") {
      target.searchParams.delete("token");
      headers.set("x-ai-doc-exchange-token", apiToken);
    }
    if (input instanceof Request) {
      const method = init.method || input.method;
      let body = init.body;
      if (body === undefined && !["GET", "HEAD"].includes(method.toUpperCase())) body = await input.clone().blob();
      return originalFetch(target.toString(), { ...init, method, headers, body, signal: init.signal || input.signal });
    }
    return originalFetch(target.toString(), { ...init, headers });
  };
})();\n`;
}

function canServeAppConfig(request) {
  return isTrustedHostHeader(request.headers.host) && hasTrustedBrowserContext(request.headers);
}

function canUseAssetRoute(request, url, assetToken) {
  return url.searchParams.get("token") === assetToken
    && isTrustedHostHeader(request.headers.host)
    && hasTrustedBrowserContext(request.headers);
}

function filteredUpstreamHeaders(requestHeaders, bodyLength = null) {
  const headers = {
    "x-ai-doc-exchange-token": requestHeaders["x-ai-doc-exchange-token"] || "",
    "content-type": requestHeaders["content-type"] || "application/json",
    "x-schema-docs-workspace-path": requestHeaders["x-schema-docs-workspace-path"] || "",
    "x-schema-docs-filename": requestHeaders["x-schema-docs-filename"] || ""
  };
  for (const key of Object.keys(headers)) {
    if (!headers[key]) delete headers[key];
  }
  if (bodyLength !== null) headers["content-length"] = String(bodyLength);
  return headers;
}

function proxyResponseHeaders(request, upstreamHeaders, pathname) {
  const headers = {};
  for (const name of ["content-type", "content-length", "cache-control", "etag", "last-modified"]) {
    const value = upstreamHeaders[name];
    if (value !== undefined) headers[name] = value;
  }
  applyCorsHeaders(request, headers);
  applyCommonSecurityHeaders(headers, { staticAsset: !pathname.startsWith("/api/") && pathname !== "/bootstrap" });
  return headers;
}

function proxyBuffered({ request, response, socketPath, internalToken, url, body }) {
  return new Promise((resolve) => {
    const upstreamUrl = new URL(url.toString());
    upstreamUrl.searchParams.delete("token");
    const upstream = http.request({
      socketPath,
      method: request.method,
      path: `${upstreamUrl.pathname}${upstreamUrl.search}`,
      headers: {
        ...filteredUpstreamHeaders(request.headers, body?.length ?? 0),
        [API_TOKEN_HEADER]: internalToken,
        host: "schema-docs-internal"
      }
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, proxyResponseHeaders(request, upstreamResponse.headers, url.pathname));
      upstreamResponse.pipe(response);
      upstreamResponse.on("end", resolve);
    });
    upstream.on("error", (error) => {
      if (!response.headersSent) sendJson(request, response, 502, errorPayload(new HttpSecurityError(502, "internal_api_unavailable", error.message)));
      else response.destroy(error);
      resolve();
    });
    if (body?.length) upstream.write(body);
    upstream.end();
  });
}

function proxyUpload({ request, response, socketPath, internalToken, url, maxBytes }) {
  return new Promise((resolve) => {
    const declared = Number(request.headers["content-length"] || 0);
    if (declared > maxBytes) {
      sendJson(request, response, 413, errorPayload(new HttpSecurityError(413, "request_too_large", `Upload exceeds the ${maxBytes}-byte limit.`)));
      request.resume();
      resolve();
      return;
    }
    const upstreamUrl = new URL(url.toString());
    upstreamUrl.searchParams.delete("token");
    const upstream = http.request({
      socketPath,
      method: request.method,
      path: `${upstreamUrl.pathname}${upstreamUrl.search}`,
      headers: {
        ...filteredUpstreamHeaders(request.headers, declared || null),
        [API_TOKEN_HEADER]: internalToken,
        host: "schema-docs-internal"
      }
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, proxyResponseHeaders(request, upstreamResponse.headers, url.pathname));
      upstreamResponse.pipe(response);
      upstreamResponse.on("end", resolve);
    });
    let total = 0;
    let aborted = false;
    const failLarge = () => {
      if (aborted) return;
      aborted = true;
      upstream.destroy();
      if (!response.headersSent) sendJson(request, response, 413, errorPayload(new HttpSecurityError(413, "request_too_large", `Upload exceeds the ${maxBytes}-byte limit.`)));
      request.resume();
      resolve();
    };
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        failLarge();
        return;
      }
      if (!aborted && !upstream.write(chunk)) request.pause();
    });
    upstream.on("drain", () => request.resume());
    request.on("end", () => {
      if (!aborted) upstream.end();
    });
    request.on("error", (error) => {
      aborted = true;
      upstream.destroy(error);
      resolve();
    });
    upstream.on("error", (error) => {
      if (!aborted && !response.headersSent) sendJson(request, response, 502, errorPayload(new HttpSecurityError(502, "internal_api_unavailable", error.message)));
      aborted = true;
      resolve();
    });
  });
}

async function listenServer(server, listenTarget) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenTarget, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

export async function listenSecureLocalServer(options = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4177;
  const publicToken = options.token ?? randomToken();
  const assetToken = options.assetToken ?? randomToken(18);
  let bootstrapToken = options.bootstrapToken ?? randomToken();
  const socketPath = internalSocketPath();
  const internalToken = randomToken();
  const internalServer = createLocalServer({
    token: internalToken,
    requireToken: true,
    host: "127.0.0.1",
    port: 0,
    apiBaseUrl: "http://schema-docs-internal"
  });
  await listenServer(internalServer, socketPath);

  let apiBaseUrl = options.apiBaseUrl || `http://${host}:${port}`;
  const publicServer = http.createServer(async (request, response) => {
    try {
      if (!isTrustedHostHeader(request.headers.host)) {
        sendJson(request, response, 403, errorPayload(new HttpSecurityError(403, "untrusted_host", "Only loopback Host headers are accepted.")));
        return;
      }
      const url = new URL(request.url || "/", apiBaseUrl);
      const origin = request.headers.origin;
      if (origin && !trustedCorsOrigin(request.headers)) {
        sendJson(request, response, 403, errorPayload(new HttpSecurityError(403, "untrusted_origin", "Cross-origin requests from non-local origins are blocked.")));
        return;
      }
      if (request.method === "OPTIONS") {
        if (!trustedCorsOrigin(request.headers)) {
          sendJson(request, response, 403, errorPayload(new HttpSecurityError(403, "untrusted_origin", "CORS preflight origin is not trusted.")));
          return;
        }
        response.writeHead(204, applyCommonSecurityHeaders(applyCorsHeaders(request, {
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": ALLOWED_REQUEST_HEADERS,
          "access-control-max-age": "600",
          "cache-control": "no-store"
        })));
        response.end();
        return;
      }
      if (url.pathname === "/bootstrap") {
        if (request.method !== "POST" || request.headers[BOOTSTRAP_TOKEN_HEADER] !== bootstrapToken) {
          sendJson(request, response, 403, errorPayload(new HttpSecurityError(403, "invalid_bootstrap_token", "Invalid desktop bootstrap token.")));
          return;
        }
        const previousToken = bootstrapToken;
        bootstrapToken = randomToken();
        sendJson(request, response, 200, {
          ok: true,
          data: { apiBaseUrl, token: publicToken, assetToken }
        });
        options.onBootstrapToken?.({ apiBaseUrl, bootstrapToken, previousToken });
        return;
      }
      if (url.pathname === "/app-config.js") {
        if (!canServeAppConfig(request)) {
          sendText(request, response, 403, "text/plain; charset=utf-8", "Forbidden");
          return;
        }
        sendText(request, response, 200, "text/javascript; charset=utf-8", browserConfigScript({ apiBaseUrl, apiToken: publicToken, assetToken }));
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        const isHealth = url.pathname === "/api/health";
        const isAsset = url.pathname === ASSET_ROUTE;
        if (isAsset) {
          if (!canUseAssetRoute(request, url, assetToken)) {
            sendJson(request, response, 403, errorPayload(new HttpSecurityError(403, "invalid_asset_token", "Invalid or untrusted workspace asset request.")));
            return;
          }
        } else if (!isHealth) {
          if (url.searchParams.has("token")) {
            sendJson(request, response, 400, errorPayload(new HttpSecurityError(400, "query_token_rejected", "API tokens are accepted only in the request header.")));
            return;
          }
          if (request.headers[API_TOKEN_HEADER] !== publicToken) {
            sendJson(request, response, 403, errorPayload(new HttpSecurityError(403, "invalid_local_token", "Invalid local session token.")));
            return;
          }
        }
        if (request.method === "POST" && url.pathname === "/api/import-upload") {
          await proxyUpload({ request, response, socketPath, internalToken, url, maxBytes: options.uploadLimitBytes ?? HTTP_SECURITY_LIMITS.uploadBytes });
          return;
        }
        let body = Buffer.alloc(0);
        if (request.method === "POST") {
          body = await readBoundedBody(request, options.jsonLimitBytes ?? HTTP_SECURITY_LIMITS.jsonBytes);
          const parsed = parseJsonBody(body);
          validatePublicApiPayload(url.pathname, parsed);
          body = Buffer.from(JSON.stringify(parsed), "utf8");
        }
        await proxyBuffered({ request, response, socketPath, internalToken, url, body });
        return;
      }
      await proxyBuffered({ request, response, socketPath, internalToken, url, body: Buffer.alloc(0) });
    } catch (error) {
      if (error?.code === "request_too_large") request.resume();
      const status = error instanceof HttpSecurityError ? error.status : 500;
      if (!response.headersSent) sendJson(request, response, status, errorPayload(error));
      else response.destroy(error);
    }
  });

  try {
    await new Promise((resolve, reject) => {
      publicServer.once("error", reject);
      publicServer.listen(port, host, () => {
        publicServer.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    internalServer.close();
    if (process.platform !== "win32") await rm(socketPath, { force: true }).catch(() => {});
    throw error;
  }

  const address = publicServer.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  apiBaseUrl = options.apiBaseUrl || `http://${host}:${actualPort}`;
  publicServer.localToken = publicToken;
  publicServer.assetToken = assetToken;
  Object.defineProperty(publicServer, "bootstrapToken", { get: () => bootstrapToken });
  options.onBootstrapToken?.({ apiBaseUrl, bootstrapToken, previousToken: null });

  publicServer.on("close", () => {
    internalServer.close();
    if (process.platform !== "win32") rm(socketPath, { force: true }).catch(() => {});
  });
  return publicServer;
}
