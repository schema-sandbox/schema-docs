import { createId, nowIso } from "./ids.js";
import { readManifest, writeManifest } from "./manifest.js";
import { AppError } from "./errors.js";
export function ensureConversionAudits(manifest) {
if (!Array.isArray(manifest.conversionAudits)) {
manifest.conversionAudits = [];
}
return manifest.conversionAudits;
}
export async function appendConversionAudit(workspacePath, input) {
const manifest = await readManifest(workspacePath);
const audits = ensureConversionAudits(manifest);
const audit = {
id: createId("conversion"),
documentId: input.documentId ?? "",
sourceType: input.sourceType ?? "",
targetFormat: input.targetFormat ?? "",
mode: input.mode ?? "via-md",
quality: input.quality ?? "basic",
sourcePath: input.sourcePath ?? "",
intermediateMarkdownPath: input.intermediateMarkdownPath ?? "",
outputPath: input.outputPath ?? "",
warnings: input.warnings ?? [],
limits: input.limits ?? [],
evidenceId: input.evidenceId ?? "",
qualityReportId: input.qualityReportId ?? "",
createdAt: nowIso()
};
audits.push(audit);
await writeManifest(workspacePath, manifest);
return audit;
}
export async function listConversionAudits(workspacePath) {
const manifest = await readManifest(workspacePath);
return ensureConversionAudits(manifest);
}
export async function deleteConversionAudit(workspacePath, auditId) {
const manifest = await readManifest(workspacePath);
const audits = ensureConversionAudits(manifest);
const index = audits.findIndex((audit) => audit.id === auditId);
if (index === -1) throw new AppError("conversion_audit_not_found", `Conversion audit not found: ${auditId}`, {
auditId
});
const [deleted] = audits.splice(index, 1);
await writeManifest(workspacePath, manifest);
return deleted;
}