import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { listenLocalServer } from "../src/server/localServer.js";
import { KATEX_WOFF2_FONT_FILES } from "../src/core/katexRuntimeAssets.js";
import {
  betaCheckPath,
  cliPath,
  desktopAppSmokePath,
  desktopBridgeSmokePath,
  desktopPreviewPath,
  desktopRuntimeLauncherPath,
  desktopWorkflowSmokePath,
  execFileAsync,
  fixtureCheckPath,
  projectRoot,
  uiCheckPath,
  webUiSmokePath
} from "./helpers/cliHarness.js";
const exportLibraryFiles = [
  "public/libs/markdown-it.min.js",
  "public/libs/docx.js",
  "public/libs/katex/katex.min.js",
  "public/libs/katex/katex.min.css",
  ...KATEX_WOFF2_FONT_FILES.map((fontName) => `public/libs/katex/fonts/${fontName}`)
];
async function runCliJson(scriptPath, args = [], options = {}) {
  const { stdout } = await execFileAsync(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: "test" },
    ...options
  });
  return JSON.parse(stdout);
}
async function runCliRejectJson(scriptPath, args = [], options = {}) {
  try {
    await execFileAsync(process.execPath, [scriptPath, ...args], {
      cwd: projectRoot,
      env: { ...process.env, NODE_ENV: "test" },
      ...options
    });
  } catch (error) {
    return JSON.parse(error.stdout);
  }
  throw new Error(`Expected ${path.basename(scriptPath)} to fail.`);
}
async function makeTempPath(prefix, relativePath, content = "") {
  const workspace = await mkdtemp(path.join(os.tmpdir(), prefix));
  const filePath = path.join(workspace, relativePath);
  await writeFile(filePath, content);
  return { workspace, filePath };
}
async function addFakePackagedRuntime(appPath) {
  const runtimeRoot = path.join(path.dirname(appPath), "runtime");
  const launcher = path.join(runtimeRoot, "src", "cli", "desktop-runtime-launcher.js");
  await mkdir(path.dirname(launcher), { recursive: true });
  await writeFile(path.join(runtimeRoot, "node.exe"), "");
  await writeFile(path.join(runtimeRoot, "package.json"), "{}");
  await writeFile(launcher, "");
  await mkdir(path.join(runtimeRoot, "public"), { recursive: true });
  await writeFile(path.join(runtimeRoot, "public", "index.html"), "<!doctype html>");
  for (const relativePath of exportLibraryFiles) {
    const filePath = path.join(runtimeRoot, ...relativePath.split("/"));
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "");
  }
  return runtimeRoot;
}
function writeJson(filePath, value) {
  return writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}
