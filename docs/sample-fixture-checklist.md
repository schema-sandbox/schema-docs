# Sample Fixture Checklist

v0.1.0 does not need perfect Office or PDF fidelity, but it does need a repeatable sample gate. Each reviewed fixture should record input file name, source format, target format, command or UI path, output path, observed limitation, and pass/fail.

## Minimum 10-Workflow Gate

1. DOCX simple paragraphs -> Markdown extraction.
2. DOCX headings and bullet list -> Markdown extraction.
3. Markdown with headings and list -> DOCX export.
4. Markdown with headings and list -> PDF export.
5. Generated DOCX export -> Markdown re-import smoke check.
6. Generated PDF export -> Markdown text-layer extraction smoke check.
7. Existing text-layer PDF -> Markdown extraction.
8. CSV import -> table preview -> query export to Markdown and CSV.
9. XLSX first sheet -> table preview.
10. Markdown exchange package -> DOCX/PDF exports -> package read-back verification -> receiver/trust report artifacts.

## Trust And API Gate

1. AI preview with normal text produces `allow`.
2. AI preview with email or phone produces `warn`.
3. AI preview with credential-like text produces `review_required`.
4. Confirmed AI send is blocked for `review_required`.
5. Evidence log and audit summary contain hashes and Send Gate decision, not API keys or full prompt bodies by default.

## Desktop Gate

1. Desktop shell opens from `npm run desktop:dev`.
2. Windows build completes from `npm run desktop:build`.
3. Desktop path uses the same workspace safety checks as CLI/API.
4. User can create or select a workspace without editing source code.
5. User can import a file, export a result, create an exchange package, and read it back.
6. A filled desktop verification record based on `samples/desktop-verification-record.template.json` passes `npm run desktop-verification-check -- --strict <filled-record.json>`.

## Recording Format

Use this compact table for every reviewed fixture:

| ID | Input | Workflow | Path | Expected | Result | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| F-001 | sample.docx | DOCX -> MD | CLI/API/UI/Desktop | headings preserved | pending | simple fixture |

Keep failing fixtures in the table. For v0.1.0, a documented limitation can pass only when the product does not claim support for that behavior.

## Machine Check

```bash
npm run fixture-smoke
npm run fixture-check
npm run fixture-check -- --strict
npm run release-readiness
npm run release-readiness -- --report-only --out <readiness.json>
npm run ui-check
npm run web-ui-smoke
npm run desktop-verification-record
npm run desktop-verification-check
npm run desktop-verification-fill -- --record <partial-record.json> --diagnostics-pass --first-workflow-pass --workspace-picker-pass --file-picker-pass --result-pass --tester <name> --windows-version <windows-version> --node-version <node-version> --webview2-present yes --out <filled-record.json>
npm run desktop-release-preflight
npm run desktop-preflight-check -- <preflight-dir>
npm run desktop-fixture-close -- --record <filled-record.json> --write
```

`fixture-smoke` writes `samples/fixture-results.json` for synthetic automated coverage by default; use `fixture-smoke -- --out <fixture-results.json>` for trial runs that should not update the tracked sample result file. Default `fixture-check` verifies structure, coverage, duplicate IDs, required fields, result count, status values, plan/result ID alignment, result evidence, and notes on `known_limit`/`blocked`/`fail` results. It also accepts `--plan <plan.json> --results <results.json>` for temporary sample audits. Strict mode is the release gate: every workflow must be recorded as `pass` or `known_limit`. `release-readiness` combines `release-check` and strict fixture status into a final `readyForPublicTag` summary; it reports `readyForPublicTag: true` only after F-012 has been strictly verified and closed for the current desktop artifact. `ui-check` validates static UI text, HTML shell integrity, and offline assets. `web-ui-smoke` starts the local server and verifies the served Web UI, reader-facing product text, runtime config, and `/api/health`.
`desktop-verification-record -- --out <record.json>` generates a partial desktop verification record from release artifacts and saved smoke JSON outputs. `desktop-release-preflight -- --out-dir <dir>` writes the release artifact, release readiness summary, handoff summary, portable preflight manifest with relative evidence paths and file hashes, check-only smoke, optional full app/workflow smoke, bridge smoke, partial record, strict preview, and `desktop-handoff.md` evidence package before visible UI testing. `desktop-preflight-check -- <dir>` verifies that package before tester handoff or after the whole folder has been copied. Add `--include-gui-smoke` only when GUI launch is allowed. After the tester completes the visible Desktop UI checks, `desktop-verification-fill -- --record <partial-record.json> --diagnostics-pass --first-workflow-pass --workspace-picker-pass --file-picker-pass --result-pass --tester <name> --windows-version <windows-version> --node-version <node-version> --webview2-present yes --out <filled-record.json>` fills the explicit manual evidence fields without changing automated smoke evidence; `--visible-ui-pass` remains a shortcut, but the handoff should prefer step-specific flags. `desktop-verification-check` validates the desktop verification record shape; strict mode requires the visible desktop UI, native pickers, runtime health, WebView2 confirmation, Node version, runtime path/session log diagnostics, artifact hashes, Send Gate fields, tester, and timestamp to pass before F-012 can be closed. `desktop-fixture-close -- --record <filled-record.json> --write` updates F-012 only after that strict verification passes, the record artifact SHA-256 matches the current release artifact manifest, and the command records the filled record SHA-256.
