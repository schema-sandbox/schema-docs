import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { detectPdfLayoutExtractor } from "../adapters/pdfLayoutExtractor.js";
import { detectPdfPageRenderer } from "../adapters/pdfVisualRenderer.js";
import { detectPdfOcrAdapter } from "../adapters/pdfOcrExtractor.js";
import { detectPdfMarkerExtractor } from "../adapters/pdfMarkerExtractor.js";
const execFileAsync = promisify(execFile);
async function checkCommand(cmd, args = ["--version"]) {
try {
const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 3000 });
const versionStr = stdout.trim() || stderr.trim() || "unknown";
return {
available: true,
version: versionStr.split("\n")[0] || "unknown"
};
} catch (err) {
if (err.code !== "ENOENT" && err.code !== 127) return {
available: true,
version: "present"
};
return {
available: false,
version: null,
error: err.message
};
}
}
function optionalAdapter({ name, command, detection, purpose, fallback, formats, sendGateImpact }) {
return {
name,
command,
required: false,
mode: "optional-system-adapter",
available: detection.available,
version: detection.version,
purpose,
fallback,
formats,
sendGateImpact
};
}
export async function detectAdapterCapabilities() {
const [soffice, pandoc, tesseract, pdftotext, mutool, pdfplumber, pdftoppm, pdfOcr, marker] = await Promise.all([
checkCommand("soffice", ["--version"]),
checkCommand("pandoc", ["--version"]),
checkCommand(process.env.SCHEMA_DOCS_TESSERACT || "tesseract", ["--version"]),
checkCommand("pdftotext", ["-v"]),
checkCommand("mutool", []),
detectPdfLayoutExtractor(),
detectPdfPageRenderer(),
detectPdfOcrAdapter(),
detectPdfMarkerExtractor()
]);
return {
soffice: optionalAdapter({
name: "LibreOffice (soffice)",
command: "soffice --version",
detection: soffice,
purpose: "Converts legacy DOC/XLS/PPT files to PDF/DOCX format offline.",
fallback: "Core DOCX/XLSX/PDF/Markdown adapters continue to work; legacy Office formats stay unsupported until this adapter is installed.",
formats: ["doc", "xls", "ppt", "odt", "ods", "odp", "wps"],
sendGateImpact: "Missing adapter should block or warn when a legacy Office file cannot be normalized before AI preview."
}),
pandoc: optionalAdapter({
name: "Pandoc",
command: "pandoc --version",
detection: pandoc,
purpose: "Converts DOCX/HTML documents to clean Markdown and vice versa.",
fallback: "Core Markdown, DOCX, and PDF exporters remain available; rich HTML/LaTeX/Pandoc-specific conversions stay disabled.",
formats: ["docx", "html", "latex", "epub", "md"],
sendGateImpact: "Missing adapter lowers conversion fidelity warnings but does not block simple built-in conversions."
}),
tesseract: optionalAdapter({
name: "Tesseract OCR",
command: "tesseract --version",
detection: tesseract,
purpose: "Extracts OCR text from scanned PDF and image inputs.",
fallback: "Core PDF extraction reads text layers only; scanned pages remain known limits until OCR is installed.",
formats: ["pdf", "png", "jpg", "jpeg", "tiff"],
sendGateImpact: "Missing adapter should block empty scanned extraction at Send Gate instead of sending incomplete context."
}),
pdftotext: optionalAdapter({
name: "pdftotext (Poppler/Xpdf)",
command: "pdftotext -v",
detection: pdftotext,
purpose: "Extracts high-fidelity layout-preserved text layers from PDF files.",
fallback: "Core built-in JS PDF text-layer converter remains available; complex multi-page PDF files will fallback to built-in rendering.",
formats: ["pdf"],
sendGateImpact: "Provides a faster, robust alternative pathway for extracting large or non-standard PDF document text."
}),
mutool: optionalAdapter({
name: "MuPDF (mutool)",
command: "mutool",
detection: mutool,
purpose: "Extracts layout-preserved text layer structure from PDF files using MuPDF engine.",
fallback: "Core built-in PDF and pdftotext extractors remain available; advanced MuPDF-based parsing is disabled.",
formats: ["pdf"],
sendGateImpact: "Provides a fallback text extraction pathway for complex or non-standard PDF document streams."
}),
pdfplumber: optionalAdapter({
name: "pdfplumber layout extractor",
command: "python -c \"import pdfplumber\"",
detection: pdfplumber,
purpose: "Recovers layout-aware PDF text, mathematical glyphs, page coordinates, table candidates, and image regions.",
fallback: "Core text extraction remains available, but mathematical font encodings and visual regions may be incomplete.",
formats: ["pdf"],
sendGateImpact: "Formula-heavy PDFs remain usable for body text, but formula regions require review when this adapter is missing."
}),
pdftoppm: optionalAdapter({
name: "pdftoppm visual renderer",
command: "pdftoppm -h",
detection: pdftoppm,
purpose: "Renders selected PDF pages, formulas, tables, and image regions to PNG for visual fallback.",
fallback: "Mapped source coordinates remain available, but visual region snapshots cannot be generated locally.",
formats: ["pdf", "png"],
sendGateImpact: "Low-confidence formula text should not be trusted without the original PDF or a rendered visual fallback."
}),
pdfOcr: {
name: "Local PDF OCR pipeline",
command: "pdftoppm + Tesseract + pdfinfo",
required: false,
mode: "optional-system-adapter",
available: pdfOcr.available,
version: pdfOcr.tesseract?.version || null,
purpose: "Renders and OCRs every scanned PDF page locally with explicit page markers and failed-page records.",
fallback: "Image-only PDFs remain blocked at Send Gate until OCR tools are installed or a searchable PDF is supplied.",
formats: ["pdf"],
sendGateImpact: "OCR output is reviewable text; formulas, handwriting, and complex layouts still require source-page comparison.",
components: {
tesseract: !!pdfOcr.tesseract?.available,
pdftoppm: !!pdfOcr.renderer?.available,
pdfinfo: !!pdfOcr.pdfInfo?.available,
tessdataDir: pdfOcr.tesseract?.tessdataDir || ""
}
},
marker: optionalAdapter({
name: "Marker high-fidelity PDF converter",
command: "marker_single --help",
detection: marker,
purpose: "Produces local Markdown with editable LaTeX equations, formatted tables, reading order, and extracted images.",
fallback: "pdfplumber preserves layout-aware text and visual-region coordinates; uncertain formulas remain renderable source-linked images.",
formats: ["pdf", "md", "latex", "png"],
sendGateImpact: "Scientific PDFs should prefer this adapter when editable equations and table structure are required for AI intake."
})
};
}
