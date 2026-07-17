# Schema Docs v0.1.1 Public Preview

Schema Docs v0.1.1 is a patch release for the Windows public preview.

## What changed

- Stabilized large PDF import progress and failure reporting.
- Improved preservation and visual blending of formula images extracted from PDFs.
- Kept Markdown formulas stable during single-click inline editing.
- Serialized full-document exports so Word, PDF, HTML, and Markdown jobs no longer compete for memory.
- Prevented silent overwrites by saving repeated exports as `name (2).ext`, `name (3).ext`, and so on.
- Rebuilt all Windows artifacts from the corrected source.

## Windows artifacts

Windows downloads:

- `schema-docs_0.1.1_x64-setup.exe`
- `schema-docs_0.1.1_x64_en-US.msi`
- `schema-docs_0.1.1_x64-portable.zip`
- `SHA256SUMS.txt`

| Artifact | Size | SHA-256 |
|---|---:|---|
| `schema-docs_0.1.1_x64-setup.exe` | 25,361,475 bytes | `0743f3f884eb2d46487dbe8253324ae05e3628dd2ec77859a99b75ff11b33f5a` |
| `schema-docs_0.1.1_x64_en-US.msi` | 37,180,437 bytes | `c03e6324da9a243423737a6fbbebb8e3ff053bb22cf4d3ef3895eea1143091e0` |
| `schema-docs_0.1.1_x64-portable.zip` | 37,017,019 bytes | `4e5b58718fc732c0dec3ac65f9ba0952e5850cf76bc612d96b61172879066483` |

## Verification

- Full automated test suite: 332 passed, 1 skipped, 0 failed on v0.1.1.
- Rust desktop compile and Windows packaging passed.
- Packaged runtime structure checks passed for the installer and portable layouts.
- Large-document export queue and numbered no-overwrite behavior have dedicated regressions.

## Known limits

- PDF formula regions that are images remain images; Schema Docs improves their presentation but does not claim full mathematical OCR reconstruction.
- Scanned PDFs still require optional local OCR tools and visual review.
- Very large imports and exports can take several minutes; keep the desktop application open until completion.
