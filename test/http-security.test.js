import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  HTTP_SECURITY_LIMITS,
  readBoundedBody
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
