import { createHash } from "node:crypto";
import { AppError } from "./errors.js";
import { createId, nowIso } from "./ids.js";

export const DOCUMENT_IR_SCHEMA = "schema-docs.document-ir";
export const DOCUMENT_IR_VERSION = 1;

const BLOCK_TYPES = new Set([
  "title",
  "heading",
  "paragraph",
  "list",
  "table",
  "formula",
  "image",
  "code",
  "caption",
  "header",
  "footer",
  "comment",
  "unknown"
]);

const PAGE_STATUSES = new Set(["pending", "processing", "completed", "partial", "failed", "skipped"]);
const irIndexes = new WeakMap();

function indexesFor(documentIr) {
  let indexes = irIndexes.get(documentIr);
  if (!indexes) {
    indexes = {
      pages: new Set((documentIr.pages || []).map((page) => page.id)),
      blocks: new Set((documentIr.blocks || []).map((block) => block.id)),
      assets: new Set((documentIr.assets || []).map((asset) => asset.id)),
      pageBlocks: new Map((documentIr.pages || []).map((page) => [page.id, new Set(page.blocks || [])]))
    };
    irIndexes.set(documentIr, indexes);
  }
  return indexes;
}

function invalid(message, details = {}) {
  return new AppError("document_ir_invalid", message, details);
}

