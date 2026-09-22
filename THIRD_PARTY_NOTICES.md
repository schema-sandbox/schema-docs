# Third-Party Notices

Schema Docs distributes or uses the following open-source browser libraries:

- KaTeX - https://github.com/KaTeX/KaTeX - MIT License
- markdown-it - https://github.com/markdown-it/markdown-it - MIT License
- docx - https://github.com/dolanmiu/docx - MIT License

Their copyright notices and license terms remain applicable to their respective
components. The common MIT License text is reproduced below.

## Private document conversion runtime (Windows test candidate)

The generated `runtime/manifest.json` lists every component file, version, size,
and SHA-256 checksum. Python's license is included as `python/LICENSE.txt`;
Python package license directories are retained in their installed distribution
metadata, including PDFium's bundled notices. Tesseract's license, authors, and
source build records are retained under `tesseract/notices` and
`tesseract/build-receipt.json`.

This candidate contains Python 3.12.14, pdfplumber 0.11.9, pdfminer.six 20251230,
pypdfium2 5.13.0, Pillow 12.3.0, charset-normalizer 3.5.1, cryptography 50.0.1,
cffi 2.1.1, pycparser 3.0, and a source build of Tesseract 5.5.0 with English and simplified
Chinese data. Their licenses are separate from the project's MIT license.

The OCR build statically links Leptonica 1.85.0, libpng 1.6.58 and zlib 1.3.2;
their original notices are included. Source URLs, archive hashes and the build
recipe are recorded in `config/native-ocr-sources.json` and
`docs/native-ocr-build.md`. This replaces the previous 35-binary MinGW closure
with two native binaries. The MSVC release runtime is statically linked and
retains its separate terms. The remaining complete-runtime redistribution
review is still pending, so the public gate remains closed. Local builds do not
certify public redistribution readiness. No Docling source or model weights are
included.

## MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
