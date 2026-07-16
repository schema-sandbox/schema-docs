import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { getWorkspaceSettings } from "../core/settings.js";
import { detectAdapterCapabilities } from "../core/adapterCapabilities.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "../..");

async function readPackageJson(pkgPath) {
  try {
    const { default: pkg } = await import(pathToFileURL(pkgPath), { assert: { type: "json" } });
    return pkg;
  } catch {
    try {
      const fs = await import("node:fs/promises");
      return JSON.parse(await fs.readFile(pkgPath, "utf8"));
    } catch {
      return { version: "unknown", devDependencies: {} };
    }
  }
}

async function main() {
  const workspacePath = process.argv[2] ? path.resolve(process.argv[2]) : ".";

  console.log("=== Schema Docs Doctor Report ===");
  console.log("Checking local environment setup...\n");

  let nodeOk = false;
  try {
    const { stdout } = await execFileAsync("node", ["-v"]);
    console.log(`[OK] Node.js version: ${stdout.trim()}`);
    nodeOk = true;
  } catch (error) {
    console.log(`[FAIL] Node.js is missing or error reading version: ${error.message}`);
  }

  const pkg = await readPackageJson(path.join(root, "package.json"));
  console.log(`[OK] Package version: ${pkg.version || "unknown"}`);

  const depsCount = Object.keys(pkg.dependencies || {}).length;
  if (depsCount === 0) {
    console.log("[OK] Zero runtime dependencies verified.");
  } else {
    console.log(`[FAIL] Found ${depsCount} runtime dependencies in package.json.`);
  }

  let workspaceWritable = false;
  try {
    const tempTestFile = path.join(workspacePath, `.doctor_write_test_${Date.now()}`);
    const fs = await import("node:fs/promises");
    await fs.writeFile(tempTestFile, "write_test", "utf8");
    await fs.unlink(tempTestFile);
    console.log("[OK] Workspace directory is writable.");
    workspaceWritable = true;
  } catch (error) {
    console.log(`[FAIL] Workspace directory is not writable: ${error.message}`);
  }

  const binPath = path.join(root, "src-tauri/target/release/app.exe");
  try {
    const fileStat = await stat(binPath);
    console.log(`[OK] Desktop app installer artifact found: app.exe (${fileStat.size} bytes)`);
  } catch {
    console.log("[WARN] Desktop app installer artifact not found: app.exe");
  }

  try {
    const settings = await getWorkspaceSettings(workspacePath);
    console.log(`[OK] Workspace settings verified: model="${settings.defaultAiModel || "none"}", limit=${settings.defaultQueryLimit}`);
  } catch (error) {
    console.log(`[WARN] Workspace settings verification skipped or errored: ${error.message}`);
  }

  console.log("\n--- Detecting External System Adapter Dependencies ---");
  try {
    const caps = await detectAdapterCapabilities();
    for (const cap of Object.values(caps)) {
      if (cap.available) {
        console.log(`[OK] [${cap.name}] Available. Version: ${cap.version}`);
      } else {
        console.log(`[WARN] [${cap.name}] Not found (fallback active) - Purpose: ${cap.purpose}`);
      }
    }
  } catch (error) {
    console.log(`[WARN] Error detecting adapter capabilities: ${error.message}`);
  }

  console.log("\n=== Doctor Summary ===");
  if (nodeOk && workspaceWritable && depsCount === 0) {
    console.log("Status: PASS (Environment is healthy for delivery)");
  } else {
    console.log("Status: WARN (Please review details above)");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
