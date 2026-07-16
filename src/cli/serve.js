import { listenLocalServer } from "../server/localServer.js";

const portArg = Number(process.argv[2]);
const port = Number.isFinite(portArg) && portArg > 0 ? portArg : 4177;
const server = await listenLocalServer({ port });

console.log(`Schema Docs AI intake UI: http://127.0.0.1:${port}`);

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
