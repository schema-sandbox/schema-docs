
/**
 * Small, dependency-free page ledger used by the core pipeline. It consumes
 * explicit page markers produced by the richer adapters and keeps an honest
 * unknown-page result when the source PDF does not expose a reliable split.
 * The text extractor remains responsible for glyph decoding; this module
 * only establishes bounded page records and their source relationship.
 */
export function createPdfPageLedgerFromMarkdown(markdown, sourcePageCount = null, options = {}) {
  const qualityStatusByPage = options.qualityStatusByPage instanceof Map
    ? options.qualityStatusByPage
    : new Map(Object.entries(options.qualityStatusByPage || {}).map(([page, status]) => [Number(page), status]));
  const lines = String(markdown || "").split(/\r?\n/);
  const pages = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    current.markdown = current.lines.join("\n").trim();
    delete current.lines;
    pages.push(current);
  };
  for (const line of lines) {
    const marker = /<!--\s*pdf-page:\s*(\d+)((?:\s*;[^>]*?)?)\s*-->/i.exec(line);
    if (marker) {
      flush();
      current = {
        pageNumber: Number(marker[1]),
        status: /;\s*extraction:\s*ocr_failed(?:\s*;|\s*$)/i.test(marker[2]) ? "failed" : "completed",
        qualityStatus: qualityStatusByPage.get(Number(marker[1])) || undefined,
        lines: []
      };
      continue;
    }
    if (!current) current = { pageNumber: null, status: "completed", lines: [], qualityStatus: undefined };
    current.lines.push(line);
  }
  flush();
  const physicalPages = pages.filter((page) => Number.isInteger(page.pageNumber) && page.pageNumber > 0);
  return {
    sourcePageCount,
    pageCountKnown: sourcePageCount !== null,
    pages: physicalPages.length ? physicalPages : pages.map((page) => ({ ...page, pageNumber: null })),
    markdown: String(markdown || ""),
    warnings: sourcePageCount === null
      ? ["PDF page count or page boundaries are not authoritative; page coverage remains unknown."]
      : []
  };
}

export async function extractPdfPageLedger(buffer, sourceName = "source.pdf", options = {}) {
  const { detectPdfPageCount, pdfBufferToMarkdown } = await import("./pdfMarkdownConverter.js");
  const sourcePageCount = detectPdfPageCount(buffer);
  const markdown = await pdfBufferToMarkdown(buffer, sourceName, options);
  return createPdfPageLedgerFromMarkdown(markdown, sourcePageCount);
}
