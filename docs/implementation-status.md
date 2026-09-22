# Implementation Status

This file is the current release snapshot. It intentionally avoids long historical
change logs so the project stays lightweight for public preview.

## Current Baseline

Current conversion work supersedes the older artifact checks below. Source tests
and the private runtime have passed; older F-012 evidence is not acceptance for
this new candidate. The current EXE/MSI candidates and staged source hashes are
recorded in `.ai-doc-exchange/audit/2026-09-21-content-fixes/build-evidence.json`.
The packaged desktop workflow passed in
`.ai-doc-exchange/logs/content-fixes-desktop-workflow.json`. The two original audit
PDFs and the six-page continuation fixture passed with packaged engines and a
system-only PATH, preserving IDs, independent tables and merged DOCX spans.
This does not replace clean-machine installation acceptance.
Native Word drawings now preserve 684 previously omitted groups in the real
lecture; all 1002 referenced image assets are present and indexed. Word and
ruled PDF table spans survive the shared Markdown/IR/preview/export path.
Conservative borderless numeric tables now enter the same path, preserving
empty cells and verified multi-level header spans. Native grids take precedence.
The fixed development crops match 9/9 table topologies after correcting the
benchmark's nonzero page-origin transform; this is not independent quality acceptance.
Mixed PDF pages can now retain independently supported column bands around
spanning headings, images and tables; IR preserves the extracted source order.
Reading views join eligible cross-page prose only when current text, font and
page-edge geometry agree, with both source pages retained in IR provenance.
Canonical Markdown stays unchanged. Verified repeated page furniture can now
be omitted from the reading view using native edge coordinates and at least
three physical pages. Matching headers and column boundaries also link complete
table rows across adjacent pages, retaining merged cells and per-page provenance.
Business identifiers retain their digits in furniture grouping; explicit folios
must track physical page order. Geometry rejection also survives final cleanup.
Terminal total/subtotal rows prevent continuation into a new table. The two
2026-09-21 audit PDFs now retain all three invoice IDs and three independent Word
tables; evidence: `.ai-doc-exchange/audit/2026-09-21-content-fixes/`.
Hyphenation, split cells across pages and general sidebar layouts remain open.
The reading cleanup now counts distinct physical pages and preserves body
patterns repeated within one page instead of deleting numbered prose as headers.
Remaining gaps include 15 unsupported Word drawing groups, complex
PDF layout/table recognition, editable reconstruction of unknown math glyphs,
native redistribution notices, and a clean-machine installer run.

- Product direction: AI document exchange, not a local extraction utility.
- Visible user entry: Office, PDF, spreadsheet, CSV, TXT, and Markdown files.
- Exchange layer: Markdown plus SDXP packages for provenance, review, and handoff.
- API capability is first-day core: preview, confirmation, Send Gate, and audit.
- npm runtime dependencies: 0. The Windows conversion candidate additionally bundles Python, PDFium/pdfplumber, a source-built Tesseract and Chinese/English data (78,467,613 bytes). These are included in the separate private-runtime size gate; they are not zero-cost dependencies.
- Dev dependencies: 1 (`@tauri-apps/cli`).
- Source files checked by `npm run size-check`: within the revised 263-file budget; see the generated size report for the current count.
- Source bytes: current public-preview source stays within the revised 2.8MB source budget.
- Application code stays within the 1.75MB/132-file budget. Private conversion components have a separate 128 MiB budget. Node, browser assets, native shell and installer sizes must also be included when reporting total distribution size.
- Lightweight size budget: enforced by `npm run size-check` with 0 runtime dependencies, at most 1 dev dependency, 1.75MB runtime budget, 2.8MB source budget, 125KB largest-file budget, 125KB runtime largest-file budget, 100KB public browser module budget, 132 runtime files, 263 checked source files, and 58,500 total source lines.
- The size gate warns when source bytes exceed 80%, when the largest source file exceeds 90%, when the largest runtime file exceeds 90%, and when the largest public browser module exceeds 90% of its budget.
- The budgets were revised upward on 2026-09-23 to match measured growth (runtime 1,727,063 bytes / 132 files, source 2,768,021 bytes / 58,362 lines / 263 files). The revision is a measurement sync, not an acceptance claim. The 125KB largest-file budget leaves `src/adapters/pdfLayoutExtractor.py` (123,611 bytes, 2,589 lines) at 98.9% of budget; a structural split is deferred because it would change the audited buildId.

## Verified Commands

