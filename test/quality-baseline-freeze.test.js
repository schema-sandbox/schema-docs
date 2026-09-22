import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openOrCreateWorkspace } from "../src/core/manifest.js";
import { freezeQualityBaseline } from "../src/cli/quality-baseline-freeze.js";

test("freezes a metadata-only quality baseline with sample catalog provenance", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-baseline-freeze-"));
  try {
    await openOrCreateWorkspace(workspace);
    await mkdir(path.join(workspace, "docs"), { recursive: true });
    await writeFile(path.join(workspace, "docs", "quality-samples.json"), JSON.stringify({ schema: "schema-docs.quality-sample-catalog", version: 1, samples: [] }), "utf8");
    const output = [];
    const result = await freezeQualityBaseline([workspace, "--output", "baselines/current.json", "--label", "fixture"], { log: value => output.push(value) });
    const saved = JSON.parse(await readFile(result.outputPath, "utf8"));
    assert.equal(saved.label, "fixture");
    assert.equal(saved.catalog.sampleCount, 0);
    assert.equal(saved.catalog.fixtureOnlyCount, 0);
    assert.equal(saved.catalog.realSourceCount, 0);
    assert.doesNotMatch(JSON.stringify(saved), /body|markdown|text sentinel/i);
    assert.match(output[0], /"ok": true/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
