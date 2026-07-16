import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { readManifest } from "./manifest.js";
import { runJob } from "./jobs.js";
import { queryResultToExport } from "./exporters.js";
import { appendEvidenceRecord } from "./evidence.js";
import { appendTimelineEvent } from "./timeline.js";
import { parseSelectQuery } from "../adapters/memoryQueryEngine.js";
import { AppError } from "./errors.js";
import { csvImporter } from "../adapters/csvImporter.js";
import { xlsxImporter } from "../adapters/xlsxImporter.js";
function hashText(text) {
return `sha256:${createHash("sha256").update(String(text ?? ""), "utf8").digest("hex")}`;
}
async function loadCompleteQueryDatasets(datasets, datasetIds) {
const selectedIds = new Set(datasetIds);
return Promise.all(datasets.map(async (dataset) => {
if (!selectedIds.has(dataset.id)) return dataset;
const importer = dataset.sourceType === "csv"
? csvImporter
: dataset.sourceType === "xlsx"
? xlsxImporter
: null;
if (!importer) return dataset;
const candidates = [dataset.sourcePath, dataset.importedCopyPath, dataset.originalSourcePath]
  .filter(Boolean);
let sourcePath = "";
for (const candidate of candidates) {
  try {
    await access(candidate);
    sourcePath = candidate;
    break;
  } catch {
    // Try the next recorded source location.
  }
}
if (!sourcePath) {
  const previewIsComplete = (dataset.sheets ?? []).every((sheet) => {
    const loadedRows = sheet.previewRows?.length ?? 0;
    const totalRows = Number(sheet.totalRowsEstimate ?? loadedRows);
    return loadedRows >= totalRows;
  });
  if (previewIsComplete) return dataset;
  throw new AppError(
    "query_source_unavailable",
    "The full CSV/XLSX source is unavailable and the saved preview is incomplete. Re-import the source file before running local SQL.",
    { datasetId: dataset.id, datasetName: dataset.name, candidates }
  );
}
const imported = await importer.import({
sourcePath,
limit: Number.MAX_SAFE_INTEGER
});
return {
...dataset,
sheets: imported.sheets ?? dataset.sheets,
rowCountEstimate: imported.rowCountEstimate ?? dataset.rowCountEstimate
};
}));
}
export async function runQuery(workspacePath, sql, queryEngineFactory, options = {}) {
const manifest = await readManifest(workspacePath);
const parsed = parseSelectQuery(sql);
const previewEngine = queryEngineFactory(manifest.datasets);
const datasetIds = previewEngine.datasetIdsForTables?.([
parsed.tableName,
parsed.join?.tableName
].filter(Boolean)) ?? [];
const datasets = await loadCompleteQueryDatasets(manifest.datasets, datasetIds);
const engine = queryEngineFactory(datasets);
return engine.run(sql, options);
}
export async function listQueryTables(workspacePath, queryEngineFactory) {
const manifest = await readManifest(workspacePath);
const engine = queryEngineFactory(manifest.datasets);
return engine.listTables();
}
export async function runQueryAsJob(workspacePath, sql, queryEngineFactory, options = {}) {
return runJob(
workspacePath,
"local_sql_query",
{
sql,
engine: "memory"
},
async ({ update }) => {
await update({
progress: 30,
message: "Running query"
});
const result = await runQuery(workspacePath, sql, queryEngineFactory, options);
await update({
progress: 90,
message: "Query ready"
});
return result;
}
);
}
export function renderQueryResultAiContext(sql, result, options = {}) {
const maxRows = Math.max(1, Number(options.maxRows ?? 50) || 50);
const columns = result.columns ?? [];
const rows = result.rows ?? [];
const selectedRows = rows.slice(0, maxRows);
const truncatedRows = rows.length > selectedRows.length;
const tableMarkdown = queryResultToExport({ columns, rows: selectedRows }, "markdown");
return [
"# Filtered Table Context For AI",
"",
"This context was produced by a local SQL query before AI Send Gate review.",
"",
"## Local SQL",
"",
"```sql",
String(sql ?? "").trim(),
"```",
"",
"## Result Summary",
"",
`- Columns: ${columns.join(", ") || "none"}`,
`- Rows returned locally: ${rows.length}`,
`- Rows included for AI: ${selectedRows.length}`,
`- Truncated for AI context: ${truncatedRows ? "yes" : "no"}`,
"",
"## Filtered Rows",
"",
tableMarkdown || "_No rows returned._",
""
].join("\n");
}
function buildQueryShape(sql) {
try {
const parsed = parseSelectQuery(sql);
return {
tableCount: parsed.join ? 2 : 1,
primaryTable: parsed.tableName,
joinedTable: parsed.join?.tableName ?? "",
hasJoin: Boolean(parsed.join),
hasWhere: Boolean(parsed.whereCondition),
hasGroupBy: Boolean(parsed.groupByColumn),
hasOrderBy: Boolean(parsed.orderByColumn),
selectedColumnCount: parsed.columns?.length ?? 0,
hasAggregates: (parsed.parsedColumns ?? []).some((column) => column.type !== "field"),
limit: parsed.limit ?? null
};
} catch {
return {
tableCount: 0,
primaryTable: "",
joinedTable: "",
hasJoin: /\bjoin\b/i.test(String(sql ?? "")),
hasWhere: /\bwhere\b/i.test(String(sql ?? "")),
hasGroupBy: /\bgroup\s+by\b/i.test(String(sql ?? "")),
hasOrderBy: /\border\s+by\b/i.test(String(sql ?? "")),
selectedColumnCount: 0,
hasAggregates: /\b(count|sum|avg|min|max)\s*\(/i.test(String(sql ?? "")),
limit: null
};
}
}
export async function prepareQueryResultForAi(workspacePath, sql, queryEngineFactory, options = {}) {
const job = await runQueryAsJob(workspacePath, sql, queryEngineFactory, options);
if (job.status === "failed") {
const errorRecord = job.error ?? { code: "unknown_error", message: "Query execution failed" };
throw new AppError(errorRecord.code, errorRecord.message, errorRecord.details);
}
const result = job.output ?? { columns: [], rows: [] };
const contextMarkdown = renderQueryResultAiContext(sql, result, options);
const tokenEstimate = Math.ceil(contextMarkdown.length / 4);
const maxRows = Math.max(1, Number(options.maxRows ?? 50) || 50);
const rowCount = result.rows?.length ?? 0;
const includedRowCount = Math.min(rowCount, maxRows);
const truncatedRows = rowCount > maxRows;
const queryShape = buildQueryShape(sql);
const evidence = await appendEvidenceRecord(workspacePath, {
kind: "ai_query_context_selected",
sourceRef: "query_context",
outputType: "ai_query_context",
converter: "memory_query_context",
aiSent: false,
sentContentHash: hashText(contextMarkdown),
storeRawPrompt: false,
policyDecision: "local_ai_context_selected",
sendGateDecision: "local_query_context_selected",
sendGateSignals: truncatedRows ? ["truncated_rows"] : [],
estimatedTokens: tokenEstimate,
queryShape,
userConfirmed: false
});
const timeline = await appendTimelineEvent(workspacePath, "query_context", "ai_query_context_selected", "Selected filtered table context for AI", {
evidenceId: evidence.id,
policyDecision: "local_ai_context_selected",
queryShape
});
return {
sql,
jobId: job.id,
evidenceId: evidence.id,
timelineEventId: timeline?.id ?? "",
columns: result.columns ?? [],
rows: result.rows ?? [],
rowCount,
includedRowCount,
truncatedRows,
queryShape,
contextMarkdown,
tokenEstimate
};
}
