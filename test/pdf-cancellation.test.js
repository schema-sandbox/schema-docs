import assert from "node:assert/strict";
import test from "node:test";
import { markdownToPdfBuffer, pdfMarkdownConverter } from "../src/adapters/pdfMarkdownConverter.js";

test("PDF stream extraction checks cancellation during long built-in scans", async () => {
  const markdown = Array.from({ length: 1_800 }, (_, index) => `line ${index + 1}`).join("\n");
  const buffer = markdownToPdfBuffer(markdown);
  let checks = 0;
  await assert.rejects(
    pdfMarkdownConverter.convert({
      sourcePath: "cancel-check.pdf",
      inputStat: { size: buffer.byteLength },
      buffer,
      assertNotCancelled: async () => {
        checks += 1;
        if (checks >= 1) {
          const error = new Error("Job was cancelled.");
          error.code = "job_cancelled";
          throw error;
        }
      }
    }),
    error => error?.code === "job_cancelled"
  );
  assert.ok(checks >= 1);
});