function assertNamedChecksOk(checks, names) {
  const byName = new Map(checks.map((check) => [check.name, check]));
  for (const name of names) {
    assert.equal(byName.get(name)?.ok, true, name);
  }
}
async function writeBlockedF012Results(filePath) {
  const resultsContent = JSON.parse(await readFile(path.join(projectRoot, "samples/fixture-results.json"), "utf8"));
  resultsContent.results = resultsContent.results.map((result) => (
    result.id === "F-012" ? { ...result, status: "blocked", evidence: "Pending verification" } : result
  ));
  resultsContent.statusCounts = { pass: 10, known_limit: 1, blocked: 1 };
  await writeJson(filePath, resultsContent);
}
test("beta-check parses release mode without treating it as workspace", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-beta-workspace-"));
  const tempResultsPath = path.join(workspace, "fixture-results.json");
  await writeBlockedF012Results(tempResultsPath);
  const result = await runCliRejectJson(betaCheckPath, ["--mode", "public-preview", "--results", tempResultsPath, "--json"]);
  assert.equal(result.mode, "public-preview");
  assert.equal(result.ready, false);
  assert.equal(result.recommendedAudience, "internal");
  assert.ok(result.blockers.some((blocker) => blocker.includes("F-012")));
  assert.ok(result.realSampleSummary.total >= 20);
  await rm(workspace, { recursive: true, force: true });
});
test("beta-check exits nonzero when release readiness is blocked", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-beta-blocked-"));
  const tempResultsPath = path.join(workspace, "fixture-results.json");
  await writeBlockedF012Results(tempResultsPath);
  const result = await runCliRejectJson(betaCheckPath, [
    "--mode",
    "public-preview",
    "--results",
    tempResultsPath,
    "--json"
  ]);
  assert.equal(result.ready, false);
  assert.equal(result.recommendedAudience, "internal");
  assert.ok(result.blockers.some((blocker) => blocker.includes("F-012")));
  await rm(workspace, { recursive: true, force: true });
});
test("beta-check writes a report file", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-beta-report-"));
  const reportPath = path.join(workspace, "nested", "beta-check.json");
  const tempResultsPath = path.join(workspace, "fixture-results.json");
  await writeBlockedF012Results(tempResultsPath);
  const result = await runCliRejectJson(betaCheckPath, ["--mode", "public-preview", "--write-report", reportPath, "--results", tempResultsPath, "--json"]);
  const written = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(result.ready, false);
  assert.equal(written.mode, "public-preview");
  assert.equal(written.ready, false);
  assert.equal(written.recommendedAudience, "internal");
  await rm(workspace, { recursive: true, force: true });
});
test("ui-check validates visible desktop UI text and offline assets", async () => {
  const result = await runCliJson(uiCheckPath);
  assert.equal(result.ok, true);
  assertNamedChecksOk(result.checks, [
    "required_dom_ids_present",
    "required_ui_text_present",
    "no_known_mojibake_or_external_font_imports",
    "html_shell_integrity_present",
    "bilingual_ui_toggle_present",
    "bilingual_ui_runtime_translations_valid"
  ]);
});
test("web-ui-smoke verifies served UI, runtime config, and health endpoint", async () => {
  const result = await runCliJson(webUiSmokePath, ["--port", "18195"]);
  assert.equal(result.ok, true);
  assert.match(result.baseUrl, /http:\/\/127\.0\.0\.1:18195/);
  assertNamedChecksOk(result.checks, [
    "routes_served",
    "html_shell_ok",
    "runtime_config_served",
    "health_ok",
    "bilingual_ui_toggle_present",
    "served_bilingual_ui_runtime_translations_valid",
    "served_reader_facing_text_present",
    "no_served_mojibake"
  ]);
  const routesServed = result.checks.find((check) => check.name === "routes_served");
  assert.equal(routesServed.statuses["/i18nPanel.js"], 200);
});
test("web-ui-smoke falls back when the preferred port is already in use", async () => {
  const occupied = await listenLocalServer({ port: 18197 });
  try {
    const result = await runCliJson(webUiSmokePath, ["--port", "18197", "--end-port", "18198"]);
    assert.equal(result.ok, true);
    assert.equal(result.port, 18198);
    assert.equal(result.scanRange, "127.0.0.1:18197-18198");
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }
});
test("versions list reports a friendly missing path error", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-versions-missing-path-"));
  const result = await runCliRejectJson(cliPath, ["versions", workspace, "list"]);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unknown_error");
  assert.match(result.error.message, /versions list requires <relativePath>/);
  assert.match(result.error.message, /outputs\/document\.md/);
});
test("fixture-check strict mode blocks release until desktop workflow is verified", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-fixture-strict-"));
  const tempResultsPath = path.join(workspace, "fixture-results.json");
  await writeBlockedF012Results(tempResultsPath);
  const result = await runCliRejectJson(fixtureCheckPath, ["--strict", "--results", tempResultsPath]);
  assert.equal(result.ok, false);
  assert.equal(result.strict, true);
  assert.deepEqual(result.statusCounts, { pass: 10, known_limit: 1, blocked: 1 });
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].code, "workflow_not_release_ready");
  assert.equal(result.failures[0].detail.id, "F-012");
});
test("desktop preview check starts a local runtime without opening the app", async () => {
  const sessionDir = await mkdtemp(path.join(os.tmpdir(), "schema-docs-preview-session-"));
  const result = await runCliJson(desktopPreviewPath, ["--check-only"], {
    env: {
      ...process.env,
      SCHEMA_DOCS_DESKTOP_PORT: "18120",
      SCHEMA_DOCS_RUNTIME_SESSION_DIR: sessionDir
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "check-only");
  assert.equal(result.health.body.data.service, "schema-docs-local-api");
  assert.equal(path.dirname(result.sessionPath), sessionDir);
  assert.equal(JSON.parse(await readFile(result.sessionPath, "utf8")).baseUrl, result.baseUrl);
});
test("desktop runtime launcher writes session to configured writable directory", async () => {
  const sessionDir = await mkdtemp(path.join(os.tmpdir(), "schema-docs-runtime-session-"));
  const child = spawn(process.execPath, [desktopRuntimeLauncherPath, "18141"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      SCHEMA_DOCS_RUNTIME_SESSION_DIR: sessionDir
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let result;
  try {
    result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("desktop runtime launcher did not become ready")), 5000);
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
        try {
          const parsed = JSON.parse(stdout);
          clearTimeout(timeout);
          resolve(parsed);
        } catch {

        }
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code) => {
        if (!result) {
          clearTimeout(timeout);
          reject(new Error(`desktop runtime launcher exited early with code ${code}`));
        }
      });
    });
  } finally {
    child.kill();
  }
  assert.equal(result.ok, true);
  assert.equal(result.port, 18141);
  assert.match(result.sessionPath, /session\.json$/);
  assert.equal(result.sessionWriteError, "");
  assert.equal(existsSync(path.join(sessionDir, "session.json")), true);
});
test("desktop bridge smoke can verify a source runtime root", async () => {
  const result = await runCliJson(desktopBridgeSmokePath, ["--runtime-root", projectRoot, "--port", "18142"]);
  assert.equal(result.ok, true);
  assert.equal(result.isBundled, false);
  assert.equal(result.nodePath, process.execPath);
  assert.equal(result.runtime.port, 18142);
  assert.equal(result.health.body.data.service, "schema-docs-local-api");
  assert.equal(result.runtime.sessionWriteError, "");
});
test("desktop app smoke check-only validates a packaged app path without launching GUI", async () => {
  const { filePath: fakeApp } = await makeTempPath("schema-docs-app-smoke-", process.platform === "win32" ? "app.exe" : "app");
  await addFakePackagedRuntime(fakeApp);
  const result = await runCliJson(desktopAppSmokePath, ["--check-only", "--app", fakeApp, "--start-port", "18143", "--end-port", "18143"]);
  assert.equal(result.ok, true);
  assert.equal(result.mode, "check-only");
  assert.equal(result.appPath, fakeApp);
  assert.equal(result.packagedRuntime.ok, true);
  assert.equal(result.scanRange, "127.0.0.1:18143-18143");
});
test("desktop workflow smoke check-only validates a packaged app path without launching GUI", async () => {
  const { filePath: fakeApp } = await makeTempPath("schema-docs-workflow-smoke-", process.platform === "win32" ? "app.exe" : "app");
  await addFakePackagedRuntime(fakeApp);
  const result = await runCliJson(desktopWorkflowSmokePath, ["--check-only", "--app", fakeApp, "--start-port", "18144", "--end-port", "18144"]);
  assert.equal(result.ok, true);
  assert.equal(result.mode, "check-only");
  assert.equal(result.appPath, fakeApp);
  assert.equal(result.packagedRuntime.ok, true);
  assert.equal(result.scanRange, "127.0.0.1:18144-18144");
});
