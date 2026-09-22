import path from "node:path";
import { writeFile, readFile } from "node:fs/promises";
import { readManifest, writeManifest, withWorkspaceCommit } from "./manifest.js";
import { saveMarkdown } from "./markdown.js";
import { createId, nowIso } from "./ids.js";
import { computeBufferHash } from "./records.js";
import { assertSafeWritePath, assertInsideRoot } from "./pathGuard.js";
import { appendTimelineEvent } from "./timeline.js";
import { AppError } from "./errors.js";
function versionTarget(workspacePath, manifest, relativePath) {
 const requested = path.resolve(workspacePath, relativePath);
 const document = manifest.documents?.find(doc => [doc.outputMarkdownPath, doc.markdownVersionPath]
  .filter(Boolean).some(target => path.resolve(workspacePath, target) === requested));
 return { historyPath: document?.markdownVersionPath || relativePath,
  currentPath: document?.outputMarkdownPath || path.join(workspacePath, relativePath) };
}
export async function addMarkdownVersion(workspacePath, relativePath, reason, sourceRecordId, content, options = {}) {
const operation = () => addVersion(workspacePath, relativePath, reason, sourceRecordId, content, options);
return options.deferCommit ? operation() : withWorkspaceCommit(workspacePath, operation);
}
async function addVersion(workspacePath, relativePath, reason, sourceRecordId, content, options) {
const manifest = await readManifest(workspacePath);
relativePath = versionTarget(workspacePath, manifest, relativePath).historyPath;
manifest.markdownVersions = [...new Map([...(manifest.markdownVersions || []), ...(options.pendingVersions || [])].map(entry => [entry.id, entry])).values()];
const existing = manifest.markdownVersions.filter(v => v.path === relativePath);
const nextVerNum = Math.max(0, ...existing.map(v => v.version)) + 1;
const verId = createId("ver");
const backupFileName = `${verId}.md`;
const backupAbsolutePath = path.join(workspacePath, ".ai-doc-exchange", "versions", backupFileName);
const safeBackupPath = await assertSafeWritePath(backupAbsolutePath, workspacePath, [".md"]);
await writeFile(safeBackupPath, content, "utf8");
const contentHash = computeBufferHash(Buffer.from(content, "utf8"));
const versionEntry = {
id: verId,
path: relativePath,
version: nextVerNum,
createdAt: nowIso(),
reason,
sourceRecordId,
contentHash,
versionPath: `.ai-doc-exchange/versions/${backupFileName}`
};
manifest.markdownVersions.push(versionEntry);
if (!options.deferCommit) await writeManifest(workspacePath, manifest);
return versionEntry;
}
export async function listMarkdownVersions(workspacePath, relativePath) {
const manifest = await readManifest(workspacePath);
const versions = manifest.markdownVersions || [];
if (!relativePath) return versions;
return versions.filter(v => v.path === versionTarget(workspacePath, manifest, relativePath).historyPath);
}
export async function promoteMarkdownVersion(workspacePath, relativePath, versionId) {
return withWorkspaceCommit(workspacePath, async () => {
const manifest = await readManifest(workspacePath);
const target = versionTarget(workspacePath, manifest, relativePath);
const versions = manifest.markdownVersions || [];
const ver = versions.find(v => v.id === versionId && v.path === target.historyPath);
if (!ver) throw new AppError("version_not_found", `Version ${versionId} not found for path ${relativePath}`);
const backupAbsolutePath = path.join(workspacePath, ver.versionPath);
const safeBackupPath = await assertInsideRoot(backupAbsolutePath, workspacePath);
const content = await readFile(safeBackupPath, "utf8");
const primaryAbsolutePath = target.currentPath;
const safePrimaryPath = await assertSafeWritePath(primaryAbsolutePath, workspacePath, [".md"]);
await saveMarkdown(workspacePath, safePrimaryPath, content);
const newVer = await addMarkdownVersion(
workspacePath,
relativePath,
"manual_save",
ver.sourceRecordId,
content
);
await appendTimelineEvent(
workspacePath,
ver.sourceRecordId || relativePath,
"version_promote",
`Promoted version ${ver.version} of Markdown "${relativePath}" to current`
);
return newVer;
});
}
export async function diffMarkdownVersions(workspacePath, pathA, pathB) {
const absA = path.join(workspacePath, pathA);
const absB = path.join(workspacePath, pathB);
const safeA = await assertInsideRoot(absA, workspacePath);
const safeB = await assertInsideRoot(absB, workspacePath);
const contentA = await readFile(safeA, "utf8");
const contentB = await readFile(safeB, "utf8");
const linesA = contentA.split("\n");
const linesB = contentB.split("\n");
const diff = [];
const maxLines = Math.max(linesA.length, linesB.length);
for (let i = 0; i < maxLines; i++) {
const lineA = linesA[i];
const lineB = linesB[i];
if (lineA !== lineB) {
if (lineA !== undefined) {
diff.push(`- L${i + 1}: ${lineA}`);
}
if (lineB !== undefined) {
diff.push(`+ L${i + 1}: ${lineB}`);
}
}
}
return {
pathA,
pathB,
different: diff.length > 0,
diffLines: diff
};
}
