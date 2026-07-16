import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { KATEX_WOFF2_FONT_FILES } from "../core/katexRuntimeAssets.js";

const root = path.resolve(import.meta.dirname, "../..");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const checkOnly = process.argv.includes("--check-only");
const appPath = path.resolve(argValue(
  "--app",
  path.join(root, "src-tauri", "target", "release", "app.exe")
));
const host = "127.0.0.1";
const startPort = Number(argValue("--start-port", process.env.SCHEMA_DOCS_DESKTOP_PORT ?? 4177));
const endPort = Number(argValue("--end-port", startPort + 22));
const timeoutMs = Number(argValue("--timeout-ms", 15000));
const fetchBlockedPorts = new Set([4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);

function inspectPackagedRuntime(executablePath) {
  const runtimeRoot = path.join(path.dirname(executablePath), "runtime");
  const requiredFiles = {
    node: path.join(runtimeRoot, "node.exe"),
    packageJson: path.join(runtimeRoot, "package.json"),
    launcher: path.join(runtimeRoot, "src", "cli", "desktop-runtime-launcher.js"),
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
  return {
    ok: missingFiles.length === 0,
    runtimeRoot,
    requiredFiles,
    missingFiles
  };
}

const packagedRuntime = inspectPackagedRuntime(appPath);

function printAndExit(result) {
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

async function readHealth(baseUrl) {
  const response = await fetch(`${baseUrl}/api/health`);
  const body = await response.json();
  return {
    status: response.status,
    ok: response.ok && body?.ok === true && body?.data?.service === "schema-docs-local-api",
    body
  };
}

async function discoverRuntime() {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  let lastProbe = null;
  while (Date.now() < deadline) {
    for (let port = startPort; port <= endPort; port += 1) {
      if (fetchBlockedPorts.has(port)) {
        continue;
      }
      const baseUrl = `http://${host}:${port}`;
      try {
        const health = await readHealth(baseUrl);
        lastProbe = {
          baseUrl,
          status: health.status,
          body: health.body
        };
        if (health.ok) {
          return {
            ok: true,
            baseUrl,
            port,
            health
          };
        }
      } catch (error) {
        lastError = error.message;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return {
    ok: false,
    lastError,
    lastProbe
  };
}

async function stopProcessTree(pid) {
  if (!pid) {
    return {
      attempted: false,
      method: "none"
    };
  }

  if (process.platform === "win32") {
    return await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore"
      });
      killer.once("exit", (code) => {
        const stillRunning = isProcessRunning(pid);
        resolve({
          attempted: true,
          method: "taskkill",
          ok: code === 0 || !stillRunning,
          exitCode: code,
          stillRunning
        });
      });
      killer.once("error", (error) => {
        try {
          process.kill(pid);
        } catch {
          // Best effort cleanup. The app might already be closed by the user.
        }
        resolve({
          attempted: true,
          method: "process.kill",
          ok: !isProcessRunning(pid),
          stillRunning: isProcessRunning(pid),
          error: error.message
        });
      });
    });
  }

  try {
    process.kill(-pid);
    return {
      attempted: true,
      method: "process.kill-group",
      ok: true
    };
  } catch {
    try {
      process.kill(pid);
      return {
        attempted: true,
        method: "process.kill",
        ok: true
      };
    } catch (error) {
      return {
        attempted: true,
        method: "process.kill",
        ok: false,
        error: error.message
      };
    }
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

if (!existsSync(appPath)) {
  printAndExit({
    ok: false,
    mode: checkOnly ? "check-only" : "launch",
    appPath,
    error: "Packaged app executable is missing. Run npm run desktop:build first."
  });
} else if (!packagedRuntime.ok) {
  printAndExit({
    ok: false,
    mode: checkOnly ? "check-only" : "launch",
    appPath,
    packagedRuntime,
    error: "Packaged runtime resources are missing beside the app executable. Keep app.exe with its generated runtime directory or run npm run desktop:build first."
  });
} else if (checkOnly) {
  printAndExit({
    ok: true,
    mode: "check-only",
    appPath,
    packagedRuntime,
    scanRange: `${host}:${startPort}-${endPort}`
  });
} else {
  const child = spawn(appPath, [], {
    stdio: "ignore",
    env: {
      ...process.env,
      SCHEMA_DOCS_DESKTOP_PORT: String(startPort)
    }
  });
  const appExit = {
    exited: false,
    code: null,
    signal: null
  };
  child.once("exit", (code, signal) => {
    appExit.exited = true;
    appExit.code = code;
    appExit.signal = signal;
  });

  const runtime = await discoverRuntime();
  const cleanup = await stopProcessTree(child.pid);

  printAndExit({
    ok: runtime.ok,
    mode: "launch",
    appPath,
    packagedRuntime,
    appPid: child.pid,
    appExit,
    scanRange: `${host}:${startPort}-${endPort}`,
    cleanup,
    runtime
  });
}
