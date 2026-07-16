import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { assertInsideRoot } from "./pathGuard.js";
export async function searchWorkspace(workspacePath, keyword) {
if (!keyword || !keyword.trim()) {
return [];
}
const cleanKeyword = keyword.trim().toLowerCase();
const folders = ["notes", "outputs"];
const results = [];
for (const folder of folders) {
const dirPath = path.join(workspacePath, folder);
try {
const entries = await readdir(dirPath, { withFileTypes: true });
for (const entry of entries) {
if (entry.isFile() && entry.name.endsWith(".md")) {
const filePath = path.join(dirPath, entry.name);
await assertInsideRoot(filePath, workspacePath);
const content = await readFile(filePath, "utf8");
const lines = content.split(/\r?\n/);
const hits = [];
for (let i = 0; i < lines.length; i++) {
const line = lines[i];
if (line.toLowerCase().includes(cleanKeyword)) {
hits.push({
lineNumber: i + 1,
lineContent: line.trim()
});
}
}
if (hits.length > 0) {
results.push({
relativePath: path.join(folder, entry.name).replace(/\\/g, "/"),
fileName: entry.name,
matchesCount: hits.length,
hits: hits.slice(0, 10)
});
}
}
}
} catch {
}
}
return results.sort((a, b) => b.matchesCount - a.matchesCount);
}