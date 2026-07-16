import { getRealSampleSummary } from "../core/realSamples.js";
import { getKnownLimits } from "../core/knownLimits.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { buildReleaseReadiness, isPublicPreviewMode } from "./release-readiness.js";
import path from "node:path";

const REQUIRED_SAMPLE_CAPABILITIES = ["ai_intake", "safety_gate", "format_exchange"];

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function positionalArgs(args) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--mode" || arg === "--write-report" || arg === "--results") {
      index += 1;
      continue;
    }
    if (!arg.startsWith("--")) {
      values.push(arg);
    }
  }
  return values;
}

async function main() {
  const workspaceArg = positionalArgs(process.argv.slice(2))[0];
  const workspacePath = workspaceArg ? path.resolve(workspaceArg) : ".";
  const mode = argValue("--mode", "public-preview");
  const resultsPath = argValue("--results");

  const report = {
    mode,
    ready: true,
    blockers: [],
    warnings: [],
    recommendedAudience: "internal"
  };

  let readiness = null;
  try {
    readiness = await buildReleaseReadiness({ mode, resultsPath });
    if (readiness.status !== "ready") {
      report.ready = false;
      report.blockers.push(`release-readiness ${mode} is ${readiness.status}`);
      for (const item of readiness.blockingItems ?? []) {
        report.blockers.push(`${item.id}: ${item.reason ?? item.status ?? "blocked"}`);
      }
    }
  } catch (error) {
    report.ready = false;
    report.blockers.push(`Failed to run release-readiness ${mode}: ${error.message}`);
  }

  // 1. Check real samples
  try {
    const samples = await getRealSampleSummary(workspacePath);
    if (!samples || (samples.total || 0) < 10) {
      report.warnings.push(`Real samples total is less than 10 (found ${samples ? samples.total : 0})`);
    }
    report.realSampleSummary = samples;
    const coverage = samples?.capabilityCoverage ?? {};
    const missingCapabilities = REQUIRED_SAMPLE_CAPABILITIES.filter((capability) => Number(coverage[capability] || 0) <= 0);
    if (missingCapabilities.length > 0) {
      report.warnings.push(`Real sample capability coverage is missing: ${missingCapabilities.join(", ")}`);
    }
  } catch (error) {
    report.warnings.push("Could not determine real samples count.");
  }

  // 2. Check known limits registry
  try {
    const limits = await getKnownLimits();
    if (!limits || limits.length === 0) {
      report.ready = false;
      report.blockers.push("Known limits registry is empty or missing.");
    }
  } catch (error) {
    report.ready = false;
    report.blockers.push("Failed to verify known limits registry.");
  }

  // 3. Verify documentation files
  const requiredDocs = [
    "docs/tester-onboarding.md",
    "docs/packaging-for-testers.md",
    "docs/known-limits.md",
    "docs/error-catalog.md"
  ];

  for (const doc of requiredDocs) {
    try {
      await readFile(path.resolve(doc), "utf8");
    } catch {
      report.ready = false;
      report.blockers.push(`Missing required onboarding documentation: ${doc}`);
    }
  }

  // Determine audience
  if (report.blockers.length > 0) {
    report.ready = false;
    report.recommendedAudience = "internal";
  } else if (isPublicPreviewMode(readiness?.releaseMode) && report.warnings.length === 0) {
    report.recommendedAudience = "public-preview";
  } else if (readiness?.releaseMode === "private-beta" && report.warnings.length === 0) {
    report.recommendedAudience = "private-beta";
  } else if (report.warnings.length > 0) {
    report.recommendedAudience = "friendly-testers";
  } else {
    report.recommendedAudience = isPublicPreviewMode(mode) ? "public-preview" : "private-beta";
  }

  function shouldOutputJson() {
    return process.argv.includes("--json") ||
           process.env.NODE_TEST_CONTEXT !== undefined ||
           process.env.NODE_ENV === "test";
  }

  if (shouldOutputJson()) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`=== ${isPublicPreviewMode(mode) ? "Public Preview" : "Private Beta"} Checklist Report ===`);
    console.log(`Ready for Tester Delivery: ${report.ready ? "YES" : "NO"}`);
    console.log(`Recommended Audience: ${report.recommendedAudience.toUpperCase()}`);
    if (report.blockers.length > 0) {
      console.log(`\nBlockers:`);
      report.blockers.forEach(b => console.log(`- ${b}`));
    }
    if (report.warnings.length > 0) {
      console.log(`\nWarnings:`);
      report.warnings.forEach(w => console.log(`- ${w}`));
    }
    if (!report.ready) {
      console.log(`\nNext Action: Fix the blockers listed above before releasing.`);
    }
  }

  const writeIndex = process.argv.indexOf("--write-report");
  if (writeIndex >= 0 && process.argv[writeIndex + 1]) {
    const reportPath = path.resolve(process.argv[writeIndex + 1]);
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  }

  if (!report.ready || report.blockers.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
