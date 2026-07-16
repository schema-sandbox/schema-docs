# Real-World Layout Sample Regression Matrix

To transition from synthetic fixtures to production reliability, **Schema Docs** defines a release gate that combines automated tests with manual or semi-automated checks across complex, real-world document layouts.

> [!IMPORTANT]
> **Release Gate Criteria**: Release builds require a green automated unit/integration suite plus validation across 10 real-world sample categories and at least 20 preserved real/representative sample checks. Sensitive original documents are excluded from version control; validation is completed by verifying local checksums and matching quality indicators. Public readiness also requires real-sample capability coverage for `ai_intake`, `safety_gate`, `format_exchange`, `table_filter`, `long_input`, and `external_refresh`, so sample count alone is not enough.

---

## 1. Regression Sample Matrix (10 Categories)

| Category ID | Sample Name / Description | Layout Complexity | Target Quality indicators | AI Send Suitability | Verification Status |
|---|---|---|---|---|---|
| **R-001** | Multi-column PDF | Double/triple column academic paper layout. | `layoutSimplified: true` | Suitable after sequential paragraph re-alignment. | **Verified** |
| **R-002** | DOCX with complex merged tables | Split and nested tables with merged columns/rows. | `tableSimplified: true` | Suitable; nested rows converted to linear Markdown blocks. | **Verified** |
| **R-003** | Textless / scanned image PDF | PDF document with no embedded searchable text layer. | `textLayerDetected: false`, `scannedLikely: true` | **Unsuitable** until optional local or upstream OCR succeeds and is reviewed. | **Verified** |
| **R-004** | PDF with missing CIDFont mappings | Custom encoded fonts that may produce invalid glyphs. | `possibleMojibake: true`, `confidence: "medium"` | **Unsuitable** until reviewed. | **Verified** |
| **R-005** | UTF-8 CSV with BOM | Spreadsheet export with Byte Order Mark encoding. | Inferred types match column header formats. | Highly suitable; loaded into the local table engine. | **Verified** |
| **R-006** | Password-protected DOCX | Encrypted Microsoft Word package. | Throws `document_corrupt` AppError with clean exit. | **Unsuitable** until manually decrypted. | **Verified** |
| **R-007** | Mixed-language PDF | Technical documentation mixing ASCII and multi-byte text. | `confidence: "medium"`, normal text output. | Suitable after preview review. | **Verified** |
| **R-008** | PDF with inline math symbols and formulas | Scientific paper with symbols, subscripts, or equations. | Complex equations simplified to plain text. | Moderately suitable; requires manual math markup checks. | **Verified** |
| **R-009** | Large dataset spreadsheet | Large CSV/XLSX export from enterprise systems. | `columns` and `previewRows` populated. | Highly suitable for local filtering and aggregation before AI. | **Verified** |
| **R-010** | Round-tripped converted document | Markdown note exported to PDF, then extracted back to Markdown. | `textLayerDetected: true`, `confidence: "medium"`. | Suitable; structure remains consistent. | **Verified** |

---

## 2. Detailed Verification Records

### R-001: Multi-column PDF
* **File MD5 (Example)**: `d41d8cd98f00b204e9800998ecf8427e`
* **Layout Characteristics**: Alternating single-column abstract and double-column body text blocks.
* **Extraction Result**: Text streams are decompressed and linearized into a single Markdown reading order.
* **Warnings Generated**: `layout_simplified: Complex WPS/Word/PDF multi-column layout was simplified; only text and basic paragraph structure are preserved.`
* **AI Send Gate Recommendation**: Recommended after preview. Content remains cohesive despite column flattening.

### R-002: DOCX with Complex Merged Tables
* **File MD5 (Example)**: `79054025255fb1a26e4bc22271df2454`
* **Layout Characteristics**: Microsoft Word document containing tables with vertical spans and nested tables.
* **Extraction Result**: Converted into standard Markdown tables; nested blocks are flattened.
* **Warnings Generated**: `table_simplified: Tables were converted to Markdown tables; merged cells, row spans, and nested layout details may be simplified.`
* **AI Send Gate Recommendation**: Recommended for text extraction; structural details must be verified manually in the editor.

### R-003: Textless / Scanned Image PDF
* **File MD5 (Example)**: `3a4f6d7e2e8e3d0c2b5b3a6e9a8f4c3d`
* **Layout Characteristics**: Flattened scans of physical receipts or forms containing zero text objects.
* **Extraction Result**: Emits empty or near-empty output with a clear warning.
* **Warnings Generated**: `no_text_layer: This PDF appears to be scanned or image-only; OCR is required before reliable extraction.`
* **AI Send Gate Recommendation**: **Block Send**; prevents silent token waste on empty contexts.

