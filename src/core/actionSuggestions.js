import { lookupError } from "./errorCatalog.js";
export function getActionSuggestions(warnings = []) {
const suggestions = [];
for (const warning of warnings) {
if (warning === "scannedLikely" || warning === "pdf_text_layer_missing") {
suggestions.push({
warning,
action: "OCR is required. Use a text-layer PDF or run OCR before sending this document to AI."
});
} else if (warning === "ocr_adapter_missing") {
suggestions.push({
warning,
action: "Install Tesseract OCR or import a text-layer PDF before sending this document to AI."
});
} else if (warning === "legacy_office_adapter_required") {
suggestions.push({
warning,
action: "Install LibreOffice (soffice) or export the legacy Office file to DOCX/XLSX/PDF before importing."
});
} else if (warning === "layoutSimplified" || warning === "tableSimplified") {
suggestions.push({
warning,
action: "Review simplified tables manually, or export the table to CSV for cleanup."
});
} else if (warning === "possibleMojibake") {
suggestions.push({
warning,
action: "Check the file encoding, source language settings, or missing CJK font mappings."
});
} else if (warning === "lowQualityExtraction") {
suggestions.push({
warning,
action: "Do not send this directly to AI. Clean the Markdown manually first."
});
} else if (warning === "joinUnsupported") {
suggestions.push({
warning,
action: "Use a simple INNER JOIN (JOIN ... ON left_key = right_key), or split the work into separate queries."
});
} else {
const errorDetail = lookupError(warning);
suggestions.push({
warning,
action: errorDetail.suggestedAction || "Review the related documentation for recovery steps."
});
}
}
if (suggestions.length === 0) {
suggestions.push({
warning: "none",
action: "Document quality looks ready. You can create an exchange package or run a local SQL query next."
});
}
return suggestions;
}