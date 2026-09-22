import { pathToFileURL } from "node:url";
import { detectPdfOcrAdapter } from "../adapters/pdfOcrExtractor.js";

export async function runOcrRuntimeCheck(argv = process.argv.slice(2), io = console, runtimeOptions = {}) {
  const strict = argv.includes("--strict");
  const detection = await detectPdfOcrAdapter({
    tesseractCommand: process.env.SCHEMA_DOCS_TESSERACT,
    rendererCommand: process.env.SCHEMA_DOCS_PDFTOPPM,
    pdfInfoCommand: process.env.SCHEMA_DOCS_PDFINFO,
    ...runtimeOptions
  });
  const result = {
    schema: "schema-docs.ocr-runtime-check",
    version: 1,
    available: detection.available,
    missingLanguages: String(runtimeOptions.languages || process.env.SCHEMA_DOCS_OCR_LANGUAGES || "chi_sim+eng")
      .split("+").filter(language => !detection.tesseract.languages?.includes(language)),
    components: {
      tesseract: detection.tesseract,
      renderer: detection.renderer,
      pdfInfo: detection.pdfInfo
    },
    guidance: detection.available
      ? "Local OCR runtime is available for scanned PDF fallback."
      : "The OCR engine, PDF renderer, and requested language data must be available in the conversion runtime."
  };
  io.log(JSON.stringify(result, null, 2));
  return strict && (!result.available || result.missingLanguages.length) ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runOcrRuntimeCheck([...
    process.argv.slice(2)
  ]).then(code => { process.exitCode = code; }).catch(error => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  });
}
