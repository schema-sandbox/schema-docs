# Schema Docs Local API Contract

This document specifies the local REST API contract for Schema Docs. Local API calls use the `x-ai-doc-exchange-token` header from `/app-config.js`. The default preview port is `4177`, with fallback ports used when the preferred port is unavailable.

`POST /api/mask` and `POST /api/unmask` are token-protected local-only endpoints that do not require `workspacePath`. This lets the desktop AI summon key mask clipboard text before any workspace is selected. All other non-health API routes require a workspace path unless stated otherwise.

## 1. Document Ingest & Extract
- **Endpoint:** `POST /api/import`
- **Upload endpoint:** `POST /api/import-upload?workspacePath=<workspace>&filename=<name>`
- **Request Body:**
  ```json
  {
    "workspacePath": "<workspace>",
    "sourcePath": "<source-file>"
  }
  ```
- **Upload body:** raw file bytes. The upload endpoint reads `workspacePath` from the query string or `x-schema-docs-workspace-path`, and reads the original filename from the query string or `x-schema-docs-filename`.
- **Response:**
  ```json
  {
    "ok": true,
    "data": {
      "id": "doc_xxxx",
      "name": "file.pdf",
      "sourceType": "pdf",
      "status": "ready",
      "warnings": []
    }
  }
  ```

---

## 2. Refresh
- **Endpoint:** `POST /api/records/refresh`
- **UI endpoint:** `POST /api/record/refresh`
- **Preview endpoint:** `POST /api/record/refresh-preview`
- **Source refresh endpoint:** `POST /api/record/refresh-source`
- **Bulk endpoint:** `POST /api/records/refresh-all`
- **Request Body:**
  ```json
  {
    "workspacePath": "<workspace>",
    "recordId": "doc_xxxx"
  }
  ```
- **Response:**
  ```json
  {
    "ok": true,
    "data": {
      "id": "doc_xxxx",
      "changed": false,
      "reimported": false
    }
  }
  ```

---

## 3. Quality Report
- **Endpoint:** `GET /api/actions/suggestions/:recordId`
- **Response Schema:** matches `schemas/quality-report.schema.json`
- **Example Response:**
  ```json
  {
    "ok": true,
    "data": {
      "id": "quality_xxxx",
      "recordId": "doc_xxxx",
      "inputType": "pdf",
      "textLayerDetected": true,
      "scannedLikely": false,
      "confidence": "medium",
      "matchedKnownLimits": ["complex_pdf_layout"],
      "suggestedActions": ["Review simplified tables manually."],
      "recommendedNextStep": "Review simplified tables manually."
    }
  }
  ```

---

## Workspace Manifest Handoff Summary
- **Endpoint:** `POST /api/workspace/manifest`
- **CLI:** `node src/cli/index.js workspace <workspace> inspect`
- **CLI summary:** `node src/cli/index.js workspace <workspace> summary`
- **CLI export:** `node src/cli/index.js workspace <workspace> export-manifest` writes `workspace-manifest.json` inside the workspace.
- **SDK:** `client.compileWorkspaceManifest()`
- **Purpose:** return a redacted workspace handoff summary for AI or human testers. It lists documents, datasets, exchange packages, receiver/trust report artifacts, Send Gate decisions, local AI context selections, and saved AI handoff bundles without returning selected Markdown bodies.
- **AI context handoff fields:** `aiContextSelections[].selectionRange` records safe chunk/range indexes, `aiContextSelections[].continuation` records `canContinue`, remaining chunk/range counts, and next range command metadata for resuming large-document intake, `aiContextSelections[].queryShape` records safe table/query structure for filtered table context without raw SQL text or rows, and `aiHandoffBundles[]` records saved bundle paths, evidence IDs, source record IDs, and timestamps without returning staged context bodies.
- **Response excerpt:**
  ```json
  {
    "ok": true,
    "data": {
      "aiContextSelections": [
        {
          "type": "ai_context_range_selected",
          "sourceRef": "doc_xxxx",
          "aiSent": false,
          "selectionRange": {"kind": "range", "startChunkIndex": 1, "endChunkIndex": 3},
          "continuation": {"canContinue": true, "nextRangeCommand": "ai-context <workspace> range doc_xxxx 4 6 9000"}
        }
      ],
      "aiHandoffBundles": [
        {"recordId": "doc_xxxx", "relativePath": "notes/ai-handoff-bundle.md", "evidenceId": "evidence_xxxx"}
      ]
    }
  }
  ```

