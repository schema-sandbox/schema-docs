import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { KATEX_WOFF2_FONT_FILES } from "../core/katexRuntimeAssets.js";

const root = path.resolve(import.meta.dirname, "../..");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const runtimeRoot = path.resolve(argValue(
  "--runtime-root",
  path.join(root, "src-tauri", "target", "release", "runtime")
));
const port = Number(argValue("--port", process.env.SCHEMA_DOCS_DESKTOP_PORT ?? 18160));
const launcher = path.join(runtimeRoot, "src", "cli", "desktop-runtime-launcher.js");
const packageJson = path.join(runtimeRoot, "package.json");
const bundledNode = path.join(runtimeRoot, "node.exe");
const isBundled = existsSync(bundledNode);
const nodePath = isBundled ? bundledNode : process.execPath;
const requiredFiles = {
  launcher,
  packageJson,
  publicIndex: path.join(runtimeRoot, "public", "index.html"),
  markdownIt: path.join(runtimeRoot, "public", "libs", "markdown-it.min.js"),
  docx: path.join(runtimeRoot, "public", "libs", "docx.js"),
  katex: path.join(runtimeRoot, "public", "libs", "katex", "katex.min.js"),
  katexCss: path.join(runtimeRoot, "public", "libs", "katex", "katex.min.css"),
  ...Object.fromEntries(KATEX_WOFF2_FONT_FILES.map((fontName) => [
    `katexFont:${fontName}`,
    path.join(runtimeRoot, "public", "libs", "katex", "fonts", fontName)
  ]))
};
const missingFiles = Object.values(requiredFiles).filter((filePath) => !existsSync(filePath));

function printAndExit(result) {
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

async function readHealth(baseUrl) {
  const response = await fetch(`${baseUrl}/api/health`);
  return {
    status: response.status,
    body: await response.json()
  };
}

function waitForLauncher(child) {
  let stdout = "";
  let stderr = "";
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`desktop runtime bridge did not become ready. stderr: ${stderr.trim()}`));
    }, 7000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      try {
        const parsed = JSON.parse(stdout);
        clearTimeout(timeout);
        resolve(parsed);
      } catch {
        // Wait for pretty-printed JSON to finish.
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`desktop runtime bridge exited early with code ${code}. stderr: ${stderr.trim()}`));
    });
  });
}

if (missingFiles.length > 0) {
  printAndExit({
    ok: false,
    runtimeRoot,
    launcher,
    packageJson,
    nodePath,
    isBundled,
    requiredFiles,
    missingFiles,
    error: "Packaged runtime resource is missing. Run npm run desktop:build first, or pass --runtime-root for a source-runtime check."
  });
} else {
  const sessionDir = await mkdtemp(path.join(os.tmpdir(), "schema-docs-bridge-smoke-"));
  const child = spawn(nodePath, [launcher, String(port)], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      SCHEMA_DOCS_RUNTIME_SESSION_DIR: sessionDir
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let runtime;
  let health;
  let failure = null;
  try {
    runtime = await waitForLauncher(child);
    health = await readHealth(runtime.baseUrl);
  } catch (error) {
    failure = {
      ok: false,
      runtimeRoot,
      launcher,
      nodePath,
      isBundled,
      error: error.message
    };
  } finally {
    child.kill();
  }

  if (failure) {
    printAndExit(failure);
  } else {
    printAndExit({
      ok: Boolean(
        runtime?.ok === true
        && runtime?.sessionWriteError === ""
        && health?.status === 200
        && health?.body?.data?.service === "schema-docs-local-api"
      ),
      runtimeRoot,
      launcher,
      nodePath,
      isBundled,
      runtime,
      health
    });
  }
}
