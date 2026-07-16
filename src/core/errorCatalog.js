export const errorCatalog = {
path_outside_workspace: {
code: "path_outside_workspace",
userMessage: "The requested path is outside the workspace security boundary, so the operation was refused.",
technicalMeaning: "Outside workspace path.",
likelyCause: "Relative traversal or absolute path.",
suggestedAction: "Keep relative paths within workspace.",
severity: "high",
docsLink: "docs/security-boundaries.md"
},
unsupported_format: {
code: "unsupported_format",
userMessage: "This document format is not supported for direct parsing or import.",
technicalMeaning: "No matching adapter.",
likelyCause: "Encrypted or unknown formats.",
suggestedAction: "Save as DOCX, PDF, CSV, XLSX, or TXT.",
severity: "medium",
docsLink: "docs/supported-formats.md"
},
pdf_text_layer_missing: {
code: "pdf_text_layer_missing",
userMessage: "The PDF has no extractable text layer and may be a scanned image document.",
technicalMeaning: "PDF contains zero characters.",
likelyCause: "Scanned document.",
suggestedAction: "Run OCR first, or use a digital PDF.",
severity: "high",
docsLink: "docs/known-limits.md"
},
docx_parse_failed: {
code: "docx_parse_failed",
userMessage: "The Word document could not be parsed. It may be corrupt or saved in an unsupported variant.",
technicalMeaning: "Unable to unzip DOCX.",
likelyCause: "Corrupted file.",
suggestedAction: "Re-save and try again.",
severity: "high",
docsLink: "docs/known-limits.md"
},
xlsx_sheet_missing: {
code: "xlsx_sheet_missing",
userMessage: "The requested Excel worksheet could not be found.",
technicalMeaning: "Worksheet reference missing.",
likelyCause: "Target sheet is missing.",
suggestedAction: "Confirm active visible sheets.",
severity: "medium",
docsLink: "docs/known-limits.md"
},
query_unsupported: {
code: "query_unsupported",
userMessage: "The offline SQL query could not be parsed or uses unsupported syntax.",
technicalMeaning: "SQL syntax rejected.",
likelyCause: "Unsupported keywords.",
suggestedAction: "Simplify query.",
severity: "high",
docsLink: "docs/known-limits.md"
},
join_not_supported: {
code: "join_not_supported",
userMessage: "The local offline query engine does not support this JOIN operation.",
technicalMeaning: "Relational JOIN unsupported.",
likelyCause: "JOIN query attempted.",
suggestedAction: "Use simple INNER JOIN or multiple queries.",
severity: "high",
docsLink: "docs/known-limits.md"
},
ai_send_gate_review_required: {
code: "ai_send_gate_review_required",
userMessage: "AI Send Gate found sensitive data or credentials and blocked the send.",
technicalMeaning: "Blocked by sensitive credentials.",
likelyCause: "API Keys or secrets flagged.",
suggestedAction: "Enable Masking or remove secrets.",
severity: "high",
docsLink: "docs/security-boundaries.md"
},
ai_override_reason_required: {
code: "ai_override_reason_required",
userMessage: "A manual override requires an audit reason before sending.",
technicalMeaning: "No override explanation.",
likelyCause: "Bypassed gate with empty justification.",
suggestedAction: "Write audit justification.",
severity: "medium",
docsLink: "docs/security-boundaries.md"
},
runtime_unavailable: {
code: "runtime_unavailable",
userMessage: "The local JavaScript runtime is unavailable, so the desktop bridge is unhealthy.",
technicalMeaning: "Port SCAN closed backend.",
likelyCause: "Server process not running.",
suggestedAction: "Check desktop health status.",
severity: "high",
docsLink: "docs/desktop-runtime-gap.md"
},
desktop_artifact_missing: {
code: "desktop_artifact_missing",
userMessage: "A desktop packaging artifact is missing, so release testing cannot continue.",
technicalMeaning: "App binary missing.",
likelyCause: "No tauri build outputs.",
suggestedAction: "Run desktop:build.",
severity: "high",
docsLink: "docs/v0.1.0-release-plan.md"
},
package_hash_mismatch: {
code: "package_hash_mismatch",
userMessage: "Exchange package verification failed because a recorded hash does not match.",
technicalMeaning: "ZIP content hash mismatch.",
likelyCause: "Manual edit or corruption.",
suggestedAction: "Re-export exchange package.",
severity: "high",
docsLink: "docs/known-limits.md"
}
};
export function lookupError(code) {
return errorCatalog[code] || {
code: code || "unknown_error",
userMessage: `Operation failed: ${code || "unknown_error"}`,
technicalMeaning: "No catalog match.",
likelyCause: "Unhandled exception.",
suggestedAction: "Check logs or generate feedback.",
severity: "medium",
docsLink: "docs/known-limits.md"
};
}