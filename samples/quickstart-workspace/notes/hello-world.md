# Schema Docs Quickstart

Welcome to the Schema Docs exchange workspace.

This demo workspace shows the public-preview workflow for turning local files into AI-ready, auditable Markdown context.

## Core Demo Paths

1. **Original files stay visible, Markdown becomes the exchange layer**
   - Open the Offline Import and Extraction panel to inspect the bundled `sample-table.csv` file.
   - Edit this Markdown note, then export it to Word or PDF under `exports/`.

2. **Local SQL before AI**
   - Open the Local SQL Query panel and list the workspace tables.
   - Schema Docs infers the fields in `sample-table.csv`. Try `select * from sample_table where age > 25` to filter data locally before creating AI context.

3. **AI Send Gate and privacy masking**
   - Enable local reversible PII and secret masking.
   - Enter test-only sensitive text such as `My API key is sk-abc123xyz and contact is test@example.com`.
   - Generate an AI preview. The local gateway should replace sensitive values with `[MASK_SECRET_1]` and `[MASK_EMAIL_1]` before anything is sent.
