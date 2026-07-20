# Release Checklist

## Required Commands

```bash
npm test
npm run smoke
npm run fixture-smoke
npm run fixture-check
npm run demo
npm run size-check
npm run root-clean-check
npm run ui-check
npm run language-boundary-check
npm run web-ui-smoke
npm run desktop-verification-check
npm run desktop-verification-record
npm run desktop-verification-fill -- --record <partial-record.json> --diagnostics-pass --first-workflow-pass --workspace-picker-pass --file-picker-pass --result-pass --tester <name> --windows-version <windows-version> --node-version <node-version> --webview2-present yes --out <filled-record.json>
npm run desktop-release-preflight
npm run desktop-preflight-check -- <preflight-dir>
npm run desktop-fixture-close -- --record <filled-record.json> --write
npm run desktop-runtime-check
npm run desktop:app-smoke -- --check-only
npm run desktop:workflow-smoke -- --check-only
npm run desktop:ai-summon-smoke
npm run desktop:bridge-smoke
npm run release-check
npm run release-readiness
npm run release-artifacts
npm run release-index
npm run public-preview-package -- --json
npm run rc-check -- --mode public-preview
```

All commands should pass before a public v0.1.2 tag. Use `npm run release-readiness -- --report-only --out <readiness.json>` when an internal handoff needs an auditable JSON readiness report without changing release state. The default `npm run release-readiness` command must pass before tagging.

## Scope Check

- No accidental cloud sync.
- No macro execution.
- No automatic model request.
- No full workspace upload.
- No unsupported format advertised as supported.
- No third-party dependency added without size and replacement notes.
- `npm run size-check` stays under the enforced lightweight budgets: 0 runtime dependencies, at most 1 dev dependency, 1.16MB runtime bytes, 1.7MB source/test/docs bytes, 125KB largest runtime file, 100KB public browser module file, 100 runtime files, 195 checked source files, and 38,500 checked source lines.
- `npm run demo` completes the public first-impression path: local workspace, sensitive document import, raw versus masked AI context, blocked raw send, AI handoff bundle, SDXP package verification, and automatic temporary workspace cleanup.
- `npm run root-clean-check` passes before any public handoff so generated root-level artifacts are not shipped or shown to new contributors.
- `npm run rc-check -- --mode public-preview` passes before tagging a public preview release candidate.
- `npm run public-preview-package -- --json` reports `decision.ready: true`, `releaseReadiness.readyForPublicTag: true`, and the NSIS setup executable as the recommended public preview installer.

## Workspace Safety

- Manifest loads.
- Markdown save stays inside workspace.
- Imported files are recorded without silently uploading or rewriting the source.
- Generated Markdown and exchange artifacts stay inside the workspace.
- Path traversal is rejected.
- Symlink escape is rejected where the platform supports the test.

## Adapter Boundary

- Business logic does not call third-party libraries directly.
- New format support goes through an adapter.
- Adapter returns internal records, not vendor objects.
- Failure returns a clear `AppError` code.

## Document Exchange

- Markdown exports to DOCX.
- Markdown exports to PDF.
- DOCX converts back to Markdown for supported simple documents.
- PDF converts back to Markdown when a simple text layer is extractable.
- Directory exchange packages include `document.md`, `document.schema.json`, `manifest.json`, `evidence.jsonl`, `tables/`, `assets/`, and `exports/`.
- Package manifest hashes cover canonical Markdown, schema, evidence log, tables, and requested exports.
- Package read-back verification rejects tampered declared files.
- CLI, API, SDK, and smoke paths can create or consume the Markdown exchange package workflow.
- Complex PDF, scanned PDF, and high-fidelity Office layout limits are documented.

## Sample Fixtures

- `samples/fixture-plan.json` exists.
- The plan has at least 10 workflows.
- The plan covers DOCX, PDF, Markdown, CSV, XLSX, API, and Desktop paths.
- Every reviewed fixture records result and limitation notes.
- Synthetic fixtures are allowed; sensitive real documents are not committed.
- `npm run fixture-smoke` writes `samples/fixture-results.json`; use `npm run fixture-smoke -- --out <fixture-results.json>` for trial runs that should not update tracked sample results.
- `npm run fixture-check` passes for structure, coverage, plan/result ID alignment, result evidence, and notes on `known_limit`/`blocked`/`fail` results.
- `npm run fixture-check -- --strict` passes before a public v0.1.2 tag.
- `npm run release-readiness -- --report-only --out <readiness.json>` can be archived during internal handoff when a tester needs the JSON readiness report.
- `npm run release-readiness` reports `readyForPublicTag: true` and exits successfully before a public v0.1.2 tag.

## Desktop Shell

