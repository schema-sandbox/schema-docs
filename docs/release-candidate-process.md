# Release Candidate (RC) Process & Preflight Discipline

This document details the quality gate criteria, preflight validations, and tagging process required to declare a Release Candidate (RC) for the **Schema Docs (AI Document Exchange)** product.

---

## 1. Quality Gate Criteria

Before a build can be tagged as a Release Candidate, it must satisfy the following criteria:

1. **Unit & Integration Tests**: The required automated unit and integration suites must be green with no known regressions.
2. **Size Budget**: The runtime surface and repository source must stay within strict lightweight limits. `size-check` enforces 0 runtime dependencies, at most 1 dev dependency, a 1.16MB runtime budget for `src/core`, `src/server`, `src/adapters`, `src/sdk`, and `public`, a 1.7MB source/test/docs budget, a 100KB largest source file budget, a 125KB largest runtime file budget, a 100KB public browser module budget, 100 runtime files, 195 checked source files, and 38,500 checked source lines.
3. **Default English Boundary**: Default runtime surfaces, release docs, and runtime config must pass `language-boundary-check`; multilingual content belongs in tests, fixtures, internal strategy docs, or locale resources.
4. **Release Integrity Check**: Version indexing, API contract compliance, and licensing checks must pass.
5. **Fixture Strictness**: All capability fixtures and user workflows must match expectations exactly (`fixture-check --strict`).
6. **Mode Readiness**: The release readiness validation for the specific mode (default `public-preview`; supported modes include `private-beta` and `public`) must report success.
7. **Release Audience Handoff Readiness**: `beta-check --mode <mode>` must pass, including tester docs, known limits, and real-sample capability coverage for AI intake, safety gate, and format exchange.
8. **Zero Leaked Secrets**: The settings credentials scanner must run successfully and report no active API keys or credentials exposed in the public workspace manifest.
9. **Installer Handoff Ready**: `public-preview-package -- --json` must report `decision.ready: true`, `releaseReadiness.readyForPublicTag: true`, and a primary NSIS installer path before any public tester handoff.

---

## 2. Preflight CLI Verification

The project includes an automatic preflight script that verifies all of the above criteria in sequence.

To run the full public-preview gate and refresh the installer handoff reports in one step, use:

```bash
npm run release:public-preview
```

This command runs the public-preview RC gate, refreshes release artifact metadata, refreshes the release artifact index, and writes the public-preview package handoff report.

To run only the preflight verification locally, use the following command:

```bash
npm run rc-check
```

Or run with a specific target mode:

```bash
npm run rc-check -- --mode public-preview
```

To get structured JSON output:

```bash
npm run rc-check -- --json
```

Use the normal output while working interactively. Use `npm run rc-check -- --json` for release archives; the JSON report records `releaseTarget`, `releaseMode`, `generatedAt`, `commands`, and per-check results.

After the RC preflight is green, verify the public preview package handoff:

```bash
npm run public-preview-package -- --json
```

### Preflight Script Checks

The script runs the following underlying checks:
- **`npm test`**: Runs the entire Node.js test runner suite.
- **`node src/cli/size-check.js`**: Validates runtime, public browser module, and repository size budgets, reports runtime bytes separately from source/test/docs bytes, fails on budget violations, warns after source bytes pass 80% of the 1.7MB budget, and warns when the largest source/runtime/public browser module file passes 90% of its budget.
- **`node src/cli/language-boundary-check.js`**: Verifies default product surfaces and release docs remain English-only while allowing CJK coverage in tests and fixtures.
- **`node src/cli/release-check.js`**: Checks semantic versioning and release requirements.
- **`node src/cli/fixture-check.js --strict`**: Runs capability matrix checks in strict verification mode.
- **`node src/cli/release-readiness.js --mode <mode>`**: Verifies release readiness mode blocks/warnings.
- **`node src/cli/beta-check.js --mode public-preview --json`**: Verifies release audience handoff readiness, required tester documentation, known limits, and real-sample capability coverage.
- **`npm run public-preview-package -- --json`**: Verifies the public preview installer handoff decision, installer role, and release readiness summary.

---

## 3. Release Handoff & Tagging Steps

1. **Run Handoff Gate**: Ensure `npm run release:public-preview` passes successfully.
2. **Review Storylines**: Review the generated `docs/sample-scenarios.md` to ensure any known limits are properly documented and communicated to users.
3. **Trigger Security Audit**: Execute `npm run secrets-audit` to guarantee no sensitive keys are cached in settings.
4. **Prepare Feedback Bundle**: Generate a diagnostic bundle (`npm run feedback-bundle`) for baseline validation recording.
5. **Verify Public Preview Package**: Run `npm run public-preview-package -- --json` and confirm `decision.ready: true` plus a primary NSIS installer path.
6. **Tag the RC**: Tag the commit in git:
   ```bash
   git tag -a v0.1.0-rc1 -m "Schema Docs v0.1.0 public preview release candidate 1"
   git push origin v0.1.0-rc1
   ```
