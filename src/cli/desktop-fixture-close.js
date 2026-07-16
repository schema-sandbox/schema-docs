import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { buildReleaseArtifactManifest } from "./release-artifacts.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "../..");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function resolveFromRoot(value) {
  return path.resolve(root, value);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function sha256File(filePath) {
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function runStrictDesktopVerification(recordPath) {
  const scriptPath = path.join(root, "src", "cli", "desktop-verification-check.js");
  try {
    const { stdout } = await execFileAsync(process.execPath, [scriptPath, "--strict", recordPath, "--json"], {
      cwd: root,
      maxBuffer: 1024 * 1024
    });
    return JSON.parse(stdout);
  } catch (error) {
    const stdout = typeof error.stdout === "string" ? error.stdout.trim() : "";
    try {
      return JSON.parse(stdout);
    } catch {
      return {
        ok: false,
        strict: true,
        recordPath,
        failures: [{ code: "strict_check_failed", detail: error.message }],
        nextActions: []
      };
    }
  }
}

function countStatuses(results) {
  return results.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
}

function verifyRecordArtifact(record, releaseArtifacts) {
  const artifactSha256 = record.artifact?.sha256 ?? "";
  const matchedArtifact = releaseArtifacts.artifacts.find((artifact) => (
    artifact.exists === true && artifact.sha256 === artifactSha256
  ));
  if (matchedArtifact) {
    return {
      ok: true,
      matchedArtifact,
      failures: []
    };
  }
  return {
    ok: false,
    matchedArtifact: null,
    failures: [{
      code: "artifact_not_in_release_manifest",
      detail: {
        artifactPath: record.artifact?.path ?? "",
        artifactSha256,
        releaseArtifactSha256: releaseArtifacts.artifacts
          .filter((artifact) => artifact.exists && artifact.sha256)
          .map((artifact) => artifact.sha256)
      }
    }]
  };
}

function closeDesktopFixture(resultsFile, record, recordPath, recordSha256) {
  const results = resultsFile.results.map((item) => {
    if (item.id !== "F-012") {
      return item;
    }
    return {
      ...item,
      status: "pass",
      evidence: `desktop verification record passed strict check: ${recordPath}`,
      notes: [
        `tester=${record.result?.tester ?? ""}`,
        `testedAt=${record.result?.testedAt ?? ""}`,
        `artifact=${record.artifact?.path ?? ""}`,
        `artifactSha256=${record.artifact?.sha256 ?? ""}`,
        `recordSha256=${recordSha256}`
      ].join("; ")
    };
  });
  return {
    ...resultsFile,
    generatedBy: "npm run desktop-fixture-close",
    results,
    statusCounts: countStatuses(results)
  };
}

export async function runDesktopFixtureClose(options = {}) {
  const recordArg = options.recordPath ?? argValue("--record");
  if (!recordArg) {
    return {
      ok: false,
      releaseTarget: "v0.1.0",
      error: "Missing required --record <filled-desktop-verification-record.json>."
    };
  }
  const recordPath = resolveFromRoot(recordArg);
  const resultsPath = resolveFromRoot(options.resultsPath ?? argValue("--results", "samples/fixture-results.json"));
  const outPathArg = options.outPath ?? argValue("--out");
  const outPath = outPathArg ? resolveFromRoot(outPathArg) : resultsPath;
  const shouldWrite = options.write ?? (hasFlag("--write") || Boolean(outPathArg));

  const strictCheck = await runStrictDesktopVerification(recordPath);
  if (!strictCheck.ok) {
    return {
      ok: false,
      releaseTarget: "v0.1.0",
      dryRun: !shouldWrite,
      recordPath,
      resultsPath,
      outPath,
      strictCheck,
      updated: false
    };
  }

  const record = await readJson(recordPath);
  const releaseArtifacts = await buildReleaseArtifactManifest();
  const artifactCheck = verifyRecordArtifact(record, releaseArtifacts);
  if (!artifactCheck.ok) {
    return {
      ok: false,
      releaseTarget: "v0.1.0",
      dryRun: !shouldWrite,
      recordPath,
      resultsPath,
      outPath,
      strictCheck: {
        ok: true,
        recordPath: strictCheck.recordPath
      },
      artifactCheck,
      updated: false
    };
  }

  const recordSha256 = await sha256File(recordPath);
  const resultsFile = await readJson(resultsPath);
  const closedResults = closeDesktopFixture(resultsFile, record, recordPath, recordSha256);
  const f012 = closedResults.results.find((item) => item.id === "F-012");

  if (shouldWrite) {
    await writeFile(outPath, `${JSON.stringify(closedResults, null, 2)}\n`, "utf8");
  }

  return {
    ok: true,
    releaseTarget: "v0.1.0",
    dryRun: !shouldWrite,
    recordPath,
    resultsPath,
    outPath,
    strictCheck: {
      ok: true,
      recordPath: strictCheck.recordPath
    },
    artifactCheck: {
      ok: true,
      matchedArtifact: artifactCheck.matchedArtifact
    },
    recordSha256,
    updated: shouldWrite,
    f012,
    statusCounts: closedResults.statusCounts
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runDesktopFixtureClose();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}
