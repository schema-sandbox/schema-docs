# Desktop Runtime Posture

The current Tauri build includes a packaged Node runtime resource and verifies the local API bridge on the current Windows environment. It is no longer a system-Node-only bundle, but it still needs broader clean-machine verification before the desktop app should be called polished.

## Current State

- `npm run desktop:dev` starts the local Node server through `beforeDevCommand` and opens the Tauri shell.
- `npm run desktop:build` produces `app.exe`, MSI, and NSIS bundles.
- The production bundle loads the static `public/` UI and includes `runtime/public/` for the packaged Node server and local export libraries.
- The static UI calls relative `/api/...` routes from `public/app.js`.
- The local API server is implemented in Node at `src/server/localServer.js`.
- The production Tauri bundle now includes the JS runtime source and `runtime/node.exe` as resources, and starts `desktop-runtime-launcher.js` with bundled Node when present.
- The packaged bridge passes `SCHEMA_DOCS_RUNTIME_SESSION_DIR` under the app data directory so runtime session files are not written into the install/resource directory.
- The packaged bridge normalizes Windows `\\?\` resource paths before passing script and working-directory paths to Node.
- This remains a lightweight bridge: it prefers bundled `runtime/node.exe` and falls back to system `node` only if the bundled resource is missing.
- `/api/health` now provides a token-free readiness probe for a running local API runtime.
- `npm run desktop-runtime-check` verifies that readiness endpoint.
- `npm run desktop-runtime` starts a controlled local API runtime and writes `session.json` under `SCHEMA_DOCS_RUNTIME_SESSION_DIR`, or `.desktop-runtime/session.json` when that environment variable is not set.
- `npm run desktop:preview-check` starts a runtime, verifies readiness, writes `preview-session.json` under `SCHEMA_DOCS_RUNTIME_SESSION_DIR`, or `.desktop-runtime/preview-session.json` when that environment variable is not set, and exits.
- `npm run desktop:app-smoke -- --check-only` verifies that the packaged executable and required sibling runtime files exist without launching the GUI.
- Full `npm run desktop:app-smoke` launches the packaged app, scans `127.0.0.1:4177-4199`, checks `/api/health`, records app exit diagnostics, and attempts to clean up the launched process tree.
- `npm run desktop:workflow-smoke -- --check-only` verifies that the packaged executable, bundled Node, server launcher, and required public/export assets are present without launching the GUI.
- Full `npm run desktop:workflow-smoke` launches the packaged app, discovers the auto-started runtime, reads the local session token from `/app-config.js`, creates a temporary workspace through the packaged runtime, and runs Markdown save, DOCX/PDF export, sample DOCX create/import/extract, exchange package read-back, receiver/trust report artifact writing, and AI Send Gate preview/blocking checks through the packaged app runtime.
- The packaged Desktop UI has a `Desktop diagnostics` control that reports Node availability, runtime resource paths, session log paths, and local API health for clean-machine triage.
- The visible UI has a `Run first workflow` control that runs the same first-use exchange path from the UI and reports package read-back validity in Diagnostics.
- The packaged Desktop UI has a `Choose workspace` control that calls the Tauri `select_workspace_path` command and uses a Windows native folder picker for workspace selection.
- The packaged Desktop UI has a `Choose local file` control that calls the Tauri `select_import_file_path` command and uses a Windows native file picker for supported document/table files.
- The local API sends CORS headers for Tauri/WebView access from the packaged UI origin.
- The static UI can discover a running local API runtime on `127.0.0.1:4177-4199`, skipping browser-fetch-blocked ports such as 4190.
- If port 4177 is occupied by an older server, the preview/runtime launchers can fall back to another non-blocked port; pass that URL to `desktop-runtime-check` when checking manually.

## Consequence

The Windows bundle is useful as a public-preview package with a bundled Node runtime resource. The local API runtime is launchable, detectable, and packaged as a resource, but F-012 remains a current automatic release blocker until the packaged UI is visibly verified for the current artifact set. The required human-visible checks are:

1. temporary workspace create or native workspace picker open
2. desktop diagnostics readout
3. visible first-workflow check
4. sample DOCX create/import, plus explicit supported-file import through the native file picker before public release
5. convert/export
6. exchange package create/read-back
7. receiver/trust report artifact writing
8. Send Gate preview/send behavior

Latest local Windows result: `npm run desktop:build` produced app/MSI/NSIS artifacts with `runtime/node.exe`, and `npm run desktop:bridge-smoke` verified the packaged runtime can answer `/api/health`. Full app and workflow smoke runs have also passed on this machine, covering temporary workspace creation, Markdown save, DOCX/PDF export, DOCX import/extract, exchange package read-back, receiver/trust reports, AI previews, and Send Gate blocking. Visible packaged UI verification and broader clean-machine coverage are still needed before public tagging.

The packaged runtime workflow smoke validates the API-backed desktop workflow without relying on manual UI clicks. It complements, but does not replace, clean-machine installer verification, native file picker verification, or human review of the visible desktop UI.

## Preferred Lightweight Direction

Keep the JS/Node core as the v0.1.0 authority. The current bridge starts the packaged JS runtime through bundled `runtime/node.exe` when present, keeps the API token in session memory, and preserves the existing workspace path guards. Moving format logic into Rust is not preferred for v0.1.0 because it duplicates the tested core.

## Release Decision

- Public preview can ship with CLI, local API, Web UI, SDK, and the Windows package once the release gates pass and F-012 is closed for the current artifact set.
- Do not claim a polished Windows app until the bundled Node runtime path passes clean-machine installer testing and the same workflow verification beyond the current development machine.
