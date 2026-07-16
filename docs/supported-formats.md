# Supported Formats

## v0.1.0 Core & Optional Adapters Target

Schema Docs installs with **zero npm runtime dependencies**. Core parsing utilities run natively in Node.js/JavaScript with bundled offline assets, while heavier third-party conversion binaries are treated as **Optional System-level Adapters** that degrade gracefully. Styled PDF export is the explicit exception: it invokes a local Edge or Chromium executable and reports a clear error when neither is available.

| Format | Status | Core Conversion (No Dependencies) | Optional Adapter Boundary |
| :--- | :--- | :--- | :--- |
| `.md` | Core | Read, write, and export workspace notes natively. | None |
| `.txt` | Core | Read and normalize plain text natively. | None |
| `.csv` | Core | Normalization, type inference, local memory SQL query. | None |
| `.docx` | Core | Paragraphs, headings, lists, simple table parsing. | **Pandoc**: Detected only; rich conversions remain outside the zero-dependency core. |
| `.pptx` | Core | Slides in presentation order, titles, text boxes, raster images, editable tables, and speaker notes. | Charts, SmartArt, animations, transitions, masters, and exact positioning remain source-only rich objects. |
| `.pdf` | Core + optional enhancement | Built-in text extraction, readability checks, formula-encoding diagnostics, and source-preserving visual maps. | **Scientific refinement** combines pdfplumber layout recovery with batched local Surya formula OCR. **Marker** performs full-page reconstruction. **Poppler** renders mapped regions. **Tesseract OCR + Poppler** handles scanned PDFs. |
| `.xlsx` | Core | Minimal first-sheet shared-string preview. | None |
| Legacy | None | None | **LibreOffice (soffice)**: Detected as the optional path for `.doc`/`.xls`/`.ppt`; otherwise export to modern formats first. |

### Warnings and Graceful Degradation (No Silent Failures)
If an optional system-level adapter (soffice, pandoc, Marker, pdfplumber, Poppler, or Tesseract) is missing on the environment:
- The app **does not fail silently**. It returns structured warnings in the conversion payload.
- In the UI, warning alerts are displayed (e.g. *"No text layer: this PDF may be scanned and needs OCR before full extraction"*).
- In the API, conversion response objects populate `warnings` arrays and downgrade `quality.confidence`.

### Core Limitations & Formatting Boundaries
- **DOCX/WPS Images and Formulas**: Embedded raster images are copied into local Markdown assets. Native Word/WPS OMML equations are converted to editable LaTeX for common fractions, scripts, radicals, integrals, delimiters, accents, and matrices. SmartArt, OLE objects, text-box-heavy layouts, comments, revisions, macros, and VBA still require review against the original `.docx`.
- **PPTX Reading Order**: Slide titles, text boxes, images, tables, and speaker notes are preserved in slide order. Exact canvas positioning, charts, SmartArt, animations, transitions, theme masters, embedded objects, and macros require review against the original presentation.
- **XLSX/Spreadsheet Formulas**: The core XLSX parser extracts raw cell values only; formulas are **not** executed or evaluated.
- **Formula-heavy digital PDFs**: Layout-aware extraction is tried when the built-in stream contains damaged octal/CID math encoding. Low-confidence formulas, tables, and images retain page coordinates and can be materialized as PNG sidecar assets without guessing their content.
- **Editable scientific Markdown**: Retry with `scientific` to keep the fast text/layout path while converting uncertain formula crops into editable LaTeX with the local Surya model. Failed formula recognition remains a source-linked image. Retry with `marker` when full-page reconstruction is required. Both modes are local and can take hours on multi-thousand-page books.
- **Complex scientific tables**: Ordinary ruled/aligned tables remain editable Markdown. Formula-dense or nested tables are preserved as one high-resolution table image instead of emitting structurally invalid Markdown.
- **Portable Markdown assets**: External Markdown export copies local formula, table, and figure assets into a sibling `<document>.assets` directory and rewrites links relative to the exported file.
- **Scanned PDFs**: When Tesseract, `pdftoppm`, and `pdfinfo` are available, the pipeline performs local page OCR and keeps page markers plus explicit failed-page notices. Without those tools, Send Gate remains blocked instead of accepting unreadable text.

---

