import path from "node:path";
import { realpath, lstat, access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { AppError } from "./errors.js";

async function exists(candidate) {
  try {
    await access(candidate, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function findExistingAncestor(candidate) {
  let current = path.resolve(candidate);
  while (true) {
    if (await exists(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

function writeOutsideWorkspace(candidate, root) {
  return new AppError("write_outside_workspace", "Write path is outside the allowed workspace.", {
    path: candidate,
    root
  });
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
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export async function assertInsideRoot(candidatePath, rootPath) {
  const rootReal = await resolveExistingPath(rootPath);
  const candidateReal = await resolveExistingPath(candidatePath);
  if (!isSubPath(candidateReal, rootReal)) {
    throw new AppError("path_outside_workspace", "Path is outside the allowed workspace.", {
      path: candidateReal,
      root: rootReal
    });
  }
  return candidateReal;
}

export async function assertSafeWritePath(candidatePath, rootPath, allowedExtensions = []) {
  const rootAbsolute = path.resolve(rootPath);
  const rootReal = await resolveExistingPath(rootAbsolute);
  const absolute = path.resolve(candidatePath);

  // Reject traversal before touching the filesystem. This also prevents mkdir
  // side effects outside the workspace when the destination does not exist yet.
  if (!isSubPath(absolute, rootAbsolute)) {
    throw writeOutsideWorkspace(absolute, rootReal);
  }

  const ancestor = await findExistingAncestor(path.dirname(absolute));
  const ancestorReal = await resolveExistingPath(ancestor);
  if (!isSubPath(ancestorReal, rootReal)) {
    throw writeOutsideWorkspace(absolute, rootReal);
  }

  const normalizedExtensions = allowedExtensions.map((extension) => String(extension).toLowerCase());
  const extension = path.extname(absolute).toLowerCase();
  if (normalizedExtensions.length > 0 && !normalizedExtensions.includes(extension)) {
    throw new AppError("unsupported_output_extension", `Unsupported output extension: ${extension}`, {
      extension,
      allowedExtensions: normalizedExtensions
    });
  }

  try {
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink()) {
      throw new AppError("unsafe_symlink_write", "Refusing to write through a symbolic link.", {
        path: absolute
      });
    }
    const targetReal = await resolveExistingPath(absolute);
    if (!isSubPath(targetReal, rootReal)) {
      throw writeOutsideWorkspace(absolute, rootReal);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error?.code !== "ENOENT") throw error;
  }

  return absolute;
}

export async function prepareSafeWritePath(candidatePath, rootPath, allowedExtensions = []) {
  let safePath = await assertSafeWritePath(candidatePath, rootPath, allowedExtensions);
  await mkdir(path.dirname(safePath), { recursive: true });

  // Re-check after directory creation to catch pre-existing or concurrently
  // swapped symlink parents before the caller writes any bytes.
  safePath = await assertSafeWritePath(safePath, rootPath, allowedExtensions);
  const [parentReal, rootReal] = await Promise.all([
    resolveExistingPath(path.dirname(safePath)),
    resolveExistingPath(rootPath)
  ]);
  if (!isSubPath(parentReal, rootReal)) {
    throw writeOutsideWorkspace(safePath, rootReal);
  }
  return safePath;
}
