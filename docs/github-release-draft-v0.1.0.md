# Schema Docs v0.1.0 Public Preview

> **Before sending a document to AI, see what AI will see.**

Schema Docs is a local-first document intake layer for people who already use AI with files. Import Word, PDF, Excel, CSV, TXT, or Markdown; convert locally into AI-readable context; mask sensitive content; review the exact AI payload; block unsafe sends; and save a verifiable SDXP handoff package.

This is a public preview. The goal is not to replace Office or become a full layout-preserving converter. The goal is to make the moment before a document enters AI safer, cleaner, faster, and auditable.

## Who Should Try It

- People already uploading PDFs to Claude, pasting contracts into ChatGPT, or sending spreadsheet slices to Gemini.
- Analysts, researchers, writers, legal, finance, and consulting users who need clean AI context from local files.
- Teams that want a local review point before employees send documents to external or private AI tools.
- Developers building API-first document and AI workflows.

## What Is Included

- Local import for Word, PDF text-layer, Excel, CSV, TXT, and Markdown.
- AI Will See preview with token estimate and quality warnings.
- Local masking for emails, phone numbers, IP addresses, API keys, bearer tokens, cloud key ids, and credential-like UUIDs.
- Send Gate blocking for risky confirmed sends.
- Filtered table context through local SQL before AI review.
- Long-document intake plans and body-free runbooks for progressive feeding.
- Human-readable Markdown split into clickable numbered part files for long documents.
- Single-click Markdown reading-view edits preserve the original Markdown and LaTeX source instead of editing rendered formula text.
- Offline styled A4 PDF export with CJK text, rendered formulas, tables, embedded formula fonts, and local images through Edge/Chromium.
- SDXP exchange packages with Markdown, manifest, evidence, receiver report, and trust report.
- Local CLI, HTTP API, SDK, Web UI, and Windows desktop artifacts.
- Zero installed npm runtime dependencies in the JavaScript core; offline assets are bundled and styled PDF invokes local Edge/Chromium.

## Windows Artifacts

Use the release assets attached to this GitHub Release:

| Artifact | Purpose | Size | SHA-256 |
|---|---|---:|---|
| `schema-docs_0.1.0_x64-setup.exe` | Recommended NSIS installer for ordinary public-preview testing | 25,360,038 bytes | `f890a26d21eef48f464f86976268154f801eed24d62358139b0d57d6eb1c9f30` |
| `schema-docs_0.1.0_x64_en-US.msi` | MSI package for installer comparison and managed deployment testing | 37,180,437 bytes | `7aefdf329f6eb51a04c863c99a62006688744cc9eb24c57f92bd70b9e371e148` |
| `schema-docs_0.1.0_x64-portable.zip` | Portable ZIP containing `app.exe`, the required sibling `runtime/`, and license files | 37,018,675 bytes | `6eb8f4df480f749cc05fe21760c4b7ab3be5451e004e08813a6a00def72a1d54` |

Extract the portable ZIP as a whole and keep `app.exe` beside its `runtime/` directory. A copied `app.exe` by itself is not a standalone package.

Verify a downloaded file in PowerShell:

```powershell
Get-FileHash .\schema-docs_0.1.0_x64-setup.exe -Algorithm SHA256
```

## Quick Start

```bash
npm run demo
```

The demo creates a temporary workspace, imports sensitive sample content, shows raw versus masked AI context, proves Send Gate blocks unsafe confirmed send, writes an AI handoff bundle, verifies an SDXP package, and cleans up.

For local development:

```bash
npm install
npm run serve
```

Then open the local web UI printed by the server.

## Short Announcement Copy

Schema Docs is a local-first document intake layer for AI-first document users. It imports Word, PDF, Excel, CSV, TXT, or Markdown files, converts them locally into AI-readable context, masks PII and credential-like content, shows exactly what an LLM would see, and blocks unsafe sends through a Send Gate.

It is not an office editor and not a RAG system. It sits before AI: document in, local conversion and safety review, AI-ready context or SDXP exchange package out.

Suggested short titles:

- Schema Docs: see what AI will see before your document leaves your machine
- A zero-dependency document intake gate for AI workflows
- Local document masking, Send Gate review, and verifiable AI handoff

## Known Limits

- DOCX extraction focuses on readable Markdown, not pixel-perfect layout.
- DOCX/PDF rich-object intake is structural rather than pixel-perfect: common images and formulas can be preserved, while SmartArt, annotations, embedded objects, macros, VBA, and complex page geometry still require source review and are never executed.
- PDF extraction works best with text-layer PDFs. Scanned image-only PDFs can use optional local Tesseract + Poppler OCR; without those tools the workflow remains blocked, and OCR output still requires visual review.
- XLSX support reads saved workbook data and does not evaluate formulas.
- The in-memory SQL engine is intentionally small, not DuckDB.
- Windows desktop artifacts have local verification evidence, but broader clean-machine testing is still needed.
- The desktop package includes a bundled Node runtime resource and falls back to system Node only if that resource is missing; broader clean-machine verification is still requested.

## Privacy Boundary

- Workspace files stay local unless the user explicitly confirms a send workflow.
- AI preview is a dry run.
- API keys are not persisted in API profiles.
- Blocked Send Gate attempts write local evidence with `aiSent: false`.
- Evidence stores hashes, lengths, policy decisions, and summaries rather than API keys or raw prompt bodies by default.

## Feedback Requested

Please report:

- File type and size.
- Whether import/extraction succeeded.
- Whether AI Will See matched what you expected.
- Whether Send Gate blocked or warned correctly.
- Whether export or SDXP package creation worked.
- Windows version, Node.js version, and whether WebView2 was present.
- Screenshots or logs from the diagnostics panel when safe to share.

Do not attach files containing real credentials, customer data, or private PII.
