import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { evaluateQualitySamples } from "../src/cli/quality-sample-evaluate.js";

test("evaluates catalog samples into metadata-only structural summaries", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-sample-evaluate-"));
  try {
    await mkdir(path.join(workspace, "docs"), { recursive: true });
    await writeFile(path.join(workspace, "fixture.md"), "# Sample\n\nText.\n", "utf8");
    await writeFile(path.join(workspace, "docs", "catalog.json"), JSON.stringify({
      schema: "schema-docs.quality-sample-catalog",
      version: 1,
      samples: [{ id: "sample-1", category: "text", sourceType: "md", path: "fixture.md", expectedFeatures: ["headings"], protected: true }]
    }), "utf8");
    const logs = [];
    const result = await evaluateQualitySamples([workspace, "--catalog", "docs/catalog.json"], { log: value => logs.push(value) });
    const saved = JSON.parse(await readFile(result.outputPath, "utf8"));
    assert.equal(saved.summary.evaluatedCount, 1);
    assert.equal(saved.samples[0].summary.blockTypes.title, 1);
    assert.doesNotMatch(JSON.stringify(saved), /Text\./);
    assert.match(logs[0], /"ok": true/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("marks unsupported expected features as a quality gap instead of a pass", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-sample-gap-"));
  try {
    await mkdir(path.join(workspace, "docs"), { recursive: true });
    await writeFile(path.join(workspace, "fixture.md"), "# Sample\n\nText.\n", "utf8");
    await writeFile(path.join(workspace, "docs", "catalog.json"), JSON.stringify({
      schema: "schema-docs.quality-sample-catalog",
      version: 1,
      samples: [{ id: "sample-gap", category: "text", sourceType: "md", path: "fixture.md", expectedFeatures: ["headings", "formula"], protected: true }]
    }), "utf8");
    const logs = [];
    const result = await evaluateQualitySamples([workspace, "--catalog", "docs/catalog.json"], { log: value => logs.push(value) });
    assert.equal(result.evaluation.summary.result, "feature_gaps");
    assert.equal(result.evaluation.samples[0].status, "feature_gap");
    assert.deepEqual(result.evaluation.samples[0].missingExpectedFeatures, ["formula"]);
    assert.match(logs[0], /"ok": false/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
