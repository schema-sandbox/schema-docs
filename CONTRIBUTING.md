# Contributing to Schema Docs

Schema Docs is a local-first AI document intake layer. Contributions should protect the product's core constraints: AI-first workflows, local safety boundaries, zero runtime dependencies, and lightweight release artifacts.

## Prerequisites

| Tool | Version | Required for |
|------|---------|--------------|
| Node.js | 22+ | Web UI, CLI, tests |
| npm | 9+ | Dependency management |
| Rust + cargo | latest stable | Tauri desktop build only |
| WebView2 | Windows | Desktop app runtime |

The web UI and CLI work with Node.js only. Rust is needed only for the Tauri desktop shell.

## Setup

```bash
git clone <repo-url>
cd schema-docs
npm install
```

Start the local web UI:

```bash
npm run serve
```

Start the desktop dev build:

```bash
npm run desktop:dev
```

## Project Structure

```text
src/
  cli/       CLI commands and release preflight scripts
  core/      Business logic: masking, AI gate, exchange packages, SQL
  adapters/  Format adapters for PDF, DOCX, XLSX, CSV, and local SQL
  server/    Local HTTP API server
  sdk/       Local API client SDK

public/      Web UI, vanilla JS ES modules, no bundler
src-tauri/   Tauri desktop shell
docs/        Protocol specs, known limits, release docs
test/        Automated tests
samples/     Fixtures, sample workspaces, and test data
scripts/     Utility scripts
```

## Development Rules

### Keep Runtime Dependencies at Zero

The production runtime uses only Node.js built-ins.

- Do not add `dependencies` in `package.json`.
- Dev tools may go in `devDependencies` only when justified.
- Run `npm run size-check` before release-facing changes.

### Keep Product Surfaces English-Only

Default UI, release docs, runtime config, and public-facing source comments must be English-only.

- Put multilingual fixtures only in tests, samples, or locale resources.
- Avoid raw CJK strings in runtime source unless the file is explicitly allowed by the language boundary checker.
- Run `npm run language-boundary-check` before release-facing changes.

### Preserve the Local Safety Boundary

Document conversion, masking, SQL queries, AI preview, and exchange package creation must remain local. Only explicit, Send Gate-approved AI sends may reach a network API.

### Keep Public Preview Honest

Known limits must stay visible. Do not imply high-fidelity Office editing, OCR, or formula evaluation unless the implementation actually supports it.

## Running Tests

```bash
npm test                         # Full unit, integration, and regression suite
npm run rc-check                 # Full public-preview release candidate preflight
npm run public-preview-package   # Public-preview installer handoff report
npm run smoke                    # Core exchange smoke test
npm run web-ui-smoke             # Web UI and API smoke test
npm run ui-check                 # DOM integrity and module import check
npm run size-check               # Source size budget
npm run language-boundary-check  # English-only release boundary check
npm run doctor                   # Environment diagnostics
```

All PRs must keep the full preflight green unless the change is explicitly marked as exploratory.

## Adding Tests

Tests live in `test/` and use Node's built-in `node:test` runner.

```js
import test from "node:test";
import assert from "node:assert/strict";

test("my feature does the right thing", async () => {
  const result = await myFunction("input");
  assert.equal(result, "expected");
});
```

Run a single test file:

```bash
node --test test/my-feature.test.js
```

## Adding DLP / Masking Rules

Custom PII detection patterns live in `src/core/dlp-rules.json`; most rules do not require code changes.

```json
{
  "rules": [
    {
      "id": "company_internal_id",
      "name": "Company Internal ID",
      "pattern": "CMP-[0-9]{6}",
      "replacement": "[MASK_COMPANY_ID]",
      "flags": "g"
    }
  ]
}
```

## Preflight Before Submitting

```bash
npm run rc-check
```

This runs tests, size budget, large AI intake, language boundary, release check, strict fixtures, release readiness, and release audience handoff checks.

## Release Process

Releases follow `docs/release-candidate-process.md`.

Key gates:

1. `npm run rc-check`
2. `npm run public-preview-package -- --json`
3. `npm run release-index -- --mode public-preview`
4. Desktop build verified on Windows
5. F-012 desktop fixture closed with a strict desktop verification record

## Exchange Package Protocol

The Schema Docs Exchange Protocol defines the `.exchange` directory format.

- `docs/sdxp-spec-v1.0.md`: full technical spec
- `docs/sdxp-primer.md`: one-page introduction

## Questions

Open a GitHub issue or discussion with the exact command, fixture, document type, and observed output.
