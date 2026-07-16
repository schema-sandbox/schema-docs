# Implementation Status

This file is the current release snapshot. It intentionally avoids long historical
change logs so the project stays lightweight for public preview.

## Current Baseline

- Product direction: AI document exchange, not a local extraction utility.
- Visible user entry: Office, PDF, spreadsheet, CSV, TXT, and Markdown files.
- Exchange layer: Markdown plus SDXP packages for provenance, review, and handoff.
- API capability is first-day core: preview, confirmation, Send Gate, and audit.
- Runtime dependencies: 0.
- Dev dependencies: 1 (`@tauri-apps/cli`).
- Source files checked by `npm run size-check`: 183, within the 195-file budget.
- Source bytes: current public-preview source stays under the 1.7MB source budget.
- Runtime bytes: current public-preview runtime stays under the 1.16MB runtime budget across 97 files, within the 100-file budget.
- Lightweight size budget: enforced by `npm run size-check` with 0 runtime dependencies, at most 1 dev dependency, 1.16MB runtime budget, 1.7MB source budget, 100KB largest-file budget, 125KB runtime largest-file budget, 100KB public browser module budget, 100 runtime files, 195 checked source files, and 38,500 total source lines.
- The size gate warns when source bytes exceed 80%, when the largest source file exceeds 90%, when the largest runtime file exceeds 90%, and when the largest public browser module exceeds 90% of its budget.

## Verified Commands

- `npm test`: 329 tests, 328 pass, 1 skipped manual external-sync scenario.
- `npm run smoke`: passed exchange package read-back plus receiver/trust report writing.
- `npm run fixture-smoke`: passed with 10 `pass`, 1 `known_limit`, and 1 `blocked` pending current-artifact desktop verification.
- `npm run fixture-check`: passed.
- `npm run fixture-check -- --strict`: expected to fail until F-012 is closed for the current desktop artifact.
- `npm run size-check`: passed with 0 runtime dependencies and 1 dev dependency.
- `npm run cleanup-artifacts`: dry-run guard covers test, quickstart workspace, unresolved temp-variable, contract, doctor, integrated doctor, and desktop runtime artifacts.
- `npm run root-clean-check`: check-only guard passed with no root process artifacts.
- `npm run large-intake-check`: passed the 7900-page synthetic intake fixture.
- `npm run language-boundary-check`: passed default runtime/release-doc English boundary checks and blocks mojibake everywhere.
- `npm run ui-check`: passed visible UI text, DOM ids, module imports, offline font stack, and mojibake guard.
- `npm run web-ui-smoke`: passed served HTML, split JS modules, CSS, runtime config, and `/api/health`.
- `npm run release-check`: passed automatic release gates.
- `npm run release-readiness`: currently fails only on F-012 because the rebuilt desktop artifact still needs visible desktop verification.
- `npm run public-preview-package -- --json`: writes the public-preview installer handoff but exits blocked until F-012 is closed.
- `npm run release-artifacts`: reports app/MSI/NSIS byte counts and SHA-256 hashes.
- `npm run release-index`: refreshes `docs/release-artifact-index.md` and `samples/release-artifact-index.json`.
- `npm run desktop:app-smoke -- --check-only`: passed packaged executable path validation.
- `npm run desktop:workflow-smoke -- --check-only`: passed packaged workflow entrypoint validation.
- `npm run desktop:ai-summon-smoke`: passed desktop-window AI summon bridge, source-aware Send Gate wiring, local clipboard masking API routing, and workspace-free local mask API coverage.
- `npm run desktop:bridge-smoke`: passed packaged runtime bridge validation.
- `npm run desktop:build`: produced Windows MSI/NSIS bundles.

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
- Adaptive PDF extraction: built-in text streams remain the zero-dependency baseline; formula-encoding damage triggers pdfplumber layout recovery; scanned/image-only PDFs can run local page OCR when Tesseract and Poppler are available.
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
- F-012 desktop verification is intentionally open after the latest desktop rebuild and must be closed with strict verification evidence before public tagging.
- Clean-machine standalone posture is Node-resource based; the rebuilt packaged app still needs current-artifact visible verification before public tagging.

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
- Scanned PDFs use the optional local OCR adapter when installed; handwriting and complex mathematical OCR still require visual review.
- Arbitrary PDF equations cannot always become editable LaTeX. The pipeline preserves uncertain formulas as source-linked visual regions rather than inventing text.
- Real network verification depends on user-provided API credentials and endpoint.

## Next Engineering Step

Keep the public-preview core stable while reducing size pressure:

1. Keep `npm test`, `npm run release-check`, and `npm run root-clean-check` green; `npm run release-readiness` should turn green only after F-012 is manually closed for the current artifact.
2. Avoid new runtime dependencies; prefer optional adapters behind explicit capability checks.
3. Split or trim large files before adding broad features.
4. Keep default runtime UI and release docs English-only.
