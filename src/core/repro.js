import path from "node:path";
import { readFile } from "node:fs/promises";
import { readManifest } from "./manifest.js";
import { getTimelineEvents } from "./timeline.js";
export async function generateReproductionScript(workspacePath, recordIdOrOptions, outPath = null) {
let recordId = typeof recordIdOrOptions === "string" ? recordIdOrOptions : recordIdOrOptions?.recordId;
let fromFeedbackBundle = recordIdOrOptions?.fromFeedbackBundle || null;
let fixtureId = typeof recordIdOrOptions === "object" ? recordIdOrOptions?.fixture : null;
let doc = null;
let events = [];
if (fixtureId) {
try {
const planFile = path.join(import.meta.dirname, "../../samples/fixture-plan.json");
const planContent = await readFile(planFile, "utf8");
const plan = JSON.parse(planContent);
const wf = (plan.workflows || []).find((w) => w.id === fixtureId);
if (wf) {
const ext = path.extname(wf.input || "").slice(1);
doc = {
id: wf.id,
name: path.basename(wf.input || "input_file"),
sourceType: ext || (wf.coverage && wf.coverage[0]) || "unknown",
warnings: wf.notes ? [wf.notes] : []
};
}
} catch (error) {
doc = null;
}
}
if (!doc && fromFeedbackBundle) {
try {
doc = { id: "unknown", name: "bundled_repro", sourceType: "docx" };
} catch {
doc = null;
}
} else if (!doc && recordId) {
try {
const manifest = await readManifest(workspacePath);
doc = (manifest.documents || []).find((d) => d.id === recordId) ||
(manifest.datasets || []).find((d) => d.id === recordId);
events = await getTimelineEvents(workspacePath, recordId);
} catch {
doc = null;
}
}
const inputType = doc?.sourceType || "unknown";
const nameClean = doc?.name ? doc.name.replace(/[^a-zA-Z0-9_.-]/g, "_") : "input_file";
const reproDetails = {
appVersion: "0.1.0",
inputType,
recordId: recordId || "unknown",
suggestedReproSteps: [
`# Step 1: Place a clean sample of your file matching format '${inputType}' into workspace/imports/ as '${nameClean}'`,
`npm run cli -- init ./repro-workspace`,
`npm run cli -- import ./repro-workspace ./imports/${nameClean}`,
inputType === "csv" || inputType === "xlsx"
? `npm run cli -- inspect-${inputType} ./repro-workspace record_id`
: `npm run cli -- convert-${inputType} ./repro-workspace record_id`
],
qualityWarnings: doc?.warnings || [],
errorCatalogMatch: doc?.warnings?.length > 0 ? "Check known-limits for warnings: " + doc.warnings.join(", ") : "None"
};
const mdReport = `# Issue Reproduction Script Template
Generated At: ${new Date().toISOString()}
App Version: ${reproDetails.appVersion}
Input Type: ${reproDetails.inputType}
Record ID: ${reproDetails.recordId}
## Suggested Reproduction Commands
\`\`\`bash
# 1. Initialize temporary workspace
npm run cli -- init ./repro_sandbox
# 2. Copy and rename your sanitized file to ./repro_sandbox/imports/${nameClean}
# 3. Import and convert using the CLI
${reproDetails.suggestedReproSteps.slice(2).join("\n")}
\`\`\`
## Evidence & Warnings
- **Warnings Detected:** ${reproDetails.qualityWarnings.join(", ") || "None"}
- **Resolution Path:** ${reproDetails.errorCatalogMatch}
`;
if (outPath) {
const fileToWrite = path.resolve(outPath);
await fsWriteFile(fileToWrite, mdReport, "utf8");
}
return {
ok: true,
details: reproDetails,
markdown: mdReport
};
}
import { writeFile } from "node:fs/promises";
async function fsWriteFile(p, content) {
try {
await writeFile(p, content, "utf8");
} catch (err) {
}
}