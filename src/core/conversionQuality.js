const QUALITY_ORDER = new Map([
  ["unknown", 0],
  ["low", 1],
  ["medium", 2],
  ["high", 3]
]);

export function createQualitySignal(input = {}) {
  return {
    kind: String(input.kind || "unknown"),
    severity: String(input.severity || "info"),
    pageNumber: Number.isFinite(Number(input.pageNumber)) ? Number(input.pageNumber) : null,
    blockId: String(input.blockId || ""),
    message: String(input.message || ""),
    source: String(input.source || "pipeline"),
    ...(Array.isArray(input.sourceRefs) ? {sourceRefs:input.sourceRefs} : {})
  };
}

export function summarizeDocumentQuality(documentIr, signals = []) {
  const normalized = signals.map(createQualitySignal);
  const pages = Array.isArray(documentIr?.pages) ? documentIr.pages : [];
  const completedPages = pages.filter((page) => page.status === "completed").length;
  const failedPages = pages.filter((page) => page.status === "failed").length;
  const partialPages = pages.filter((page) => page.status === "partial").length;
  const skippedPages = pages.filter((page) => page.status === "skipped").length;
  const pendingPages = pages.filter((page) => ["pending", "processing"].includes(page.status)).length;
  const sourcePageCount = Number.isInteger(Number(documentIr?.source?.pageCount)) && Number(documentIr.source.pageCount) > 0
    ? Number(documentIr.source.pageCount)
    : null;
  const mappedPageNumbers = new Set(pages
    .filter((page) => ["completed", "partial", "failed"].includes(page.status))
    .map((page) => Number(page.pageNumber))
    .filter((pageNumber) => Number.isInteger(pageNumber) && pageNumber >= 1 && (sourcePageCount === null || pageNumber <= sourcePageCount)));
  const mappedPhysicalPages = mappedPageNumbers.size;
  const pageDenominator = sourcePageCount;
  const missingPages = sourcePageCount === null ? null : Math.max(0, sourcePageCount - mappedPhysicalPages);
  const unresolvedCount = normalized.filter((signal) => ["error", "unresolved", "warning"].includes(signal.severity)).length;
  let confidence = "high";
  if (failedPages > 0 || unresolvedCount > Math.max(2, pages.length)) confidence = "low";
  else if (partialPages > 0 || normalized.some((signal) => signal.severity === "warning")) confidence = "medium";
  const hasPhysicalPageNumbers = pages.some((page) => Number.isInteger(Number(page.pageNumber)) && Number(page.pageNumber) >= 1);
  const state = failedPages > 0 || (missingPages !== null && missingPages > 0)
    ? "partial_failed"
    : (partialPages > 0 || pendingPages > 0 || unresolvedCount > 0 || skippedPages > 0
      || (sourcePageCount === null && (pages.length === 0 || hasPhysicalPageNumbers))
      ? "review_required"
      : "clean_readable");
  return {
    state,
    confidence,
    pageCount: sourcePageCount ?? pages.length,
    sourcePageCount,
    completedPages,
    partialPages,
    failedPages,
    pageCoverage: pageDenominator === null ? null : (pageDenominator === 0 ? 0 : mappedPhysicalPages / pageDenominator),
    missingPages,
    skippedPages,
    pendingPages,
    mappedPhysicalPages,
    unresolvedCount,
    signals: normalized
  };
}

export function mergeQualitySignals(...groups) {
  return groups.flat().filter(Boolean).map(createQualitySignal);
}

export function isQualityAtLeast(actual, expected) {
  return (QUALITY_ORDER.get(String(actual)) ?? 0) >= (QUALITY_ORDER.get(String(expected)) ?? 0);
}
