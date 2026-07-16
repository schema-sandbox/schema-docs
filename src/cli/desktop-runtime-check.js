const baseUrl = (process.argv[2] ?? "http://127.0.0.1:4177").replace(/\/$/, "");

async function readJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  try {
    return {
      status: response.status,
      ok: response.ok,
      body: JSON.parse(text)
    };
  } catch {
    return {
      status: response.status,
      ok: false,
      body: text
    };
  }
}

const health = await readJson(`${baseUrl}/api/health`).catch((error) => ({
  ok: false,
  status: 0,
  body: {
    code: "local_api_unreachable",
    message: error.message
  }
}));

const result = {
  baseUrl,
  ok: Boolean(
    health.ok
    && health.body?.ok === true
    && health.body?.data?.service === "schema-docs-local-api"
  ),
  health
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
