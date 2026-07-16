import assert from "node:assert/strict";
import test from "node:test";
import { buildI18nRuntimeCases, translateUiText, validateI18nRuntimeTranslations } from "../src/cli/i18n-runtime-check.js";
import { findKnownMojibake, hasKnownMojibake, knownMojibakeFragments } from "../src/cli/mojibake-guard.js";
test("shared i18n runtime cases cover static and dynamic Chinese UI text", () => {
  const cases = buildI18nRuntimeCases();
  assert.ok(cases.some((item) => item.source === "Chinese help" && item.actual === "\u4e2d\u6587\u754c\u9762"));
  assert.ok(cases.some((item) => item.source === "Imported: contract.pdf" && item.actual === "\u5df2\u5bfc\u5165\uff1acontract.pdf"));
  assert.equal(translateUiText("Untranslated fallback remains English"), "Untranslated fallback remains English");
});
test("shared i18n runtime validation separates served static text from dynamic pattern output", () => {
  const result = validateI18nRuntimeTranslations({
    hasMojibake: hasKnownMojibake,
    servedText: "\u4e2d\u6587\u754c\u9762\n\u4fdd\u5b58\u5e72\u51c0 AI-ready \u526f\u672c",
    servedExpected: ["\u4e2d\u6587\u754c\u9762", "\u4fdd\u5b58\u5e72\u51c0 AI-ready \u526f\u672c"]
  });
  assert.equal(result.ok, true);
  assert.equal(result.fallbackOk, true);
  assert.equal(result.servedTextOk, true);
});
test("shared mojibake guard detects common corrupted Chinese fragments", () => {
  const corrupted = `bad text ${String.fromCharCode(0x6d93, 0xe15f, 0x6783)}`;
  assert.equal(hasKnownMojibake(corrupted), true);
  assert.deepEqual(findKnownMojibake(corrupted), [
    String.fromCharCode(0x6d93),
    String.fromCharCode(0xe15f),
    String.fromCharCode(0x6783)
  ]);
});
test("shared mojibake guard leaves valid Chinese locale text alone", () => {
  assert.equal(hasKnownMojibake("\u6587\u6863\u8fdb\u5165 AI \u524d\uff0c\u5148\u770b\u770b AI \u4f1a\u770b\u5230\u4ec0\u4e48\u3002"), false);
  assert.ok(knownMojibakeFragments.includes("\ufffd"));
});