## Document Exchange Matrix

The local API exposes this matrix as the document capability contract. Direct document-to-format exports validate against this matrix before writing files, and conversion audit summaries store the matching `mode`, `quality`, and current limits.
Each direct document-to-format export also creates a minimal evidence record with input/output SHA-256 hashes and a local-only policy decision. Evidence is indexed in the manifest and appended to `.ai-doc-exchange/logs/evidence.jsonl`.

* **AI Send Gate Guard**: All API payload submissions (`POST /api/ai/send`) must pass the **Send Gate** check.
* **Selection vs Send**: Local AI context selection (`ai_context_chunk_selected`) is a staging metadata event; it is *not* an active AI send event. No content is sent to the model provider until a user explicitly approves and signs the Send Gate prompt.

| From | To | Status | Notes |
| :--- | :--- | :--- | :--- |
| Markdown | Markdown | Direct | Copy or normalize as workspace Markdown. |
| Markdown | DOCX | Rich | Word export with headings, paragraphs, lists, Markdown tables, native Office math, and embedded local images. |
| Markdown | HTML | Printable | HTML: printable styled export with clean CSS typography. |
| Markdown | PDF | Printable | Offline HTML-backed A4 PDF with text, tables, rendered math, embedded formula fonts, and embedded local images. Requires Chromium/Edge; renderer failure is reported instead of silently returning a degraded text-only file. |
| DOCX | Markdown | Basic | Reads `word/document.xml`, paragraphs, headings, simple tables. |
| DOCX | DOCX | Via Markdown | Normalized DOCX output. |
| DOCX | PDF | Via Markdown | DOCX -> Markdown -> PDF. |
| PPTX | Markdown | Basic | Slide order, titles, text, images, tables, and speaker notes become readable Markdown. |
| PPTX | DOCX/PDF/HTML | Via Markdown | PPTX -> Markdown -> selected document format; slide canvas positioning is intentionally simplified. |
| PDF | Markdown | Adaptive | Uses built-in text first, then layout-aware recovery for damaged math fonts, and OCR for image-only pages when optional adapters are installed. Visual regions remain traceable to source pages. |
| PDF | DOCX | Via Markdown | PDF -> Markdown -> DOCX with recovered tables, native editable math where reliable, and embedded visual fallbacks for uncertain formulas and figures. |
| PDF | PDF | Via Markdown | Normalized printable PDF output; source page geometry is reflowed through Markdown rather than reproduced pixel for pixel. |

---

## Out Of Scope For MVP

- Pixel-perfect editable reconstruction of arbitrary PDF page layout. Visual fallback assets are preserved, but automatic conversion of every equation image into editable LaTeX remains adapter-dependent.
- Preservation of arbitrary fonts embedded in imported source documents; the PDF exporter embeds its own text/math font subsets but does not reproduce every source font.
- WPS-specific binary formats.
- Auto-execution of Office VBA macros.

## API

