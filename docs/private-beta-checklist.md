# Public Preview Release Checklist

This page details the release checklist that must be satisfied before distributing the Schema Docs AI document intake layer to external public preview testers on Windows.

## Automated Checker
You can run the automated checklist tool:
```bash
npm run beta-check -- --mode public-preview
```

## Checklist Criteria

| Area | Check Item | Status Requirement | Automated Verification Script |
|------|------------|--------------------|---------------------------------|
| **Tests** | Full Node test suite passes: 333 tests, 332 pass, 1 skipped manual external-sync scenario | Mandatory | `npm test` |
| **Verification** | Release check clean | Mandatory | `npm run release-check` |
| **Fixture** | Strict desktop manual flows verification closed | Mandatory | `npm run fixture-check -- --strict` |
| **Handoff** | F-012 closed and validated | Mandatory | `npm run release-readiness -- --mode public-preview` |
| **Documentation** | Tester onboarding documentation exists | Mandatory | Check `docs/tester-onboarding.md` |
| **Feedback** | Diagnostics feedback bundle command available | Mandatory | `feedback-bundle` CLI and POST API check |
| **Limits** | Known Limits catalog registered | Mandatory | Check `samples/known-limits.json` |
| **Real Samples** | At least 20 real sample document check logs preserved, with `ai_intake`, `safety_gate`, `format_exchange`, `table_filter`, `long_input`, and `external_refresh` capability coverage | Mandatory | `npm run release-readiness` |
| **Credentials** | API Key leakage scan passed | Mandatory | `secrets-audit` |
