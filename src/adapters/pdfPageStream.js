import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export function assertMemoryBudget(maxResidentBytes) {
  if (Number(maxResidentBytes) > 0 && process.memoryUsage().rss > Number(maxResidentBytes)) {
    throw Object.assign(new Error("Conversion memory budget reached; committed page checkpoints are retained."),
      { code: "resource_limit", recoverable: true });
  }
}

export async function readPageStream(file, options = {}) {
  const pages = [], resources = { peakNodeRssBytes: process.memoryUsage().rss, pagesRead: 0, maxPageBytes: 0 };
  const input = createReadStream(file, { highWaterMark: 64 * 1024 });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      await options.assertNotCancelled?.();
      assertMemoryBudget(options.maxResidentBytes);
      const page = JSON.parse(line);
      resources.pagesRead++;
      resources.maxPageBytes = Math.max(resources.maxPageBytes, Buffer.byteLength(line));
      resources.peakNodeRssBytes = Math.max(resources.peakNodeRssBytes, process.memoryUsage().rss);
      if (options.onPage) await options.onPage(page);
      else pages.push(page);
    }
  } finally { lines.close(); input.destroy(); }
  return { pages, resources };
}

export function* pdfPagePieces(markdown) {
  const marker = /<!--\s*pdf-page:\s*\d+(?:\s*;[^>]*?)?\s*-->/g;
  let start = 0, match;
  while ((match = marker.exec(markdown))) {
    if (match.index > start) yield markdown.slice(start, match.index);
    start = match.index;
  }
  if (start < markdown.length) yield markdown.slice(start);
}
