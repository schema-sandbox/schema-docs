# Marker: Optional Channel for Mathematics Textbooks

Marker is an **optional, local, opt-in** adapter for one specific case: a
mathematics or science PDF whose pages the built-in extractor cannot read in the
right order. It is not installed with Schema Docs, is never invoked for ordinary
PDFs, and adds no runtime dependency. If it is absent, every other workflow
behaves exactly as before.

## When the built-in path is enough

The built-in extractor is the default and handles most PDFs. Keep using it when:

- the document is prose with occasional display equations;
- the output reads correctly and formulas render;
- the file is a report, contract, spreadsheet export, or scanned page.

## When to reach for Marker

Choose Marker when a page's **reading order** is wrong, not when a single formula
is imperfect. The symptoms are structural:

- inline mathematics arrives as loose symbols scattered through a sentence, for
  example `cont ⊆ radicting` or `denoted − ⊤ by`;
- word spacing collapses, so `abeliansubgroupofcontaining` appears in the text;
- superscripts and subscripts detach from the variable they belong to;
- two-column or heavily typeset LaTeX pages interleave body text with symbols.

These come from the PDF text layer drawing prose and mathematics on separate
baselines with near-identical coordinates. Rebuilding that from coordinates is
guesswork; Marker re-derives the page layout instead.

## Installing Marker

Marker is a Python package and pulls in machine-learning models on first run.
Install it into its own environment so it cannot disturb the Schema Docs
runtime, which stays dependency-free.

```bash
python -m venv ~/.schema-docs-marker
# Windows: %USERPROFILE%\.schema-docs-marker\Scripts\activate
source ~/.schema-docs-marker/bin/activate
pip install marker-pdf
```

Verify the executable resolves:

```bash
marker_single --help
```

Schema Docs finds Marker in one of two ways:

1. `marker_single` is on `PATH`; or
2. `SCHEMA_DOCS_MARKER` points at the executable:

```bash
# Windows
set SCHEMA_DOCS_MARKER=%USERPROFILE%\.schema-docs-marker\Scripts\marker_single.exe
# macOS / Linux
export SCHEMA_DOCS_MARKER="$HOME/.schema-docs-marker/bin/marker_single"
```

Confirm detection:

```bash
npm run doctor
```

Marker appears under adapter capabilities. `[WARN] ... Not found (fallback
active)` means Schema Docs will keep using the built-in path — that is a healthy
state, not an error.

## Using the channel

Marker only runs when explicitly selected. In the document panel choose
**Marker full-page reconstruction (slowest)** before converting, or call the API
with `preferredExtractor: "marker"`. The built-in path stays the default for
every other document.

Inline mathematics is requested automatically. Marker converts display equations
by default but leaves inline mathematics as plain text unless its inline pass is
enabled, and inline mathematics is the substance of a textbook. Callers that only
need display equations can pass `inlineMath: false` to skip that model pass.

## What to expect

- **Slow.** Full-page reconstruction with model passes takes far longer than
  text extraction. A book-length PDF is a long job, not an interactive one.
- **Not exact.** Marker emits embedded LaTeX but does not guarantee correctness.
  Complex or unusual notation still needs review against the source pages.
- **Heavy on disk.** The models are large. They live in the Marker environment,
  not in the Schema Docs installation.
- **Local.** No document content leaves the machine.

## If Marker is unavailable

Requesting Marker without installing it does not fail the conversion. The
pipeline records the attempt, keeps the built-in output, and reports that the
adapter was unavailable — so the document is still converted, just without
full-page reconstruction.
