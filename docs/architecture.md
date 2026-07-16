# Architecture Notes

The MVP keeps a small core and isolates replaceable integrations behind adapters.

## Core Owns

- Workspace layout
- Manifest read/write
- Path guard
- Import records
- Markdown file IO as the technical exchange layer
- Markdown exchange packages for API, audit, and handoff workflows
- Job and status vocabulary

## Adapters Own

- PDF text extraction
- DOCX to Markdown conversion
- Spreadsheet import
- Local SQL execution
- AI client calls
- Secret storage

Business flows must call internal interfaces rather than third-party libraries directly.

## App Service Facade

`src/core/appService.js` is the intended boundary for future Tauri commands and UI calls.

The UI should call the app service shape, not individual adapters. This keeps the adapter layer replaceable and lets the desktop shell stay thin.

## Local API SDK

`src/sdk/localApiClient.js` is a zero-dependency wrapper for the semantic local API routes. It is intended for desktop shell code, scripts, and agent integrations that should call `ingest`, `extract`, `normalize`, `readPackage`, `exportDocument`, and evidence APIs without hard-coding HTTP envelopes throughout the app.

The SDK unwraps successful `{ ok, data }` responses and throws `SchemaDocsApiError` for structured API errors.

`src/core/apiContract.js` is the source of truth for semantic local API routes. The capability manifest exposes both a compact route list and route metadata with intent and required fields.

## Exchange Package Verification

`readExchangePackage` reads a directory-based Markdown exchange package, verifies declared hashes for the canonical Markdown document, `document.schema.json`, `evidence.jsonl`, table artifacts, and requested exports, then parses the canonical Markdown frontmatter and headings. This makes the package usable as a handoff unit for scripts, desktop UI, and agent integrations instead of only a write-only artifact.
