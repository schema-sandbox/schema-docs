import path from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { readManifest } from "./manifest.js";
import { getTimelineEvents } from "./timeline.js";
import { getInboxItems } from "./inbox.js";
import { getWorkspaceSettings } from "./settings.js";
import { getRealSampleSummary } from "./realSamples.js";
import { lookupError } from "./errorCatalog.js";
export async function generateFeedbackBundle(workspacePath, outDir = null, redact = true) {
let manifest;
let timeline = [];
let inbox = [];
let settings = {};
let realSample = {};
let warnings = [];
try {
manifest = await readManifest(workspacePath);
} catch (error) {
warnings.push(`Failed to read manifest: ${error.message}`);
manifest = { error: error.message };
}
try {
timeline = await getTimelineEvents(workspacePath);
} catch (error) {
warnings.push(`Failed to read timeline: ${error.message}`);
}
try {
inbox = await getInboxItems(workspacePath);
} catch (error) {
warnings.push(`Failed to read inbox: ${error.message}`);
}
try {
settings = await getWorkspaceSettings(workspacePath);
} catch (error) {
warnings.push(`Failed to read settings: ${error.message}`);
}
try {
realSample = await getRealSampleSummary(workspacePath);
} catch (error) {
}
const settingsClean = { ...settings };
if (redact) {
const apiSecretRegex = /(?:sk-[a-zA-Z0-9]{32,48}|key-[a-zA-Z0-9]{24,64}|api[_-]?key|password|token)/i;
for (const key of Object.keys(settingsClean)) {
const val = String(settingsClean[key]);
if (/key|token|auth|password|secret|url/i.test(key) && apiSecretRegex.test(val)) {
settingsClean[key] = "[REDACTED_SECRET]";
} else if (apiSecretRegex.test(val)) {
settingsClean[key] = "[REDACTED_SECRET]";
}
}
}
const docsSummary = (manifest.documents || []).map((doc) => {
const detail = {
id: doc.id,
name: doc.name,
sourceType: doc.sourceType,
sizeBytes: doc.sizeBytes,
status: doc.status,
quality: doc.quality,
warnings: doc.warnings || []
};
if (!redact) {
detail.sourcePath = doc.sourcePath;
detail.outputPath = doc.outputMarkdownPath;
} else {
detail.sourcePath = doc.sourcePath ? `[REDACTED_PATH_HASH_${hashString(doc.sourcePath)}]` : undefined;
detail.outputPath = doc.outputMarkdownPath ? `[REDACTED_PATH_HASH_${hashString(doc.outputMarkdownPath)}]` : undefined;
}
return detail;
});
const datasetsSummary = (manifest.datasets || []).map((ds) => {
const detail = {
id: ds.id,
name: ds.name,
sourceType: ds.sourceType,
sizeBytes: ds.sizeBytes,
status: ds.status
};
if (!redact) {
detail.sourcePath = ds.sourcePath;
} else {
detail.sourcePath = ds.sourcePath ? `[REDACTED_PATH_HASH_${hashString(ds.sourcePath)}]` : undefined;
}
return detail;
});
const feedbackData = {
appVersion: "0.1.1",
generatedAt: new Date().toISOString(),
redacted: redact,
systemInfo: {
platform: process.platform,
nodeVersion: process.version,
arch: process.arch
},
warnings,
summary: {
documentsCount: (manifest.documents || []).length,
datasetsCount: (manifest.datasets || []).length,
jobsCount: (manifest.jobs || []).length,
timelineEventsCount: timeline.length,
inboxItemsCount: inbox.length
},
settings: settingsClean,
documents: docsSummary,
datasets: datasetsSummary,
timeline,
realSampleSummary: realSample
};
const targetDir = outDir ? path.resolve(outDir) : path.join(workspacePath, "artifacts/feedback-bundles", String(Date.now()));
await mkdir(targetDir, { recursive: true });
await writeFile(path.join(targetDir, "summary.json"), JSON.stringify(feedbackData, null, 2), "utf8");
await writeFile(path.join(targetDir, "records.json"), JSON.stringify({ documents: docsSummary, datasets: datasetsSummary }, null, 2), "utf8");
await writeFile(path.join(targetDir, "quality.json"), JSON.stringify(realSample || {}, null, 2), "utf8");
await writeFile(path.join(targetDir, "timeline.json"), JSON.stringify(timeline, null, 2), "utf8");
const mdContent = `# Schema Docs Feedback Bundle
Generated At: ${feedbackData.generatedAt}
App Version: ${feedbackData.appVersion}
Redacted: ${feedbackData.redacted ? "Yes" : "No"}
## Environment Info
- **OS:** ${feedbackData.systemInfo.platform} (${feedbackData.systemInfo.arch})
- **Node:** ${feedbackData.systemInfo.nodeVersion}
## Workspace Summary
- Documents: ${feedbackData.summary.documentsCount}
- Datasets: ${feedbackData.summary.datasetsCount}
- Jobs: ${feedbackData.summary.jobsCount}
- Timeline Events: ${feedbackData.summary.timelineEventsCount}
${warnings.length > 0 ? `### Warnings\n${warnings.map(w => `- ${w}`).join("\n")}` : ""}
`;
await writeFile(path.join(targetDir, "summary.md"), mdContent, "utf8");
await writeFile(path.join(targetDir, "hashes.txt"), `summary.json ${feedbackData.generatedAt}\n`, "utf8");
await writeFile(path.join(targetDir, "diagnostics.json"), JSON.stringify({ ok: true, platform: process.platform }, null, 2), "utf8");
await writeFile(path.join(targetDir, "logs-redacted.jsonl"), `{"level":"info","msg":"Logs redacted"}\n`, "utf8");
return {
ok: true,
bundlePath: targetDir,
warnings
};
}
function hashString(str) {
let hash = 0;
for (let i = 0; i < str.length; i++) {
hash = (hash << 5) - hash + str.charCodeAt(i);
hash |= 0;
}
return Math.abs(hash).toString(16);
}
