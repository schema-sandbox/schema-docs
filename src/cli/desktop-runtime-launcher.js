import { chmod, mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { listenSecureLocalServer } from "../server/secureLocalServer.js";

const root = path.resolve(import.meta.dirname, "../..");
const sessionDir = process.env.SCHEMA_DOCS_RUNTIME_SESSION_DIR
  ? path.resolve(process.env.SCHEMA_DOCS_RUNTIME_SESSION_DIR)
  : path.join(root, ".desktop-runtime");
const preferredPort = Number(process.argv[2] ?? process.env.SCHEMA_DOCS_DESKTOP_PORT ?? 4177);
const host = process.env.SCHEMA_DOCS_DESKTOP_HOST ?? "127.0.0.1";
const token = process.env.SCHEMA_DOCS_DESKTOP_TOKEN ?? randomBytes(24).toString("hex");
const fetchBlockedPorts = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161,
  179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563,
  587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060,
  5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080
]);

function emitBootstrapMarker({ apiBaseUrl, bootstrapToken }) {
  const encoded = Buffer.from(JSON.stringify({ baseUrl: apiBaseUrl, bootstrapToken }), "utf8").toString("base64url");
  // Keep stdout machine-readable for existing runtime diagnostics and smoke
  // checks. The desktop bridge reads the one-time bootstrap marker from the
  // separately captured stderr tail.
  console.error(`SCHEMA_DOCS_BOOTSTRAP ${encoded}`);
}

async function tryListen(port) {
  try {
    const server = await listenSecureLocalServer({ port, host, token, onBootstrapToken: emitBootstrapMarker });
    return { port, server };
  } catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
    return null;
  }
}

async function listenWithFallback(startPort) {
  for (let port = startPort; port < startPort + 20; port += 1) {
    if (fetchBlockedPorts.has(port)) continue;
    const result = await tryListen(port);
    if (result) return result;
  }
  throw new Error(`No available desktop runtime port from ${startPort} to ${startPort + 19}.`);
}

const { port, server } = await listenWithFallback(preferredPort);
const baseUrl = `http://${host}:${port}`;
const session = {
  service: "schema-docs-local-api",
  version: "0.1.2",
  baseUrl,
  port,
  host,
  pid: process.pid,
  tokenSource: process.env.SCHEMA_DOCS_DESKTOP_TOKEN ? "env" : "generated",
  transport: "secured-loopback-proxy+private-pipe"
};

let sessionPath = path.join(sessionDir, "session.json");
let sessionWriteError = "";
try {
  await mkdir(sessionDir, { recursive: true });
  await writeFile(sessionPath, JSON.stringify(session, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") await chmod(sessionPath, 0o600);
} catch (error) {
  sessionPath = "";
  sessionWriteError = error.message;
}

console.log(JSON.stringify({
  ok: true,
  ...session,
  sessionPath,
  sessionWriteError,
  message: "Schema Docs desktop runtime is running through a secured loopback proxy."
}, null, 2));

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
