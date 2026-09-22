// Structural checks are distinct from source-content accuracy verification.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export async function validatePdfAssets(result, assetDir, python) {
  const regions = (result.visualMap?.pages || []).flatMap(page => (page.regions || [])
    .filter(region => region.assetFile).map(region => ({ page: page.page, file: region.assetFile })));
  if (!regions.length) return { checked: 0, issues: [] };
  if (!assetDir || !python?.command) return { checked: 0, issues: [{ code: "asset_verification_unavailable" }] };
  const scratch = await mkdtemp(path.join(os.tmpdir(), "schema-docs-asset-check-"));
  try {
    const request = path.join(scratch, "request.json");
    await writeFile(request, JSON.stringify({ root: assetDir, regions }));
    const { stdout } = await promisify(execFile)(python.command, [...(python.args || []),
      path.join(path.dirname(fileURLToPath(import.meta.url)), "pdfAssetValidation.py"), request],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
    return JSON.parse(stdout);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

export function validatePdfConversion(result, { startPage = 1, endPage = result.pageCount } = {}) {
  const issues = [];
  const expected = Number.isInteger(endPage) && endPage >= startPage
    ? Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i) : null;
  const check = (label, numbers) => {
    if (!expected) return;
    const sorted = [...numbers].sort((a, b) => a - b);
    if (sorted.length !== expected.length || sorted.some((n, i) => n !== expected[i])) {
      issues.push({ code: `${label}_coverage`, expected: expected.length, actual: numbers.length });
    }
  };
  check("ledger", (result.pageLedger?.pages || []).map(p => p.pageNumber));
  const markers = [...String(result.markdown || "").matchAll(/<!--\s*pdf-page:\s*(\d+)(?:\s*;[^>]*?)?\s*-->/g)];
  check("markdown", markers.map(m => Number(m[1])));
  if (result.visualMap) {
    check("visual_map", (result.visualMap.pages || []).map(p => p.page));
    const visualPages = result.visualMap.pages || [];
    const declaredCandidateCount = Number.isInteger(Number(result.visualMap.summary?.ocrCandidateCount))
      ? Number(result.visualMap.summary.ocrCandidateCount)
      : visualPages.reduce((sum, page) => sum + Number(page.ocrCandidateCount || 0), 0);
    const candidateLedgers = visualPages.flatMap(page =>
      Array.isArray(page.ocrCandidateLedger)
        ? page.ocrCandidateLedger.map(entry => ({ page: page.page, entry }))
        : []
    );
    if (declaredCandidateCount > 0 && candidateLedgers.length !== declaredCandidateCount) {
      issues.push({ code: "ocr_candidate_ledger_coverage", expected: declaredCandidateCount, actual: candidateLedgers.length });
    }
    for (const page of visualPages) {
      const ledger = page.ocrCandidateLedger;
      if (!Array.isArray(ledger)) continue;
      const ids = new Set();
      const byId = new Map();
      for (const entry of ledger) {
        const id = String(entry?.id || "");
        if (!id) {
          issues.push({ code: "ocr_candidate_missing_id", page: page.page });
          continue;
        }
        if (ids.has(id)) issues.push({ code: "ocr_candidate_duplicate_id", page: page.page, id });
        ids.add(id);
        byId.set(id, entry);
      }
      const mappedDispositions = new Set(["requested", "queued", "queued_visual_review", "queued_review", "excluded_non_text"]);
      const knownDispositions = new Set([...mappedDispositions, "duplicate", "filtered", "native_covered"]);
      for (const { entry } of ledger.map(entry => ({ entry }))) {
        const disposition = String(entry?.disposition || "");
        if (disposition && !knownDispositions.has(disposition)) {
          issues.push({ code: "ocr_candidate_unknown_disposition", page: page.page, id: entry.id, disposition });
        }
        if (disposition === "duplicate") {
          const target = String(entry.duplicateOf || "");
          if (!target) {
            issues.push({ code: "ocr_candidate_missing_duplicate_target", page: page.page, id: entry.id });
            continue;
          }
          const visited = new Set([String(entry.id)]);
          let current = target;
          while (current) {
            if (visited.has(current)) {
              issues.push({ code: "ocr_candidate_duplicate_cycle", page: page.page, id: entry.id });
              break;
            }
            visited.add(current);
            const targetEntry = byId.get(current);
            if (!targetEntry) {
              issues.push({ code: "ocr_candidate_dangling_duplicate", page: page.page, id: entry.id, duplicateOf: target });
              break;
            }
            if (String(targetEntry.disposition || "") !== "duplicate") break;
            current = String(targetEntry.duplicateOf || "");
          }
        }
        if (mappedDispositions.has(disposition) && !entry.regionId) {
          issues.push({ code: "ocr_candidate_missing_region", page: page.page, id: entry.id, disposition });
        }
        if (!disposition) issues.push({ code: "ocr_candidate_missing_disposition", page: page.page, id: entry.id });
      }
      const knownRegions = new Set([
        ...(page.ocrRegions || []).map(region => String(region.id || "")),
        ...(page.ocr?.regions || []).map(region => String(region.id || "")),
        ...(page.ocrExcludedRegions || []).map(region => String(region.id || ""))
      ].filter(Boolean));
      const hasOcrResult = page.ocr && typeof page.ocr === "object";
      for (const { entry } of ledger.map(entry => ({ entry }))) {
        if (entry.regionId && !knownRegions.has(String(entry.regionId))) {
          issues.push({ code: "ocr_candidate_region_missing", page: page.page, id: entry.id, regionId: entry.regionId });
        }
        // A requested candidate is not complete merely because its crop was
        // scheduled. Require a terminal OCR record (including a visual-only
        // or unresolved record) so a missing worker result cannot pass as a
        // verified conversion. This check intentionally does not require OCR
        // text to be non-empty.
        if (mappedDispositions.has(String(entry?.disposition || "")) && !hasOcrResult) {
          issues.push({ code: "ocr_candidate_result_missing", page: page.page, id: entry.id, disposition: entry.disposition });
        }
      }
      for (const region of page.ocrRegions || []) {
        if (region.candidateId && !byId.has(String(region.candidateId))) {
          issues.push({ code: "ocr_candidate_source_missing", page: page.page, candidateId: region.candidateId, regionId: region.id });
        }
      }
    }
    const imageFiles = new Set([...String(result.markdown || "").matchAll(/<!--\s*pdf-image:[^>]*\bfile=([^\s>]+)/g)].map(m => m[1]));
    for (const page of result.visualMap.pages || []) {
      if (page.backendFailure) issues.push({ ...page.backendFailure, backendCode: page.backendFailure.code, code: "backend_recovery", page: page.page });
      for (const region of page.regions || []) {
        if (region.assetStatus === "failed") issues.push({ code: "visual_render_failed", page: page.page, bbox: region.bbox });
        if (region.type === "image" && region.assetFile && !imageFiles.has(region.assetFile)) {
          issues.push({ code: "image_reference_missing", page: page.page, file: region.assetFile });
        }
      }
      if (page.ocrRegions && page.ocr?.regions) {
        const requested = page.ocrRegions.map(r => r.id).sort();
        const processed = page.ocr.regions.map(r => r.id).sort();
        if (JSON.stringify(requested) !== JSON.stringify(processed)) issues.push({ code: "ocr_region_coverage", page: page.page });
      }
    }
  }
  for (const failure of result.backendFailures || []) issues.push({ code: "backend_failed", ...failure });
  issues.push(...(result.assetValidation?.issues || []));
  return { passed: issues.length === 0, contentAccuracyVerified: false, issues };
}
