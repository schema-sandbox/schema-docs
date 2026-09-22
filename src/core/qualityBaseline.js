export const QUALITY_BASELINE_SCHEMA = "schema-docs.quality-baseline";
export const QUALITY_BASELINE_VERSION = 1;

function documentFingerprint(document) {
  const ir = document.documentIr || {};
  const quality = ir.quality || {};
  return {
    id: document.id,
    title: document.title,
    sourceType: document.sourceType,
    status: document.status,
    sourceSize: document.sourceSize,
    pageEstimate: document.pageEstimate,
    irAvailable: Boolean(ir.available),
    revisionId: ir.revisionId || "",
    pageCount: ir.pageCount || 0,
    partCount: ir.partCount || 0,
    logicalPartOnly: Boolean(ir.logicalPartOnly),
    blockCount: ir.blockCount || 0,
    assetCount: ir.assetCount || 0,
    pageStatuses: ir.pageStatuses || {},
    readingOrderStrategies: ir.readingOrderStrategies || {},
    unknownReadingOrderPageCount: ir.unknownReadingOrderPageCount || 0,
    blockTypes: ir.blockTypes || {},
    assetStatuses: ir.assetStatuses || {},
    headingCount: ir.headingCount || 0,
    repeatedNoiseCandidateCount: ir.repeatedNoiseCandidateCount || 0,
    structuredTableCount: ir.structuredTableCount || 0,
    unresolvedFormulaCount: ir.unresolvedFormulaCount || 0,
    qualityState: quality.state || "unknown",
    qualityConfidence: quality.confidence || "unknown",
    unresolvedCount: Number(quality.unresolvedCount || 0)
  };
}

export function createQualityBaseline(report, options = {}) {
  const documents = (report?.documents || [])
    .map(documentFingerprint)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return {
    schema: QUALITY_BASELINE_SCHEMA,
    version: QUALITY_BASELINE_VERSION,
    sourceReportSchema: report?.schema || "",
    createdAt: options.createdAt || new Date().toISOString(),
    label: String(options.label || "local-quality-baseline"),
    summary: {
      ...(report?.summary || {}),
      documentCount: documents.length,
      irDocumentCount: documents.filter((document) => document.irAvailable).length
    },
    documents
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function compareQualityBaselines(expected, actual) {
  const expectedById = new Map((expected?.documents || []).map((document) => [document.id, document]));
  const actualById = new Map((actual?.documents || []).map((document) => [document.id, document]));
  const added = [...actualById.keys()].filter((id) => !expectedById.has(id)).sort();
  const removed = [...expectedById.keys()].filter((id) => !actualById.has(id)).sort();
  const changed = [];
  for (const [id, actualDocument] of actualById.entries()) {
    const expectedDocument = expectedById.get(id);
    if (expectedDocument && stableJson(expectedDocument) !== stableJson(actualDocument)) {
      changed.push({ id, expected: expectedDocument, actual: actualDocument });
    }
  }
  return {
    schema: "schema-docs.quality-baseline-diff",
    version: 1,
    ok: added.length === 0 && removed.length === 0 && changed.length === 0,
    added,
    removed,
    changed
  };
}
