# Schema Docs Universal Positioning

This note captures the open-source launch positioning for Schema Docs.

## Core Thesis

Schema Docs should not present itself as another document converter.

It should present itself as a local, auditable intake gateway for people who
already send documents to LLMs.

The strongest one-line positioning is:

> Before a document reaches AI, see what AI will see.

The product wins when users understand this in the first 30 seconds:

1. Import a Word, PDF, spreadsheet, CSV, or Markdown file.
2. Convert it locally into AI-readable context.
3. Mask PII and credential-like content locally.
4. Preview the exact AI context.
5. Approve, block, or export a verifiable SDXP package.

## Why It Can Stand Out On GitHub

Developers care about three things when evaluating an open-source tool:

- It solves a real daily problem.
- Its architecture is technically disciplined.
- It can be understood and tried quickly.

Schema Docs has strong technical material:

- Zero runtime dependencies.
- Local-first masking and Send Gate review.
- DOCX/PDF/CSV/XLSX/Markdown intake.
- AI Will See preview before any send.
- SDXP package format with evidence and trust reports.
- One-command demo through `npm run demo`.
- Release gates for tests, size, language boundary, root cleanliness, and readiness.

That combination is different from plain converters, RAG tools, or office editors.

## Competitive Frame

Schema Docs should not compete head-on with Office, WPS, Obsidian, Typora,
Notion, or RAG products.

The competitive frame is:

- MarkItDown: conversion only, not Send Gate, masking, evidence, or exchange.
- Marker/OCR tools: extraction quality, often heavy dependencies or GPU needs.
- RAG tools: downstream knowledge systems, not the local document intake boundary.
- Office editors: original editing environments, not AI safety gateways.

Schema Docs should occupy the boundary before AI:

> Document in. Local conversion and safety review. AI-ready context out.

## Launch Requirements

Before public launch, these must stay true:

1. The README first screen must be English and immediately explain the AI intake role.
2. `npm run demo` must show the full value loop without setup friction.
3. The repository root must be clean; generated `tmp-*` artifacts should never be visible.
4. A visual explanation should appear near the top of the README.
5. Release gates must stay green before every public package handoff.

Current status:

- English README: done.
- One-command demo: done.
- Root clean gate: done through `npm run root-clean-check`.
- Core visual: done through `docs/images/schema_docs_gateway_infographic.png`.
- Public preview readiness: done through `npm run release-readiness`.

## UI Direction

The UI does not need decorative polish before public preview. It needs hierarchy.

The first screen should focus on one workflow:

1. Import document.
2. Review AI Will See.
3. Confirm or block through Send Gate.
4. Save handoff or SDXP package.

Advanced panels such as SQL, audit chain details, settings, and package internals
should remain available but secondary.

The goal is not to imitate an office suite. The goal is to make users feel:

> My document is protected before AI sees it.

## Infrastructure Potential

Schema Docs can become infrastructure only if it stays boring, embeddable, and
portable.

The long-term path is protocol first, tool second:

- SDXP defines a portable exchange package.
- The app is the reference implementation.
- CLI and SDK make it embeddable.
- The desktop app makes it usable by non-developers.

The infrastructure analogy is closer to cURL, SQLite, or Pandoc than to a SaaS
workspace product. The product should be a pipe, not a platform.

## Non-Negotiables

- Keep the local-first trust boundary.
- Keep zero runtime dependencies unless an optional adapter boundary is explicit.
- Keep Markdown as the exchange layer, not the visible ideology.
- Keep Office/PDF/spreadsheet intake as the user's mental entry.
- Keep AI Will See and Send Gate as the center of the product.
- Keep SDXP simple enough for independent implementations.