function stringOrEmpty(value) {
  return value === undefined || value === null ? "" : String(value);
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function normalizeBox(box) {
  if (!Array.isArray(box) || box.length !== 4 || box.some((value) => !Number.isFinite(Number(value)))) return null;
  return box.map(Number);
}

function stableId(prefix, value) {
  const digest = createHash("sha1").update(String(value)).digest("hex").slice(0, 12);
  return `${prefix}_${digest}`;
}

export function createDocumentIr(input = {}) {
  const createdAt = input.createdAt || nowIso();
  const documentId = stringOrEmpty(input.documentId) || createId("docir");
  const revisionId = stringOrEmpty(input.revisionId) || createId("rev");
  return {
    schema: DOCUMENT_IR_SCHEMA,
    version: DOCUMENT_IR_VERSION,
    documentId,
    revisionId,
    createdAt,
    updatedAt: input.updatedAt || createdAt,
    source: {
      path: stringOrEmpty(input.source?.path),
      name: stringOrEmpty(input.source?.name),
      type: stringOrEmpty(input.source?.type),
      hash: stringOrEmpty(input.source?.hash),
      size: finiteNumberOrNull(input.source?.size),
      pageCount: finiteNumberOrNull(input.source?.pageCount)
    },
    extraction: {
      engine: stringOrEmpty(input.extraction?.engine),
      engineVersion: stringOrEmpty(input.extraction?.engineVersion),
      pipelineVersion: stringOrEmpty(input.extraction?.pipelineVersion),
      options: input.extraction?.options && typeof input.extraction.options === "object"
        ? structuredClone(input.extraction.options)
        : {},
      warnings: Array.isArray(input.extraction?.warnings) ? [...input.extraction.warnings].map(String) : [],
      status: stringOrEmpty(input.extraction?.status) || "unknown"
    },
    metadata: input.metadata && typeof input.metadata === "object" ? structuredClone(input.metadata) : {},
    pages: [],
    blocks: [],
    assets: [],
    quality: input.quality && typeof input.quality === "object" ? structuredClone(input.quality) : {
      state: "unknown",
      confidence: "unknown",
      signals: [],
      unresolvedCount: 0
    }
  };
}

export function pageId(documentIr, pageNumber, suffix = "") {
  return stableId("page", `${documentIr.documentId}:${documentIr.revisionId}:${pageNumber}:${suffix}`);
}

export function blockId(documentIr, pageNumber, ordinal, type = "unknown") {
  return stableId("block", `${documentIr.documentId}:${documentIr.revisionId}:${pageNumber}:${ordinal}:${type}`);
}

export function addIrPage(documentIr, input = {}) {
  if (!documentIr || typeof documentIr !== "object") throw invalid("A DocumentIR object is required.");
  const pageNumber = finiteNumberOrNull(input.pageNumber);
  const page = {
    id: stringOrEmpty(input.id) || pageId(documentIr, pageNumber ?? documentIr.pages.length + 1, input.partId || ""),
    pageNumber,
    partId: stringOrEmpty(input.partId),
    width: finiteNumberOrNull(input.width),
    height: finiteNumberOrNull(input.height),
    rotation: finiteNumberOrNull(input.rotation) ?? 0,
    status: PAGE_STATUSES.has(input.status) ? input.status : "pending",
    blocks: Array.isArray(input.blocks) ? [...input.blocks] : [],
    sourceRefs: Array.isArray(input.sourceRefs) ? structuredClone(input.sourceRefs) : [],
    warnings: Array.isArray(input.warnings) ? [...input.warnings].map(String) : [],
    quality: input.quality && typeof input.quality === "object" ? structuredClone(input.quality) : {}
  };
  const indexes = indexesFor(documentIr);
  if (indexes.pages.has(page.id)) throw invalid("DocumentIR page id must be unique.", { id: page.id });
  documentIr.pages.push(page);
  indexes.pages.add(page.id);
  indexes.pageBlocks.set(page.id, new Set(page.blocks));
  documentIr.updatedAt = nowIso();
  return page;
}

export function addIrBlock(documentIr, input = {}) {
  if (!documentIr || typeof documentIr !== "object") throw invalid("A DocumentIR object is required.");
  const type = BLOCK_TYPES.has(input.type) ? input.type : "unknown";
  const pageNumber = finiteNumberOrNull(input.pageNumber);
  const ordinal = Number.isInteger(input.ordinal) ? input.ordinal : documentIr.blocks.length;
  const block = {
    id: stringOrEmpty(input.id) || blockId(documentIr, pageNumber ?? 0, ordinal, type),
    type,
    pageId: stringOrEmpty(input.pageId),
    pageNumber,
    ordinal,
    readingOrder: Number.isInteger(input.readingOrder) ? input.readingOrder : null,
    parentId: stringOrEmpty(input.parentId),
    text: stringOrEmpty(input.text),
    sourceRefs: Array.isArray(input.sourceRefs) ? structuredClone(input.sourceRefs) : [],
    bbox: normalizeBox(input.bbox),
    assetId: stringOrEmpty(input.assetId),
    assetIds: Array.isArray(input.assetIds) ? input.assetIds.map(stringOrEmpty).filter(Boolean) : [],
    status: stringOrEmpty(input.status) || "extracted",
    formulaStructure: input.formulaStructure && typeof input.formulaStructure === "object"
      ? structuredClone(input.formulaStructure)
      : null,
    qualitySignals: input.qualitySignals && typeof input.qualitySignals === "object"
      ? structuredClone(input.qualitySignals)
      : {}
  };
  const indexes = indexesFor(documentIr);
  if (indexes.blocks.has(block.id)) throw invalid("DocumentIR block id must be unique.", { id: block.id });
  documentIr.blocks.push(block);
  indexes.blocks.add(block.id);
  const page = block.pageId ? documentIr.pages.find((candidate) => candidate.id === block.pageId) : null;
  // Block IDs are unique within the DocumentIR, so a newly accepted block
  // cannot already be listed on its target page. Avoid an O(n) includes scan
  // for every block when importing very large text documents.
  if (page) {
    const pageBlockIds = indexes.pageBlocks.get(page.id) || new Set(page.blocks);
    if (!pageBlockIds.has(block.id)) {
      page.blocks.push(block.id);
      pageBlockIds.add(block.id);
      indexes.pageBlocks.set(page.id, pageBlockIds);
    }
  }
  documentIr.updatedAt = nowIso();
  return block;
}

export function addIrAsset(documentIr, input = {}) {
  if (!documentIr || typeof documentIr !== "object") throw invalid("A DocumentIR object is required.");
  const asset = {
    id: stringOrEmpty(input.id) || stableId("asset", `${documentIr.documentId}:${documentIr.revisionId}:${input.path || documentIr.assets.length}`),
    path: stringOrEmpty(input.path),
    type: stringOrEmpty(input.type) || "unknown",
    hash: stringOrEmpty(input.hash),
    pageNumber: finiteNumberOrNull(input.pageNumber),
    bbox: normalizeBox(input.bbox),
    sourceRefs: Array.isArray(input.sourceRefs) ? structuredClone(input.sourceRefs) : [],
    status: stringOrEmpty(input.status) || "derived"
  };
  const indexes = indexesFor(documentIr);
  if (indexes.assets.has(asset.id)) throw invalid("DocumentIR asset id must be unique.", { id: asset.id });
  documentIr.assets.push(asset);
  indexes.assets.add(asset.id);
  documentIr.updatedAt = nowIso();
  return asset;
}

function validateSourceRef(ref, location) {
  if (!ref || typeof ref !== "object") throw invalid("DocumentIR sourceRefs must contain objects.", { location });
  if (!stringOrEmpty(ref.kind)) throw invalid("DocumentIR sourceRefs require kind.", { location });
  if (ref.bbox !== undefined && ref.bbox !== null && !normalizeBox(ref.bbox)) throw invalid("DocumentIR sourceRef bbox is invalid.", { location });
}

export function validateDocumentIr(documentIr, options = {}) {
  if (!documentIr || typeof documentIr !== "object") throw invalid("DocumentIR must be an object.");
  if (documentIr.schema !== DOCUMENT_IR_SCHEMA || documentIr.version !== DOCUMENT_IR_VERSION) {
    throw invalid("Unsupported DocumentIR schema version.", { schema: documentIr.schema, version: documentIr.version });
  }
  for (const key of ["documentId", "revisionId", "createdAt", "updatedAt"]) {
    if (!stringOrEmpty(documentIr[key])) throw invalid(`DocumentIR requires ${key}.`);
  }
  if (!Array.isArray(documentIr.pages) || !Array.isArray(documentIr.blocks) || !Array.isArray(documentIr.assets)) {
    throw invalid("DocumentIR pages, blocks, and assets must be arrays.");
  }
  const pageIds = new Set();
  for (const [index, page] of documentIr.pages.entries()) {
    if (!page || typeof page !== "object" || !stringOrEmpty(page.id)) throw invalid("DocumentIR page is invalid.", { index });
    if (pageIds.has(page.id)) throw invalid("DocumentIR page id must be unique.", { id: page.id });
    pageIds.add(page.id);
    if (!PAGE_STATUSES.has(page.status)) throw invalid("DocumentIR page status is invalid.", { id: page.id, status: page.status });
    if (!Array.isArray(page.blocks) || !Array.isArray(page.sourceRefs)) throw invalid("DocumentIR page blocks/sourceRefs must be arrays.", { id: page.id });
    page.sourceRefs.forEach((ref, refIndex) => validateSourceRef(ref, `pages[${index}].sourceRefs[${refIndex}]`));
  }
  const blockIds = new Set();
  for (const [index, block] of documentIr.blocks.entries()) {
    if (!block || typeof block !== "object" || !stringOrEmpty(block.id)) throw invalid("DocumentIR block is invalid.", { index });
    if (blockIds.has(block.id)) throw invalid("DocumentIR block id must be unique.", { id: block.id });
    blockIds.add(block.id);
    if (!BLOCK_TYPES.has(block.type)) throw invalid("DocumentIR block type is invalid.", { id: block.id, type: block.type });
    if (block.pageId && !pageIds.has(block.pageId)) throw invalid("DocumentIR block references an unknown page.", { id: block.id, pageId: block.pageId });
    if (block.bbox !== null && block.bbox !== undefined && !normalizeBox(block.bbox)) throw invalid("DocumentIR block bbox is invalid.", { id: block.id });
    if (!Array.isArray(block.sourceRefs)) throw invalid("DocumentIR block sourceRefs must be an array.", { id: block.id });
    block.sourceRefs.forEach((ref, refIndex) => validateSourceRef(ref, `blocks[${index}].sourceRefs[${refIndex}]`));
  }
  const assetIds = new Set();
  for (const [index, asset] of documentIr.assets.entries()) {
    if (!asset || typeof asset !== "object" || !stringOrEmpty(asset.id)) throw invalid("DocumentIR asset is invalid.", { index });
    if (assetIds.has(asset.id)) throw invalid("DocumentIR asset id must be unique.", { id: asset.id });
    assetIds.add(asset.id);
    if (!Array.isArray(asset.sourceRefs)) throw invalid("DocumentIR asset sourceRefs must be an array.", { id: asset.id });
    asset.sourceRefs.forEach((ref, refIndex) => validateSourceRef(ref, `assets[${index}].sourceRefs[${refIndex}]`));
  }
  const blockIdSet = blockIds;
  for (const page of documentIr.pages) {
    for (const blockId of page.blocks) if (!blockIdSet.has(blockId)) throw invalid("DocumentIR page references an unknown block.", { pageId: page.id, blockId });
  }
  if (options.requireSourceHash && !stringOrEmpty(documentIr.source?.hash)) throw invalid("DocumentIR source hash is required.");
  return documentIr;
}

export function cloneDocumentIr(documentIr) {
  return structuredClone(validateDocumentIr(documentIr));
}
