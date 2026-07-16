import { execFile } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getRealSampleSummary } from "../core/realSamples.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC_REAL_SAMPLE_MINIMUM = 20;
const DEFAULT_RELEASE_MODE = "public-preview";
export const SUPPORTED_RELEASE_MODES = ["internal-alpha", "private-beta", "public-preview", "public"];

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function runJsonScript(scriptRelativePath, args = []) {
  const scriptPath = path.join(root, scriptRelativePath);
  try {
    const { stdout } = await execFileAsync(process.execPath, [scriptPath, ...args], {
      cwd: root,
      maxBuffer: 1024 * 1024
    });
    return {
      ok: true,
      exitCode: 0,
      result: JSON.parse(stdout)
    };
  } catch (error) {
    const stdout = typeof error.stdout === "string" ? error.stdout.trim() : "";
    let result = null;
    try {
      result = stdout ? JSON.parse(stdout) : null;
    } catch {
      result = null;
    }
    return {
      ok: false,
      exitCode: typeof error.code === "number" ? error.code : 1,
      error: error.message,
      result
    };
  }
}

function fixtureBlockingItems(fixtureResult) {
  return (fixtureResult?.failures ?? [])
    .filter((failure) => failure.code === "workflow_not_release_ready")
    .map((failure) => ({
      id: failure.detail?.id ?? "unknown",
      status: failure.detail?.status ?? "unknown",
      required: failure.detail?.required ?? []
    }));
}

function buildNextActions({ releaseCheck, fixtureStrict }) {
  const actions = [];
  if (releaseCheck.result?.automaticChecksPassed !== true) {
    actions.push("Fix failing automatic release-check items before preparing a public v0.1.0 tag.");
  }

  const blockingItems = fixtureBlockingItems(fixtureStrict.result);
  if (blockingItems.some((item) => item.id === "F-012")) {
    actions.push("Complete F-012 visible Desktop UI verification on the target Windows machine.");
    actions.push("Run npm run desktop-release-preflight -- --out-dir <dir> and follow desktop-handoff.md.");
    actions.push("Run npm run desktop-preflight-check -- <dir> to verify the preflight evidence hashes before manual testing.");
    actions.push("Fill the desktop verification record with WebView2, Node, diagnostics, native picker, tester, and timestamp evidence.");
    actions.push("Confirm the filled record artifact SHA-256 matches npm run release-artifacts before closing F-012.");
    actions.push("Run npm run desktop-verification-check -- --strict <filled-record.json> before closing F-012.");
    actions.push("Close F-012 only with npm run desktop-fixture-close -- --record <filled-record.json> --write.");
  }

  if (fixtureStrict.result?.ok !== true && blockingItems.length === 0) {
    actions.push("Fix fixture-check --strict failures before preparing a public v0.1.0 tag.");
  }

  return actions;
}

function missingRequiredCapabilities(summary, required = ["ai_intake", "safety_gate", "format_exchange"]) {
  const coverage = summary?.capabilityCoverage ?? {};
  return required.filter((capability) => Number(coverage[capability] || 0) <= 0);
}

export function isSupportedReleaseMode(mode) {
  return SUPPORTED_RELEASE_MODES.includes(mode);
}

export function isPublicPreviewMode(mode) {
  return mode === "public-preview" || mode === "public";
}

