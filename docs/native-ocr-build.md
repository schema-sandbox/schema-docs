# Internal Windows OCR build

The OCR engine is an internal component of Schema Docs. PDFium supplies page
images; the native worker sends RGB pixels directly to Tesseract. PNG support
also preserves the existing command-line fallback. This build excludes training
tools, network clients, archive support, GUI libraries and unused image codecs.

## Rebuilding

Download the four official archives listed in `config/native-ocr-sources.json`
to a local directory. The build script performs no downloads and checks all
archive hashes before extraction into a fresh workspace directory:

```powershell
pwsh -File scripts/build-native-ocr.ps1 -ArchiveDirectory .ai-doc-exchange/native-source
```

The script requires Visual Studio C++ Build Tools, CMake and Ninja. It records
compiler/SDK versions, commands, source archive hashes, original notices and
output file hashes in `package/build-receipt.json`. This is a repeatable source
build recipe, not a claim of byte-for-byte reproducibility: timestamps and
compiler versions can change binary hashes. Rebuilding requires explicitly
reviewing and updating the binary input lock before runtime assembly.

## Components and terms

- Tesseract 5.5.0: Apache-2.0; original LICENSE and AUTHORS included.
- Leptonica 1.85.0: BSD-style two-clause terms; original license included.
- libpng 1.6.58: original libpng license and AUTHORS included.
- zlib 1.3.2: original zlib license included.
- English and simplified Chinese data remain the pinned `tessdata_fast` 4.1.0
  files under Apache-2.0; the runtime input lock records their hashes.
- MSVC release C/C++ runtime is statically linked. This does not remove its
  separate redistribution terms. See [Build Tools terms](https://visualstudio.microsoft.com/license-terms/vs2022-ga-diagnosticbuildtools/)
  and [Visual Studio redistribution list](https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution).

The source build replaces the previous opaque MinGW DLL closure. It does not
by itself certify the complete Python/PDFium/native runtime for public release.
The public gate stays closed until the remaining notice review and clean
Windows installation/offline conversion acceptance are complete.
