import { listenLocalServer } from "../../src/server/localServer.js";

const fetchBlockedPorts = new Set([4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);
let nextTestPort = 18080;

export async function withServer(fn) {
  let server;
  let lastError;
  for (let attempts = 0; attempts < 50; attempts += 1) {
    const port = nextTestPort;
    nextTestPort += 1;
    if (fetchBlockedPorts.has(port)) {
      continue;
    }
    try {
      server = await listenLocalServer({ port });
      break;
    } catch (error) {
      lastError = error;
      if (error.code !== "EADDRINUSE") {
        throw error;
      }
    }
  }
  if (!server) {
    throw lastError ?? new Error("No test server port available.");
  }
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

export async function getToken(baseUrl) {
  const response = await fetch(`${baseUrl}/app-config.js`);
  const script = await response.text();
  return /"([a-f0-9]{48})"/.exec(script)?.[1];
}

export async function post(baseUrl, route, body) {
  const token = await getToken(baseUrl);
  const response = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ai-doc-exchange-token": token
    },
    body: JSON.stringify(body)
  });
  return response.json();
}

export async function getJson(baseUrl, route, params = {}) {
  const token = await getToken(baseUrl);
  const url = new URL(`${baseUrl}${route}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    headers: {
      "x-ai-doc-exchange-token": token
    }
  });
  return response.json();
}
