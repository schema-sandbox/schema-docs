import { rm, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_ROOT = path.resolve(import.meta.dirname, "../..");
const APPLY = process.argv.includes("--apply");
const CHECK = process.argv.includes("--check");

const GENERATED_DIR_PATTERNS = [
  /^%TEMP%$/i,
  /^\$(TEMP|TMP)$/i,
  /^tmp-test-[a-z0-9-]+$/i,
  /^tmp-workspace$/i,
  /^tmp-contract-workspace$/i,
  /^tmp-doctor-workspace$/i,
  /^tmp-doctor-workspace-integrated$/i,
  /^\.desktop-runtime$/i
];

function argValue(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function resolveRoot() {
  return path.resolve(argValue("--root", DEFAULT_ROOT));
}

function isInsideRoot(root, targetPath) {
  const relative = path.relative(root, targetPath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isGeneratedArtifactName(name) {
  return GENERATED_DIR_PATTERNS.some((pattern) => pattern.test(name));
}

async function collectCandidates(root) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(root, { withFileTypes: true });
  const candidates = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !isGeneratedArtifactName(entry.name)) {
      continue;
    }

    const fullPath = path.join(root, entry.name);
    if (!isInsideRoot(root, fullPath)) {
      continue;
    }

    const fileStat = await stat(fullPath);
    candidates.push({
      path: path.relative(root, fullPath).replaceAll("\\", "/"),
      absolutePath: fullPath,
      modifiedAt: fileStat.mtime.toISOString()
    });
  }

  return candidates.toSorted((left, right) => left.path.localeCompare(right.path));
}

async function main() {
  const root = resolveRoot();
  const candidates = await collectCandidates(root);
  const removed = [];

  if (APPLY) {
    for (const candidate of candidates) {
      const resolved = path.resolve(root, candidate.path);
      if (!isInsideRoot(root, resolved) || !isGeneratedArtifactName(path.basename(resolved))) {
        throw new Error(`Refusing to remove unsafe path: ${candidate.path}`);
      }
      await rm(resolved, { recursive: true, force: true });
      removed.push(candidate.path);
    }
  }

  const ok = !(CHECK && candidates.length > 0);
  console.log(JSON.stringify({
    ok,
    mode: APPLY ? "apply" : "dry-run",
    checkOnly: CHECK,
    root,
    candidateCount: candidates.length,
    removedCount: removed.length,
    candidates: candidates.map(({ path: candidatePath, modifiedAt }) => ({
      path: candidatePath,
      modifiedAt
    })),
    removed
  }, null, 2));

  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
