# Schema Docs v0.1.3 Large-Document Reliability Update

Schema Docs v0.1.3 is a Windows public-preview reliability update based on a complete regression with eight real PDF, TXT, Markdown, XLSX, PPTX, and DOCX samples.

## What changed

- Fixed PDF fraction/exponent layout regressions and restored missing formula-quality fallback helpers.
- Added CMSY symbol mappings for angle brackets and single/double vertical bars.
- Added adaptive browser timeouts for very large, formula-heavy PDF exports.
- Restored safe external Markdown open/save through a native-picker authorization bridge.
- Kept imported-record selection, the current document, and the Markdown workbench in sync.
- Cleared stale segment notices when switching to a non-segmented document.
- Preserved exact outer whitespace when exporting handwritten/external Markdown.
- Raised authenticated JSON body capacity from 8 MiB to 64 MiB while keeping the upload limit at 256 MiB.
- Expanded security, formula, Markdown, desktop, and server regression coverage.

## Compared with v0.1.2

| Area | v0.1.2 | v0.1.3 |
|---|---|---|
| Automated suite | 332 passed, 1 skipped | 380 passed, 1 skipped, 0 failed |
| Complex merged PDF export | Fixed 180-second timeout | Adaptive timeout based on content size and images |
| External Markdown | Could lose native read/write access after hardening | Explicit native-picker authorization with canonical-path checks |
| Markdown round trip | Outer whitespace could be normalized | Byte-identical `.md` export on both regression samples |
| Formula regression baseline | Four failures in the formula path | All four repaired and covered |

## Windows artifacts

Upload these four files from `release/windows` after the final build:

- `schema-docs_0.1.3_x64-setup.exe`
- `schema-docs_0.1.3_x64_en-US.msi`
- `schema-docs_0.1.3_x64-portable.zip`
- `SHA256SUMS.txt`

| Artifact | Size | SHA-256 |
|---|---:|---|
| `schema-docs_0.1.3_x64-setup.exe` | 25,470,091 bytes | `0dd6f56fbe8b5347e13c550630caf2766d8aa9170cb047916061c4bd86fe8662` |
| `schema-docs_0.1.3_x64_en-US.msi` | 37,316,399 bytes | `8ccc757cb6ca84bfed233e36f0e038f3df01f26faff5717d2b548885fbabf228` |
| `schema-docs_0.1.3_x64-portable.zip` | 37,162,172 bytes | `4dc2ac11e3a82ad1c1e82c3166e0c03134e6560374bf1f86f3464799efe95bba` |

## Verification

- Full automated suite: 380 passed, 1 skipped, 0 failed.
- Rust desktop compile and Windows packaging passed.
- The final packaged `app.exe` launched with its bundled Node runtime, reported version `0.1.3`, completed the DOCX/PDF/export/AI-gate workflow, and shut down cleanly.
- Eight real documents were exercised through open/import, segmentation, per-segment export, and merged export as applicable.
- Two Markdown source/export pairs were byte-identical.
- Detailed evidence is retained in the local customer-facing v0.1.3 regression report.

## Known limits

- Complex subset-font mathematics such as `math-deep.pdf` still requires visual review; v0.1.3 does not claim perfect mathematical OCR.
- Some legacy DOCX DrawingML/VML objects have no image relationship and are represented by explicit placeholders.
- The optional Marker channel was not installed in the verification environment.
- Windows artifacts are not commercially code-signed.
- The public-tag readiness checklist still requires a human F-012 visible desktop verification on the target Windows machine, including native picker evidence.