export async function buildReleaseReadiness(options = {}) {
  const resultsArg = options.resultsPath ?? argValue("--results");
  const mode = options.mode ?? argValue("--mode", DEFAULT_RELEASE_MODE);
  const releaseCheck = await runJsonScript("src/cli/release-check.js");
  const fixtureArgs = ["--strict", "--json"];
  if (resultsArg) {
    fixtureArgs.push("--results", resultsArg);
  }
  const fixtureStrict = await runJsonScript("src/cli/fixture-check.js", fixtureArgs);
  const automaticChecksPassed = releaseCheck.result?.automaticChecksPassed === true;
  const fixtureStrictPassed = fixtureStrict.result?.ok === true;

  let f012Status = "blocked";
  try {
    const resultsFile = resultsArg ? path.resolve(root, resultsArg) : path.join(root, "samples/fixture-results.json");
    const fixtureResults = JSON.parse(await readFile(resultsFile, "utf8"));
    f012Status = fixtureResults.results?.find((r) => r.id === "F-012")?.status ?? "blocked";
  } catch {
    f012Status = "blocked";
  }

  let realSampleSummary = null;
  let realSampleCount = 0;
  try {
    realSampleSummary = await getRealSampleSummary(root);
    realSampleCount = realSampleSummary.total || 0;
  } catch {
    // Ignore if not present
  }

  let readyForPublicTag = false;
  let status = "blocked";
  const blockingItems = [];

  if (!isSupportedReleaseMode(mode)) {
    blockingItems.push({
      id: "release_mode",
      status: "unsupported",
      reason: `Unsupported release mode "${mode}". Use one of: ${SUPPORTED_RELEASE_MODES.join(", ")}.`
    });
  } else if (mode === "internal-alpha") {
    const otherFailures = (fixtureStrict.result?.failures ?? []).filter((f) => f.detail?.id !== "F-012");
    readyForPublicTag = automaticChecksPassed && otherFailures.length === 0;
    status = readyForPublicTag ? "ready" : "blocked";
    for (const f of otherFailures) {
      blockingItems.push({
        id: f.detail?.id ?? "unknown",
        status: f.detail?.status ?? "unknown"
      });
    }
  } else if (mode === "private-beta") {
    const hasF012Blocker = f012Status === "blocked";
    const realSamplesOk = realSampleCount >= 1;
    readyForPublicTag = automaticChecksPassed && fixtureStrictPassed && !hasF012Blocker && realSamplesOk;
    status = readyForPublicTag ? "ready" : "blocked";

    if (hasF012Blocker) {
      blockingItems.push({ id: "F-012", status: f012Status, reason: "F-012 cannot be blocked in private-beta" });
    }
    if (!realSamplesOk) {
      blockingItems.push({ id: "real_samples", status: "insufficient", reason: `At least 1 real sample reviewed required, found ${realSampleCount}` });
    }
  } else if (isPublicPreviewMode(mode)) {
    const hasF012Blocker = f012Status !== "pass";
    const realSamplesOk = realSampleCount >= PUBLIC_REAL_SAMPLE_MINIMUM;
    const missingCapabilities = missingRequiredCapabilities(realSampleSummary);
    const capabilitiesOk = missingCapabilities.length === 0;
    readyForPublicTag = automaticChecksPassed && fixtureStrictPassed && !hasF012Blocker && realSamplesOk && capabilitiesOk;
    status = readyForPublicTag ? "ready" : "blocked";

    if (hasF012Blocker) {
      blockingItems.push({ id: "F-012", status: f012Status, reason: "F-012 must be pass in public preview release" });
    }
    if (!realSamplesOk) {
      blockingItems.push({ id: "real_samples", status: "insufficient", reason: `At least ${PUBLIC_REAL_SAMPLE_MINIMUM} real samples reviewed required, found ${realSampleCount}` });
    }
    if (!capabilitiesOk) {
      blockingItems.push({ id: "real_sample_capabilities", status: "insufficient", reason: `Missing required real-sample capability coverage: ${missingCapabilities.join(", ")}` });
    }
  }

  const nextActions = buildNextActions({ releaseCheck, fixtureStrict });
  if (!isSupportedReleaseMode(mode)) {
    nextActions.push(`Rerun release-readiness with --mode ${DEFAULT_RELEASE_MODE}, private-beta, public, or internal-alpha.`);
  }
  if (isPublicPreviewMode(mode) && realSampleCount < PUBLIC_REAL_SAMPLE_MINIMUM) {
    nextActions.push(`Add more real sample validation entries in samples/real-sample-results.json (current: ${realSampleCount}/${PUBLIC_REAL_SAMPLE_MINIMUM}).`);
  }
  const missingCapabilities = isPublicPreviewMode(mode) ? missingRequiredCapabilities(realSampleSummary) : [];
  if (missingCapabilities.length > 0) {
    nextActions.push(`Add real sample capability tags for: ${missingCapabilities.join(", ")}.`);
  }

  return {
    releaseTarget: "v0.1.0",
    releaseMode: mode,
    readyForPublicTag,
    automaticChecksPassed,
    fixtureStrictPassed,
    status,
    blockingItems,
    realSampleSummary,
    statusCounts: fixtureStrict.result?.statusCounts ?? {},
    desktopGate: {
      f012Status,
      requiredEvidence: [
        "visible Desktop UI diagnostics",
        "visible first workflow",
        "native workspace picker",
        "native supported-file picker",
        "WebView2 confirmation",
        "Node version and runtime diagnostics",
        "release artifact SHA-256 match",
        "strict desktop verification record"
      ]
    },
    commands: [
      `npm run release-readiness -- --mode ${mode}`,
      "npm run release-check",
      "npm run large-intake-check",
      "npm run language-boundary-check",
      "npm run doctor",
      "npm run fixture-check -- --strict",
      "npm run release-artifacts",
      "npm run release-index",
      "npm run public-preview-package -- --json",
      "npm run desktop-release-preflight -- --out-dir <dir>",
      "npm run desktop-preflight-check -- <dir>",
      "npm run desktop-verification-fill -- --record <partial-record.json> --diagnostics-pass --first-workflow-pass --workspace-picker-pass --file-picker-pass --result-pass --tester <name> --windows-version <windows-version> --node-version <node-version> --webview2-present yes --out <filled-record.json>",
      "npm run desktop-verification-check -- --strict <filled-record.json>",
      "npm run desktop-fixture-close -- --record <filled-record.json> --write"
    ],
    nextActions,
    releaseCheck: {
      ok: releaseCheck.ok,
      automaticChecksPassed,
      failedChecks: (releaseCheck.result?.checks ?? [])
        .filter((check) => check.ok !== true)
        .map((check) => check.name)
    },
    fixtureStrict: {
      ok: fixtureStrict.ok,
      resultOk: fixtureStrict.result?.ok === true,
      failures: fixtureStrict.result?.failures ?? []
    }
  };
}

