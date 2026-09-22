import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  HTTP_SECURITY_LIMITS,
  readBoundedBody,
  validatePublicApiPayload
} from "../src/server/httpSecurity.js";

test("default JSON limit accepts a merged multi-million-character CJK document", async () => {
  const payload = Buffer.from(JSON.stringify({
    workspacePath: "C:\\workspace",
    relativePath: "notes/merged.md",
    content: "中".repeat(3_000_000)
  }), "utf8");
  assert.ok(payload.length > 8 * 1024 * 1024);
  assert.ok(payload.length < HTTP_SECURITY_LIMITS.jsonBytes);

  const request = Readable.from([payload]);
  request.headers = { "content-length": String(payload.length) };
  const received = await readBoundedBody(request, HTTP_SECURITY_LIMITS.jsonBytes);
  assert.deepEqual(received, payload);
});

test("bounded request reader still rejects payloads above its configured limit", async () => {
  const payload = Buffer.from("123456789");
  const request = Readable.from([payload]);
  request.headers = { "content-length": String(payload.length) };

  await assert.rejects(
    readBoundedBody(request, 8),
    (error) => error?.code === "request_too_large" && error?.status === 413
  );
});

test("segmented HTML export accepts only workspace-relative output paths", () => {
  assert.deepEqual(validatePublicApiPayload("/api/markdown/export-segments-html", {
    outputRelativePath: ".schema-docs-export-staging/job/complete.html",
    segmentRelativePaths: ["outputs/readable/part-001.md"]
  }), {
    outputRelativePath: ".schema-docs-export-staging/job/complete.html",
    segmentRelativePaths: ["outputs/readable/part-001.md"]
  });
  assert.throws(
    () => validatePublicApiPayload("/api/markdown/export-segments-html", {
      outputRelativePath: "../outside.html",
      segmentRelativePaths: ["outputs/readable/part-001.md"]
    }),
    (error) => error?.code === "unsafe_output_path" && error?.status === 400
  );
  assert.throws(
    () => validatePublicApiPayload("/api/markdown/export-segments-html", {
      outputRelativePath: "C:\\outside.html",
      segmentRelativePaths: ["outputs/readable/part-001.md"]
    }),
    (error) => error?.code === "unsafe_output_path" && error?.status === 400
  );
  assert.throws(
    () => validatePublicApiPayload("/api/markdown/export-segments-html", {
      outputRelativePath: "exports/complete.html",
      segmentRelativePaths: ["../outside.md"]
    }),
    (error) => error?.code === "unsafe_segment_path" && error?.status === 400
  );
});
