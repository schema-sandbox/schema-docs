export const DOCUMENT_EXCHANGE_API_ROUTES = [
{
method: "POST",
path: "/api/ingest",
intent: "Import a local file into the workspace manifest.",
required: ["workspacePath", "sourcePath"]
},
{
method: "POST",
path: "/api/extract",
intent: "Extract Markdown from a document or inspect a dataset.",
required: ["workspacePath"],
oneOf: ["documentId", "datasetId"]
},
{
method: "POST",
path: "/api/normalize",
intent: "Create a Markdown exchange document or directory package.",
required: ["workspacePath", "input"]
},
{
method: "POST",
path: "/api/workspace/manifest",
intent: "Return a redacted workspace handoff summary with documents, datasets, packages, Send Gate decisions, AI context selection summaries, AI handoff bundle summaries, safe selection ranges, and continuation metadata.",
required: ["workspacePath"]
},
{
method: "POST",
path: "/api/exchange/package",
intent: "Create a directory-based Markdown exchange package.",
required: ["workspacePath", "packageRelativePath", "input"]
},
{
method: "POST",
path: "/api/exchange-packages",
intent: "Create a directory-based Markdown exchange package using the public plural route alias.",
required: ["workspacePath", "packagePath or packageRelativePath"]
},
{
method: "POST",
path: "/api/exchange-packages/explain",
intent: "Explain package provenance, quality, Send Gate readiness, receiver trust summary, and recommended actions.",
required: ["workspacePath", "packagePath or packageRelativePath"]
},
{
method: "POST",
path: "/api/exchange-packages/verify",
intent: "Verify a package against the exchange package integrity and AI consumption readiness checks.",
required: ["workspacePath", "packagePath or packageRelativePath"]
},
{
method: "POST",
path: "/api/exchange-packages/from-record",
intent: "Create a package from an imported document or dataset using the public plural route alias.",
required: ["workspacePath", "recordId", "packagePath or packageRelativePath"]
},
{
method: "POST",
path: "/api/exchange/package/read",
intent: "Read and verify a directory-based Markdown exchange package.",
required: ["workspacePath", "packageRelativePath"]
},
{
method: "POST",
path: "/api/export/md",
intent: "Export Markdown or an imported document to Markdown.",
required: ["workspacePath", "outputRelativePath"]
},
{
method: "POST",
path: "/api/export/docx",
intent: "Export Markdown or an imported document to DOCX.",
required: ["workspacePath", "outputRelativePath"]
},
{
method: "POST",
path: "/api/export/pdf",
intent: "Export Markdown or an imported document to PDF.",
required: ["workspacePath", "outputRelativePath"]
},
{
method: "POST",
path: "/api/pdf/render-region",
intent: "Render a mapped PDF formula, table, image, or full source page to a workspace PNG without changing extracted text.",
required: ["workspacePath", "documentId", "pageNumber"]
},
{
method: "POST",
path: "/api/pdf/preserve-visual-assets",
intent: "Render every mapped low-confidence formula, table, and image region into a traceable Markdown visual-content sidecar without silently truncating pages.",
required: ["workspacePath", "documentId"]
},
{
method: "POST",
path: "/api/ai/preview",
intent: "Build a local Send Gate preview without sending a network request.",
required: ["workspacePath", "input"]
},
{
method: "POST",
path: "/api/ai/intake-plan",
intent: "Return a content-free AI intake plan with chunk ids, ranges, token estimates, feeding plan metadata, batch plan preview metadata, continuation commands, structured continuation metadata, progress metadata, and Send Gate safety flags.",
required: ["workspacePath", "recordIdOrPackagePath"]
},
{
method: "POST",
path: "/api/ai/feed-runbook",
intent: "Write a body-free AI feed runbook as Markdown and JSON with every planned range batch, resume commands, API payload metadata, and Send Gate requirements for long-document handoff.",
required: ["workspacePath", "recordIdOrPackagePath"]
},
{
method: "POST",
path: "/api/ai/feed-runbook/status",
intent: "Read a body-free AI feed runbook status summary and batch queue without returning document content.",
required: ["workspacePath", "jsonRelativePath"]
},
{
method: "POST",
path: "/api/ai/feed-runbook/batch",
intent: "Update one AI feed runbook batch status after pull, review, send, skip, or block, then rewrite the body-free Markdown and JSON handoff files.",
required: ["workspacePath", "jsonRelativePath", "batchIndex", "status"]
},
{
method: "POST",
path: "/api/ai/context-chunk",
intent: "Return one selected Markdown/context chunk from the AI intake plan without sending it to a model, with structured continuation metadata, progress metadata, and local selection evidence.",
required: ["workspacePath", "recordIdOrPackagePath", "chunkIndex"]
},
{
method: "POST",
path: "/api/ai/context-range",
intent: "Return a token-budgeted range bundle of Markdown/context chunks from the AI intake plan without sending it to a model, with continuation commands, structured continuation metadata, progress metadata, and local selection evidence.",
required: ["workspacePath", "recordIdOrPackagePath", "startChunkIndex", "endChunkIndex"]
},
{
method: "POST",
path: "/api/ai/handoff-bundle",
intent: "Save reviewed or selected AI context as a Markdown handoff bundle with Send Gate summary, evidence references, operator prompt, return contract, and staged context.",
required: ["workspacePath", "input.content or input.recordIdOrPackagePath"]
},
{
method: "POST",
path: "/api/ai/query-context",
intent: "Run a local SQL query, render the filtered table result as AI-ready Markdown context before Send Gate review, and write local selection evidence.",
required: ["workspacePath", "sql"]
},
{
method: "POST",
path: "/api/ai/query-handoff",
intent: "Run a local SQL query, render the filtered table result as AI-ready Markdown context, and save it as an AI Handoff Bundle before model handoff.",
required: ["workspacePath", "relativePath", "sql"]
},
{
method: "POST",
path: "/api/ai/send",
intent: "Send confirmed selected context to a user-provided API endpoint.",
required: ["workspacePath", "input.confirmed"]
},
{
method: "POST",
path: "/api/ai/result/write-back",
intent: "Write an AI result back into a Markdown exchange record with optional audit and evidence context.",
required: ["workspacePath", "relativePath", "input.aiResult"]
},
{
method: "GET",
path: "/api/evidence/{id}",
intent: "Read a single evidence summary by id.",
required: ["workspacePath", "id"]
},
{
method: "POST",
path: "/api/capability/manifest",
intent: "Return this document exchange capability manifest.",
required: ["workspacePath"]
},
{
method: "GET",
path: "/api/adapter/capabilities",
intent: "Return optional system adapter detection for LibreOffice, Pandoc, Tesseract OCR, pdfplumber layout extraction, and pdftoppm visual rendering without making them runtime dependencies.",
required: ["workspacePath"]
}
];
export function listSemanticRoutes() {
return DOCUMENT_EXCHANGE_API_ROUTES.map((route) => `${route.method} ${route.path}`);
}