function shouldOutputJson() {
  return process.argv.includes("--json") ||
         process.env.NODE_TEST_CONTEXT !== undefined ||
         process.env.NODE_ENV === "test";
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const reportOnly = process.argv.includes("--report-only");
  const outPath = argValue("--out");
  const result = await buildReleaseReadiness();
  const output = {
    ...result,
    reportOnly,
    outPath: outPath ? path.resolve(root, outPath) : ""
  };
  const outputJson = `${JSON.stringify(output, null, 2)}\n`;

  if (outPath) {
    const resolvedOutPath = path.resolve(root, outPath);
    await mkdir(path.dirname(resolvedOutPath), { recursive: true });
    await writeFile(resolvedOutPath, outputJson, "utf8");
  }

  if (shouldOutputJson()) {
    console.log(outputJson.trimEnd());
  } else {
    if (result.readyForPublicTag) {
      console.log(`=== Release Readiness: PASS ===`);
      console.log(`Ready for public preview tag (mode: ${result.releaseMode}).`);
    } else {
      console.log(`=== Release Readiness: FAILED ===`);
      console.log(`Not ready for public preview tag (mode: ${result.releaseMode}).`);
      if (result.blockingItems.length > 0) {
        console.log(`\nBlocking Items:`);
        for (const item of result.blockingItems) {
          console.log(`- ${item.id}: ${item.reason ?? item.status}`);
        }
      }
      if (result.nextActions.length > 0) {
        console.log(`\nNext Actions:`);
        for (const action of result.nextActions) {
          console.log(`- ${action}`);
        }
      }
    }
  }

  if (!reportOnly && !result.readyForPublicTag) {
    process.exitCode = 1;
  }
}