- `npm test`: 549 tests, 548 pass, 1 skipped manual external-sync scenario (2026-09-21). Current log: `.ai-doc-exchange/implementation/2026-09-21-completion/full-packaged-final.txt`.
- `npm run smoke`: passed exchange package read-back plus receiver/trust report writing.
- Fixture results: 11 `pass` and 1 `known_limit` after current-artifact F-012 desktop verification on 2026-09-15.
- `npm run fixture-check`: passed.
- `npm run fixture-check -- --strict`: passed after F-012 closure.
- `npm run size-check`: passed with 0 runtime dependencies and 1 dev dependency.
- `npm run cleanup-artifacts`: dry-run guard covers test, quickstart workspace, unresolved temp-variable, contract, doctor, integrated doctor, and desktop runtime artifacts.
- `npm run root-clean-check`: check-only guard passed with no root process artifacts.
- `npm run large-intake-check`: passed the 7900-page synthetic intake fixture.
- `npm run language-boundary-check`: passed default runtime/release-doc English boundary checks and blocks mojibake everywhere.
- `npm run ui-check`: passed visible UI text, DOM ids, module imports, offline font stack, and mojibake guard.
- `npm run web-ui-smoke`: passed served HTML, split JS modules, CSS, runtime config, and `/api/health`.
- `npm run release-check`: passed automatic release gates.
- `npm run release-readiness`: passed in public-preview mode with no blocking items for the verified artifact.
- `npm run public-preview-package -- --json`: generates the public-preview installer handoff using the current release gates.
- `npm run release-artifacts`: reports app/MSI/NSIS byte counts and SHA-256 hashes.
- `npm run release-index`: refreshes `docs/release-artifact-index.md` and `samples/release-artifact-index.json`.
- `npm run desktop:app-smoke -- --check-only`: passed packaged executable path validation.
- `npm run desktop:workflow-smoke -- --check-only`: passed packaged workflow entrypoint validation.
- `npm run desktop:ai-summon-smoke`: passed desktop-window AI summon bridge, source-aware Send Gate wiring, local clipboard masking API routing, and workspace-free local mask API coverage.
- `npm run desktop:bridge-smoke`: passed packaged runtime bridge validation.
- Rust/MSVC are available and current-source internal candidates can be built. Public release remains blocked on complete-runtime notices and clean-machine acceptance; older installer checks do not certify this candidate.

## Implemented Product Surface

- Workspace layout and `.ai-doc-exchange/manifest.json`.
- Workspace path guard for scoped reads and writes.
- Document import for Markdown, TXT, DOCX, PPTX, PDF, CSV, and XLSX.
- Markdown read/write, version history, and export.
- Human-readable Markdown post-processing with automatic long-document index and numbered part files.
- Long-document readable segment source maps (`*.source-map.json`) with source line ranges, part paths, headings, and character counts for later visual verification and parser-adapter mapping.
- Markdown to DOCX and PDF export with tables, native/rendered math, and embedded local visual assets.
- Direct document-to-format conversion through Markdown where supported.
- Dataset inspection, table preview, and in-memory SQL query flow.
- In-memory query engine with filters, sorting, and simple INNER JOIN support.
- Optional adapter capability detection for LibreOffice, Pandoc, Marker, Tesseract, pdfplumber, and Poppler through `/api/adapter/capabilities`, CLI, SDK, and UI.
- Adaptive PDF extraction: built-in text streams remain the zero-dependency baseline; formula-encoding damage triggers the explicit pdfplumber layout path, which now emits physical-page records, bounded page-window status, geometry-backed image/table/formula regions, and linked visual assets; scanned/image-only PDFs can run local page OCR when Tesseract and Poppler are available.
- Real-material page evidence (`.ai-doc-exchange/audit/2026-09-20-followup/m1-page-backend-evidence.json`) covers 585/585 pages. Symbol/Lucida private-use leakage is cleared on the 585-page sample; 13 unconfirmed CID glyphs remain explicitly marked for source-page visual fallback rather than guessed text.
- PDF visual maps retain formula/table/image page coordinates. Low-confidence formulas use traceable source crops; ordinary scientific tables are reconstructed from ruled or aligned columns; formula-dense tables use a faithful whole-table image; vector figures exclude surrounding prose and keep searchable captions as text.
- `scientific` retry batches uncertain formula crops through the local Surya math recognizer and promotes validated results to editable LaTeX while retaining image fallback evidence. Marker remains the opt-in full-page reconstruction path.
- PDF table-of-contents lines are split into chapter and entry blocks before readable-Markdown paragraph joining. PDF visual/table/math markers are protected structural blocks and cannot be merged into surrounding prose.
- External Markdown export includes referenced local assets in a sibling portable asset directory.
- API profiles without persisted API keys.
- Local API, CLI, SDK, Web UI, and Tauri Desktop shell entrypoints.
- First-run Office/Markdown product mode selection.
- Source-aware AI summon key and desktop AI summon bridge with local clipboard masking before staging.
- Workspace Dashboard with inbox, timeline, settings, quality, versions, AI context, and exchange package summaries.
- `policyMode` metadata for open-core, team, and enterprise policy boundaries.
- CLI release/runtime coverage is consolidated in the main CLI release gate test, with desktop verification and desktop preflight coverage split into focused files and shared through a CLI harness.
- Server API coverage is split across focused base, document-exchange, and AI/query test files with a shared local server harness.
- Release checks keep AI context assertions in a dedicated module instead of the general part-2 release gate.

