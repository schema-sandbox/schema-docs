import { DOCUMENT_EXCHANGE_FORMATS, listDocumentExchangeCapabilities } from "./documentExchangeMatrix.js";
import { DOCUMENT_EXCHANGE_API_ROUTES, listSemanticRoutes } from "./apiContract.js";
export function createDocumentCapabilityManifest() {
const capabilities = listDocumentExchangeCapabilities();
return {
capability_type: "document.exchange",
name: "Schema Docs Local Document Exchange",
version: "0.1.0",
input_contract: {
accepted_formats: ["md", "txt", "pdf", "docx", "pptx", "xlsx", "csv"],
document_exchange_formats: DOCUMENT_EXCHANGE_FORMATS,
max_file_size_mb: null
},
output_contract: {
canonical_format: "markdown",
export_formats: capabilities.formats,
conversion_matrix: capabilities.conversions,
requires_validation: true
},
permission_scope: {
fs_scope: ["workspace", "imports", "outputs", "notes", ".ai-doc-exchange"],
net_scope: ["user_confirmed_ai_endpoint_only"],
tool_scope: [
"extract.pdf_text_layer",
"extract.docx",
"extract.pptx",
"import.xlsx_preview",
"import.csv_preview",
"query.local_subset",
"export.markdown",
"export.docx",
"export.pdf",
"verify.exchange_package",
"ai.preview",
"ai.feed_runbook",
"ai.byok_send"
]
},
validation: {
required_evidence: ["input_hash", "output_hash", "policy_decision"],
stores_raw_prompt_by_default: false,
stores_api_key: false
},
api_contract: {
semantic_routes: listSemanticRoutes(),
routes: DOCUMENT_EXCHANGE_API_ROUTES
},
limits: capabilities.limits
};
}
