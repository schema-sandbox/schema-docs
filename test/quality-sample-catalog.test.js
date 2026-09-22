import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createQualitySampleCatalog, readQualitySampleCatalog, validateQualitySampleCatalog } from "../src/core/qualitySampleCatalog.js";

test("quality sample catalog validates unique relative sample paths", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-sample-catalog-"));
  try {
    await writeFile(path.join(workspace, "sample.pdf"), "fixture", "utf8");
    const catalog = createQualitySampleCatalog([{ id: "pdf-1", sourceType: "pdf", path: "sample.pdf", protected: true }]);
    const result = await validateQualitySampleCatalog(catalog, { workspacePath: workspace, requireFiles: true });
    assert.equal(result.valid, true);
    assert.equal(result.protectedCount, 1);
    assert.equal(catalog.samples[0].fixtureOnly, false);
    const invalid = createQualitySampleCatalog([{ id: "bad", path: "../outside.pdf" }, { id: "bad", path: "missing.pdf" }]);
    const invalidResult = await validateQualitySampleCatalog(invalid, { workspacePath: workspace, requireFiles: true });
    assert.equal(invalidResult.valid, false);
    assert.ok(invalidResult.errors.length >= 2);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("strict catalog reads reject malformed metadata", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-sample-catalog-invalid-"));
  try {
    const catalogPath = path.join(workspace, "catalog.json");
    await writeFile(catalogPath, JSON.stringify({ schema: "wrong", version: 9, samples: [] }), "utf8");
    await assert.rejects(() => readQualitySampleCatalog(workspace, "catalog.json", { strict: true }), { code: "quality_sample_catalog_invalid" });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
