# Tester Onboarding Guide

Welcome to the Schema Docs public preview. Schema Docs is a local-first AI document intake pipeline for Office, PDF, spreadsheet, Markdown, and API workflows.

> [!IMPORTANT]
> **Primary Target Platform**: Windows is the prioritized target for the v0.1.0 public preview. Verification on other operating systems is not promised or officially supported for this release.

> [!WARNING]
> **Privacy Safety Warning**: Do NOT paste or record real production API keys, production tokens, or actual credentials in the workspace settings, prompt preview field, or verification records. Use mock keys (e.g. `sk-proj-123456...` or `bearer eyJ...`) for verification.

## 1. What Schema Docs Is
- **Office-First Exchange Workflow:** Keeps Word, PDF, Excel, and WPS-style source files as the visible user entry while normalizing content into a Markdown exchange layer for AI preview, audit, API access, and Word/PDF export.
- **Privacy Masking Firewall:** High-precision local redaction of API keys, passwords, emails, and credentials *before* sending anything to a model provider. Auto-restores original text in memory locally upon receiving LLM responses.
- **In-Memory SQL Query Engine:** Run local SQL query statements (`SELECT`, `WHERE`, `GROUP BY`, `ORDER BY`, `LIMIT`) directly on CSV and Excel datasets.
- **Traceable Evidence Log:** All workspace actions, conversions, and package signatures compute cryptographic SHA-256 hashes and save to a local audit timeline.

## 2. Getting Started with the Demo

### Step 1: Open the Demo Workspace
- In the workspace path input, paste:
  `<repo>\samples\quickstart-workspace`
- Click **Open / create**. The workspace auto-heals and registers samples.

### Step 2: Import & Convert
- Choose **Choose local file** to pick your document.
- Click **Import path** to register it in the workspace.
- Locate the document ID in the manifest list, input it into the record box, and click **Extract to Markdown**.

### Step 3: Run Diagnostics & Edit
- Check the **Inbox** and **Timeline** panels on the Workspace Dashboard for recent activities, system logs, and actionable recommendation steps.
- Inspect the **Version history** panel inside the Markdown editor workspace to see, diff, or roll back edits.

### Step 4: Run SQL Query & Export
- Type a standard query on `sample_table` (e.g. `SELECT * FROM sample_table WHERE age > 25`).
- View the query logs and click export to Markdown table or CSV.

### Step 5: Save & Validate Exchange Package
- Use the Exchange Package area to build a directory-based `.exchange` package containing Markdown notes, datasets, exports, and evidence logs.
- Use **Read and verify package** to perform hash integrity checks.

---

## 3. Tester Tasks Checklist
- [ ] Open the quickstart-workspace demo.
- [ ] Import a standard DOCX document.
- [ ] Import a digital PDF document.
- [ ] Import a CSV or XLSX sheet.
- [ ] Run a SQL query with `GROUP BY` and `LIMIT`.
- [ ] Run a simple `INNER JOIN ... ON ...` query over two CSV/XLSX-derived tables.
- [ ] Trigger an advanced SQL warning with `HAVING` or an unsupported complex query.
- [ ] Perform a dry-run AI preview with secret keys to verify local masking.
- [ ] Export your normalized Markdown note to Word or PDF.
- [ ] Save an Exchange Package.
- [ ] Click the **Generate diagnostic bundle** button or run the feedback CLI.

---

## 4. What NOT to Expect / Out of Scope
- **Full Office Editor:** This is a document exchange, not a competitor to MS Word or WPS.
- **OCR Processing:** Scanned PDFs can use optional local Tesseract + Poppler OCR. Without those tools the workflow remains blocked; handwriting, formulas, tables, and reading order still require review against the source.
- **Advanced SQL:** Simple INNER JOIN equality is supported; complex joins, subqueries, and HAVING still require split queries or export.
- **Real-Time Bidirectional Sync:** Files are refreshed manually.

---

## 5. Feedback Formatting
When filing an issue, please run the Feedback Bundle tool and submit the output logs along with the following:
- Input File Extension: (e.g. `.docx`, `.pdf`)
- Contains Sensitive Content: (Yes/No)
- Expected Behavior vs Actual Behavior:
- Quality warnings shown on dashboard:
- Diagnostic Bundle Location:
