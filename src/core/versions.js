import path from "node:path";
import { writeFile, readFile } from "node:fs/promises";
import { readManifest, writeManifest } from "./manifest.js";
import { createId, nowIso } from "./ids.js";
import { computeBufferHash } from "./records.js";
import { assertSafeWritePath, assertInsideRoot } from "./pathGuard.js";
import { appendTimelineEvent } from "./timeline.js";
import { AppError } from "./errors.js";
export async function addMarkdownVersion(workspacePath, relativePath, reason, sourceRecordId, content) {
const manifest = await readManifest(workspacePath);
manifest.markdownVersions = manifest.markdownVersions || [];
const existing = manifest.markdownVersions.filter(v => v.path === relativePath);
const nextVerNum = existing.length + 1;
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
await writeManifest(workspacePath, manifest);
return versionEntry;
}
export async function listMarkdownVersions(workspacePath, relativePath) {
const manifest = await readManifest(workspacePath);
const versions = manifest.markdownVersions || [];
if (!relativePath) return versions;
return versions.filter(v => v.path === relativePath);
}
export async function promoteMarkdownVersion(workspacePath, relativePath, versionId) {
const manifest = await readManifest(workspacePath);
const versions = manifest.markdownVersions || [];
const ver = versions.find(v => v.id === versionId && v.path === relativePath);
if (!ver) throw new AppError("version_not_found", `Version ${versionId} not found for path ${relativePath}`);
const backupAbsolutePath = path.join(workspacePath, ver.versionPath);
const safeBackupPath = await assertInsideRoot(backupAbsolutePath, workspacePath);
const content = await readFile(safeBackupPath, "utf8");
const primaryAbsolutePath = path.join(workspacePath, relativePath);
const safePrimaryPath = await assertSafeWritePath(primaryAbsolutePath, workspacePath, [".md"]);
await writeFile(safePrimaryPath, content, "utf8");
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