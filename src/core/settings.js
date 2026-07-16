import { readManifest, writeManifest } from "./manifest.js";
import { appendTimelineEvent } from "./timeline.js";
import { AppError } from "./errors.js";
const ALLOWED_SETTING_KEYS = new Set([
"defaultExportFormats",
"defaultAiModel",
"defaultApiBaseUrl",
"defaultQueryLimit",
"extractionQualityGate",
"defaultPackagePath",
"preferNewVersionOnRefresh",
"policyMode"
]);
const ALLOWED_POLICY_MODES = new Set(["open-core", "team", "enterprise"]);
export async function getWorkspaceSettings(workspacePath) {
const manifest = await readManifest(workspacePath);
const settings = manifest.settings || {};
return {
defaultExportFormats: settings.defaultExportFormats ?? ["docx", "pdf"],
defaultAiModel: settings.defaultAiModel ?? "",
defaultApiBaseUrl: settings.defaultApiBaseUrl ?? "",
defaultQueryLimit: settings.defaultQueryLimit ?? 500,
extractionQualityGate: settings.extractionQualityGate ?? "normal",
defaultPackagePath: settings.defaultPackagePath ?? "",
preferNewVersionOnRefresh: settings.preferNewVersionOnRefresh ?? true,
policyMode: settings.policyMode ?? "open-core"
};
}
export async function updateWorkspaceSettings(workspacePath, key, value) {
if (!ALLOWED_SETTING_KEYS.has(key)) {
throw new AppError("invalid_setting_key", `Invalid setting key: ${key}`);
}
const manifest = await readManifest(workspacePath);
manifest.settings = manifest.settings || {};
let parsedValue = value;
if (key === "defaultQueryLimit") {
parsedValue = Number(value);
if (isNaN(parsedValue)) throw new AppError("invalid_setting_value", "defaultQueryLimit must...");
} else if (key === "preferNewVersionOnRefresh") {
parsedValue = value === "true" || value === true;
} else if (key === "defaultExportFormats") {
if (typeof value === "string") {
parsedValue = value.split(",").map(f => f.trim()).filter(Boolean);
} else if (!Array.isArray(value)) {
throw new AppError("invalid_setting_value", "defaultExportFormats m...");
}
} else if (key === "policyMode") {
parsedValue = String(value ?? "").trim();
if (!ALLOWED_POLICY_MODES.has(parsedValue)) {
throw new AppError("invalid_setting_value", "policyMode must be one...");
}
}
manifest.settings[key] = parsedValue;
await writeManifest(workspacePath, manifest);
await appendTimelineEvent(
workspacePath,
"workspace_settings",
"settings_change",
`Updated workspace setting "${key}" to ${JSON.stringify(parsedValue)}`
);
return manifest.settings;
}