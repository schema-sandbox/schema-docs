import { listenSecureLocalServer } from "../server/secureLocalServer.js";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function pairingUrl({ apiBaseUrl, bootstrapToken }) {
  const descriptor = Buffer.from(JSON.stringify({ baseUrl: apiBaseUrl, bootstrapToken }), "utf8").toString("base64url");
  return `${apiBaseUrl}/#bootstrap=${descriptor}`;
}

const sessionDir = process.env.SCHEMA_DOCS_RUNTIME_SESSION_DIR
  ? path.resolve(process.env.SCHEMA_DOCS_RUNTIME_SESSION_DIR)
  : "";
const bootstrapLogPath = sessionDir ? path.join(sessionDir, "runtime-stderr.log") : "";

async function publishDesktopBootstrapMarker({ apiBaseUrl, bootstrapToken }) {
  if (!bootstrapLogPath) return;
  const encoded = Buffer.from(JSON.stringify({ baseUrl: apiBaseUrl, bootstrapToken }), "utf8").toString("base64url");
  await mkdir(sessionDir, { recursive: true });
  await appendFile(bootstrapLogPath, `SCHEMA_DOCS_BOOTSTRAP ${encoded}\n`, "utf8");
}

if (bootstrapLogPath) {
  await mkdir(sessionDir, { recursive: true });
  // A stale one-time token must never be tried after restarting the dev server.
  await writeFile(bootstrapLogPath, "", "utf8");
}

const portArg = Number(process.argv[2]);
const port = Number.isFinite(portArg) && portArg > 0 ? portArg : 4177;
const server = await listenSecureLocalServer({
  port,
  onBootstrapToken: (descriptor) => {
    publishDesktopBootstrapMarker(descriptor).catch((error) => {
      console.error(`Schema Docs could not publish the desktop bootstrap marker: ${error.message}`);
    });
    if (descriptor.previousToken) console.log(`Schema Docs refreshed pairing URL: ${pairingUrl(descriptor)}`);
  }
});
const address = server.address();
const actualPort = typeof address === "object" && address ? address.port : port;

const baseUrl = `http://127.0.0.1:${actualPort}`;
console.log(`Schema Docs AI intake UI: ${pairingUrl({ apiBaseUrl: baseUrl, bootstrapToken: server.bootstrapToken })}`);

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
