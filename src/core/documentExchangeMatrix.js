import { AppError } from "./errors.js";
export const DOCUMENT_EXCHANGE_FORMATS = ["md", "docx", "pdf", "html"];
export const DOCUMENT_EXCHANGE_CONVERSIONS = [
{ from: "md", to: "md", mode: "direct", quality: "copy" },
{ from: "md", to: "docx", mode: "direct", quality: "basic" },
{ from: "md", to: "pdf", mode: "direct", quality: "basic" },
{ from: "md", to: "html", mode: "direct", quality: "basic" },
{ from: "docx", to: "md", mode: "direct", quality: "basic" },
{ from: "docx", to: "docx", mode: "via-md", quality: "normalized" },
{ from: "docx", to: "pdf", mode: "via-md", quality: "basic" },
{ from: "docx", to: "html", mode: "via-md", quality: "basic" },
{ from: "pptx", to: "md", mode: "direct", quality: "reading-order" },
{ from: "pptx", to: "docx", mode: "via-md", quality: "reading-order" },
{ from: "pptx", to: "pdf", mode: "via-md", quality: "reading-order" },
{ from: "pptx", to: "html", mode: "via-md", quality: "reading-order" },
{ from: "pdf", to: "md", mode: "direct", quality: "basic-text-layer" },
{ from: "pdf", to: "docx", mode: "via-md", quality: "basic-text-layer" },
{ from: "pdf", to: "pdf", mode: "via-md", quality: "normalized-text-layer" },
{ from: "pdf", to: "html", mode: "via-md", quality: "basic-text-layer" }
];
export const DOCUMENT_EXCHANGE_LIMITS = [
"DOCX conversion is structural and does not preserve full layout.",
"PPTX conversion preserves slide content in reading order, not the original canvas layout.",
"PDF conversion handles simple text layers; scanned PDFs need OCR or a heavier adapter.",
"Markdown to PDF uses an offline styled A4 renderer, but requires local Edge or Chromium and does not reproduce arbitrary source-page layout pixel for pixel."
];
export function normalizeDocumentFormat(format) {
const normalized = String(format ?? "").trim().toLowerCase().replace(/^\./, "");
if (!DOCUMENT_EXCHANGE_FORMATS.includes(normalized)) {
throw new AppError("document_exchange_format_unsupported", `Unsupported document exchange format: ${format}`, {
format,
supportedFormats: DOCUMENT_EXCHANGE_FORMATS
});
}
return normalized;
}
export function normalizeDocumentExchangeSourceType(sourceType) {
const normalized = String(sourceType ?? "").trim().toLowerCase().replace(/^\./, "");
if (normalized === "txt") return "md";
if (normalized === "pptx") return "pptx";
return normalizeDocumentFormat(normalized);
}
export function getDocumentExchangeCapability(sourceType, targetFormat) {
const from = normalizeDocumentExchangeSourceType(sourceType);
const to = normalizeDocumentFormat(targetFormat);
const capability = DOCUMENT_EXCHANGE_CONVERSIONS.find((conversion) => conversion.from === from && conversion.to === to);
if (!capability) throw new AppError("document_exchange_conversion_unsupported", `Unsupported document exchange conversion: ${from} -> ${to}`, {
from,
to,
supportedConversions: DOCUMENT_EXCHANGE_CONVERSIONS
});
return {
...capability,
limits: DOCUMENT_EXCHANGE_LIMITS
};
}
export function listDocumentExchangeCapabilities() {
return {
centerFormat: "md",
formats: DOCUMENT_EXCHANGE_FORMATS,
conversions: DOCUMENT_EXCHANGE_CONVERSIONS,
limits: DOCUMENT_EXCHANGE_LIMITS
};
}
