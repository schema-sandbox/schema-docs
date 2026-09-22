import assert from "node:assert/strict";
import test from "node:test";
import { compareQualityBaselines, createQualityBaseline } from "../src/core/qualityBaseline.js";

function report(documents) {
  return {
    schema: "schema-docs.conversion-quality-report",
    summary: { documentCount: documents.length },
    documents
  };
}

test("quality baseline contains metadata only and compares stable document fingerprints", () => {
  const input = report([{
    id: "doc_1",
    title: "Report",
    sourceType: "pdf",
    status: "ready",
    sourceSize: 123,
    documentIr: {
      available: true,
      revisionId: "rev_1",
      pageCount: 2,
      readingOrderStrategies: { column_major: 1, preserved: 1 },
      unknownReadingOrderPageCount: 1,
      blockCount: 4,
      assetCount: 1,
      pageStatuses: { completed: 2 },
      blockTypes: { paragraph: 4 },
      assetStatuses: { derived: 1 },
      quality: { state: "clean_readable", confidence: "high", unresolvedCount: 0 }
    }
  }]);
  const baseline = createQualityBaseline(input, { createdAt: "2026-01-01T00:00:00.000Z", label: "fixture" });
  assert.equal(baseline.schema, "schema-docs.quality-baseline");
  assert.equal(baseline.documents[0].qualityState, "clean_readable");
  assert.doesNotMatch(JSON.stringify(baseline), /body|markdown|paragraph text/i);
  assert.equal(compareQualityBaselines(baseline, createQualityBaseline(input, { createdAt: "2027-01-01T00:00:00.000Z" })).ok, true);
  const changed = createQualityBaseline(report([{ ...input.documents[0], documentIr: { ...input.documents[0].documentIr, quality: { state: "review_required", confidence: "medium", unresolvedCount: 1 } } }]));
  const diff = compareQualityBaselines(baseline, changed);
  assert.equal(diff.ok, false);
  assert.equal(diff.changed[0].id, "doc_1");
});
