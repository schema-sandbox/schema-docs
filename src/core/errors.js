export class AppError extends Error {
constructor(code, message, details = {}) {
super(message);
this.name = "AppError";
this.code = code;
this.details = details;
}
}
const ERROR_GUIDANCE = {
  ai_confirmation_required: "Check confirmation and click Confirm Send.",
  ai_content_empty: "Paste or load content first.",
  ai_handoff_context_empty: "Load a record or save an AI handoff bundle.",
  ai_send_gate_review_required: "Remove or mask credentials and secrets, then regenerate preview.",
  ai_operation_unsupported: "Choose summarize, translate, extract, or explain.",
  ai_result_empty: "Run an AI send first.",
  ai_override_reason_required: "Add a short override reason.",
  api_base_url_required: "Enter the API base URL.",
  api_key_required: "Paste the API key for this session.",
  api_model_required: "Enter a model name (e.g. gpt-4o).",
  api_prompt_empty: "Load reviewed context first.",
  api_profile_name_required: "Enter a profile name.",
  api_profile_not_found: "Select another profile or create one.",
  api_authentication_failed: "The provider rejected this API key. Verify that the key belongs to the selected provider and project.",
  api_permission_denied: "This API project cannot use the selected model or endpoint. Check project permissions and model access.",
  api_endpoint_or_model_not_found: "Check the API base URL and exact model ID.",
  api_rate_limited: "The URL, model, and key may be correct. Wait for the retry window, or check this API project's rate limit, quota, trial allowance, and billing.",
  api_request_failed: "Check URL, model, key, network, or API base URL, then retry.",
  api_service_unavailable: "The provider is temporarily unavailable. Retry later; changing a correct key is usually unnecessary.",
  api_response_blocked: "The provider safety system blocked the response. Adjust the request or provider safety settings.",
  api_response_empty: "Check the endpoint response format and whether the selected model supports text generation.",
  api_response_non_json: "Ensure URL points to OpenAI-compatible JSON endpoint.",
  dataset_importer_not_found: "Supported: DOCX, PPTX, PDF, XLSX, CSV, MD, TXT.",
  dataset_not_found: "Select a dataset or import a file.",
  csv_empty: "Import a CSV with headers and data rows.",
  document_corrupt: "Save a fresh DOCX copy and try again.",
  document_converter_not_found: "Try importing as another format.",
  document_not_found: "Select a document or import a file.",
  exchange_audit_not_found: "Open a package with an audit trail.",
  exchange_document_frontmatter_invalid: "Regenerate the exchange MD (closed frontmatter).",
  exchange_document_frontmatter_missing: "Regenerate exchange MD from Schema Docs first.",
  exchange_document_schema_invalid: "Regenerate exchange document from record.",
  exchange_package_hash_mismatch: "Generate a fresh exchange package.",
  exchange_package_incomplete: "Rebuild package to include manifest, MD, and audit.",
  exchange_package_missing_audit: "Rebuild package with audit export enabled.",
  exchange_package_missing_markdown: "Rebuild package from prepared MD record.",
  exchange_package_schema_invalid: "Open a Schema Docs exchange package or rebuild it.",
  exchange_package_schema_version_mismatch: "Update Schema Docs or export with correct schema version.",
  exchange_package_type_invalid: "Choose directory containing Schema Docs manifest.",
  exchange_package_unsafe_raw_file: "Rebuild from prepared record instead of raw files.",
  invalid_setting_key: "Use settings panel or a valid key.",
  invalid_setting_value: "Use settings panel to choose a valid value.",
  manifest_invalid: "Restore workspace manifest from backup.",
  manifest_not_found: "Open or create a workspace first.",
  optional_adapter_required: "Convert file format or install adapter.",
  path_not_found: "Ensure file exists and pick it again.",
  path_outside_workspace: "Choose file inside workspace or open correct workspace.",
  pdf_text_layer_missing: "Run OCR first or use text-layer PDF.",
  query_column_not_found: "Use table picker to copy an available column name.",
  query_no_columns: "Add at least one column or SELECT *.",
  query_table_not_found: "Use listed table names and retry.",
  query_unsupported: "Use SELECT, WHERE, GROUP BY, ORDER BY, LIMIT, or INNER JOIN.",
  record_not_found: "Select a record or import a file.",
  record_markdown_missing: "Extract document to Markdown first.",
  refresh_failed: "Ensure original file exists and click Refresh.",
  runtime_unavailable: "Run doctor or start the local Schema Docs API runtime.",
  unsupported_file_type: "Save as DOCX, PPTX, PDF, XLSX, CSV, MD, or TXT.",
  unsupported_output_extension: "Choose .md, .docx, .pdf, .html, .csv, or .xlsx.",
  unsafe_symlink_write: "Choose a normal workspace folder.",
  version_not_found: "Choose an available version.",
  write_outside_workspace: "Choose output path inside the current workspace.",
  workspace_required: "Enter a workspace path."
};
export function getErrorGuidance(code) {
return ERROR_GUIDANCE[code] ?? "";
}
export function toErrorRecord(error) {
const isCodedError = error instanceof AppError || (error && typeof error === "object" && typeof error.code === "string");
const code = isCodedError ? error.code : "unknown_error";
const message = error instanceof Error
? error.message
: error && typeof error === "object" && typeof error.message === "string"
? error.message
: String(error);
const guidance = getErrorGuidance(code);
return {
code,
message,
details: error instanceof AppError ? error.details : {},
...(guidance ? { guidance } : {})
};
}
