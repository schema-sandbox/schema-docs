# Public Preview Sample Verification Report (v0.1.0)

This report summarizes 20 real/representative document sample checks for the v0.1.0 public preview. The complete machine-readable registry is stored in `samples/real-sample-results.json`; this document expands 10 representative cases for release review.

## Status Summary

- 20 real/representative sample checks preserved.
- 9 `pass`, 10 `known_limit`, 1 `blocked`.
- The `blocked` sample is an expected Send Gate safety result for credential-like content, not a release failure.
- Required capability coverage is present for `ai_intake`, `safety_gate`, `format_exchange`, `table_filter`, `long_input`, and `external_refresh`.
- The release question is whether usable AI context is generated or correctly blocked before model handoff, not whether Office/PDF layout is preserved pixel-for-pixel.

## Representative Samples

| ID | Sample File | Type | AI Will See Result | Send Gate | Export / Handoff | Release Judgment |
|---|---|---|---|---|---|---|
| RS-001 | `academic-paper-multi-column.pdf` | PDF | Readable; multi-column layout linearized into Markdown. | Allowed | SDXP/export succeeded. | Acceptable layout simplification for AI intake. |
| RS-002 | `financial-report-complex-table.docx` | DOCX | Readable Markdown table structure. | Allowed | DOCX/PDF/SDXP succeeded. | Merged/nested layout may flatten, but AI context is usable. |
| RS-003 | `legal-agreement-text.pdf` | PDF | Clean text-layer extraction. | Review recommended for ordinary contact data. | DOCX/PDF export succeeded. | Good contract-style AI intake sample. |
| RS-004 | `patient-survey-scanned.pdf` | PDF | Empty or unreadable in the recorded environment because no text layer or optional OCR adapter was available. | Blocked by low-quality extraction. | Structural output only. | Correctly blocks scanned input until local/upstream OCR produces reviewable text. |
| RS-005 | `chinese-employee-list.csv` | CSV | CJK text remains readable; PII can be masked locally. | Allowed after local masking. | CSV/Markdown/SDXP succeeded. | Confirms encoding and safety boundary behavior. |
| RS-006 | `inventory-records.xlsx` | XLSX | Active sheet becomes a clean table preview. | Allowed | Spreadsheet context/export succeeded. | Suitable for token-bounded table intake. |
| RS-007 | `formula-heavy-sheet.xlsx` | XLSX | Cached cell values are readable; formulas are not executed. | Allowed | Static export succeeded. | Known formula limit is explicit and acceptable. |
| RS-020 | `credentials-leak-blocked.txt` | TXT | Credential-like content detected. | Hard blocked. | Send intentionally not used. | Confirms local safety gate blocks secret leakage. |
| RS-019 | `technical-spec-images.docx` | DOCX | Text is readable; embedded images are omitted. | Allowed | Export/SDXP succeeded. | Text-first AI review works; vision/OCR remains out of scope. |
| RS-009 | `round-trip-docx-back-to-md.md` | MD/SDXP | Markdown is directly AI-ready. | Allowed | Round-trip handoff succeeded. | Confirms Markdown exchange layer behavior. |

## Known Limits Preserved

- Scanned/image-only PDFs require optional local Tesseract + Poppler OCR or an upstream searchable PDF. The recorded sample remains a known limit because that OCR path was not available in the sample environment.
- Complex visual layout, embedded images, formulas, and merged spreadsheet structures are simplified rather than faithfully reproduced.
- These are documented known limits, not public-preview blockers, when Send Gate and quality warnings make the limitation visible before AI send.