| Capability | Status | Notes |
| :--- | :--- | :--- |
| Document capability manifest | Implemented | `/api/capability/manifest` exposes a SIP-style local capability contract. |
| Semantic document exchange routes | Implemented | `/api/ingest`, `/api/extract`, `/api/normalize`, and `/api/export/md|docx|pdf` wrap the core workflow. |
| Evidence record lookup | Implemented | `GET /api/evidence/{id}` returns one evidence summary by id inside the selected workspace. |
| OpenAI-compatible chat API | Implemented | Requires user confirmation before sending. |
| API payload preview | Implemented | Shows content hash, length, estimated tokens, target model, endpoint, API key source status, and lightweight Send Gate signals; `review_required` content is blocked from confirmed send. |
| AI intake plan | Implemented | `/api/ai/intake-plan` returns chunk ids, character ranges, token estimates, a body-free feeding plan, body-free batch plan preview, default range budget, estimated batch count, quality warnings, Send Gate status, next chunk command, next range command, and continuation metadata without returning document body. |
| AI feed runbook | Implemented | `/api/ai/feed-runbook` writes a body-free Markdown/JSON runbook with every planned range batch, resume command, API range payload metadata, and Send Gate-per-batch requirements for long-document handoff; `/api/ai/feed-runbook/status` and `/api/ai/feed-runbook/batch` support resumable batch status updates without document body text. |
| Selected AI context chunk | Implemented | `/api/ai/context-chunk` returns one reviewed Markdown/context chunk for staged Send Gate review and large-document intake, including valid chunk indexes beyond the manifest preview window, next-chunk metadata, progress metadata, and local selection evidence without storing raw chunk text. |
| Selected AI context range | Implemented | `/api/ai/context-range` returns a token-budgeted bundle of consecutive chunks for staged multi-chunk Send Gate review, including later chunk ranges derived on demand, next-range metadata, progress metadata, Web/Desktop one-click append controls, and local selection evidence without storing raw range text. |
| Filtered table AI context | Implemented | `/api/ai/query-context` runs local SQL over inspected CSV/XLSX data, including simple INNER JOIN queries, renders the filtered result as Markdown context before Send Gate review, and writes local selection evidence without storing raw SQL result rows. `/api/ai/query-handoff` and `query-ai-handoff` save that reviewed filtered result directly as an AI Handoff Bundle. |
| AI result write-back | Implemented | `/api/ai/result/write-back` writes the AI answer back into a Markdown Exchange record with selected context plus optional audit/evidence references. |
| Local secret masking | Implemented | Masks emails, phone numbers, IP addresses, labeled secrets, standalone `sk-`/`key-` tokens, Bearer tokens, common cloud access key ids, and credential-labeled UUID tokens before Send Gate review. |
| API key storage | Not implemented | Key is only entered for the current Web UI send action. |

## Evidence

| Capability | Status | Notes |
| :--- | :--- | :--- |
| Document conversion evidence | Implemented | Stores input file hash, output artifact hash, converter id, output type, and local-only policy decision. |
| AI preview evidence | Implemented | Stores selected content hash and preview-only policy decision. |
| AI context selection evidence | Implemented | Chunk/range selection stores `ai_context_chunk_selected` / `ai_context_range_selected` evidence with `aiSent: false`, content hash, token estimate, Send Gate decision, selection range, continuation metadata, and timeline linkage; raw selected Markdown is not stored. |
| Filtered table context evidence | Implemented | Query context selection stores `ai_query_context_selected` evidence with `aiSent: false`, context hash, token estimate, truncation signal, safe `queryShape` metadata, and timeline linkage; raw SQL text and result rows are not stored. |
| AI send evidence | Implemented | Stores selected content hash, user-confirmed policy decision, and `aiSent: true`; blocked Send Gate attempts store `ai_send_blocked` / `api_send_blocked` evidence and audit records with `aiSent: false`. Neither path stores API key or raw prompt. |
| Append-only evidence log | Implemented | Writes each evidence record to `.ai-doc-exchange/logs/evidence.jsonl`; deletion only removes the manifest index entry. |
| Markdown exchange evidence block | Implemented | Exchange packages can include the audit-linked evidence summary as a JSON block. |
| Directory-based exchange package | Implemented | Writes and verifies `document.md`, `document.schema.json`, enriched `manifest.json` with asset hashes, hashed `evidence.jsonl`, `exports/`, `tables/`, and `assets/`; query results become `tables/query_result.csv` / `.md`, requested exports become `exports/document.docx` / `.pdf`, and receiver handoff can write `receiver-report.md` plus `trust-report.json`. |

---

## Local SQL Query Engine Syntax Boundary

The local SQL query engine runs natively in JavaScript for local CSV/XLSX table filtering. It supports a restricted SQL subset:

* **Supported Operations**:
  - `SELECT` column list or expression aliases
  - Single `WHERE` comparison (e.g., `=`, `>`, `<`, `>=`, `<=`, `!=`) or `LIKE` pattern matching
  - `GROUP BY` with single or multiple columns
  - `ORDER BY` sorting (supports column aliases)
  - `LIMIT` row clipping
  - Aggregation functions: `COUNT()`, `SUM()`, `AVG()`, `MIN()`, `MAX()`
  - Simple `INNER JOIN ... ON ...` (using qualified column names)
* **Unsupported Operations**:
  - Compound `WHERE` conditions (e.g., using `AND` / `OR`)
  - Subqueries
  - `HAVING` filters
  - Complex JOIN types (e.g., `OUTER JOIN`, multiple joins)