---

## Optional Adapter Capabilities
- **Endpoint:** `GET /api/adapter/capabilities`
- **CLI:** `node src/cli/index.js adapter-capabilities <workspace>`
- **SDK:** `client.adapterCapabilities()`
- **Purpose:** detect optional local system adapters without adding runtime dependencies to the open-core package.
- **Adapters:** LibreOffice (`soffice`), Pandoc, Marker rich PDF conversion, Tesseract OCR, pdfplumber layout extraction, and Poppler `pdftoppm` visual rendering.
- **Response:**
  ```json
  {
    "ok": true,
    "data": {
      "soffice": {
        "name": "LibreOffice (soffice)",
        "mode": "optional-system-adapter",
        "available": false,
        "formats": ["doc", "xls", "ppt", "odt", "ods", "odp"]
      }
    }
  }
  ```

---

### Preserve PDF Visual Content
- **Endpoint:** `POST /api/pdf/preserve-visual-assets`
- **Purpose:** render all mapped low-confidence formulas, tables, and images from the original PDF into a Markdown sidecar and PNG assets. The operation has no hidden page or region limit; individual failures are recorded and processing continues.
- **Request:** `{"workspacePath":"<workspace>","documentId":"doc_xxxx","mode":"fallback","dpi":220}`
- **Related endpoint:** `POST /api/pdf/render-region` renders one mapped page or region on demand.

---

## 4. AI Send Gate
- **Endpoint:** `POST /api/ai/preview`
- **Send endpoint:** `POST /api/ai/send`
- **CLI:** `node src/cli/index.js ai-preview <workspace> <operation> [--mask] <content>`
- **Request Body:**
  ```json
  {
    "workspacePath": "<workspace>",
    "input": {
      "operation": "explain",
      "content": "text content",
      "mask": true
    }
  }
  ```
- **Response Schema:** matches `schemas/ai-send-gate.schema.json`
- **Example Response:**
  ```json
  {
    "ok": true,
    "data": {
      "decision": "review_required",
      "reasons": ["Contains sensitive information patterns."],
      "requiredActions": ["Manual review is required before external transmission."],
      "overrideAllowed": true,
      "knownLimitIds": []
    }
  }
  ```

---

### Prepare Record For AI
- **Endpoint:** `POST /api/ai/prepare-record`
- **CLI:** `node src/cli/index.js prepare-ai <workspace> <record-id>`
- **SDK:** `client.prepareRecordForAi(recordId)`
- **Purpose:** prepare a document or dataset record before opening AI Send Gate. Documents are converted to Markdown when needed; CSV/XLSX datasets are inspected when needed; the response includes the same AI context preview used by the Web/Desktop UI.
- **Request Body:**
  ```json
  {
    "workspacePath": "<workspace>",
    "recordId": "doc_xxxx"
  }
  ```
- **Response:**
  ```json
  {
    "ok": true,
    "data": {
      "recordId": "doc_xxxx",
      "kind": "document",
      "prepared": true,
      "preparationJob": {"id": "job_xxxx", "status": "succeeded"},
      "preview": {
        "markdownSections": ["# Title"],
        "tokenEstimate": 120,
        "aiIntakePlan": {
          "mode": "single_context",
          "chunkCount": 1,
          "chunks": [{"id": "chunk_0001", "index": 1, "estimatedTokens": 120, "headingHint": "# Title"}],
          "recommendedSendStrategy": "Send as one reviewed context after masking."
        },
        "sendGateDecision": "allow",
        "recommendedNextAction": "Document extraction is ready for AI exchange."
      }
    }
  }
  {"workspacePath": "<workspace>", "input": {"operation": "explain", "content": "text content", "mask": true}}
  ```
