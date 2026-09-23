import assert from "node:assert/strict";
import test from "node:test";
import { deriveRealMaterialQualityGap } from "../src/cli/quality-real-material-evaluate.js";

test("a document with no blocking quality signal is complete", () => {
  assert.equal(deriveRealMaterialQualityGap({ quality: {} }), false);
  assert.equal(deriveRealMaterialQualityGap({ quality: { pendingOcrPages: 0, unresolvedPages: 0,
    failedVisualRegions: 0, reviewPages: 0, ocrReviewRegions: 0 }, validation: { passed: true } }), false);
});

test("every blocking quality signal marks a gap", () => {
  for (const quality of [
    { pendingOcrPages: 4 },
    { unresolvedPages: 1 },
    { failedVisualRegions: 2 },
    { reviewPages: 4 },
    { ocrReviewRegions: 7 }
  ]) {
    assert.equal(deriveRealMaterialQualityGap({ quality }), true, JSON.stringify(quality));
  }
  assert.equal(deriveRealMaterialQualityGap({ quality: {}, partial: true }), true);
  assert.equal(deriveRealMaterialQualityGap({ quality: {}, validation: { passed: false } }), true);
});

test("pages kept as review regions rather than pending OCR still count as a gap", () => {
  const quality = { pendingOcrPages: 0, unresolvedPages: 0, failedVisualRegions: 0,
    reviewPages: 4, ocrReviewRegions: 7 };
  assert.equal(deriveRealMaterialQualityGap({ quality, validation: { passed: true } }), true);
});

test("the predicate tolerates a missing quality object", () => {
  assert.equal(deriveRealMaterialQualityGap(), false);
});
