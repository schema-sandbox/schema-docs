import { listenSecureLocalServer } from "../server/secureLocalServer.js";

function pairingUrl({ apiBaseUrl, bootstrapToken }) {
  const descriptor = Buffer.from(JSON.stringify({ baseUrl: apiBaseUrl, bootstrapToken }), "utf8").toString("base64url");
  return `${apiBaseUrl}/#bootstrap=${descriptor}`;
}

const portArg = Number(process.argv[2]);
const port = Number.isFinite(portArg) && portArg > 0 ? portArg : 4177;
const server = await listenSecureLocalServer({
  port,
  onBootstrapToken: (descriptor) => {
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