- **Response Schema:** matches `schemas/ai-send-gate.schema.json`
- **Example Response:**
  ```json
  {"ok": true, "data": {"decision": "review_required", "overrideAllowed": true}}
  ```

---

### Prepare Record For AI
- **Endpoint:** `POST /api/ai/prepare-record`
- **CLI:** `node src/cli/index.js prepare-ai <workspace> <record-id>`
- **SDK:** `client.prepareRecordForAi(recordId)`
- **Purpose:** prepare a document or dataset record before opening AI Send Gate.
- **Request Body:**
  ```json
  {"workspacePath": "<workspace>", "recordId": "doc_xxxx"}
  ```
- **Response:**
  ```json
  {"ok": true, "data": {"recordId": "doc_xxxx", "prepared": true, "preview": {"tokenEstimate": 120}}}
  ```

---

### Compile AI Intake Plan
- **Endpoint:** `POST /api/ai/intake-plan`
- **CLI:** `node src/cli/index.js ai-context <workspace> plan <record-id-or-package-path> [--summary]`
- **SDK:** `client.compileAiIntakeManifest(recordIdOrPackagePath)`
- **Purpose:** return a content-free intake plan for long-document feeding.
- **Response excerpt:**
  ```json
  {"ok": true, "data": {"recordIdOrPackagePath": "doc_xxxx", "tokenEstimate": 12400, "aiIntakePlan": {"mode": "chunked_large_document", "chunkCount": 5}}}
  ```

---

### Resolve AI Context Chunk Range
- **Endpoint:** `POST /api/ai/context-range`
- **CLI:** `node src/cli/index.js ai-context <workspace> range <record-id-or-package-path> <startChunkIndex> <endChunkIndex> [tokenBudget] [--summary]`
- **SDK:** `client.resolveAiContextChunkRange(recordIdOrPackagePath, startChunkIndex, endChunkIndex, tokenBudget)`
- **Purpose:** return a token-budgeted bundle of consecutive Markdown/context chunks without sending it to AI.
- **Response excerpt:**
  ```json
  {"ok": true, "data": {"recordIdOrPackagePath": "doc_xxxx", "includedRange": {"startChunkIndex": 1, "endChunkIndex": 3}, "content": "..."}}
  ```

---

### Save AI Handoff Bundle
- **Endpoint:** `POST /api/ai/handoff-bundle`
- **CLI:** `node src/cli/index.js ai-context <workspace> handoff <record-id-or-package-path> [relative-output-path] [chunkIndex] [--range=start:end] [--budget=9000] [--summary]`
- **SDK:** `client.saveAiHandoffBundle(relativePath, input)`
- **Purpose:** save reviewed or selected AI context as a Markdown Exchange record.
- **Response excerpt:**
  ```json
  {"ok": true, "data": {"relativePath": "notes/ai-handoff-bundle.md", "evidenceId": "evidence_xxxx"}}
  ```

---

