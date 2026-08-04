import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { prepareReleaseRuntime } from "../scripts/prepare-release.js";

async function writeFixture(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

test("prepareReleaseRuntime removes source Python caches and stale packaged runtime", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "schema-docs-runtime-prepare-test-"));
  const nodeExecutable = path.join(root, "fixture-node.exe");
  await writeFixture(nodeExecutable, "node-runtime");
  await writeFixture(path.join(root, "src", "adapters", "__pycache__", "module.cpython-312.pyc"), "cache");
  await writeFixture(path.join(root, "src", "adapters", "stray.pyo"), "cache");
  await writeFixture(path.join(root, "src", "adapters", "module.py"), "print('ok')\n");
  await writeFixture(path.join(root, "src-tauri", "target", "release", "runtime", "stale.txt"), "stale");

  const result = await prepareReleaseRuntime({ rootDir: root, nodeExecutable });

  assert.deepEqual(result.removedPythonCaches, ["adapters/__pycache__", "adapters/stray.pyo"]);
  assert.equal(await readFile(path.join(root, "src", "adapters", "module.py"), "utf8"), "print('ok')\n");
  await assert.rejects(stat(path.join(root, "src", "adapters", "__pycache__")), { code: "ENOENT" });
  await assert.rejects(stat(path.join(root, "src", "adapters", "stray.pyo")), { code: "ENOENT" });
  await assert.rejects(stat(path.join(root, "src-tauri", "target", "release", "runtime")), { code: "ENOENT" });
  assert.equal(await readFile(result.targetNodePath, "utf8"), "node-runtime");
  await rm(root, { recursive: true, force: true });
});