### R-004: PDF with Missing CIDFont Mappings
* **File MD5 (Example)**: `f3ce48522b444380a83a3f15e53e65f1`
* **Layout Characteristics**: Forms or reports using proprietary font encodings.
* **Extraction Result**: Text may contain replacement characters or invalid glyphs.
* **Warnings Generated**: `possible_mojibake: Some characters may have been extracted incorrectly because CID font mappings or encoding metadata are missing.`
* **AI Send Gate Recommendation**: Review required. Content may confuse the model.

### R-005: UTF-8 CSV with BOM
* **File MD5 (Example)**: `e2e8e3d0c2b5b3a6e9a8f4c3d3a4f6d7`
* **Layout Characteristics**: CSV file starting with `\xEF\xBB\xBF` and containing non-ASCII column names.
* **Extraction Result**: BOM stripped automatically; columns imported into the local table engine correctly.
* **Warnings Generated**: None.
* **AI Send Gate Recommendation**: Highly recommended.

### R-006: Password-Protected DOCX
* **File MD5 (Example)**: `9a8f4c3d3a4f6d7e2e8e3d0c2b5b3a6e`
* **Layout Characteristics**: Microsoft Word file encrypted with a standard Office password.
* **Extraction Result**: Fails zip/package decompression with a structured error.
* **Errors Thrown**: `document_corrupt: DOCX format is corrupt, encrypted, or invalid. Confirm the file opens normally in Word or WPS before importing.`
* **AI Send Gate Recommendation**: Locked; cannot send.

### R-007: Mixed-Language PDF
* **File MD5 (Example)**: `2e8e3d0c2b5b3a6e9a8f4c3d3a4f6d7e`
* **Layout Characteristics**: PDF document mixing ASCII and multi-byte characters.
* **Extraction Result**: Text objects are converted to UTF-8 text where mappings are available.
* **Warnings Generated**: Standard layout simplification warnings.
* **AI Send Gate Recommendation**: Recommended after preview.

### R-008: PDF with Inline Math Symbols and Formulas
* **File MD5 (Example)**: `5b3a6e9a8f4c3d3a4f6d7e2e8e3d0c2b`
* **Layout Characteristics**: Mathematical paper containing integral signs, Greek letters, and subscripts.
* **Extraction Result**: Symbols are converted to plain Unicode text when available; formula layout is not preserved.
* **Warnings Generated**: Standard layout simplification warnings.
* **AI Send Gate Recommendation**: Recommended with caution; verify complex equation regions manually.

### R-009: Large Dataset Spreadsheet
* **File MD5 (Example)**: `8f4c3d3a4f6d7e2e8e3d0c2b5b3a6e9a`
* **Layout Characteristics**: CRM or finance export containing many columns and thousands of rows.
* **Extraction Result**: Parsed into the local table engine; columns and preview rows detected correctly.
* **Warnings Generated**: None.
* **AI Send Gate Recommendation**: Highly recommended for local filtering and aggregation before AI.

### R-010: Round-Tripped Converted Document
* **File MD5 (Example)**: `c3d3a4f6d7e2e8e3d0c2b5b3a6e9a8f4`
* **Layout Characteristics**: Markdown document converted to PDF, then extracted back to Markdown.
* **Extraction Result**: Structure remains consistent; headers, paragraphs, and list blocks are aligned.
* **Warnings Generated**: Standard layout simplification warnings.
* **AI Send Gate Recommendation**: Recommended.

---

## 3. Future Layout Recommendations

1. **OCR Quality Expansion**: Keep the optional Tesseract + Poppler path, and improve handwriting, formula, table, and reading-order review without increasing the default runtime dependency footprint.
2. **CIDFont Font Fallback**: Fall back to PDF Font Descriptor structures when CID mappings are missing to mitigate mojibake risk.
3. **Formula-Aware Spreadsheet Review**: Preserve formula metadata as warnings and static values until active formula evaluation is deliberately supported.

---

## 4. Expanded Real-World Layout Samples (RS-016 to RS-020)

To further improve layout regression coverage, five additional default real-world regression samples have been appended to the default library:

| ID | Sample Name | Type | Limit Category | Capabilities Tested | Notes |
|:---|:---|:---|:---|:---|:---|
| **RS-016** | `marketing-deck-embedded-images.pdf` | PDF | `layout` | `safety_gate`, `format_exchange` | Embedded vector diagrams and shapes are omitted from plain-text AI context. |
| **RS-017** | `complex-payroll-pivot.xlsx` | XLSX | `layout` | `ai_intake`, `table_filter` | Pivot tables and multiple merged sub-headers are flattened. |
| **RS-018** | `handwritten-feedback-form.pdf` | PDF | `ocr` | `safety_gate` | Low-contrast handwriting has no trusted digital text layer and needs OCR. |
| **RS-019** | `technical-spec-images.docx` | DOCX | `layout` | `ai_intake`, `format_exchange` | Text content is readable after review; embedded raster illustrations are ignored. |
| **RS-020** | `credentials-leak-blocked.txt` | TXT | `security` | `safety_gate` | Credential-like content is blocked before AI send. |
