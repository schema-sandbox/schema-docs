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
| `schema-docs_0.1.2_x64-setup.exe` | 25,361,421 bytes | `04b0fc994aa3f33c35a0e94bb9cbaff5b98215fa7f86d070bf651b3877a3d245` |
| `schema-docs_0.1.2_x64_en-US.msi` | 37,193,010 bytes | `8b523b4d4cebc5dcd7c8a373fba9ced37da35d300a5c323ff7e839e03a44a5f7` |
| `schema-docs_0.1.2_x64-portable.zip` | 37,029,955 bytes | `dffd7d193284ed1c58cf7b1652aeee3118e2d8cb93e6c73cf8e18eb4cbe6f70b` |

## Verification

- Full automated test suite: 332 passed, 1 skipped, 0 failed on v0.1.2.
- Dedicated security regression suite: 11 passed, 0 failed.
- Rust desktop compile and Windows packaging passed on v0.1.2.
- Packaged runtime bridge, real desktop launch, and end-to-end desktop workflow smokes passed.

## Known limits

- PDF formula regions that are images remain images; Schema Docs improves their presentation but does not claim full mathematical OCR reconstruction.
- Scanned PDFs still require optional local OCR tools and visual review.
- Very large imports and exports can take several minutes; keep the desktop application open until completion.
