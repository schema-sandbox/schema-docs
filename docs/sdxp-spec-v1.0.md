# Schema Docs Exchange Protocol (SDXP) Specification

Version: **v1.0 draft**
Status: **Open draft, not yet a formal standard**
Author: **Schema Docs Core Group**
Date: **2026-07-02**

---

## 1. Introduction

The **Schema Docs Exchange Protocol (SDXP)** defines a local-first, zero-dependency package format and audit protocol for transferring document context safely between humans, software tools, and Large Language Models (LLMs).

This document is intentionally independent from the Schema Docs application. A tool can produce or consume an SDXP package without embedding Schema Docs code.

SDXP exists because today's AI document workflow often has no standard answer for four basic questions:

1. What exact document content was prepared for AI?
2. Which sensitive values were masked before review or send?
3. What evidence proves the package was not changed after creation?
4. Was content previewed, blocked, or actually sent?

SDXP answers those questions with a small directory layout, JSON metadata, Markdown content, SHA-256 hashes, and append-only evidence records.

---

## 2. Directory Layout

An SDXP package is a directory, usually suffixed with `.exchange`, containing this layout:

```text
my-package.exchange/
|-- manifest.json         # Package metadata, hashes, and policy declarations
|-- document.md           # Canonical Markdown representation of the document
|-- document.schema.json  # Structural schema for document.md
|-- evidence.jsonl        # Chronological security and audit evidence
|-- exports/              # Optional exported assets, such as PDF or DOCX
`-- tables/               # Optional helper datasets or segmented table assets
```

All package paths MUST be relative. Consumers MUST reject absolute paths and path traversal segments such as `..`.

---

## 3. Manifest Specification

`manifest.json` is the package index. It identifies the canonical document, declared hashes, package metadata, and safety policies.

Required fields:

* **`version`** (integer): SDXP package format version, for example `1`.
* **`packageVersion`** (string): SemVer version of the packaged content.
* **`packageType`** (string): Usually `markdown.exchange`.
* **`title`** (string): Human-readable package title.
* **`canonicalDocument`** (object): Points to `document.md`.
  * `path` (string): Relative path, usually `document.md`.
  * `hash` (string): SHA-256 hash prefixed with `sha256:`.
* **`documentSchema`** (object): Points to `document.schema.json`.
  * `path` (string): Relative path.
  * `hash` (string): SHA-256 hash prefixed with `sha256:`.
* **`evidenceFile`** (object): Points to `evidence.jsonl`.
  * `path` (string): Relative path.
  * `hash` (string): SHA-256 hash prefixed with `sha256:`.
* **`createdAt`** (string): ISO-8601 timestamp.
* **`policies`** (object): Safety declarations.
  * `policyMode` (string): For example `open-core`, `team`, or `enterprise`.
  * `storesRawPrompt` (boolean): SHOULD be `false`.
  * `storesApiKey` (boolean): MUST be `false`.
  * `defaultNetworkScope` (string): SHOULD describe when network send is allowed.

Example:

```json
{
  "version": 1,
  "packageVersion": "1.0.0",
  "packageType": "markdown.exchange",
  "title": "Q3 Delivery Package",
  "canonicalDocument": {
    "path": "document.md",
    "hash": "sha256:fc0c11518485486a261e8449b091a46f6c2ab441c8f1367bb60a336e6377f179"
  },
  "documentSchema": {
    "path": "document.schema.json",
    "hash": "sha256:bed75ae0c34dc144cd993be628218ad860f660a5d2f0f417b054532047ac922f"
  },
  "evidenceFile": {
    "path": "evidence.jsonl",
    "hash": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  },
  "createdAt": "2026-07-02T01:52:31.116Z",
  "policies": {
    "policyMode": "open-core",
    "storesRawPrompt": false,
    "storesApiKey": false,
    "defaultNetworkScope": "user_confirmed_ai_endpoint_only"
  }
}
```

---

## 4. Local Sanitization and Masking

Sensitive values selected for AI context SHOULD be masked locally before review or send.

Standard placeholder forms:

* **`[MASK_EMAIL_N]`**: Email address.
* **`[MASK_PHONE_N]`**: Phone number or phone-like identifier.
* **`[MASK_SECRET_N]`**: API key, password, bearer token, cloud credential, or credential-like token.
* **`[MASK_IP_N]`**: IP address.

`N` is a 1-based integer scoped to one masking session.

The reversible mapping from placeholders to original values MUST remain local and temporary. It MUST NOT be written into the SDXP package, included in `evidence.jsonl`, or transmitted to an AI endpoint.

---

## 5. Evidence and Audit Trail

`evidence.jsonl` records one JSON object per line. Consumers MUST tolerate unknown fields and MUST reject malformed JSON lines when strict verification is requested.

Common event fields:

* **`id`** (string): Unique identifier, usually starting with `evidence_`.
* **`kind`** (string): Example values: `document_extraction`, `ai_preview`, `ai_send`, `ai_send_blocked`.
* **`inputFileHash`** (string): Source file hash when available.
* **`sentContentHash`** (string): Hash of selected AI context after sanitization. For previews and blocked sends, this does not imply network transmission.
* **`policyDecision`** (string): Example values: `preview_only`, `user_confirmed_selected_context`, `blocked_review_required`.
* **`sendGateDecision`** (string): Example values: `allow`, `review_recommended`, `review_required`, `never_send`.
* **`sendGateSignals`** (array): Machine-readable safety signals.
* **`aiSent`** (boolean): `true` only when content was actually sent to an AI endpoint.
* **`createdAt`** (string): ISO-8601 timestamp.

---

## 6. Trust Report and Verification

An SDXP verifier SHOULD run this checklist:

1. Open `manifest.json`.
2. Resolve `canonicalDocument.path`, `documentSchema.path`, and `evidenceFile.path`.
3. Confirm all resolved paths stay inside the package root.
4. Recalculate SHA-256 hashes for `document.md`, `document.schema.json`, and `evidence.jsonl`.
5. Compare recalculated hashes to manifest hashes.
6. Parse `evidence.jsonl` line by line.
7. Scan `document.md` for raw credentials or other configured sensitive patterns.
8. Return one of these verdicts:
   * **`trusted`**: Required hashes match, required files exist, no raw secrets are detected.
   * **`trusted_with_warnings`**: Integrity holds, but quality, policy, or optional evidence warnings exist.
   * **`blocked`**: Required files are missing, hashes do not match, unsafe paths are present, or raw secrets are detected.

---

## 7. Minimal Reader Contract

A minimal SDXP reader does not need a database, desktop app, local server, or Schema Docs runtime. It only needs JSON, Markdown, JSONL, SHA-256, and filesystem path checks.

This is the core portability goal: SDXP should be simple enough for a second implementation in Python, Go, Rust, Java, or a browser extension.
