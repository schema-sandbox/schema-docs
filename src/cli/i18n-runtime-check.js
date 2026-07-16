import { createI18nPanel } from "../../public/i18nPanel.js";

const i18nRuntimePanel = createI18nPanel({ $: () => null });

export function translateUiText(value) {
  return i18nRuntimePanel._test.translateText(value);
}

export function buildI18nRuntimeCases() {
  return [
    {
      source: "Chinese help",
      expected: "\u4e2d\u6587\u754c\u9762"
    },
    {
      source: "Extract to Markdown",
      expected: "\u63d0\u53d6\u4e3a Markdown"
    },
    {
      source: "Save clean AI-ready copy",
      expected: "\u4fdd\u5b58\u5e72\u51c0 AI-ready \u526f\u672c"
    },
    {
      source: "Before sending a document to AI, see what AI will see. Do not send raw files directly to AI.",
      expected: "\u53d1\u9001\u524d\u5148\u9884\u89c8\u3002"
    },
    {
      source: "Imported: contract.pdf",
      expected: "\u5df2\u5bfc\u5165\uff1acontract.pdf"
    }
  ].map((item) => ({
    ...item,
    actual: translateUiText(item.source)
  }));
}

export function validateI18nRuntimeTranslations({ hasMojibake, servedText = "", servedExpected = null } = {}) {
  const cases = buildI18nRuntimeCases();
  const fallbackOk = translateUiText("Untranslated fallback remains English") === "Untranslated fallback remains English";
  const caseOutputOk = cases.every((item) => (
    item.actual === item.expected
    && (typeof hasMojibake === "function" ? !hasMojibake(item.actual) : true)
  ));
  const requiredServedText = servedExpected ?? cases.map((item) => item.expected);
  const servedTextOk = servedText
    ? requiredServedText.every((expected) => servedText.includes(expected))
    : true;
  return {
    ok: caseOutputOk && fallbackOk && servedTextOk,
    cases,
    fallbackOk,
    servedTextOk
  };
}
