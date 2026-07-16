import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import {
  prepareWindowsRelease,
  REQUIRED_RUNTIME_FILES,
  sha256File
} from "../scripts/prepare-windows-release.js";

async function writeFixture(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

async function createBuildTree(root, { packageVersion = "0.1.0", tauriVersion = packageVersion } = {}) {
  await writeFixture(path.join(root, "package.json"), JSON.stringify({ version: packageVersion }));
  await writeFixture(path.join(root, "src-tauri", "tauri.conf.json"), JSON.stringify({
    version: tauriVersion,
    productName: "schema-docs"
  }));
  const releaseDir = path.join(root, "src-tauri", "target", "release");
  await writeFixture(path.join(releaseDir, "app.exe"), "fake-app");
  for (const relativePath of REQUIRED_RUNTIME_FILES) {
    await writeFixture(path.join(releaseDir, "runtime", ...relativePath.split("/")), `runtime:${relativePath}`);
  }
  await writeFixture(path.join(releaseDir, "runtime", "extra", "nested.txt"), "nested-runtime-file");
  await writeFixture(path.join(releaseDir, "bundle", "msi", "schema-docs_0.1.0_x64_en-US.msi"), "fake-msi");
  await writeFixture(path.join(releaseDir, "bundle", "nsis", "schema-docs_0.1.0_x64-setup.exe"), "fake-nsis");
  await writeFixture(path.join(root, "LICENSE"), "license\n");
  await writeFixture(path.join(root, "README.md"), "readme\n");
  await writeFixture(path.join(root, "THIRD_PARTY_NOTICES.md"), "notices\n");
}

async function fakeArchive({ sourceDir, archivePath }) {
  const entries = (await readdir(sourceDir)).sort();
  await writeFile(archivePath, `fake-zip:${entries.join(",")}`);
}

test("prepareWindowsRelease creates verified assets and deterministic checksums", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "schema-docs-release-prepare-test-"));
  const tempRoot = path.join(root, "temp");
  await mkdir(tempRoot);
  await createBuildTree(root);
  const archiveCalls = [];

  const result = await prepareWindowsRelease({
    root,
    tempRoot,
    compressArchive: async (options) => {
      archiveCalls.push(options);
      assert.ok(options.sourceDir.startsWith(`${tempRoot}${path.sep}`));
      assert.deepEqual((await readdir(options.sourceDir)).sort(), [
        "LICENSE",
        "README.md",
        "THIRD_PARTY_NOTICES.md",
        "app.exe",
        "runtime"
      ]);
      for (const relativePath of REQUIRED_RUNTIME_FILES) {
        assert.equal(
          await readFile(path.join(options.sourceDir, "runtime", ...relativePath.split("/")), "utf8"),
          `runtime:${relativePath}`
        );
      }
      await fakeArchive(options);
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.version, "0.1.0");
  assert.equal(result.generatedBy, "npm run release:windows:prepare");
  assert.equal(result.portable.runtimeFileCount, REQUIRED_RUNTIME_FILES.length + 1);
  assert.equal(archiveCalls.length, 1);
  assert.deepEqual(result.artifacts.map((item) => path.basename(item.path)), [
    "schema-docs_0.1.0_x64_en-US.msi",
    "schema-docs_0.1.0_x64-setup.exe",
    "schema-docs_0.1.0_x64-portable.zip"
  ]);
  assert.equal(await readFile(path.join(root, result.artifacts[0].path), "utf8"), "fake-msi");
  assert.equal(await readFile(path.join(root, result.artifacts[1].path), "utf8"), "fake-nsis");
  assert.match(await readFile(path.join(root, result.artifacts[2].path), "utf8"), /^fake-zip:/);
  for (const artifact of result.artifacts) {
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    assert.equal(await sha256File(path.join(root, artifact.path)), artifact.sha256);
  }

  const checksumText = await readFile(path.join(root, result.checksums), "utf8");
  assert.equal(checksumText.includes("\r"), false);
  assert.equal(checksumText, `${result.artifacts.map((item) => (
    `${item.sha256}  ${path.basename(item.path)}`
  )).join("\n")}\n`);
  assert.deepEqual(await readdir(tempRoot), []);
  await rm(root, { recursive: true, force: true });
});

test("prepareWindowsRelease rejects package and Tauri version drift before publishing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "schema-docs-release-version-test-"));
  await createBuildTree(root, { tauriVersion: "0.1.1" });
  await assert.rejects(
    prepareWindowsRelease({ root, compressArchive: fakeArchive }),
    /Version mismatch: package\.json=0\.1\.0, tauri\.conf\.json=0\.1\.1/
  );
  await assert.rejects(readdir(path.join(root, "release", "windows")), { code: "ENOENT" });
  await rm(root, { recursive: true, force: true });
});

test("prepareWindowsRelease reports missing runtime files and leaves existing assets untouched", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "schema-docs-release-missing-test-"));
  const tempRoot = path.join(root, "temp");
  await mkdir(tempRoot);
  await createBuildTree(root);
  const missingPath = path.join(root, "src-tauri", "target", "release", "runtime", "public", "libs", "docx.js");
  await rm(missingPath);
  const outputDir = path.join(root, "release", "windows");
  await mkdir(outputDir, { recursive: true });
  await writeFixture(path.join(outputDir, "SHA256SUMS.txt"), "existing-checksums\n");
  let compressed = false;

  await assert.rejects(
    prepareWindowsRelease({
      root,
      tempRoot,
      compressArchive: async () => {
        compressed = true;
      }
    }),
    /Missing required runtime file public\/libs\/docx\.js/
  );
  assert.equal(compressed, false);
  assert.equal(await readFile(path.join(outputDir, "SHA256SUMS.txt"), "utf8"), "existing-checksums\n");
  assert.deepEqual(await readdir(tempRoot), []);
  await rm(root, { recursive: true, force: true });
});

test("prepareWindowsRelease does not replace existing assets when compression fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "schema-docs-release-failure-test-"));
  const tempRoot = path.join(root, "temp");
  await mkdir(tempRoot);
  await createBuildTree(root);
  const outputDir = path.join(root, "release", "windows");
  const existing = {
    "schema-docs_0.1.0_x64_en-US.msi": "old-msi",
    "schema-docs_0.1.0_x64-setup.exe": "old-nsis",
    "schema-docs_0.1.0_x64-portable.zip": "old-zip",
    "SHA256SUMS.txt": "old-sums"
  };
  for (const [name, content] of Object.entries(existing)) {
    await writeFixture(path.join(outputDir, name), content);
  }

  await assert.rejects(
    prepareWindowsRelease({
      root,
      tempRoot,
      compressArchive: async () => {
        throw new Error("archive failed");
      }
    }),
    /archive failed/
  );
  for (const [name, content] of Object.entries(existing)) {
    assert.equal(await readFile(path.join(outputDir, name), "utf8"), content);
  }
  assert.deepEqual(await readdir(tempRoot), []);
  await rm(root, { recursive: true, force: true });
});
