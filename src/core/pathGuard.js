import path from "node:path";
import { realpath, lstat, access } from "node:fs/promises";
import { constants } from "node:fs";
import { AppError } from "./errors.js";
async function exists(p) {
try {
await access(p, constants.F_OK);
return true;
} catch {
return false;
}
}
async function findExistingAncestor(p) {
let current = path.resolve(p);
while (true) {
if (await exists(current)) {
return current;
}
const parent = path.dirname(current);
if (parent === current) return current;
current = parent;
}
}
export async function resolveExistingPath(inputPath) {
try {
return await realpath(inputPath);
} catch {
throw new AppError("path_not_found", `Path does not exist: ${inputPath}`, {
path: inputPath
});
}
}
export function isSubPath(candidatePath, rootPath) {
const relative = path.relative(rootPath, candidatePath);
return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
export async function assertInsideRoot(candidatePath, rootPath) {
const rootReal = await resolveExistingPath(rootPath);
const candidateReal = await resolveExistingPath(candidatePath);
if (!isSubPath(candidateReal, rootReal)) {
throw new AppError("path_outside_workspace", "Path is outside the al...", {
path: candidateReal,
root: rootReal
});
}
return candidateReal;
}
export async function assertSafeWritePath(candidatePath, rootPath, allowedExtensions = []) {
const rootReal = await resolveExistingPath(rootPath);
const absolute = path.resolve(candidatePath);
const ancestor = await findExistingAncestor(path.dirname(absolute));
const ancestorReal = await resolveExistingPath(ancestor);
if (!isSubPath(ancestorReal, rootReal)) {
throw new AppError("write_outside_workspace", "Write path is outside ...", {
path: absolute,
root: rootReal
});
}
const extension = path.extname(absolute).toLowerCase();
if (allowedExtensions.length > 0 && !allowedExtensions.includes(extension)) {
throw new AppError("unsupported_output_extension", `Unsupported output extension: ${extension}`, {
extension,
allowedExtensions
});
}
try {
const stats = await lstat(absolute);
if (stats.isSymbolicLink()) {
throw new AppError("unsafe_symlink_write", "Refusing to write thro...", {
path: absolute
});
}
} catch (error) {
if (error instanceof AppError) throw error;
}
return absolute;
}