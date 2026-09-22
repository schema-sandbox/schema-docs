import { createHash } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createId, nowIso } from "./ids.js";
import { AppError } from "./errors.js";
import { assertSafeWritePath, prepareSafeWritePath } from "./pathGuard.js";

export const CONVERSION_CHECKPOINT_SCHEMA = "schema-docs.conversion-checkpoint";
export const CONVERSION_CHECKPOINT_VERSION = 1;

function safeKey(value, label) {
  const text = String(value ?? "");
  if (!/^[A-Za-z0-9._-]+$/.test(text)) {
    throw new AppError("conversion_checkpoint_invalid", `${label} contains unsafe path characters`, { label, value: text });
  }
  return text;
}

function checkpointRoot(workspacePath) {
  return path.join(workspacePath, ".ai-doc-exchange", "cache", "conversion-checkpoints");
}

function checkpointFile(workspacePath, jobId) {
  return path.join(checkpointRoot(workspacePath), `${safeKey(jobId, "jobId")}.json`);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function optionsFingerprint(options) {
  return `sha256:${createHash("sha256").update(stableJson(options || {}), "utf8").digest("hex")}`;
}

function invalid(message, details = {}) {
  return new AppError("conversion_checkpoint_invalid", message, details);
}

export function createConversionCheckpoint(input = {}) {
  const jobId = String(input.jobId || createId("job"));
  const documentId = String(input.documentId || "");
  const sourceHash = String(input.sourceHash || "");
  if (!documentId || !sourceHash) throw invalid("Conversion checkpoints require documentId and sourceHash.");
  return {
    schema: CONVERSION_CHECKPOINT_SCHEMA,
    version: CONVERSION_CHECKPOINT_VERSION,
    jobId,
    documentId,
    sourceHash,
    pipelineVersion: String(input.pipelineVersion || "1"),
    options: input.options && typeof input.options === "object" ? structuredClone(input.options) : {},
    optionsFingerprint: input.optionsFingerprint || optionsFingerprint(input.options || {}),
    status: "running",
    stages: input.stages && typeof input.stages === "object" ? structuredClone(input.stages) : {},
    pages: Array.isArray(input.pages) ? structuredClone(input.pages) : [],
    createdAt: input.createdAt || nowIso(),
    updatedAt: input.updatedAt || nowIso()
  };
}

export function validateConversionCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== "object") throw invalid("Conversion checkpoint must be an object.");
  if (checkpoint.schema !== CONVERSION_CHECKPOINT_SCHEMA || checkpoint.version !== CONVERSION_CHECKPOINT_VERSION) {
    throw invalid("Unsupported conversion checkpoint schema version.", { schema: checkpoint.schema, version: checkpoint.version });
  }
  for (const key of ["jobId", "documentId", "sourceHash", "pipelineVersion", "optionsFingerprint", "createdAt", "updatedAt"]) {
    if (!String(checkpoint[key] || "")) throw invalid(`Conversion checkpoint requires ${key}.`);
  }
  if (!Array.isArray(checkpoint.pages) || !checkpoint.stages || typeof checkpoint.stages !== "object") {
    throw invalid("Conversion checkpoint pages and stages are invalid.");
  }
  return checkpoint;
}

export function upsertCheckpointPage(checkpoint, input = {}) {
  validateConversionCheckpoint(checkpoint);
  const pageNumber = Number(input.pageNumber);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) throw invalid("Checkpoint pageNumber must be a positive integer.");
  const page = {
    pageNumber,
    status: String(input.status || "completed"),
    contentHash: String(input.contentHash || ""),
    artifactPath: String(input.artifactPath || ""),
    error: String(input.error || ""),
    updatedAt: nowIso()
  };
  const index = checkpoint.pages.findIndex((candidate) => Number(candidate.pageNumber) === pageNumber);
  if (index >= 0) checkpoint.pages[index] = { ...checkpoint.pages[index], ...page };
  else checkpoint.pages.push(page);
  checkpoint.pages.sort((a, b) => Number(a.pageNumber) - Number(b.pageNumber));
  checkpoint.updatedAt = nowIso();
  return page;
}

export function isCheckpointReusable(checkpoint, input = {}) {
  try {
    validateConversionCheckpoint(checkpoint);
  } catch {
    return false;
  }
  const identityMatches = checkpoint.documentId === String(input.documentId || "")
    && checkpoint.sourceHash === String(input.sourceHash || "")
    && checkpoint.pipelineVersion === String(input.pipelineVersion || "1")
    && checkpoint.optionsFingerprint === (input.optionsFingerprint || optionsFingerprint(input.options || {}));
  if (!identityMatches) return false;
  if (Array.isArray(input.requiredPageNumbers)) {
    const pages = new Map(checkpoint.pages.map((page) => [Number(page.pageNumber), page]));
    return input.requiredPageNumbers.every((pageNumber) => {
      const page = pages.get(Number(pageNumber));
      return page?.status === "completed" && Boolean(page.artifactPath) && Boolean(page.contentHash);
    });
  }
  return true;
}

export function getCheckpointResumePageRange(checkpoint, pageCount) {
  try { validateConversionCheckpoint(checkpoint); } catch { return null; }
  const total = Number(pageCount);
  if (!Number.isInteger(total) || total < 1) return null;
  const completed = new Set(checkpoint.pages
    .filter((page) => page.status === "completed" && page.artifactPath && page.contentHash)
    .map((page) => Number(page.pageNumber)));
  const missing = [];
  for (let page = 1; page <= total; page += 1) if (!completed.has(page)) missing.push(page);
  if (!missing.length) return null;
  return { start: missing[0], end: missing[missing.length - 1], pages: missing };
}

export async function writeConversionCheckpoint(workspacePath, checkpoint) {
  validateConversionCheckpoint(checkpoint);
  const root = checkpointRoot(workspacePath);
  await mkdir(root, { recursive: true });
  const target = await prepareSafeWritePath(checkpointFile(workspacePath, checkpoint.jobId), root, [".json"]);
  const temporary = `${target}.${process.pid}.${createId("tmp")}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
  return target;
}

export async function readConversionCheckpoint(workspacePath, jobId) {
  const root = checkpointRoot(workspacePath);
  const target = await assertSafeWritePath(checkpointFile(workspacePath, jobId), root, [".json"]);
  const checkpoint = JSON.parse(await readFile(target, "utf8"));
  return validateConversionCheckpoint(checkpoint);
}

export function getConversionCheckpointPath(workspacePath, jobId) {
  return checkpointFile(workspacePath, jobId);
}
