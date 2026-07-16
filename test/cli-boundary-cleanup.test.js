import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  cleanupArtifactsPath,
  execFileAsync,
  languageBoundaryCheckPath,
  projectRoot
} from "./helpers/cliHarness.js";
async function runCliJson(scriptPath, args = [], options = {}) {
  const { stdout } = await execFileAsync(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    ...options
  });
  return JSON.parse(stdout);
}
async function runCliRejectJson(scriptPath, args = [], options = {}) {
  try {
    await execFileAsync(process.execPath, [scriptPath, ...args], {
      cwd: projectRoot,
      ...options
    });
  } catch (error) {
    return JSON.parse(error.stdout);
  }
  throw new Error(`Expected ${path.basename(scriptPath)} to fail.`);
}
test("language-boundary-check blocks CJK from default product surfaces", async () => {
  const result = await runCliJson(languageBoundaryCheckPath, ["--json"], {
    maxBuffer: 16 * 1024 * 1024
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.blocked, []);
  assert.equal(result.review.length, 0);
  assert.match(result.policy, /Default runtime/);
});
test("language-boundary-check blocks mojibake everywhere and CJK in default surfaces", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "schema-docs-language-boundary-"));
  const multilingualMojibakePath = path.join(fixtureRoot, "test", "lang_boundary_test_mojibake.js");
  const commonUiMojibakePath = path.join(fixtureRoot, "test", "lang_boundary_common_ui_mojibake.js");
  const defaultSurfaceCjkPath = path.join(fixtureRoot, "public", "lang_boundary_test_cjk.js");
  const mojibakeText = String.fromCharCode(0x951f, 0x65a4, 0x62f7);
  const commonUiMojibakeText = String.fromCharCode(0x6d93, 0xe15f, 0x6783, 0x9423, 0x5c84, 0x6f70);
  await mkdir(path.dirname(multilingualMojibakePath), { recursive: true });
  await mkdir(path.dirname(defaultSurfaceCjkPath), { recursive: true });
  await writeFile(multilingualMojibakePath, `export const broken = '${mojibakeText}';\n`, "utf8");
  await writeFile(commonUiMojibakePath, `export const brokenUiLabel = '${commonUiMojibakeText}';\n`, "utf8");
  await writeFile(defaultSurfaceCjkPath, "export const label = '\u4e2d\u6587';\n", "utf8");
  try {
    const result = await runCliRejectJson(languageBoundaryCheckPath, ["--json", "--root", fixtureRoot], {
      maxBuffer: 16 * 1024 * 1024
    });
    assert.equal(result.ok, false);
    assert.ok(result.blocked.some((entry) => (
      entry.path === "test/lang_boundary_test_mojibake.js"
      && entry.containsMojibake === true
      && entry.reason === "mojibake"
    )));
    assert.ok(result.blocked.some((entry) => (
      entry.path === "test/lang_boundary_common_ui_mojibake.js"
      && entry.containsMojibake === true
      && entry.reason === "mojibake"
    )));
    assert.ok(result.blocked.some((entry) => (
      entry.path === "public/lang_boundary_test_cjk.js"
      && entry.containsHan === true
    )));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
test("language-boundary-check ignores local customer fresh test workspaces", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "schema-docs-language-customer-workspace-"));
  const generatedWorkspacePath = path.join(fixtureRoot, "customer-fresh-test", "outputs", "readable", "normal.readable.md");
  const defaultSurfacePath = path.join(fixtureRoot, "README.md");
  await mkdir(path.dirname(generatedWorkspacePath), { recursive: true });
  await writeFile(generatedWorkspacePath, "# 中文测试夹具\n\n这是客户视角重测生成的本地工作区内容。\n", "utf8");
  await writeFile(defaultSurfacePath, "# Schema Docs\n", "utf8");
  try {
    const result = await runCliJson(languageBoundaryCheckPath, ["--json", "--root", fixtureRoot], {
      maxBuffer: 16 * 1024 * 1024
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.blocked, []);
    assert.deepEqual(result.review, []);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
test("cleanup-artifacts detects and removes generated root artifacts in a supplied root", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "schema-docs-cleanup-root-"));
  const generatedDirs = ["%TEMP%", "$TMP", "tmp-workspace"];
  const keepDir = path.join(fixtureRoot, "keep-me");
  for (const dir of generatedDirs) {
    await mkdir(path.join(fixtureRoot, dir), { recursive: true });
  }
  await mkdir(keepDir, { recursive: true });
  try {
    const check = await runCliRejectJson(cleanupArtifactsPath, ["--check", "--root", fixtureRoot]);
    assert.equal(check.ok, false);
    assert.deepEqual(check.candidates.map((candidate) => candidate.path).sort(), generatedDirs.sort());
    const applied = await runCliJson(cleanupArtifactsPath, ["--apply", "--root", fixtureRoot]);
    assert.equal(applied.ok, true);
    assert.deepEqual(applied.removed.sort(), generatedDirs.sort());
    for (const dir of generatedDirs) {
      assert.equal(existsSync(path.join(fixtureRoot, dir)), false);
    }
    assert.equal(existsSync(keepDir), true);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});