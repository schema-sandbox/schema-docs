# Schema Docs v0.1.2 Security Update

Schema Docs v0.1.2 is a security-hardening update for the Windows public preview.

## What changed

- Confined Markdown and document exports to the active workspace and blocked path traversal, unsafe absolute paths, and symbolic-link escapes.
- Added Office ZIP protections for entry count, expanded size, compression ratio, ZIP64, encryption, bounds, and decompression output.
- Moved the internal desktop API to a private named pipe and protected its loopback proxy with one-time pairing, exact origin checks, scoped image tokens, and strict CORS.
- Added limits for JSON and upload request bodies.
- Removed the API master token from URLs and browser globals.
- Removed inline-script permission from the desktop Content Security Policy.
- Added dedicated security regression tests and revalidated the complete Windows desktop workflow.

## Security behavior change

Direct external Markdown read/write and API-driven export to arbitrary absolute paths are no longer allowed. Import files into a Schema Docs workspace first; server-side output paths must stay inside that workspace.

## Windows artifacts

Upload these four files from `release/windows` after the final build:

- `schema-docs_0.1.2_x64-setup.exe`
- `schema-docs_0.1.2_x64_en-US.msi`
- `schema-docs_0.1.2_x64-portable.zip`
- `SHA256SUMS.txt`

| Artifact | Size | SHA-256 |
|---|---:|---|
| `schema-docs_0.1.2_x64-setup.exe` | 25,365,648 bytes | `206df6a5fd47c79410281bedfcf0ff4cdc951502da6f964d8091229cf5b60082` |
| `schema-docs_0.1.2_x64_en-US.msi` | 37,197,106 bytes | `2467757f6b14d178ffe580f38f02094822879989ef83fe5bf22f642bd3be80b1` |
| `schema-docs_0.1.2_x64-portable.zip` | 37,029,954 bytes | `a2f428931862d80a64428b13b7a094fdfddacd96144abbab7e92a56ff96e3e68` |

## Verification

- Full automated test suite: 332 passed, 1 skipped, 0 failed on v0.1.2.
- Dedicated security regression suite: 11 passed, 0 failed.
- Rust desktop compile and Windows packaging passed on v0.1.2.
- Packaged runtime bridge, real desktop launch, and end-to-end desktop workflow smokes passed.

## Known limits

- PDF formula regions that are images remain images; Schema Docs improves their presentation but does not claim full mathematical OCR reconstruction.
- Scanned PDFs still require optional local OCR tools and visual review.
- Very large imports and exports can take several minutes; keep the desktop application open until completion.
