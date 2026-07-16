# Desktop Standalone Runtime Decision

This decision record keeps v0.1.0 lightweight while making the desktop runtime requirement explicit.

## Decision For v0.1.0 Preview

Schema Docs v0.1.0 keeps the JavaScript/Node core as the authority. The Tauri shell does not reimplement document conversion, package generation, Send Gate, or API audit logic in Rust.

For the public preview:

- The Windows bundle includes the JS runtime source and `runtime/node.exe` as Tauri resources.
- The release-mode Tauri app starts `runtime/src/cli/desktop-runtime-launcher.js` through bundled `runtime/node.exe` when present, with system `node` as fallback.
- Runtime session state is written under the app data directory through `SCHEMA_DOCS_RUNTIME_SESSION_DIR`.
- The static UI can discover the local API on `127.0.0.1:4177-4199`.
- Windows `\\?\` resource paths are normalized before launching Node so the bundled runtime resource can start from a release build.
- Machines without system Node are supported by the packaged runtime resource, but still need broader clean-machine verification before the app is called polished.

## Bundled Node Boundary

Bundling Node is used for the Windows public-preview package, while the core remains zero-runtime-dependency JavaScript:

- It changes installer size and update behavior.
- It requires platform-specific sidecar naming and signing decisions.
- It needs a clean-machine verification pass.
- It should not change the zero-runtime-dependency JavaScript core posture.

## Release Gates

Internal developer preview can proceed when:

- `npm run release-check` passes.
- `npm run desktop:build` produces app, MSI, and NSIS artifacts.
- The runtime bridge check is present in `release-check`.
- `npm run desktop:app-smoke -- --check-only` verifies the packaged executable path and app smoke entrypoint.
- Full `npm run desktop:app-smoke` verifies the packaged app can auto-start the local API and answer `/api/health`.
- `npm run desktop:workflow-smoke -- --check-only` verifies the packaged workflow smoke entrypoint.
- Full `npm run desktop:workflow-smoke` verifies the packaged app runtime can complete workspace open, Markdown save, DOCX/PDF export, DOCX ingest/extract, exchange package read-back, receiver/trust report artifact writing, and AI Send Gate preview/blocking checks through the local API.
- `npm run desktop:bridge-smoke` verifies the packaged runtime resource can start and answer `/api/health`.
- `npm run desktop:preview-check` verifies a local API runtime.

First usable Windows test build requires a clean Windows machine to verify packaged auto-start, workspace, import, export, exchange package read-back, receiver/trust report writing, and Send Gate with the bundled runtime resource.

F-012 remains open for the current desktop artifact until visible packaged UI verification is completed on the target Windows machine. Preflight scripts can prepare and hash the evidence folder, but they do not replace the human-visible diagnostics, first workflow, native workspace picker, native file picker, and result review. F-012 should only be closed with `desktop-fixture-close` after `desktop-verification-check -- --strict <filled-record.json>` passes for the current artifact set.

## Desktop AI Summon Scope

v0.1.0 verifies a source-aware AI summon path inside the desktop app:

- The floating AI key opens the AI Send Gate.
- `Ctrl+Alt+A` opens the AI Send Gate while the Schema Docs desktop window is active.
- The Tauri `summon_ai_gate` command focuses the main window and emits `schema-docs-ai-summon`.
- The web UI scrolls to AI Send Gate, focuses the context box, and refreshes AI Will See when a record is selected.

This is not an operating-system-wide automation promise. v0.1.0 does not claim alternate system shortcuts, background clipboard capture from arbitrary applications, OS-level paste-back automation, or background access to external Office windows.

## Next Runtime Work

- Keep the JS runtime resource path stable as `runtime/`.
- Route session files to app data, never to the install directory.
- Verify startup, shutdown cleanup, port fallback, and UI discovery on Windows.
- Record installer size and startup time after clean-machine verification.
