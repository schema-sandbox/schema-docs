import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "../..");

async function runCommand(command, args = []) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: root,
      maxBuffer: 16 * 1024 * 1024
    });
    return { ok: true, stdout, stderr, error: null };
  } catch (error) {
    return { ok: false, stdout: error.stdout || "", stderr: error.stderr || "", error };
  }
}

function firstUsefulLine(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const failureLine = lines.find((line) => /^not ok\b/i.test(line))
    ?? lines.find((line) => /AssertionError|ERR_ASSERTION|failureType|error:/i.test(line));
  if (failureLine) {
    return failureLine;
  }
  return lines.find((line) => !line.startsWith("TAP version")) ?? lines[0] ?? "Command failed without output.";
}

async function main() {
  const isJson = process.argv.includes("--json");
  const mode = process.argv.includes("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] : "public-preview";
  const resultsPath = process.argv.includes("--results") ? process.argv[process.argv.indexOf("--results") + 1] : "";
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const releaseTarget = `v${packageJson.version}`;
  const commands = {
    tests: "npm test",
    sizeBudget: "npm run size-check",
    largeIntake: "npm run large-intake-check",
    languageBoundary: "npm run language-boundary-check",
    releaseCheck: "npm run release-check",
    fixtureStrict: `npm run fixture-check -- --strict${resultsPath ? ` --results ${resultsPath}` : ""}`,
    readiness: `npm run release-readiness -- --mode ${mode}${resultsPath ? ` --results ${resultsPath}` : ""}`,
    betaCheck: `npm run beta-check -- --mode ${mode} --json${resultsPath ? ` --results ${resultsPath}` : ""}`
  };

  if (!isJson) {
    console.log("=== Schema Docs Release Candidate (RC) Preflight Discipline ===");
    console.log(`Target Mode: ${mode}`);
    console.log("Running comprehensive preflight checks...\n");
  }

  if (!isJson) console.log("1. Running all tests (npm test)...");
  const testRes = await runCommand(process.execPath, ["--test"]);

  if (!isJson) console.log("2. Running size budget check...");
  const sizeRes = await runCommand(process.execPath, [path.join(root, "src/cli/size-check.js")]);

  if (!isJson) console.log("3. Running ultra-large AI intake check...");
  const largeIntakeRes = await runCommand(process.execPath, [path.join(root, "src/cli/large-intake-check.js")]);

  if (!isJson) console.log("4. Running language boundary check...");
  const languageBoundaryRes = await runCommand(process.execPath, [path.join(root, "src/cli/language-boundary-check.js")]);

  if (!isJson) console.log("5. Running release requirements check...");
  const releaseRes = await runCommand(process.execPath, [path.join(root, "src/cli/release-check.js")]);

  if (!isJson) console.log("6. Running strict fixture check...");
  const fixtureRes = await runCommand(process.execPath, [
    path.join(root, "src/cli/fixture-check.js"),
    "--strict",
    ...(resultsPath ? ["--results", resultsPath] : [])
  ]);

  if (!isJson) console.log("7. Running release readiness mode validation...");
  const readinessRes = await runCommand(process.execPath, [
    path.join(root, "src/cli/release-readiness.js"),
    "--mode",
    mode,
    ...(resultsPath ? ["--results", resultsPath] : [])
  ]);

  if (!isJson) console.log("8. Running release audience checklist validation...");
  const betaRes = await runCommand(process.execPath, [
    path.join(root, "src/cli/beta-check.js"),
    "--mode",
    mode,
    "--json",
    ...(resultsPath ? ["--results", resultsPath] : [])
  ]);

  const summary = {
    tests: { ok: testRes.ok, detail: testRes.ok ? "All tests passed." : testRes.stderr || testRes.stdout },
    sizeBudget: { ok: sizeRes.ok, detail: sizeRes.ok ? "Size budgets are within limits." : sizeRes.stdout },
    largeIntake: { ok: largeIntakeRes.ok, detail: largeIntakeRes.ok ? "Ultra-large AI intake is body-free and review-gated." : largeIntakeRes.stdout || largeIntakeRes.stderr },
    languageBoundary: { ok: languageBoundaryRes.ok, detail: languageBoundaryRes.ok ? "Default product surfaces are English-only." : languageBoundaryRes.stdout || languageBoundaryRes.stderr },
    releaseCheck: { ok: releaseRes.ok, detail: releaseRes.ok ? "Release checklist passed." : releaseRes.stdout },
    fixtureStrict: { ok: fixtureRes.ok, detail: fixtureRes.ok ? "Strict fixtures verified." : fixtureRes.stdout },
    readiness: { ok: readinessRes.ok, detail: readinessRes.ok ? "Release readiness mode verified." : readinessRes.stdout },
    betaCheck: { ok: betaRes.ok, detail: betaRes.ok ? "Release audience checklist passed." : betaRes.stdout }
  };

  const allPassed = Object.values(summary).every((check) => check.ok);

  if (isJson) {
    console.log(JSON.stringify({
      ok: allPassed,
      releaseTarget,
      releaseMode: mode,
      generatedAt: new Date().toISOString(),
      commands,
      checks: summary
    }, null, 2));
    return;
  }

  console.log("\n================ Preflight Summary ================");
  for (const [name, check] of Object.entries(summary)) {
    const status = check.ok ? "PASSED" : "FAILED";
    console.log(`[${status}] ${name}`);
    if (!check.ok) {
      console.log(`   Error: ${firstUsefulLine(check.detail)}`);
    }
  }
  console.log("===================================================\n");

  if (allPassed) {
    console.log("All checks passed. The codebase is ready for a Release Candidate tag.");
    process.exit(0);
  }

  console.log("Preflight check failed. Fix the errors above before tagging an RC.");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
