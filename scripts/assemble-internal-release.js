import { cp, mkdir, rm, stat, copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function insideRoot(target) {
  const relative = path.relative(root, path.resolve(target));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Release target must be inside the project: ${target}`);
  }
}

export async function assembleInternalRelease({ runtimeDir, appPath, outputDir }) {
  insideRoot(runtimeDir); insideRoot(appPath); insideRoot(outputDir);
  const runtime = path.resolve(runtimeDir);
  const app = path.resolve(appPath);
  const output = path.resolve(outputDir);
  if (!(await stat(path.join(runtime, "runtime-build-manifest.json")).catch(() => null))) {
    throw new Error("Staged runtime receipt is missing.");
  }
  if (!(await stat(app).catch(() => null))) throw new Error("Desktop executable is missing.");
  // Keep the desktop executable beside a single resource directory. Tauri's
  // resource_dir on Windows resolves to the executable directory, while the
  // launcher then resolves runtime/src and runtime/node.exe below it.
  const appBytes = await readFile(app);
  const preserved = new Map();
  for (const name of ["README-INTERNAL.md", "LICENSE", "THIRD_PARTY_NOTICES.md"]) {
    const file = path.join(output, name);
    if (await stat(file).catch(() => null)) preserved.set(name, await readFile(file));
  }
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, path.basename(app)), appBytes);
  for (const [name, bytes] of preserved) await writeFile(path.join(output, name), bytes);
  await cp(runtime, path.join(output, "runtime"), { recursive: true });
  return { outputDir: output, app: path.join(output, path.basename(app)), runtime: path.join(output, "runtime") };
}

async function main() {
  const args = new Map();
  for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
  const result = await assembleInternalRelease({
    runtimeDir: path.resolve(args.get("--runtime") || ".ai-doc-exchange/repairs/2026-09-22-r5-upgrade-review/r5-final-runtime/release/runtime"),
    appPath: path.resolve(args.get("--app") || ".ai-doc-exchange/repairs/2026-09-22-r5-internal/release-r5-final4/app.exe"),
    outputDir: path.resolve(args.get("--output") || ".ai-doc-exchange/repairs/2026-09-22-r5-internal/release-r5-final4")
  });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