### Compile AI Feed Runbook
- **Endpoint:** `POST /api/ai/feed-runbook`
  {
    "ok": true,
    "data": {
      "kind": "ai_feed_runbook",
      "recordIdOrPackagePath": "doc_xxxx",
      "bodyFree": true,
      "sendGateDecision": "allow",
      "totalChunkCount": 14,
      "totalBatchCount": 5,
      "tokenBudget": 9000,
      "markdownRelativePath": "ai-feed/doc_xxxx-runbook.md",
      "jsonRelativePath": "ai-feed/doc_xxxx-runbook.json",
      "batches": [
        {
          "batchIndex": 1,
          "status": "planned",
          "startChunkIndex": 1,
          "endChunkIndex": 3,
          "command": "ai-context <workspace> range doc_xxxx 1 3 9000"
        }
      ]
    }
  }
  ```

The runbook is deliberately not a document-content endpoint. It does not contain extracted Markdown body text, selected chunk text, raw prompts, or API keys. It is meant for AI desktop agents, testers, and operators who need a resumable queue for very large PDFs/books while preserving Send Gate review per batch.

Status and batch updates:

- **Endpoint:** `POST /api/ai/feed-runbook/status`
- **CLI:** `node src/cli/index.js ai-context <workspace> runbook-status <json-relative-path> [--summary]`
- **SDK:** `client.readAiFeedRunbook(jsonRelativePath)`
- **Purpose:** read the body-free queue state, including completed/blocked batches and the next planned command.

- **Endpoint:** `POST /api/ai/feed-runbook/batch`
- **CLI:** `node src/cli/index.js ai-context <workspace> runbook-batch <json-relative-path> <batchIndex> <planned|pulled|reviewed|sent|skipped|blocked> [note] [--summary]`
- **SDK:** `client.updateAiFeedRunbookBatch(jsonRelativePath, batchIndex, status, note)`
- **Purpose:** mark a batch as pulled, reviewed, sent, skipped, or blocked after operator/Send Gate action, then rewrite the Markdown and JSON runbook without adding document body text.

---

### Resolve AI Context Chunk
- **Endpoint:** `POST /api/ai/context-chunk`
- **CLI:** `node src/cli/index.js ai-context <workspace> chunk <record-id-or-package-path> [chunkIndex] [--summary]`
- **SDK:** `client.resolveAiContextChunk(recordIdOrPackagePath, chunkIndex)`
- **Purpose:** return one reviewed Markdown/context chunk without sending it to AI. The manifest stays lightweight by previewing only an initial chunk window, while this endpoint derives any valid chunk index on demand.
- **Request Body:**
  ```json
  {
    "workspacePath": "<workspace>",
    "recordIdOrPackagePath": "doc_xxxx",
    "chunkIndex": 2
  }
  ```
- **Response:**
  ```json
  {
    "ok": true,
    "data": {
      "recordIdOrPackagePath": "doc_xxxx",
      "chunk": {
        "id": "chunk_0002",
        "index": 2,
        "estimatedTokens": 3000,
        "headingHint": "## Chapter 4"
      },
      "content": "Markdown content for this chunk...",
      "tokenEstimate": 3000,
      "evidenceId": "evidence_xxxx",
      "totalChunkCount": 14,
      "progress": {"completedChunks": 2, "remainingChunks": 12},
      "continuation": {
        "canContinue": true,
        "nextRangeStartChunkIndex": 3
      },
      "nextChunkCommand": "ai-context <workspace> chunk doc_xxxx 3",
      "sendGateDecision": "allow"
    }
  }
  ```
  The full response also includes chunk character bounds, timeline event id, current command, remaining range count, and recommended send strategy.

Each intake manifest includes a body-free `feedingPlan` that classifies the source as single-review, reviewed range feeding, or background range feeding; it also reports the recommended batch token budget, estimated batch count, and whether a continuous agent loop is appropriate. `batchPlanPreview` adds a body-free preview of the first planned range batches and the final batch, including CLI resume commands, without enumerating every batch for ultra-long documents. Each chunk/range selection writes local evidence with `aiSent: false`, a content hash, token estimate, Send Gate decision, and timeline linkage. The selected Markdown body is returned to the caller for review, but it is not stored in the evidence record or timeline. `progress`, `continuation`, `nextChunkCommand`, and `nextRangeCommand` let an agent continue large-document intake without guessing the next batch, remaining batch count, or resume point. CLI `--summary` prints continuation metadata without printing the selected Markdown body.

---

### Prepare Filtered Query Result For AI
- **Endpoint:** `POST /api/ai/query-context`
- **Shortcut Endpoint:** `POST /api/ai/query-handoff`
- **CLI:** `node src/cli/index.js query-ai-context <workspace> <sql>` or `node src/cli/index.js query-ai-handoff <workspace> <relative-output-path> <sql>` to save the reviewed filtered result directly as an AI Handoff Bundle.
- **SDK:** `client.prepareQueryForAi(sql, options)` or `client.saveQueryAiHandoffBundle(relativePath, sql, options)`
- **Purpose:** run a local SQL query over inspected CSV/XLSX data and render the filtered result as Markdown context for AI Send Gate review. This keeps table filtering local before any selected rows are sent to a model, and writes local selection evidence without storing the SQL result body.
- **Request Body:**
  ```json
  {
    "workspacePath": "<workspace>",
    "sql": "select dept, sum(amount) from sales group by dept order by sum(amount) desc limit 10",
    "options": {
      "maxRows": 50
    }
  }
  ```
- **Response:**
  ```json
  {
    "ok": true,
    "data": {
      "sql": "select dept, sum(amount) from sales group by dept order by sum(amount) desc limit 10",
      "columns": ["dept", "sum(amount)"],
      "rows": [{"dept": "Finance", "sum(amount)": 1200}],
      "rowCount": 1,
      "tokenEstimate": 120,
      "evidenceId": "evidence_xxxx",
      "contextMarkdown": "# Filtered Table Context For AI\n\n..."
    }
  }
  ```

---

### Write Back AI Result
- **Endpoint:** `POST /api/ai/result/write-back`
- **CLI:** `node src/cli/index.js ai-result-writeback <workspace> <relative-output-path> <ai-result> [context-body]`
- **SDK:** `client.writeBackAiResult(relativePath, input)`
- **Purpose:** write an AI answer back into a Markdown Exchange record after Send Gate review/send, preserving the selected context plus optional audit/evidence references. This closes the loop from document intake to AI response to exchangeable Markdown.
- **Request Body:**
  ```json
  {
    "workspacePath": "<workspace>",
    "relativePath": "notes/ai-result.md",
    "input": {
      "title": "AI Result Write-back",
      "source": "web-ui-ai-result-writeback",
      "body": "Reviewed context that was sent to AI.",
      "aiResult": "AI generated answer.",
      "apiBaseUrl": "https://api.example.test/v1",
      "model": "model-a",
      "auditId": "audit_xxxx",
      "evidenceId": "evidence_xxxx"
    }
  }
  ```
- **Response:**
  ```json
  {
    "ok": true,
    "data": {
      "relativePath": "notes/ai-result.md",
      "path": "<workspace>/notes/ai-result.md",
      "auditId": "audit_xxxx",
      "evidenceId": "evidence_xxxx"
    }
  }
  ```

---

## 5. Exchange Package Management

### Write Package
- **Endpoint:** `POST /api/exchange-packages`
- **SDK:** `client.writePackage(packageRelativePath, input)`
- **Request Body:**
  ```json
  {
    "workspacePath": "<workspace>",
    "packagePath": "packages/my-exchange",
    "title": "Document exchange title",
    "body": "Markdown text content",
    "exportFormats": ["docx", "pdf", "html"]
  }
  ```

### Explain Package
- **Endpoint:** `POST /api/exchange-packages/explain`
- **SDK:** `client.explainPackage(packageRelativePath)`
- **Request Body:**
  ```json
  {
    "packagePath": "packages/my-exchange"
  }
  ```
- **Response Schema:**
  ```json
  {
    "ok": true,
    "data": {
      "title": "Document exchange title",
      "packageType": "markdown.exchange",
      "aiExposureDescription": "...",
      "sanitizationStatus": "Active (API keys and sensitive tokens redacted)",
      "sourceRecords": [{"id": "doc_xxxx", "kind": "document", "sourceType": "docx"}],
      "aiSendGateSummaries": [{"sourceRef": "doc_xxxx", "decision": "allow"}],
      "readiness": {"provenance": "pass", "markdown": "pass", "sendGate": "pass", "sanitization": "pass"},
      "receiverSummary": {"verdict": "trusted", "riskCount": 0},
      "riskSummary": [],
      "recommendedActions": ["Package is ready for AI preview and external handoff under the declared policies."]
    }
  }
  ```
  The full response also includes capability, file, table, export, policy, quality, raw-vs-Markdown mapping, and suitability details.

### Verify Package
- **Endpoint:** `POST /api/exchange-packages/verify`
- **SDK:** `client.verifyPackage(packageRelativePath)`
- **Request Body:**
  ```json
  {
    "packagePath": "packages/my-exchange"
  }
  ```
- **Response Schema:** matches `schemas/exchange-package.schema.json`
- **Example Response:**
  ```json
  {
    "ok": true,
    "data": {
      "ok": true,
      "manifestComplete": true,
      "noRawSensitiveFiles": true,
      "schemaVersion": 1
    }
  }
  ```

---

### Write Receiver Report
- **Endpoint:** `POST /api/exchange/package/receiver-report`
- **CLI:** `node src/cli/index.js exchange-package <workspace> receiver-report <relative-package-dir>`
- **SDK:** `client.writeReceiverReport(packageRelativePath)`
- **Purpose:** write derived receiver-facing trust artifacts into an existing exchange package without changing the canonical manifest hash chain. The generated files are `receiver-report.md` for human review and `trust-report.json` for automation.
- **Request Body:**
  ```json
  {
    "workspacePath": "<workspace>",
    "packageRelativePath": "packages/my-exchange"
  }
  ```
- **Response:**
  ```json
  {
    "ok": true,
    "data": {
      "packageRelativePath": "packages/my-exchange",
      "markdownPath": "<workspace>/packages/my-exchange/receiver-report.md",
      "jsonPath": "<workspace>/packages/my-exchange/trust-report.json",
      "verdict": "trusted_with_warnings",
      "riskCount": 2
    }
  }
  ```

---

### Create Package From Record
- **Endpoint:** `POST /api/exchange-packages/from-record`
- **Compatibility alias:** `POST /api/exchange/package/from-record`
- **CLI:** `node src/cli/index.js exchange-package <workspace> from-record <relative-package-dir> <record-id> [--exports=docx,pdf]`
- **SDK:** `client.createPackageFromRecord(recordId, packageRelativePath, input)` or `client.createExchangePackageFromRecord(recordId, packageRelativePath, input)`
- **Purpose:** create a directory-based exchange package from the prepared record itself. Documents use the extracted Markdown working copy; CSV/XLSX datasets use the inspected table preview. This avoids placeholder exchange packages that only describe the source.
- **Request Body:**
  ```json
  {
    "workspacePath": "<workspace>",
    "recordId": "doc_xxxx",
    "packageRelativePath": "packages/report-exchange",
    "input": {
      "title": "Report Exchange",
      "exportFormats": ["docx", "pdf"]
    }
  }
  ```
- **Response:** same file path structure as package creation, plus `recordId`, `kind`, `sourceType`, and `preparedPreview`.

---

## 6. Feedback Bundle
- **Endpoint:** `POST /api/feedback-bundle`
- **Request Body:**
  ```json
  {
    "outDir": "custom/output/dir",
    "redact": true
  }
  ```
- **Response Schema:** matches `schemas/feedback-bundle.schema.json` for summary output.
- **Example Response:** `{ "ok": true, "data": { "bundlePath": "<workspace>/artifacts/feedback-bundles/1234567890", "warnings": [] } }`

---

## 7. Error Handling & API Contract Validation

### API Error Response Format
When an API call fails (either with a non-200 HTTP status code, or a JSON response indicating failure), the response body is formatted as follows:

```json
{
  "ok": false,
  "error": {
    "code": "error_code_string",
    "message": "Human-readable description of what went wrong",
    "details": {},
    "guidance": "Recommended action to recover from the error (optional)"
  }
}
```

Common error fields:
- `code`: Unique string identifier for the error category (e.g., `csv_empty`, `api_base_url_required`).
- `message`: Plaintext description explaining the failure.
- `details`: Extra context parameters (e.g., invalid parameter names).
- `guidance`: Suggestion on what to do next to resolve the error.

### SDK Client Error Handling
The local client SDK (`src/sdk/localApiClient.js`) wraps all route interactions. In case of a server, network, or non-JSON local API response failure, it throws a `SchemaDocsApiError` which exposes the following properties:
- `code`: The error category string (copied from `error.code`).
- `status`: The HTTP response status code (e.g., `500` or `400`).
- `details`: Extra context object for debugging.
- `guidance`: The optional recovery suggestion indicating what to do next.
Non-JSON local API responses use `schema_docs_api_non_json_response` so callers do not accidentally treat an HTML/error page as trusted API data.
