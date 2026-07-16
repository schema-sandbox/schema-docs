import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import { listenLocalServer } from "../server/localServer.js";

const root = path.resolve(import.meta.dirname, "../..");
const sessionDir = process.env.SCHEMA_DOCS_RUNTIME_SESSION_DIR
  ? path.resolve(process.env.SCHEMA_DOCS_RUNTIME_SESSION_DIR)
  : path.join(root, ".desktop-runtime");
const checkOnly = process.argv.includes("--check-only");
const launchApp = process.argv.includes("--launch-app");
const host = "127.0.0.1";
const preferredPort = Number(process.env.SCHEMA_DOCS_DESKTOP_PORT ?? 4177);
const token = randomBytes(24).toString("hex");
const fetchBlockedPorts = new Set([4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);

async function listenWithFallback() {
  for (let port = preferredPort; port < preferredPort + 50; port += 1) {
    if (fetchBlockedPorts.has(port)) {
      continue;
    }
    try {
      return {
        port,
        server: await listenLocalServer({ port, host, token })
      };
    } catch (error) {
      if (error.code !== "EADDRINUSE") {
        throw error;
      }
    }
  }
  throw new Error(`No available desktop preview port from ${preferredPort} to ${preferredPort + 49}.`);
}

async function readHealth(baseUrl) {
  const response = await fetch(`${baseUrl}/api/health`);
  return {
    status: response.status,
    body: await response.json()
  };
}

function launchPackagedApp() {
  const appPath = path.join(root, "src-tauri", "target", "release", "app.exe");
  const child = spawn(appPath, [], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      SCHEMA_DOCS_API_BASE_URL: undefined
    }
  });
  child.unref();
  return appPath;
}

const { port, server } = await listenWithFallback();
const baseUrl = `http://${host}:${port}`;
const health = await readHealth(baseUrl);
const appPath = launchApp ? launchPackagedApp() : "";
const sessionPath = path.join(sessionDir, "preview-session.json");
const result = {
  ok: health.status === 200 && health.body?.ok === true,
  mode: checkOnly ? "check-only" : "preview",
  baseUrl,
  port,
  health,
  appPath,
  sessionPath,
  note: launchApp
    ? "Packaged app launched; keep this process alive while testing."
    : "Runtime is ready. Start the packaged app separately, or rerun with --launch-app."
};

await mkdir(sessionDir, { recursive: true });
await writeFile(
  sessionPath,
  JSON.stringify(result, null, 2) + "\n",
  "utf8"
);

console.log(JSON.stringify(result, null, 2));

if (!result.ok || checkOnly) {
  server.close(() => process.exit(result.ok ? 0 : 1));
} else {
  process.on("SIGINT", () => server.close(() => process.exit(0)));
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}