## AI Intake And Send Gate

- AI Will See preview shows selected content, estimated tokens, masking signals, quality warnings, and Send Gate decision.
- Confirmed sends require explicit user confirmation and are blocked for `review_required` content.
- Confirmed sends blocked by Send Gate write `ai_send_blocked` and `api_send_blocked` evidence without a network request.
- API send evidence stores hashes, policy decision, model/endpoint summary, and `aiSent` status, not API keys or raw prompt bodies.
- `POST /api/ai/prepare-record` prepares document and dataset records before AI review.
- `/api/ai/intake-plan` returns a content-free intake manifest with body-free `feedingPlan`, `batchPlanPreview`, `nextRangeCommand`, `sendAllowedAfterReview`, progress, and structured `continuation` metadata.
- `/api/ai/context-chunk` and `/api/ai/context-range` resolve reviewed chunks or ranges on demand; long-document chunk resolution is not limited to the first manifest preview window.
- `ai-context ... --summary` prints continuation metadata without dumping chunk bodies.
- `ai_context_chunk_selected` evidence records selected chunk/range metadata with `aiSent: false`, content hash, token estimate, and selection range.
- `/api/ai/feed-runbook`, `/api/ai/feed-runbook/status`, and `updateAiFeedRunbookBatch` support body-free long-document queue recovery with planned, pulled, reviewed, sent, skipped, and blocked batch state.
- background range feeding is supported for large documents while keeping Send Gate review required per batch.
- `/api/ai/handoff-bundle` saves a reviewed AI Handoff Bundle with staged context, chunk ledger, prompt, return contract, and evidence references.
- `/api/ai/result/write-back` writes AI responses back into Markdown Exchange records with audit references.
- `/api/ai/query-context` prepares filtered table context for AI after local SQL filtering.
- `/api/ai/query-handoff` and `client.saveQueryAiHandoffBundle` write reviewed filtered table context directly into an AI Handoff Bundle.
- Filtered table evidence uses `ai_query_context_selected` and safe `queryShape` metadata instead of raw SQL or full result rows.

## SDXP Exchange Package

- SDXP package generation writes `manifest.json`, `document.md`, `document.schema.json`, `evidence.jsonl`, optional exports, optional tables, and receiver-facing reports.
- Exchange packages can be created directly from prepared records through `/api/exchange-packages/from-record`, CLI, SDK, and UI, with the singular route kept as a compatibility alias.
- Read-back verification checks hashes, provenance, evidence, unsafe paths, and Send Gate summary.
- Receiver/trust report generation writes `receiver-report.md` and `trust-report.json`.
- Trust verdicts are `trusted`, `trusted_with_warnings`, or `blocked`.

## Workspace Handoff Summary

- `POST /api/workspace/manifest` compiles a safe workspace handoff summary.
- The summary includes `aiContextSelections`, `aiHandoffBundles`, exchange package counts, receiver/trust report status, safe selection range details, remaining continuation metadata, and safe `queryShape` values.
- It does not expose staged context bodies, raw SQL text, table rows, API keys, or raw prompts.

## Desktop Release State

- Windows public-preview artifacts exist for the complete portable ZIP, MSI, and NSIS; a bare `app.exe` is not distributed without its sibling runtime.
- Desktop runtime bridge auto-starts the local JS runtime from packaged resources when possible.
- Native workspace and supported-file picker hooks exist.
- Desktop diagnostics report Node/runtime/API status.
- F-012 passed strict verification on 2026-09-15 for app SHA-256 `7886b313f0420fca23f9466764059b8be48a850b25a0fa33a14a09dfeac2ed2e`. The record and UI evidence are in `output/desktop-unblock-v0.1.4/`; closure records the verification file hash in `samples/fixture-results.json`.
- The verified packaged app uses bundled Node v22.20.0. Verification ran on the developer Windows machine; clean-machine installer certification remains separate.
- Visible verification covered native pickers, first-workflow package read-back, two-sheet XLSX switching, decoded PPTX/PDF images, save cancellation, and complete six-part HTML export. Root-relative XLSX worksheet targets are resolved correctly.

## Conversion Completion Increment (2026-09-21)

