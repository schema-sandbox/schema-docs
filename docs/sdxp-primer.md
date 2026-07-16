# SDXP Primer: Schema Docs Exchange Protocol in One Page

> **SDXP** is a simple open format for sharing AI-ready documents safely. Think of it as a signed envelope for document context.

---

## The Problem

You have a Word document, a PDF, or a spreadsheet. You want to send part of it to an AI model, but:

- You are not sure **what exactly** will be sent.
- It might contain **credentials, PII, or confidential data**.
- The receiver has no way to **verify** the file came from you unaltered.
- There is no **audit trail** of what was sent or blocked.

SDXP solves this.

---

## What Is an SDXP Exchange Package?

An SDXP package is a **directory** that can be zipped and shared:

```text
my-report.exchange/
|-- manifest.json        # package identity, hashes, and metadata
|-- document.md          # the actual document content in Markdown
|-- document.schema.json # structural schema for document.md
|-- evidence.jsonl       # imports, conversions, and Send Gate decisions
`-- receiver-report.md   # human-readable trust summary
```

That is it. No proprietary format. No binary lock-in. Just files you can open in any text editor.

---

## Key Concepts

### 1. Content Is Markdown

The original Office, PDF, CSV, or spreadsheet file is converted locally to Markdown. Markdown is the exchange layer because it is readable, diffable, and AI-friendly.

### 2. Masking Placeholders

Any sensitive data detected locally, such as passwords, API keys, emails, or phone numbers, is replaced with a placeholder **before** it appears in `document.md`:

```text
Original:   "API key: sk-abc123xyz"
In package: "API key: [MASK_SECRET_1]"
```

The restoration map stays on the sender's machine. The receiver gets the masked version.

### 3. SHA-256 Integrity

Every file in the package has a SHA-256 hash recorded in `manifest.json`. Recipients and tools can verify the package was not tampered with after creation.

### 4. Send Gate Verdict

The `manifest.json` includes a `sendGateDecision`:

- `allowed`: the document passed checks and was sent.
- `allowed_after_review`: the sender reviewed warnings and approved.
- `blocked`: the document was blocked and logged locally, not sent.

### 5. Receiver Trust Report

`receiver-report.md` gives the recipient a plain-language summary:

```markdown
## Trust Report

Verdict: trusted

- [OK] Package integrity: all SHA-256 hashes match.
- [OK] Source provenance: import history recorded.
- [OK] Send Gate: allowed, with no blocking warnings.
- [WARN] Known limits: table structure simplified.
```

---

## Example `manifest.json`

```json
{
  "sdxpVersion": "1.0",
  "packageId": "pkg_abc123",
  "createdAt": "2026-07-02T10:00:00Z",
  "sourceFile": "report.docx",
  "contentHash": "sha256:aabbcc...",
  "sendGateDecision": "allowed",
  "maskingApplied": true,
  "verdict": "trusted"
}
```

---

## Who Is SDXP For?

| User | How they use SDXP |
|------|-------------------|
| **Individual** | Send documents to AI without leaking secrets. |
| **Team** | Share AI-ready document bundles with audit trails. |
| **Enterprise** | Plug custom DLP rules into the masking layer. |
| **Developer** | Build tools that read and verify `.exchange` packages. |

---

## Reading an SDXP Package

Since it is just files, any tool can read an SDXP package:

```python
import json
import pathlib

pkg = pathlib.Path("my-report.exchange")
manifest = json.loads((pkg / "manifest.json").read_text())
content = (pkg / "document.md").read_text()

print(f"Verdict: {manifest['verdict']}")
print(f"Content preview: {content[:200]}")
```

---

## Full Specification

See [`docs/sdxp-spec-v1.0.md`](sdxp-spec-v1.0.md) for the complete technical specification, including:

- Full `manifest.json` schema.
- `evidence.jsonl` record format.
- `[MASK_*]` placeholder naming conventions.
- Reversibility and restoration requirements.
- Trust report generation rules.

---

*SDXP is an open format. Implementations welcome.*
