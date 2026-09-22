import path from "node:path";
import { lstat, opendir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { acquireEvaluationLock, assertPlainPath, validateRunId } from "./realMaterialRun.js";

const DEFAULT_OUTPUT_ROOT = ".ai-doc-exchange/real-material-final";
async function removeTree(target) {
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink()) return unlink(target);
  for await (const entry of await opendir(target)) await removeTree(path.join(target, entry.name));
  await rmdir(target);
}

export async function cleanRealMaterialTestArtifacts(outputRoot = DEFAULT_OUTPUT_ROOT, options = {}) {
  const expected = path.resolve(process.cwd(), DEFAULT_OUTPUT_ROOT);
  if (path.resolve(outputRoot).toLowerCase() !== expected.toLowerCase()) throw new Error("Unexpected output root.");
  const root = await assertPlainPath(process.cwd(), expected);
  const runId = validateRunId(options.runId);
  if (options.mode === "resume") return { runId, mode: "resume", removed: [], retained: true };
  const target = await assertPlainPath(root, path.join(root, "real-material-artifacts", runId));
  const owner = JSON.parse(await readFile(path.join(target, ".run-owner.json"), "utf8"));
  if (owner.schema !== "schema-docs.real-material-run" || owner.runId !== runId || owner.retained === true) {
    throw new Error("Run is unowned or retained as evidence; refusing cleanup.");
  }
  if (owner.sourceRoot && (path.resolve(owner.sourceRoot) === target || target.startsWith(path.resolve(owner.sourceRoot) + path.sep))) {
    throw new Error("Cleanup target overlaps source materials.");
  }
  const manifest = { schema: "schema-docs.real-material-test-cleanup", runId,
    outputRoot: root, planned: [target], removed: [], dryRun: options.apply !== true };
  if (options.apply !== true) return manifest;
  const guard = await acquireEvaluationLock(root, { runId, operation: "cleanup" });
  try {
    await assertPlainPath(root, target);
    const currentOwner = JSON.parse(await readFile(path.join(target, ".run-owner.json"), "utf8"));
    if (JSON.stringify(currentOwner) !== JSON.stringify(owner)) throw new Error("Run ownership changed.");
    options.onPlan?.(manifest.planned);
    await removeTree(target);
    manifest.removed.push(target);
    manifest.cleanedAt = new Date().toISOString();
    await writeFile(path.join(root, `cleanup-${runId}.json`), JSON.stringify(manifest, null, 2));
    return manifest;
  } finally { guard.release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), runIndex = args.indexOf("--run-id");
  if (args.includes("--help")) console.log("Usage: clean-real-material-artifacts.js [output-root] --run-id ID [--apply] [--resume]\nDefaults to listing the selected run; retained evidence is protected.");
  else cleanRealMaterialTestArtifacts(args[0]?.startsWith("--") ? DEFAULT_OUTPUT_ROOT : args[0], {
    runId: runIndex >= 0 ? args[runIndex + 1] : "", apply: args.includes("--apply"),
    mode: args.includes("--resume") ? "resume" : "cold",
    onPlan: planned => console.log(JSON.stringify({ planned }))
  }).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(error.message); process.exitCode = 1;
  });
}
