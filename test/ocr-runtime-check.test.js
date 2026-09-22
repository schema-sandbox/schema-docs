import test from "node:test";
import assert from "node:assert/strict";
import { runOcrRuntimeCheck } from "../src/cli/ocr-runtime-check.js";

test("OCR runtime check reports unavailable components without throwing", async () => {
  const output = [];
  const code = await runOcrRuntimeCheck(["--strict"], { log: value => output.push(value) }, {
    tesseractCommand: "schema-docs-missing-tesseract",
    rendererCommand: "schema-docs-missing-pdftoppm",
    pdfInfoCommand: "schema-docs-missing-pdfinfo"
  });
  const result = JSON.parse(output[0]);
  assert.equal(code, 1);
  assert.equal(result.available, false);
  assert.equal(result.components.tesseract.available, false);
});

