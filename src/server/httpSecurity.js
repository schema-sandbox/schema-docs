import path from "node:path";

export const HTTP_SECURITY_LIMITS = Object.freeze({
  jsonBytes: 8 * 1024 * 1024,
  uploadBytes: 256 * 1024 * 1024
});

export class HttpSecurityError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "HttpSecurityError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isTrustedLocalHostname(hostname = "") {
  const normalized = String(hostname).replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1" || normalized === "tauri.localhost";
}

export function isTrustedHostHeader(value = "") {
  if (!value) return false;
  try {
    return isTrustedLocalHostname(new URL(`http://${value}`).hostname);
  } catch {
    return false;
  }
}

export function isTrustedLocalUrl(value = "") {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return ["http:", "https:", "tauri:"].includes(parsed.protocol) && isTrustedLocalHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function canonicalLocalOrigin(value = "") {
  if (!isTrustedLocalUrl(value)) return "";
  const parsed = new URL(value);
  return `${parsed.protocol}//${parsed.host}`.toLowerCase();
}

export function trustedCorsOrigin(headers = {}, allowedOrigins = []) {
  const origin = headers.origin;
  const canonical = canonicalLocalOrigin(origin);
  if (!canonical) return "";
  const allowed = new Set(allowedOrigins.map(canonicalLocalOrigin).filter(Boolean));
  return allowed.has(canonical) ? origin : "";
}

export function hasTrustedBrowserContext(headers = {}, allowedOrigins = []) {
  const allowed = new Set(allowedOrigins.map(canonicalLocalOrigin).filter(Boolean));
  return [headers.origin, headers.referer]
    .map(canonicalLocalOrigin)
    .some((origin) => origin && allowed.has(origin));
}

export function isAbsoluteLocalPath(value = "") {
  const target = String(value).trim();
  return path.isAbsolute(target) || /^[A-Za-z]:[\\/]/.test(target) || /^\\\\/.test(target) || /^\/[A-Za-z]:[\\/]/.test(target);
}

export function isSafeWorkspaceRelativePath(value = "") {
  const target = String(value).trim();
  if (!target || target.includes("\u0000") || isAbsoluteLocalPath(target) || /^[a-z][a-z0-9+.-]*:/i.test(target)) return false;
  const normalized = target.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return !parts.includes("..") && !normalized.startsWith("/");
}

const OUTPUT_PATH_ROUTES = new Set([
  "/api/markdown/export",
  "/api/document/export",
  "/api/record/export-md"
]);

export function validatePublicApiPayload(route, body = {}) {
  if (route === "/api/markdown/read-external" || route === "/api/markdown/save-external") {
    throw new HttpSecurityError(403, "external_markdown_route_disabled", "Direct external Markdown access is disabled. Import the file into a workspace first.");
  }
  if (OUTPUT_PATH_ROUTES.has(route) || /^\/api\/export\/(?:md|docx|pdf|html)$/.test(route)) {
    if (!isSafeWorkspaceRelativePath(body.outputRelativePath)) {
      throw new HttpSecurityError(400, "unsafe_output_path", "Export outputRelativePath must be a workspace-relative path without traversal segments.", {
        outputRelativePath: body.outputRelativePath
      });
    }
  }
  return body;
}

export async function readBoundedBody(request, maxBytes) {
  const rawLength = request.headers?.["content-length"];
  const declaredLength = rawLength === undefined ? null : Number(rawLength);
  if (declaredLength !== null && (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > maxBytes)) {
    throw new HttpSecurityError(413, "request_too_large", `Request body exceeds the ${maxBytes}-byte limit.`, {
      declaredLength,
      maxBytes
    });
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new HttpSecurityError(413, "request_too_large", `Request body exceeds the ${maxBytes}-byte limit.`, {
        receivedBytes: total,
        maxBytes
      });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

export function parseJsonBody(buffer) {
  if (!buffer.length) return {};
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    throw new HttpSecurityError(400, "invalid_json", "Request body is not valid JSON.", {
      originalError: error.message
    });
  }
}

export function errorPayload(error) {
  return {
    ok: false,
    error: {
      code: error?.code || "proxy_error",
      message: error?.message || String(error),
      ...(error?.details && Object.keys(error.details).length ? { details: error.details } : {})
    }
  };
}
