import path from "node:path";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { readFileSync, unlinkSync } from "node:fs";

export function validateRunId(runId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(runId || "") || [".", ".."].includes(runId)) throw new Error("A safe, explicit run ID is required.");
  return runId;
}

export async function assertPlainPath(root, target) {
  const base = path.resolve(root), resolved = path.resolve(target);
  const relative = path.relative(base, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Path escapes its workspace.");
  const canonical = await realpath(base);
  let current = base;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const info = await lstat(current).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (!info) continue;
    if (info.isSymbolicLink()) throw new Error(`Refusing linked cleanup path: ${current}`);
    const actual = await realpath(current);
    const inside = path.relative(canonical, actual);
    if (inside.startsWith("..") || path.isAbsolute(inside)) throw new Error("Resolved path escapes its workspace.");
  }
  return resolved;
}

export async function acquireEvaluationLock(root, { runId, sourceRoot = "", operation = "evaluate" }) {
  validateRunId(runId);
  await mkdir(root, { recursive: true });
  const lockPath = path.join(root, ".real-material-evaluation.lock");
  const token = randomUUID();
  const lock = { schema: "schema-docs.evaluation-lock", token, runId, pid: process.pid,
    processStartedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    startedAt: new Date().toISOString(), sourceRoot, operation };
  try {
    await writeFile(lockPath, JSON.stringify(lock), { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stale = JSON.parse(await readFile(lockPath, "utf8"));
    if (!Number.isInteger(stale.pid) || !stale.token) throw new Error("Unknown lock owner; refusing cleanup/start.");
    let alive = true;
    try { process.kill(stale.pid, 0); } catch (probe) { if (probe.code === "ESRCH") alive = false; }
    if (alive) throw new Error(`Run ${stale.runId} still owns the evaluation lock.`);
    const latest = JSON.parse(await readFile(lockPath, "utf8"));
    if (latest.token !== stale.token) throw new Error("Evaluation lock owner changed.");
    await unlink(lockPath);
    await writeFile(lockPath, JSON.stringify(lock), { flag: "wx" });
  }
  const release = () => {
    try { if (JSON.parse(readFileSync(lockPath, "utf8")).token === token) unlinkSync(lockPath); } catch {}
    process.removeListener("exit", release);
  };
  process.once("exit", release);
  return { lock, release };
}