The completion review invalidated earlier claims that all Q00–Q09 quality work was finished. The current implementation and evidence distinguish delivered functions from unresolved quality categories.

- Cross-page tables require explicit table identity or continuous row identifiers. Repeated headers alone remain candidates. Real hyphens and URLs are retained; soft hyphens or an independently present source word can establish dehyphenation. Indented Chinese paragraphs remain separate.
- Same-page raster regions receive bounded OCR with crop/rotation/deskew transforms, source coordinates, native-text priority and per-page region cache identity. Proven ruled grids can retry individual cells with light background removal. Unresolved regions retain source assets and review status.
- Native text, multiline and sparse tables preserve unique word assignments. Filled header fragments do not create artificial grid boundaries. Scanned ruled tables retain partial header rules and spans. General complex borderless and cross-page split-cell recovery remain incomplete.
- Native geometry reaches DocumentIR. Local caption/sidebar/footnote constraints are applied to the canonical Markdown order shared by readable output, chunks and exports. Conflicting constraints preserve source order. Uncertain continuation decisions and current source hashes reach persisted quality reports.
- Authored positive/negative fixtures protect behavior; they are development evidence. W3C's table entered the development set after its first failure. The revised native and scanned 6-by-6 grids match source expectations. A separate W3C two-column page passes order checks in raw/readable/Word output. The Docling report's complex table remains a source-linked visual fallback and fails semantic-table acceptance.
- A 125-page local PDF passes cancellation/resume, complete physical coverage, warm reuse and single-corrupt-page repair. This does not certify every character or formula in the book.
- Orphan Word list levels now start at a valid Markdown indentation, preserving two previously code-formatted image references in the real Word export. Contiguous nested lists retain hierarchy.
- Word drawing support retains the 684/699 visual baseline. All 15 remaining image-less groups contain private-use characters absent from their declared local font; they are not preserved images or verified editable formulas. Original-source retention remains available.
- TableFormer Fast remains outside the product: its fixed experiment and resource footprint do not justify admission. Model research is not equivalent to default integration.
- Runtime source budget is 1.75 MB / 132 files; source/tests/docs budget is 2.8 MB / 58,500 lines / 263 files. This covers one region-processing module and regression fixtures. No application dependency or model weight was added. The private conversion runtime remains 78,467,613 bytes under its unchanged 128 MiB budget.
- Internal build evidence is recorded under `.ai-doc-exchange/implementation/2026-09-21-completion/`. Public release remains blocked by complete redistribution provenance and clean Windows installation/offline/uninstall evidence. No public artifact is replaced.

## Security And Privacy Baseline

- API keys are used only for confirmed sends and are not persisted.
- AI preview does not send network requests.
- Evidence records store hashes, decisions, timestamps, and policy snapshots, not raw secrets.
- Exchange audits store summaries only.
- Local HTTP API requires an in-process token served to the local UI.
- File reads and writes are workspace-scoped through path guards.
- Enterprise hooks are reserved for DLP policy packs, custom Send Gate rules, audit retention, private deployment, access control, model routing, and compliance evidence.

## Known Limits

- DOCX/WPS adapter reads OOXML document relationships, preserves `word/media` images as local Markdown assets, and converts common OMML equations to editable LaTeX. Styles and basic tables are simplified; SmartArt, OLE objects, complex floating layout, comments, revisions, macros, and VBA are not executed.
- Markdown to DOCX is structural, not layout-perfect.
- Markdown to PDF uses the printable offline HTML/KaTeX pipeline for tables, math, fonts, and local images when Chromium/Edge is available. Renderer failure is explicit; production no longer silently falls back to a degraded text-only PDF.
- XLSX formulas are not executed.
- CSV parser is intentionally small and not a full RFC implementation.
- Scanned PDFs use the optional local OCR adapter when installed; handwriting and complex mathematical OCR still require visual review. Tesseract is not installed in the current machine environment.
- Arbitrary PDF equations cannot always become editable LaTeX. The pipeline preserves uncertain formulas as source-linked visual regions rather than inventing text.
- Real network verification depends on user-provided API credentials and endpoint.

## Next Engineering Step

Close the M1 quality gap before adding more format breadth:

1. Compare geometry-path output against held-out double-column and mixed-layout pages, with formula damage and image/table asset evidence.
2. Keep `npm test`, `npm run release-check`, and `npm run root-clean-check` green; repeat current-artifact desktop verification whenever a later rebuild invalidates F-012 evidence.
3. Package the selected Python/PDF/OCR runtime or record the explicit installation boundary; do not treat the development runtime as a product dependency.
4. Wire page-window checkpoints into production scheduling and close the single-revision commit protocol before claiming reliable resume.
