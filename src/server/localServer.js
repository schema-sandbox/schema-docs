import http from "node:http";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { execFile, execSync } from "node:child_process";
import fs from "node:fs";
const serverStartTime = new Date().toISOString();
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAppService } from "../core/appService.js";
import { toErrorRecord } from "../core/errors.js";
import { maskSensitiveData, unmaskSensitiveData } from "../core/masking.js";
import { sanitizeFolderForAi } from "../core/appService.js";
import { assertInsideRoot, isSubPath, resolveExistingPath } from "../core/pathGuard.js";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC_DIR = path.join(ROOT, "public");
const MIME_TYPES = new Map([[".html", "text/html; charset=utf-8"], [".css", "text/css; charset=utf-8"], [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"]]);
const WORKSPACE_ASSET_TYPES = new Map([[".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".gif", "image/gif"], [".webp", "image/webp"]]);
async function readJsonRequest(request) {
const chunks = [];
for await (const chunk of request) {
chunks.push(chunk);
}
const raw = Buffer.concat(chunks).toString("utf8");
return raw ? JSON.parse(raw) : {};
}
function sendJson(response, statusCode, payload) {
response.writeHead(statusCode, {
"content-type": "application/json; charset=utf-8",
"cache-control": "no-store",
"access-control-allow-origin": "*",
"access-control-allow-methods": "GET,POST,OPTIONS",
"access-control-allow-headers": "content-type,x-ai-doc-exchange-token"
});
response.end(JSON.stringify(payload, null, 2));
}
function sendOk(response, data) {
sendJson(response, 200, { ok: true, data });
}
function assertExternalMarkdownPath(value) {
const target = String(value || "").trim();
if (!path.isAbsolute(target) || !/\.(md|markdown)$/i.test(target)) {
throw new Error("An absolute Markdown file path is required.");
}
return target;
}
async function sendStatic(response, pathname) {
const safePath = pathname === "/" ? "/index.html" : pathname;
const resolved = path.resolve(PUBLIC_DIR, `.${safePath}`);
if (!resolved.startsWith(PUBLIC_DIR)) {
response.writeHead(403);
response.end("Forbidden");
return;
}
try {
const content = await readFile(resolved);
response.writeHead(200, {
"content-type": MIME_TYPES.get(path.extname(resolved)) ?? "application/octet-stream"
});
response.end(content);
} catch {
response.writeHead(404);
response.end("Not found");
}
}
async function handleApi(request, response, url) {
const method = request.method;
const route = url.pathname;
if (method === "GET" && route === "/api/health") {
let gitCommit = "unknown";
try {
gitCommit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"], timeout: 1000 }).toString().trim();
} catch {}
let documentsMtime = "unknown";
try {
const docPath = path.join(ROOT, "src/core/documents.js");
documentsMtime = fs.statSync(docPath).mtime.toISOString();
} catch {}
sendOk(response, {
service: "schema-docs-local-api",
version: "0.1.0",
workspaceRequired: true,
diagnostics: { appMode: ROOT.includes("Schema Sandbox") ? "source" : "packaged", startTime: serverStartTime, gitCommit, documentsMtime }
});
return;
}
if (method === "GET" && route === "/api/workspace-asset") {
const workspacePath = url.searchParams.get("workspacePath") || "";
const markdownPath = url.searchParams.get("markdownPath") || "";
const assetPath = url.searchParams.get("assetPath") || "";
try {
const workspaceRoot = path.resolve(workspacePath);
const externalMarkdown = path.isAbsolute(markdownPath);
const markdownFile = externalMarkdown ? path.resolve(markdownPath) : path.resolve(workspaceRoot, markdownPath);
if (!workspacePath || !markdownPath || !assetPath || (externalMarkdown && !/\.(?:md|markdown)$/i.test(markdownFile))) {
throw new Error("Invalid workspace image path.");
}
let allowedRoot;
if (externalMarkdown) {
allowedRoot = await resolveExistingPath(path.dirname(markdownFile));
const markdownReal = await resolveExistingPath(markdownFile);
if (!isSubPath(markdownReal, allowedRoot)) throw new Error("Invalid workspace image path.");
} else {
allowedRoot = await resolveExistingPath(workspaceRoot);
await assertInsideRoot(markdownFile, allowedRoot);
}
const assetFile = await resolveExistingPath(path.resolve(path.dirname(markdownFile), assetPath));
const extension = path.extname(assetFile).toLowerCase();
if (!isSubPath(assetFile, allowedRoot) || !WORKSPACE_ASSET_TYPES.has(extension)) {
throw new Error("Invalid workspace image path.");
}
const content = await readFile(assetFile);
response.writeHead(200, {
"content-type": WORKSPACE_ASSET_TYPES.get(extension),
"cache-control": "private, max-age=3600",
"access-control-allow-origin": "*"
});
response.end(content);
} catch (error) {
sendJson(response, 404, { ok: false, error: toErrorRecord(error) });
}
return;
}
if (method === "POST" && route === "/api/import-upload") {
const workspacePath = request.headers["x-schema-docs-workspace-path"] || url.searchParams.get("workspacePath");
const originalName = request.headers["x-schema-docs-filename"] || url.searchParams.get("filename") || "uploaded-file";
if (!workspacePath) {
sendJson(response, 400, { ok: false, error: toErrorRecord({ code: "workspace_required", message: "workspacePath is required." }) });
return;
}
try {
const chunks = [];
for await (const chunk of request) chunks.push(chunk);
sendOk(response, await createAppService(workspacePath).importFileBuffer(Buffer.concat(chunks), originalName));
} catch (err) {
sendJson(response, 500, { ok: false, error: toErrorRecord(err) });
}
return;
}
const body = method === "POST" ? await readJsonRequest(request) : {};
const workspacePath = body.workspacePath ?? url.searchParams.get("workspacePath") ?? request.headers["x-schema-docs-workspace-path"];
if (method === "POST") {
if (route === "/api/mask") { sendOk(response, maskSensitiveData(body.content)); return; }
if (route === "/api/unmask") { sendOk(response, unmaskSensitiveData(body.content, body.mapping)); return; }
if (route === "/api/markdown/read-external") {
try {
const sourcePath = assertExternalMarkdownPath(body.sourcePath);
const fileStat = await stat(sourcePath);
if (!fileStat.isFile()) throw new Error("The selected Markdown path is not a file.");
sendOk(response, await readFile(sourcePath, "utf8"));
} catch (err) {
sendJson(response, 400, { ok: false, error: toErrorRecord(err) });
}
return;
}
if (route === "/api/markdown/save-external") {
try {
const sourcePath = assertExternalMarkdownPath(body.sourcePath);
const fileStat = await stat(sourcePath);
if (!fileStat.isFile()) throw new Error("The selected Markdown path is not a file.");
await writeFile(sourcePath, String(body.content ?? ""), "utf8");
sendOk(response, { sourcePath });
} catch (err) {
sendJson(response, 400, { ok: false, error: toErrorRecord(err) });
}
return;
}
if (route === "/api/folder/sanitize") {
try { sendOk(response, await sanitizeFolderForAi(body.sourceFolderPath, { outputFolderPath: body.outputFolderPath })); }
catch (err) { sendJson(response, 500, { ok: false, error: { message: err.message } }); }
return;
}
if (route === "/api/document/open-original") {
const target = String(body.originalPath || "").trim();
if (!target || !path.isAbsolute(target)) { sendJson(response, 400, { ok: false, error: { message: "An absolute originalPath is required." } }); return; }
const platform = os.platform();
const command = platform === "win32" ? "explorer.exe" : (platform === "darwin" ? "open" : "xdg-open");
execFile(command, [target], (err) => {
if (err) sendJson(response, 500, { ok: false, error: { message: `Failed to open document: ${err.message}` } });
else sendOk(response, { opened: true });
});
return;
}
if (route === "/api/document/open-folder") {
const target = body.folderPath;
if (!target) { sendJson(response, 400, { ok: false, error: { message: "folderPath is required." } }); return; }
const resolved = path.resolve(target);
const platform = os.platform();
if (platform === "win32") {
execFile("explorer.exe", ["/select," + resolved], (err) => {
if (err) execFile("explorer.exe", [path.dirname(resolved)], () => sendOk(response, { opened: true, fallback: true }));
else sendOk(response, { opened: true });
});
} else if (platform === "darwin") {
execFile("open", ["-R", resolved], (err) => {
if (err) execFile("open", [path.dirname(resolved)], () => sendOk(response, { opened: true, fallback: true }));
else sendOk(response, { opened: true });
});
} else {
execFile("xdg-open", [path.dirname(resolved)], (err) => {
if (err) sendJson(response, 500, { ok: false, error: { message: `Failed to open folder: ${err.message}` } });
else sendOk(response, { opened: true });
});
}
return;
}
if (route === "/api/workspace/create-temp") {
const tempPath = await mkdtemp(path.join(os.tmpdir(), "schema-docs-workspace-"));
sendOk(response, { workspacePath: tempPath, manifest: await createAppService(tempPath).openWorkspace() });
return;
}
}
if (!workspacePath) {
sendJson(response, 400, { ok: false, error: toErrorRecord({ code: "workspace_required", message: "workspacePath is required." }) });
return;
}
const service = createAppService(workspacePath);
if (method === "GET") {
if (route === "/api/known-limits") {
sendOk(response, await service.getKnownLimits({ format: url.searchParams.get("format") || undefined, area: url.searchParams.get("area") || undefined }));
return;
}
if (route.startsWith("/api/actions/suggestions/")) {
const recordId = route.slice("/api/actions/suggestions/".length);
const manifest = await service.getManifest();
const doc = (manifest.documents || []).find((d) => d.id === recordId) || (manifest.datasets || []).find((d) => d.id === recordId);
sendOk(response, await service.getActionSuggestions(doc?.warnings || []));
return;
}
if (route.startsWith("/api/evidence/")) {
sendOk(response, await service.getEvidenceRecord(decodeURIComponent(route.slice("/api/evidence/".length))));
return;
}
if (route.startsWith("/api/timeline/")) {
sendOk(response, await service.getTimeline(decodeURIComponent(route.slice("/api/timeline/".length))));
return;
}
}
if (route === "/api/inbox/recommendations") {
sendOk(response, await service.getInboxRecommendations(body.itemId ?? url.searchParams.get("itemId")));
return;
}
if (method === "POST" && /^\/api\/export\/(md|docx|pdf)$/.test(route)) {
const format = route.split("/").pop();
sendOk(response, body.documentId
? await service.convertDocumentToFormat(body.documentId, body.outputRelativePath, format)
: await service.exportMarkdownDocument(body.relativePath, body.outputRelativePath, format)
);
return;
}
const handlers = {
"/api/workspace/open": s => s.openWorkspace(),
"/api/markdown/save": (s, b) => s.saveMarkdown(b.relativePath, b.content ?? ""),
"/api/markdown/read": (s, b) => s.readMarkdown(b.relativePath),
"/api/markdown/delete": (s, b) => s.deleteMarkdown(b.relativePath),
"/api/markdown/export": (s, b) => s.exportMarkdownDocument(b.relativePath, b.outputRelativePath, b.format),
"/api/import": (s, b) => s.importFile(b.sourcePath),
"/api/workspace/search": (s, b) => s.searchWorkspace(b.keyword),
"/api/samples/docx": s => s.createSampleDocx(),
"/api/ingest": (s, b) => s.importFile(b.sourcePath),
"/api/dataset/inspect": (s, b) => s.inspectDataset(b.datasetId),
"/api/document/convert": (s, b) => s.convertDocument(b.documentId),
"/api/document/retry-extraction": (s, b) => s.retryDocumentExtraction(b.documentId, b.preferredExtractor),
"/api/pdf/render-region": (s, b) => s.renderPdfVisualRegion(b.documentId, b.pageNumber, b.regionIndex, b.outputRelativePath, b.dpi),
"/api/pdf/preserve-visual-assets": (s, b) => s.preservePdfVisualAssets(b.documentId, b.mode, b.dpi),
"/api/document/convert-all": s => s.convertAllDocuments(),
"/api/workspace/check-updates": s => s.checkUpdates(),
"/api/workspace/detect-source-changes": s => s.detectSourceChanges(),
"/api/record/refresh": (s, b) => s.refreshRecord(b.recordId),
"/api/record/refresh-source": (s, b) => s.refreshImportSource(b.recordId),
"/api/record/refresh-preview": (s, b) => s.previewRecordRefresh(b.recordId),
"/api/records/status": s => s.getRecordStatuses(),
"/api/records/refresh": (s, b) => s.refreshRecord(b.recordId),
"/api/records/refresh-all": (s, b) => s.refreshAll({ write: !!b.write }),
"/api/extract": (s, b) => b.documentId ? s.convertDocument(b.documentId) : s.inspectDataset(b.datasetId),
"/api/document/export": (s, b) => s.convertDocumentToFormat(b.documentId, b.outputRelativePath, b.format),
"/api/record/export-md": (s, b) => s.exportRecordToMarkdown(b.recordId ?? b.documentId, b.outputRelativePath),
"/api/document/capabilities": s => s.listDocumentExchangeCapabilities(),
"/api/adapter/capabilities": s => s.detectAdapterCapabilities(),
"/api/capability/manifest": s => s.getDocumentCapabilityManifest(),
"/api/conversions/list": s => s.listConversionAudits(),
"/api/conversions/delete": (s, b) => s.deleteConversionAudit(b.auditId),
"/api/evidence/list": s => s.listEvidenceRecords(),
"/api/evidence/get": (s, b) => s.getEvidenceRecord(b.evidenceId),
"/api/evidence/delete": (s, b) => s.deleteEvidenceRecord(b.evidenceId),
"/api/tables": s => s.listTables(),
"/api/query": (s, b) => s.runQuery(b.sql),
"/api/ai/query-context": (s, b) => s.prepareQueryForAi(b.sql, b.options ?? {}),
"/api/ai/query-handoff": (s, b) => s.saveQueryAiHandoffBundle(b.relativePath, b.sql, b.options ?? {}),
"/api/ai/preview": (s, b) => s.previewAiPayload(b.input ?? {}),
"/api/ai/send": (s, b) => s.sendAiRequest(b.input ?? {}),
"/api/profiles/list": s => s.listApiProfiles(),
"/api/profiles/save": (s, b) => s.saveApiProfile(b.input ?? {}),
"/api/profiles/delete": (s, b) => s.deleteApiProfile(b.profileId),
"/api/audits/list": s => s.listExchangeAudits(),
"/api/audits/delete": (s, b) => s.deleteExchangeAudit(b.auditId),
"/api/exchange/save": (s, b) => s.saveExchangeMarkdown(b.relativePath, b.input ?? {}),
"/api/ai/result/write-back": (s, b) => s.writeBackAiResult(b.relativePath, b.input ?? {}),
"/api/exchange/package": (s, b) => s.saveExchangePackage(b.packageRelativePath, b.input ?? {}),
"/api/exchange-packages": (s, b) => s.saveExchangePackage(b.packageRelativePath ?? b.packagePath, b.input ?? { title: b.title, body: b.body, source: b.source, exportFormats: b.exportFormats, evidence: b.evidence, audit: b.audit }),
"/api/exchange/package/read": (s, b) => s.readExchangePackage(b.packageRelativePath),
"/api/exchange/package/explain": (s, b) => s.explainExchangePackage(b.packageRelativePath),
"/api/exchange/package/trust-report": (s, b) => s.generateTrustReport(b.packageRelativePath),
"/api/exchange/package/receiver-report": (s, b) => s.writeExchangePackageReceiverReport(b.packageRelativePath),
"/api/exchange/package/from-record": (s, b) => s.saveExchangePackageFromRecord(b.recordId, b.packageRelativePath, b.input ?? {}),
"/api/exchange-packages/from-record": (s, b) => s.saveExchangePackageFromRecord(b.recordId, b.packagePath ?? b.packageRelativePath, b.input ?? {}),
"/api/normalize": (s, b) => b.packageRelativePath ? s.saveExchangePackage(b.packageRelativePath, b.input ?? {}) : s.saveExchangeMarkdown(b.relativePath, b.input ?? {}),
"/api/manifest": s => s.getManifest(),
"/api/inbox": s => s.getInbox(),
"/api/inbox/archive": (s, b) => s.archiveInbox(b.itemId),
"/api/inbox/unarchive": (s, b) => s.unarchiveInbox(b.itemId),
"/api/timeline": (s, b, u) => s.getTimeline(b.recordId ?? u.searchParams.get("recordId")),
"/api/versions": (s, b, u) => s.listMarkdownVersions(u.searchParams.get("relativePath") ?? u.searchParams.get("path")),
"/api/versions/promote": (s, b) => s.promoteMarkdownVersion(b.relativePath ?? b.path, b.versionId),
"/api/versions/diff": (s, b, u) => s.diffMarkdownVersions(b.pathA ?? u.searchParams.get("pathA"), b.pathB ?? u.searchParams.get("pathB")),
"/api/settings": (s, b, u, m) => m === "POST" ? s.updateWorkspaceSettings(b.key, b.value) : s.getWorkspaceSettings(),
"/api/samples/real-summary": s => s.getRealSampleSummary(),
"/api/exchange-packages/explain": (s, b, u) => s.explainExchangePackage(b.packagePath ?? b.packageRelativePath ?? b.path ?? u.searchParams.get("packagePath") ?? u.searchParams.get("packageRelativePath") ?? u.searchParams.get("path")),
"/api/exchange-packages/verify": (s, b) => s.verifyExchangePackage(b.packagePath ?? b.packageRelativePath ?? b.path),
"/api/feedback-bundle": (s, b) => s.generateFeedbackBundle(b.outDir || null, b.redact !== false),
"/api/repro-script": (s, b) => s.generateReproductionScript({ recordId: b.recordId, fromFeedbackBundle: b.fromFeedbackBundle || null }, b.outPath || null),
"/api/security/secrets-audit": s => s.runSecuritySecretsAudit(),
"/api/workspace/manifest": s => s.compileWorkspaceManifest(),
"/api/ai/context-preview": (s, b) => s.compileAiContextPreview(b.recordIdOrPackagePath),
"/api/ai/intake-plan": (s, b) => s.compileAiIntakeManifest(b.recordIdOrPackagePath),
"/api/ai/feed-runbook": (s, b) => s.compileAiFeedRunbook(b.recordIdOrPackagePath, b.options ?? {}),
"/api/ai/feed-runbook/status": (s, b) => s.readAiFeedRunbook(b.jsonRelativePath),
"/api/ai/feed-runbook/batch": (s, b) => s.updateAiFeedRunbookBatch(b.jsonRelativePath, b.batchIndex, b.status, b.note ?? ""),
"/api/ai/handoff-bundle": (s, b) => s.saveAiHandoffBundle(b.relativePath, b.input ?? {}),
"/api/ai/context-chunk": (s, b) => s.resolveAiContextChunk(b.recordIdOrPackagePath, b.chunkIndex),
"/api/ai/context-range": (s, b) => s.resolveAiContextChunkRange(b.recordIdOrPackagePath, b.startChunkIndex, b.endChunkIndex, b.tokenBudget),
"/api/ai/prepare-record": (s, b) => s.prepareRecordForAi(b.recordId)
};
const handler = handlers[route];
if (handler) {
try {
sendOk(response, await handler(service, body, url, method));
} catch (err) {
sendJson(response, 500, { ok: false, error: toErrorRecord(err) });
}
return;
}
sendJson(response, 404, { ok: false, error: { code: "route_not_found", message: `Route not found: ${method} ${route}` } });
}
function sendAppConfig(response, token, apiBaseUrl) {
response.writeHead(200, {
"content-type": "text/javascript; charset=utf-8",
"cache-control": "no-store",
"access-control-allow-origin": "*"
});
response.end([
`window.AI_DOC_EXCHANGE_TOKEN = ${JSON.stringify(token)};`,
`window.SCHEMA_DOCS_API_BASE_URL = ${JSON.stringify(apiBaseUrl)};`,
""
].join("\n"));
}
function isTrustedLocalUrl(value = "") {
if (!value) return true;
try {
const parsed = new URL(value);
return ["127.0.0.1", "localhost", "tauri.localhost"].includes(parsed.hostname);
} catch {
return false;
}
}
function hasTrustedLocalHeader(request) {
return [request.headers.origin, request.headers.referer].some((value) => {
if (!value) return false;
return isTrustedLocalUrl(value);
});
}
function canServeAppConfig(request) {
if (request.headers["sec-fetch-site"] === "cross-site" && !hasTrustedLocalHeader(request)) {
return false;
}
return isTrustedLocalUrl(request.headers.origin) && isTrustedLocalUrl(request.headers.referer);
}
export function createLocalServer(options = {}) {
const token = options.token ?? randomBytes(24).toString("hex");
const requireToken = options.requireToken ?? true;
const host = options.host ?? "127.0.0.1";
const port = options.port ?? 4177;
const apiBaseUrl = options.apiBaseUrl ?? `http://${host}:${port}`;
return http.createServer(async (request, response) => {
try {
const url = new URL(request.url ?? "/", "http://127.0.0.1");
if (request.method === "OPTIONS") {
response.writeHead(204, {
"access-control-allow-origin": "*",
"access-control-allow-methods": "GET,POST,OPTIONS",
"access-control-allow-headers": "content-type,x-ai-doc-exchange-token",
"cache-control": "no-store"
});
response.end();
return;
}
if (url.pathname === "/app-config.js") {
if (!canServeAppConfig(request)) {
response.writeHead(403, {
"content-type": "text/plain; charset=utf-8",
"cache-control": "no-store"
});
response.end("Forbidden");
return;
}
const requestBaseUrl = options.apiBaseUrl
?? `http://${request.headers.host ?? `${host}:${port}`}`;
sendAppConfig(response, token, requestBaseUrl);
return;
}
if (url.pathname.startsWith("/api/")) {
const requestToken = request.headers["x-ai-doc-exchange-token"] || url.searchParams.get("token");
if (url.pathname !== "/api/health" && requireToken && requestToken !== token) {
sendJson(response, 403, {
ok: false,
error: {
code: "invalid_local_token",
message: "Invalid local session token."
}
});
return;
}
await handleApi(request, response, url);
return;
}
await sendStatic(response, url.pathname);
} catch (error) {
sendJson(response, 500, {
ok: false,
error: toErrorRecord(error)
});
}
}).on("listening", function setToken() {
this.localToken = token;
});
}
export function listenLocalServer({ port = 4177, host = "127.0.0.1", token, requireToken } = {}) {
const server = createLocalServer({ port, host, token, requireToken });
return new Promise((resolve, reject) => {
server.once("error", reject);
server.listen(port, host, () => {
server.off("error", reject);
resolve(server);
});
});
}
