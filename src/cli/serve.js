import { listenSecureLocalServer } from "../server/secureLocalServer.js";

const portArg = Number(process.argv[2]);
const port = Number.isFinite(portArg) && portArg > 0 ? portArg : 4177;
const server = await listenSecureLocalServer({ port });
const address = server.address();
const actualPort = typeof address === "object" && address ? address.port : port;

console.log(`Schema Docs AI intake UI: http://127.0.0.1:${actualPort}`);

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
