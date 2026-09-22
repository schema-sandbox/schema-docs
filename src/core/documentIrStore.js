import path from "node:path";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createId, nowIso } from "./ids.js";
import { assertSafeWritePath, prepareSafeWritePath } from "./pathGuard.js";
import { cloneDocumentIr, validateDocumentIr } from "./documentIr.js";
import { AppError } from "./errors.js";

function storageKey(value, label) {
  const text = String(value ?? "");
  if (!/^[A-Za-z0-9._-]+$/.test(text)) {
    throw new AppError("document_ir_invalid", `${label} contains unsafe path characters`, { label, value: text });
  }
  return text;
}

function irRoot(workspacePath, documentId, revisionId) {
  return path.join(
    workspacePath,
    ".ai-doc-exchange",
    "cache",
    "document-ir",
    storageKey(documentId, "documentId"),
    storageKey(revisionId, "revisionId")
  );
}

function pageFile(root, index) {
  return path.join(root, "pages", `${String(index).padStart(6, "0")}.json`);
}

async function writeJsonAtomic(filePath, value, rootPath) {
  const safePath = await prepareSafeWritePath(filePath, rootPath, [".json"]);
  const temporaryPath = `${safePath}.${process.pid}.${createId("tmp")}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, safePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
  return safePath;
}

export function getDocumentIrRoot(workspacePath, documentId, revisionId) {
  return irRoot(workspacePath, documentId, revisionId);
}

export async function writeDocumentIr(workspacePath, input, options = {}) {
  const documentIr = cloneDocumentIr(input);
  const root = irRoot(workspacePath, documentIr.documentId, documentIr.revisionId);
  const parent = path.dirname(root);
  const stagingRoot = `${root}.staging-${process.pid}-${createId("generation")}`;
  await mkdir(parent, { recursive: true });
  await mkdir(stagingRoot, { recursive: true });
  const pagesRoot = path.join(stagingRoot, "pages");
  await mkdir(pagesRoot, { recursive: true });
  const blocksByPage = new Map();
  for (const block of documentIr.blocks) {
    if (!block.pageId) continue;
    const pageBlocks = blocksByPage.get(block.pageId) || [];
    pageBlocks.push(block);
    blocksByPage.set(block.pageId, pageBlocks);
  }
  const pageEntries = [];
  for (const [index, page] of documentIr.pages.entries()) {
    const pageBlocks = blocksByPage.get(page.id) || [];
    const payload = {
      schema: documentIr.schema,
      version: documentIr.version,
      documentId: documentIr.documentId,
      revisionId: documentIr.revisionId,
      page,
      blocks: pageBlocks
    };
    const filePath = pageFile(stagingRoot, index + 1);
    await writeJsonAtomic(filePath, payload, stagingRoot);
    const serialized = `${JSON.stringify(payload, null, 2)}\n`;
    pageEntries.push({
      id: page.id,
      pageNumber: page.pageNumber,
      status: page.status,
      blockCount: pageBlocks.length,
      relativePath: path.relative(stagingRoot, filePath).split(path.sep).join("/"),
      sha256: createHash("sha256").update(serialized, "utf8").digest("hex"),
      contentHash: `sha256:${createHash("sha256").update(serialized, "utf8").digest("hex")}`
    });
  }
  const indexPayload = {
    ...documentIr,
    pages: pageEntries,
    blocks: undefined,
    unpagedBlocks: documentIr.blocks.filter((block) => !block.pageId),
    storage: {
      kind: "paged-json",
      pageCount: pageEntries.length,
      pageDirectory: "pages",
      status: "complete",
      generationId: path.basename(stagingRoot)
    },
    updatedAt: nowIso()
  };
  delete indexPayload.blocks;
  const stagedIndexPath = await writeJsonAtomic(path.join(stagingRoot, "index.json"), indexPayload, stagingRoot);
  try {
    await rename(stagingRoot, root);
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    if (!error || !["EEXIST", "EPERM", "ENOTEMPTY"].includes(error.code)) throw error;
    const existingIndexPath = path.join(root, "index.json");
    const existing = JSON.parse(await readFile(existingIndexPath, "utf8"));
    await readDocumentIr(workspacePath, documentIr.documentId, documentIr.revisionId);
    if (JSON.stringify(existing.pages) !== JSON.stringify(pageEntries)
      || JSON.stringify(existing.assets) !== JSON.stringify(documentIr.assets)
      || JSON.stringify(existing.unpagedBlocks) !== JSON.stringify(indexPayload.unpagedBlocks)) {
      throw new AppError("document_ir_revision_conflict", "An immutable IR revision already exists with different content.");
    }
  }
  const indexPath = path.join(root, "index.json");
  return {
    documentId: documentIr.documentId,
    revisionId: documentIr.revisionId,
    root,
    indexPath,
    indexRelativePath: path.relative(workspacePath, indexPath).split(path.sep).join("/"),
    pageCount: pageEntries.length,
    blockCount: documentIr.blocks.length,
    assetCount: documentIr.assets.length,
    pages: pageEntries,
    ...options
  };
}

export async function readDocumentIr(workspacePath, documentId, revisionId) {
  const root = irRoot(workspacePath, documentId, revisionId);
  const indexPath = await assertSafeWritePath(path.join(root, "index.json"), root, [".json"]);
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  if (index.storage?.status && index.storage.status !== "complete") {
    throw new AppError("document_ir_incomplete", "DocumentIR revision is not committed.", { documentId, revisionId });
  }
  const documentIr = { ...index, pages: [], blocks: [...(index.unpagedBlocks || [])] };
  delete documentIr.unpagedBlocks;
  for (const entry of index.pages || []) {
    const pagePath = await assertSafeWritePath(path.join(root, entry.relativePath), root, [".json"]);
    const pageText = await readFile(pagePath, "utf8");
    if (entry.sha256 && createHash("sha256").update(pageText, "utf8").digest("hex") !== entry.sha256) {
      throw new AppError("document_ir_corrupt", "DocumentIR page content hash does not match its committed index.", { documentId, revisionId, relativePath: entry.relativePath });
    }
    const pagePayload = JSON.parse(pageText);
    if (pagePayload.documentId !== documentId || pagePayload.revisionId !== revisionId) {
      throw new AppError("document_ir_corrupt", "DocumentIR page identity does not match its committed index.", { documentId, revisionId, relativePath: entry.relativePath });
    }
    documentIr.pages.push(pagePayload.page);
    documentIr.blocks.push(...(pagePayload.blocks || []));
  }
  validateDocumentIr(documentIr);
  return documentIr;
}