- `npm run desktop:dev` opens the Tauri shell during development.
- `npm run desktop:build` creates a Windows test build.
- Windows bundles are generated under `src-tauri/target/release/bundle/`.
- `npm run desktop-runtime-check` passes against the local API runtime used by the desktop UI.
- `npm run desktop:app-smoke -- --check-only` passes after `npm run desktop:build`.
- `npm run desktop:workflow-smoke -- --check-only` passes after `npm run desktop:build`.
- `npm run desktop:bridge-smoke` passes against the packaged runtime resource after `npm run desktop:build`.
- `npm run desktop-verification-record -- --out samples/desktop-verification-record.local.json` can generate a partial desktop verification record from release artifacts and saved smoke JSON outputs.
- `npm run desktop-verification-fill -- --record <partial-record.json> --diagnostics-pass --first-workflow-pass --workspace-picker-pass --file-picker-pass --result-pass --tester <name> --windows-version <windows-version> --node-version <node-version> --webview2-present yes --out <filled-record.json>` fills explicitly confirmed visible UI evidence and required environment metadata into the partial record after the tester has completed each manual Desktop UI check. `--visible-ui-pass` remains a shortcut, but the release handoff should use the step-specific flags.
- `npm run desktop-verification-check samples/desktop-verification-record.template.json` passes for record structure, and `npm run desktop-verification-check -- --strict <filled-record.json>` passes before F-012 is closed; strict failures include `nextActions` for the missing command, WebView2/Node/runtime diagnostic evidence, visible UI step, or traceability field.
- `npm run desktop-release-preflight -- --out-dir <dir>` writes a desktop handoff evidence package with release artifacts, release readiness summary, machine-readable handoff summary, preflight manifest with file hashes, check-only smoke outputs, optional full app/workflow smoke outputs, bridge smoke output, a partial verification record, a strict preview, and `desktop-handoff.md` with manual verification steps before visible UI testing.
- `npm run desktop-preflight-check -- <dir>` verifies the generated preflight manifest, portable relative evidence paths, file byte counts, SHA-256 hashes, JSON parse status, and file count before tester handoff.
- `npm run desktop-release-preflight -- --out-dir <dir> --include-gui-smoke` runs full app/workflow smoke in a Windows GUI environment and pre-fills startup, automated evidence, and Send Gate fields in the partial verification record.
- `npm run desktop-fixture-close -- --record <filled-record.json> --write` updates F-012 only after the filled desktop verification record passes strict validation, the record artifact SHA-256 matches the current release artifact manifest, and the command records that filled record's SHA-256.
- Full `npm run desktop:app-smoke` or an equivalent manual launch records packaged app `/api/health` in a Windows GUI environment.
- Full `npm run desktop:workflow-smoke` or equivalent manual evidence records packaged app runtime temporary workspace creation, Markdown save, DOCX/PDF export, sample DOCX create/import/extract, exchange package read-back, receiver/trust report artifact writing, and AI Send Gate preview/blocking checks.
- Packaged Desktop UI `Desktop diagnostics` reports Node availability, runtime resource paths, session log paths, and local API health.
- The filled desktop verification record confirms WebView2 presence and records the Node version used by the current runtime bridge.
- Packaged Desktop UI `Run first workflow` completes and reports a valid package read-back.
- Packaged Desktop UI `Choose workspace` opens a Windows native folder picker, fills the workspace path, and opens the workspace.
- Packaged Desktop UI `Choose local file` opens a Windows native file picker and fills the import path field.
- The shell loads the same local UI and does not bypass workspace path checks.
- Desktop commands stay thin and call the app service boundary rather than format adapters directly.
- A user can complete workspace selection, import, conversion/export, exchange package creation, package read-back, and receiver/trust report generation from the desktop path before public v0.1.0.

## User-Facing Clarity

- Supported formats are documented in `docs/supported-formats.md`.
- Known limits are documented in `docs/implementation-status.md`.
- `npm run ui-check` passes so visible UI text is not mojibake, public browser module imports resolve, the HTML shell is structurally intact, and desktop UI assets do not depend on remote font imports.
- `npm run web-ui-smoke` passes so the served Web UI, split public browser modules, reader-facing product text, runtime config script, static assets, and `/api/health` are available from a real local server.
- AI preview clearly states whether content, API key, or workspace files are sent.
- AI preview shows Send Gate decision, estimated tokens, sensitive-content signals, local-only markers, and API key source status.
- Web UI displays the latest Send Gate summary before confirmed send.
- AI send requires explicit confirmation.
- API profiles do not persist API keys.
- Audit summaries do not store API keys or full prompt bodies by default.
- Job failure includes actionable error text.

## Lightweight Budget

Record before release:

- dependency count
- source file count
- source bytes
- largest files
- desktop artifact bytes and SHA-256 hashes from `npm run release-artifacts`
- desktop preflight evidence package from `npm run desktop-release-preflight -- --out-dir <dir>`, including `release-readiness.json`, `desktop-handoff-summary.json`, `desktop-preflight-manifest.json`, and `desktop-handoff.md` with manual verification steps
- desktop preflight manifest check result from `npm run desktop-preflight-check -- <dir>`
- filled desktop verification record generated with explicit tester identity and WebView2 confirmation through `npm run desktop-verification-fill`
- filled desktop verification record checked with `npm run desktop-verification-check -- --strict <filled-record.json>`
- F-012 closure produced by `npm run desktop-fixture-close -- --record <filled-record.json> --write`, including release artifact hash match and filled record SHA-256 in notes
- release readiness summary from `npm run release-readiness -- --report-only --out <readiness.json>` during internal handoff, and from default `npm run release-readiness` before public tag
- smoke result
- test result
- sample fixture checklist result
