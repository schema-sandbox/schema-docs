# Desktop Verification Protocol

Use this protocol before calling a Windows build usable by a first tester.

## Build Artifacts

Expected local artifacts after `npm run desktop:build`:

- `src-tauri/target/release/app.exe`
- `src-tauri/target/release/runtime/` (must remain beside the build-tree `app.exe`)
- `src-tauri/target/release/bundle/msi/schema-docs_0.1.2_x64_en-US.msi`
- `src-tauri/target/release/bundle/nsis/schema-docs_0.1.2_x64-setup.exe`

After `npm run desktop:build`, run `npm run release:windows:prepare`. This separate step does not build implicitly: it validates the build-tree executable, sibling runtime (including bundled Node and public UI libraries), installers, version agreement, and release documents before atomically producing the MSI, NSIS installer, portable ZIP, and LF-formatted `release/windows/SHA256SUMS.txt`. If preparation fails, it cleans its unique temporary staging directory and leaves the previous release assets unchanged.

`npm run release-check` should report the build-tree `app.exe` plus the three prepared `release/windows/` upload assets in the optional `desktopArtifacts` block when they exist.
`npm run release-artifacts` should report those exact tested files with byte counts and SHA-256 hashes; it does not treat the build-tree `app.exe` as a standalone upload asset.
Use `samples/desktop-verification-record.template.json` as the handoff record. `npm run desktop-verification-record -- --out samples/desktop-verification-record.local.json` can generate a partial record from release artifacts and saved smoke JSON outputs; `npm run desktop-verification-fill -- --record <partial-record.json> --diagnostics-pass --first-workflow-pass --workspace-picker-pass --file-picker-pass --result-pass --tester <name> --windows-version <windows-version> --node-version <node-version> --webview2-present yes --out <filled-record.json>` can fill explicitly confirmed visible UI evidence after the tester performs each manual step; `--visible-ui-pass` remains a shortcut but is not the preferred handoff command. `npm run desktop-verification-check` validates structure; `npm run desktop-verification-check -- --strict <filled-record.json>` is the machine check for a completed visible desktop verification record. Strict mode requires artifact hash, Windows version, confirmed WebView2 presence, Node version, runtime health, visible diagnostics, native picker evidence, Send Gate evidence, tester identity, and timestamp. Strict failures include `nextActions` so the tester can see which command or visible UI step still needs evidence.
Use `npm run desktop-release-preflight -- --out-dir <dir>` before manual visible UI testing to generate a handoff folder with release artifacts, release readiness summary, public preview package handoff command, machine-readable handoff summary, preflight manifest with portable relative evidence paths, file byte counts, and SHA-256 hashes, check-only smoke results, optional full app/workflow smoke results, bridge smoke results, a partial verification record, a strict preview, and `desktop-handoff.md`. Run `npm run desktop-preflight-check -- <dir>` after generating or copying the folder to verify file byte counts, SHA-256 hashes, JSON parse status, manifest file count, and required release commands including `npm run public-preview-package -- --json`. Add `--include-gui-smoke` only on a Windows GUI machine where launching the packaged app is allowed.
After strict desktop verification passes, use `npm run desktop-fixture-close -- --record <filled-record.json> --write` to update F-012 in `samples/fixture-results.json`; the command first verifies that the record artifact SHA-256 is present in the current release artifact manifest, then records the filled verification record SHA-256 in F-012 notes. Then run `npm run fixture-check -- --strict`.

## Startup

1. Launch the build-tree `app.exe` with its generated sibling `runtime/` directory intact, or extract and launch the complete portable ZIP.
2. Launch the NSIS installer build.
3. Launch the MSI installer build.
4. Record startup time to first visible window.
5. Confirm the window title is `Schema Docs`.
6. Confirm the app loads the same local UI as `npm run serve`.
7. Confirm the packaged app has a live API runtime, not only static assets.
8. Run `npm run desktop-runtime-check` against the API base URL used by the packaged UI.
9. Confirm Desktop diagnostics reports whether the packaged runtime is using bundled `runtime/node.exe` or falling back to system `node`, and record the Node version.
10. If testing before packaged runtime startup, start `npm run desktop-runtime` or `npm run desktop:preview -- --launch-app` first and record that this is a manual runtime path.
11. Run `npm run desktop:preview-check` before manual packaged-app testing.
12. Run `npm run desktop:app-smoke -- --check-only` after `npm run desktop:build` to confirm the app smoke gate can find the packaged executable.
13. Run `npm run desktop:workflow-smoke -- --check-only` after `npm run desktop:build` to confirm the packaged workflow smoke gate can find the packaged executable.
14. Run `npm run desktop:bridge-smoke` after `npm run desktop:build` to verify the packaged JS runtime resource can answer `/api/health`.
15. Run `npm run desktop-release-preflight -- --out-dir <dir>` and keep the generated evidence folder with the release candidate. Then run `npm run desktop-preflight-check -- <dir>` before sending the folder to a tester. If GUI launch is allowed, run `npm run desktop-release-preflight -- --out-dir <dir> --include-gui-smoke` to prefill full app/workflow smoke evidence. Start the manual pass from `desktop-handoff.md`.
16. Run the full `npm run desktop:app-smoke` only in an environment where launching the Windows GUI app is allowed; record the reported port, health result, and cleanup status.
17. Run the full `npm run desktop:workflow-smoke` in the same environment to verify the packaged app runtime can complete temporary workspace creation, Markdown save, DOCX/PDF export, sample DOCX create/import/extract, exchange package read-back, receiver/trust report artifact writing, and AI Send Gate preview/blocking checks through the local API.
18. If the runtime falls back from 4177 to another port, confirm the packaged UI discovers the runtime through `127.0.0.1:4177-4199` and does not require manual base URL editing.
19. Click `Desktop diagnostics` in the packaged Desktop UI and record Node availability, runtime paths, session log paths, and API health.
20. Click `Run first workflow` in the packaged Desktop UI and confirm Diagnostics reports `readBackValid: true`.
21. Click `Choose workspace` in the packaged Desktop UI and confirm the Windows folder picker fills and opens the workspace path.
22. Click `Choose local file` in the packaged Desktop UI and confirm the Windows file picker returns a path into the source path field.

