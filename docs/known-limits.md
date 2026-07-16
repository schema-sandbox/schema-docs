# Known Limits Registry

This page documents the known limits of the Schema Docs document exchange pipeline. These limitations are machine-readable and mapped to automated warnings.

## Recent Adapter Limits

- `ocr_adapter_missing`: scanned PDF extraction needs the optional Tesseract OCR adapter or an upstream text-layer PDF.
- `legacy_office_adapter_required`: legacy Office files need LibreOffice (`soffice`) or export to DOCX/XLSX/PDF before import.

## Registry Table

| ID | Area | Format | Severity | User Message & Workaround |
|----|------|--------|----------|---------------------------|
| `ocr_unsupported` | Extraction | PDF | High | A scanned PDF requires the optional local Tesseract + Poppler OCR path or an upstream searchable PDF before reliable AI review.<br>*Workaround:* Install the optional OCR tools or create a searchable PDF with another trusted OCR tool. |
| `ocr_adapter_missing` | Extraction | PDF | High | Scanned PDF extraction needs the optional Tesseract OCR adapter or an upstream text-layer PDF.<br>*Workaround:* Install Tesseract OCR, or export/scan the document as a searchable text-layer PDF before importing. |
| `complex_pdf_layout` | Extraction | PDF | Medium | Complex PDF layout may be simplified. Review the extracted text block order manually.<br>*Workaround:* Check sequence in markdown editor. |
| `pdf_rich_objects_unsupported` | Extraction | PDF | Medium | Basic text extraction does not fully reconstruct rich objects. The adaptive pipeline preserves uncertain images, formulas, and tables as source-linked visual assets, while annotations and embedded objects may remain source-only.<br>*Workaround:* Review retained source pages and visual assets before final use. |
| `docx_comments_revisions` | Extraction | DOCX | Low | Word comments and revision history are not preserved; only the final body text is extracted.<br>*Workaround:* Accept all changes first. |
| `docx_rich_layout_unsupported` | Extraction | DOCX | Medium | Embedded images and common OMML formulas are preserved, but SmartArt, OLE objects, floating text boxes, comments, revisions, and complex page layout are not fully represented in Markdown.<br>*Workaround:* Keep the original DOCX for final layout review. |
| `docx_macros_vba_unsupported` | Extraction | DOCX | High | Macros, VBA, and scripts are not executed or preserved; Schema Docs extracts static readable content only.<br>*Workaround:* Run or export macro-generated content in Office/WPS first, then import the static result. |
| `wps_proprietary_formats` | Extraction | WPS | Medium | WPS proprietary formats are not supported natively. Save as standard .docx first.<br>*Workaround:* Convert to .docx first. |
| `legacy_office_adapter_required` | Import | doc, xls, ppt, odt, ods, odp, wps | Medium | Legacy Office files need LibreOffice (soffice) or must be exported to DOCX/XLSX/PDF before import.<br>*Workaround:* Install LibreOffice, or save the file as .docx, .xlsx, .pdf, .md, .txt, or .csv first. |
| `xlsx_formulas_omitted` | Query | XLSX | Medium | Excel formulas are not executed; only the latest cached calculated cell values are extracted.<br>*Workaround:* Refresh or save spreadsheet to calculate. |
| `sql_advanced_join_limited` | Query | CSV, XLSX | Medium | Offline queries support simple INNER JOIN. Complex JOINs, subqueries, and HAVING still require staged queries or export processing.<br>*Workaround:* Use simple INNER JOIN equality or split complex relational work into multiple steps. |
| `realtime_sync_unsupported` | Sync | All | Medium | Real-time two-way sync is not supported. Use manual refresh or import actions.<br>*Workaround:* Click refresh dashboard. |
| `pdf_export_renderer_required` | Export | PDF | Low | Styled A4 PDF export requires a local Edge or Chromium executable. It preserves rendered math, tables, and local images, but it is not a pixel-perfect reproduction of arbitrary source-page layout.<br>*Workaround:* Install or enable Edge/Chromium, or export HTML/DOCX when no supported browser renderer is available. |
| `clean_machine_standalone` | Standalone | Desktop | Medium | The Windows package includes a bundled Node runtime resource, but broader clean-machine verification is still required before calling the desktop app polished.<br>*Workaround:* Run Desktop diagnostics and the first workflow check after install; report startup/runtime failures with the generated diagnostics. |
