import { readFile } from "node:fs/promises";
import path from "node:path";
let cachedLimits = null;
export async function loadKnownLimits() {
if (cachedLimits) return cachedLimits;
try {
const filePath = path.join(import.meta.dirname, "../../samples/known-limits.json");
const content = await readFile(filePath, "utf8");
cachedLimits = JSON.parse(content);
return cachedLimits;
} catch (error) {
return [
{
id: "ocr_unsupported",
area: "extract",
title: "Scanned PDF Requires OCR",
description: "Scanned PDFs or images without text layers require the optional local Tesseract and Poppler OCR path or an upstream searchable PDF.",
userVisibleMessage: "OCR is required. Use the optional local OCR adapter or provide a searchable text-layer PDF before AI review.",
workaround: "Install Tesseract and Poppler, or create a searchable PDF with another trusted OCR tool.",
plannedStatus: "optional_adapter_available",
severity: "high",
appliesToFormats: ["pdf"],
detectionSignal: "scannedLikely"
},
{
id: "ocr_adapter_missing",
area: "extract",
title: "OCR Adapter Missing",
description: "The document appears to need OCR, but the optional Tesseract OCR adapter is not available.",
userVisibleMessage: "Scanned PDF extraction needs Tesseract OCR or an upstream text-layer PDF.",
workaround: "Install Tesseract OCR, or provide a searchable text-layer PDF.",
plannedStatus: "optional_adapter_available",
severity: "high",
appliesToFormats: ["pdf"],
detectionSignal: "ocr_adapter_missing"
},
{
id: "legacy_office_adapter_required",
area: "import",
title: "Legacy Office Adapter Required",
description: "Legacy Office formats need LibreOffice or export to a modern format.",
userVisibleMessage: "Legacy Office files need LibreOffice (soffice) or export to DOCX/XLSX/PDF before import.",
workaround: "Install LibreOffice, or save the file as .docx, .xlsx, .pdf, .md, .txt, or .csv first.",
plannedStatus: "optional_adapter_available",
severity: "medium",
appliesToFormats: ["doc", "xls", "ppt", "odt", "ods", "odp", "wps"],
detectionSignal: "legacy_office_adapter_required"
},
{
id: "pdf_rich_objects_unsupported",
area: "extract",
title: "PDF Rich Objects Require Review",
description: "Basic PDF text extraction does not fully reconstruct rich objects. The adaptive pipeline preserves uncertain images, formulas, and tables as source-linked visual assets, while annotations and embedded objects may remain source-only.",
userVisibleMessage: "Review PDF rich objects against the retained source. Visual assets may be preserved, but annotations, embedded objects, and complex page geometry are not fully reconstructed.",
workaround: "Keep the original PDF as the authoritative visual source and review extracted Markdown before sending it to AI.",
plannedStatus: "planned_rich_layout_adapter",
severity: "medium",
appliesToFormats: ["pdf"],
detectionSignal: "richObjectsUnsupported"
}
];
}
}
export async function getKnownLimits(filter = {}) {
const limits = await loadKnownLimits();
return limits.filter((limit) => {
if (filter.format && limit.appliesToFormats.length > 0 && !limit.appliesToFormats.includes(filter.format)) {
return false;
}
if (filter.area && limit.area !== filter.area) return false;
return true;
});
}
