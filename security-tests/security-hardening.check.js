import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, access, symlink, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { prepareSafeWritePath } from "../src/core/pathGuard.js";
import { listZipEntries, readZipEntry } from "../src/core/zip.js";
import { buildZip } from "../test/helpers/zipBuilder.js";
import {
  HttpSecurityError,
  hasTrustedBrowserContext,
  isSafeWorkspaceRelativePath,
  isTrustedHostHeader,
  parseJsonBody,
  readBoundedBody,
  trustedCorsOrigin,
  validatePublicApiPayload
} from "../src/server/httpSecurity.js";

async function tempDir(prefix) { return mkdtemp(path.join(os.tmpdir(), prefix)); }

test("safe write preparation rejects traversal before creating directories", async () => {
  const root = await tempDir("schema-path-root-");
  const outside = path.join(path.dirname(root), `schema-outside-${Date.now()}`);
  await assert.rejects(
    prepareSafeWritePath(path.join(outside, "nested", "file.md"), root, [".md"]),
    (error) => error.code === "write_outside_workspace"
  );
  await assert.rejects(access(path.join(outside, "nested")));
});

test("safe write preparation permits normal workspace output", async () => {
  const root = await tempDir("schema-path-ok-");
  const output = await prepareSafeWritePath(path.join(root, "exports", "safe.md"), root, [".md"]);
  await writeFile(output, "safe", "utf8");
  assert.equal(output, path.join(root, "exports", "safe.md"));
});

test("safe write preparation rejects a symlink parent escaping the workspace", async (t) => {
  const root = await tempDir("schema-path-link-");
  const outside = await tempDir("schema-path-link-out-");
  const link = path.join(root, "linked");
  try {
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`symlinks unavailable: ${error.message}`);
    return;
  }
  await assert.rejects(
    prepareSafeWritePath(path.join(link, "escape.md"), root, [".md"]),
    (error) => error.code === "write_outside_workspace"
  );
});

test("ZIP parser reads a normal bounded entry", () => {
  const archive = buildZip([{ name: "word/document.xml", content: "<document>Hello</document>" }]);
  assert.equal(listZipEntries(archive).length, 1);
  assert.equal(readZipEntry(archive, "word/document.xml").toString("utf8"), "<document>Hello</document>");
});

test("ZIP parser rejects suspicious compression ratios before inflate", () => {
  const archive = buildZip([{ name: "word/document.xml", content: Buffer.alloc(2 * 1024 * 1024, 0x41) }]);
  assert.throws(() => listZipEntries(archive), (error) => error.code === "zip_compression_ratio_exceeded");
});

test("ZIP parser enforces configurable entry and total expansion limits", () => {
  const archive = buildZip([
    { name: "one.bin", content: Buffer.alloc(2048, 1) },
    { name: "two.bin", content: Buffer.alloc(2048, 2) }
  ]);
  assert.throws(
    () => listZipEntries(archive, { maxEntryUncompressedBytes: 1024, maxCompressionRatio: 10000 }),
    (error) => error.code === "zip_entry_too_large"
  );
  assert.throws(
    () => listZipEntries(archive, { maxEntryUncompressedBytes: 4096, maxTotalUncompressedBytes: 3000, maxCompressionRatio: 10000 }),
    (error) => error.code === "zip_total_too_large"
  );
});

test("HTTP security trusts only loopback browser contexts", () => {
  assert.equal(isTrustedHostHeader("127.0.0.1:4177"), true);
  assert.equal(isTrustedHostHeader("evil.example"), false);
  assert.equal(trustedCorsOrigin({ origin: "http://localhost:4177" }), "http://localhost:4177");
  assert.equal(trustedCorsOrigin({ origin: "https://evil.example" }), "");
  assert.equal(hasTrustedBrowserContext({ referer: "tauri://localhost/" }), true);
  assert.equal(hasTrustedBrowserContext({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }), false);
});

test("public API payload validation rejects absolute and traversal export paths", () => {
  for (const outputRelativePath of ["/tmp/out.md", "C:\\temp\\out.md", "../out.md", "exports/../../out.md"]) {
    assert.throws(
      () => validatePublicApiPayload("/api/markdown/export", { outputRelativePath }),
      (error) => error instanceof HttpSecurityError && error.code === "unsafe_output_path"
    );
  }
  assert.equal(isSafeWorkspaceRelativePath("exports/out.md"), true);
  assert.doesNotThrow(() => validatePublicApiPayload("/api/markdown/export", { outputRelativePath: "exports/out.md" }));
});

test("public API disables direct external Markdown routes", () => {
  assert.throws(
    () => validatePublicApiPayload("/api/markdown/save-external", { sourcePath: "/tmp/a.md" }),
    (error) => error.status === 403 && error.code === "external_markdown_route_disabled"
  );
});

test("bounded request reader rejects declared and streamed oversized bodies", async () => {
  const declared = Readable.from([Buffer.from("{}")]);
  declared.headers = { "content-length": "100" };
  await assert.rejects(readBoundedBody(declared, 10), (error) => error.status === 413);

  const streamed = Readable.from([Buffer.alloc(6), Buffer.alloc(6)]);
  streamed.headers = {};
  await assert.rejects(readBoundedBody(streamed, 10), (error) => error.status === 413);

  const valid = Readable.from([Buffer.from('{"ok":true}')]);
  valid.headers = {};
  const parsed = parseJsonBody(await readBoundedBody(valid, 100));
  assert.deepEqual(parsed, { ok: true });
});
