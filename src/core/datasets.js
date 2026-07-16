import { readManifest, writeManifest } from "./manifest.js";
import { AppError } from "./errors.js";
import { runJob } from "./jobs.js";
import { appendTimelineEvent } from "./timeline.js";
export function findDataset(manifest, datasetId) {
return manifest.datasets.find((dataset) => dataset.id === datasetId);
}
export async function inspectDataset(workspacePath, datasetId, importer) {
const manifest = await readManifest(workspacePath);
const dataset = findDataset(manifest, datasetId);
if (!dataset) throw new AppError("dataset_not_found", `Dataset not found: ${datasetId}`, {
datasetId
});
if (!importer.canHandle(dataset)) {
throw new AppError("dataset_importer_mismatch", "Importer cannot handle...", {
datasetId,
importer: importer.name
});
}
const result = await importer.import({
sourcePath: dataset.sourcePath,
limit: 500
});
dataset.sheets = result.sheets;
dataset.rowCountEstimate = result.rowCountEstimate;
dataset.status = "ready";
dataset.updatedAt = new Date().toISOString();
await writeManifest(workspacePath, manifest);
await appendTimelineEvent(workspacePath, dataset.id, "inspect", `Inspected dataset "${dataset.name}" (sheets: ${dataset.sheets.length})`);
return dataset;
}
export async function inspectDatasetAsJob(workspacePath, datasetId, importer) {
return runJob(
workspacePath,
importer.name === "csv-importer" ? "parse_csv" : "parse_xlsx",
{
datasetId,
importer: importer.name
},
async ({ update }) => {
await update({
progress: 20,
message: "Inspecting dataset"
});
const dataset = await inspectDataset(workspacePath, datasetId, importer);
await update({
progress: 90,
message: "Dataset ready"
});
return {
datasetId: dataset.id,
status: dataset.status,
sheets: dataset.sheets.map((sheet) => ({
sheetId: sheet.sheetId,
name: sheet.name,
columns: sheet.columns.length,
previewRows: sheet.previewRows.length
}))
};
}
);
}