23. After the visible UI checks pass, run `npm run desktop-verification-fill -- --record <dir>/desktop-verification-record.partial.json --diagnostics-pass --first-workflow-pass --workspace-picker-pass --file-picker-pass --result-pass --tester <name> --windows-version <windows-version> --node-version <node-version> --webview2-present yes --out <dir>/desktop-verification-record.filled.json`, then run the strict checker on the filled record.

## Workspace Flow

1. Create a disposable local workspace with the `Create temporary workspace` button, or select an explicit local workspace path with `Choose workspace`.
2. Run `Run first workflow` and confirm the generated package read-back is valid.
3. Save a Markdown note inside the workspace.
4. Generate a sample Word document with `Create sample Word and import`, then separately import a supported local file through `Choose local file` before public release.
5. Export Markdown to DOCX.
6. Export Markdown to PDF.
7. Open the exported PDF from a note containing Chinese text plus inline and display formulas. Confirm the text and rendered formulas are legible and that no mojibake, raw `$...$`, `\frac`, or Markdown markers remain.
8. In Preview/Read mode, single-click a paragraph and a table cell containing formulas. Confirm the editor shows the original Markdown/LaTeX on normal lines and saving preserves the formula source.
9. Create a Markdown exchange package with DOCX and PDF exports.
10. Read back the exchange package and verify hashes.
11. Write `receiver-report.md` and `trust-report.json` for the package and verify both artifact hashes are reported.
12. Confirm path traversal attempts are rejected through the same service boundary.

## AI Send Gate Flow

1. Run AI preview with ordinary text and record the decision.
2. Run AI preview with email/phone-like text and record the warning.
3. Run AI preview with credential-like text and verify confirmed send is blocked.
4. Confirm API key is not saved to the API profile.

## Packaging Notes

Record:

- Windows version.
- WebView2 presence.
- Node version and whether the packaged bridge used bundled `runtime/node.exe` or system `node`.
- Build artifact used: complete portable ZIP, MSI, or NSIS (the build-tree `app.exe` is valid only beside its generated `runtime/`).
- Artifact size.
- Artifact SHA-256 from `npm run release-artifacts`.
- Desktop preflight evidence folder path from `npm run desktop-release-preflight -- --out-dir <dir>`.
- `npm run desktop-preflight-check -- <dir>` result for the evidence folder.
- `desktop-handoff-summary.json` public tag status, F-012 blocker list, artifact hashes, and next actions.
- `desktop-preflight-manifest.json` portable relative file list, byte counts, SHA-256 hashes, and JSON parse status.
- `desktop-handoff.md` status and any remaining strict preview next actions.
- Startup time.
- Whether Windows SmartScreen or antivirus interrupts launch.
- Any missing runtime or WebView dependency prompt.

## Pass Criteria

The first usable Windows test build passes when:

- The app starts from at least one installer artifact on a clean or near-clean Windows machine.
- The packaged app can reach a local API runtime without developer tooling.
- `npm run desktop-runtime-check` passes for that runtime.
- `npm run desktop:app-smoke -- --check-only` passes against the packaged executable path.
- `npm run desktop:workflow-smoke -- --check-only` passes against the packaged executable path.
- `npm run desktop:bridge-smoke` passes against the packaged runtime resource.
- Full `npm run desktop:app-smoke` passes or an equivalent manual launch records the same `/api/health` result.
- Full `npm run desktop:workflow-smoke` passes or equivalent manual API-backed desktop workflow evidence is recorded, including receiver/trust report artifact writing and AI Send Gate preview/blocking behavior.
- The runtime is started by the packaged app or by a documented launcher during the preview phase.
- The strict desktop verification record captures whether bundled `runtime/node.exe` or system `node` was used.
- WebView2 presence, Node version, runtime resource paths, session log paths, and API health are recorded in the strict desktop verification record.
- The packaged UI discovers the documented preview/runtime port without editing the static files.
- CORS/preflight works for the Tauri/WebView origin.
- The main document exchange flow completes without developer tooling.
- A first-time user can create a disposable workspace without typing a path.
- Workspace-scoped file access is preserved.
- AI Send Gate behavior matches CLI/API behavior.
- Limitations are visible in release notes and supported format docs.
- A filled desktop verification record passes `npm run desktop-verification-check -- --strict <filled-record.json>`.
- F-012 is closed through `npm run desktop-fixture-close -- --record <filled-record.json> --write`, with the record artifact SHA-256 matched to the current release artifact manifest and the filled verification record SHA-256 recorded in F-012 notes.
