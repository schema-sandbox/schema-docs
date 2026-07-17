import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");

function resolveManifestPath(value) {
  const input = value || "desktop-preflight-manifest.json";
  const resolved = path.resolve(root, input);
  return resolved.endsWith(".json")
    ? resolved
    : path.join(resolved, "desktop-preflight-manifest.json");
}

function failure(code, detail) {
  return { code, detail };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function resolveEvidencePath(entryPath, manifestDir) {
  return path.isAbsolute(entryPath)
    ? entryPath
    : path.resolve(manifestDir, entryPath);
}

function requiredCommandMissing(commands, text) {
  return !commands.some((command) => command.includes(text));
}

function includesAllCommands(commands, requiredCommands) {
  return Array.isArray(commands)
    && Array.isArray(requiredCommands)
    && requiredCommands.every((required) => commands.includes(required));
}

function hasQuotedPreflightCommand(value) {
  return typeof value === "string"
    && value.includes("npm run desktop-preflight-check --")
    && /desktop-preflight-check -- ".*"/.test(value);
}

function isPortableEvidencePath(value) {
  return typeof value === "string"
    && value.length > 0
    && !path.isAbsolute(value)
    && !value.split(/[\\/]+/).includes("..");
}

function verifyPortableEvidence(summary, entries) {
  const failures = [];
  const portableEvidence = summary.portableEvidence;
  if (!portableEvidence || typeof portableEvidence !== "object" || Array.isArray(portableEvidence)) {
    return [failure("handoff_summary_portable_evidence_missing", null)];
  }

  for (const [key, entry] of entries.entries()) {
    const value = portableEvidence[key];
    if (!isPortableEvidencePath(value)) {
      failures.push(failure("handoff_summary_portable_evidence_path_invalid", { key, path: value ?? null }));
    } else if (value !== entry.path) {
      failures.push(failure("handoff_summary_portable_evidence_mismatch", {
        key,
        expected: entry.path,
        actual: value
      }));
    }
  }

  const manifestPath = portableEvidence.preflightManifest;
  if (!isPortableEvidencePath(manifestPath)) {
    failures.push(failure("handoff_summary_portable_evidence_path_invalid", {
      key: "preflightManifest",
      path: manifestPath ?? null
    }));
  } else if (manifestPath !== "desktop-preflight-manifest.json") {
    failures.push(failure("handoff_summary_portable_evidence_mismatch", {
      key: "preflightManifest",
      expected: "desktop-preflight-manifest.json",
      actual: manifestPath
    }));
  }

  return failures;
}

async function verifyFile(entry, manifestDir) {
  const evidencePath = resolveEvidencePath(entry.path, manifestDir);
  try {
    const buffer = await readFile(evidencePath);
    const bytes = buffer.byteLength;
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const failures = [
      bytes !== entry.bytes && failure("bytes_mismatch", { key: entry.key, expected: entry.bytes, actual: bytes }),
      sha256 !== entry.sha256 && failure("sha256_mismatch", { key: entry.key, expected: entry.sha256, actual: sha256 })
    ].filter(Boolean);

    if (entry.path.endsWith(".json")) {
      try {
        JSON.parse(buffer.toString("utf8"));
        if (entry.jsonOk !== true) {
          failures.push(failure("json_status_mismatch", { key: entry.key, expected: entry.jsonOk, actual: true }));
        }
      } catch {
        failures.push(failure("json_parse_failed", { key: entry.key, path: evidencePath }));
      }
    }

    return { key: entry.key, path: evidencePath, ok: failures.length === 0, bytes, sha256, failures };
  } catch (error) {
    return {
      key: entry.key,
      path: evidencePath,
      ok: false,
      failures: [failure("file_unreadable", { key: entry.key, path: evidencePath, error: error.message })]
    };
  }
}

async function verifyHandoffSemantics(manifest, manifestDir) {
  if (!Array.isArray(manifest.files)) {
    return [];
  }
  const failures = [];
  const entries = new Map(manifest.files.map((entry) => [entry.key, entry]));
  const handoffSummaryEntry = entries.get("handoffSummary");
  const releaseReadinessEntry = entries.get("releaseReadiness");
  const handoffEntry = entries.get("handoff");
  let releaseReadinessCommands = null;

  if (!releaseReadinessEntry) {
    failures.push(failure("release_readiness_missing", null));
  } else {
    try {
      const readiness = await readJson(resolveEvidencePath(releaseReadinessEntry.path, manifestDir));
      releaseReadinessCommands = readiness.commands;
      if (!Array.isArray(releaseReadinessCommands)) {
        failures.push(failure("release_readiness_commands_missing", null));
      }
    } catch (error) {
      failures.push(failure("release_readiness_unreadable", error.message));
    }
  }

  if (!handoffSummaryEntry) {
    failures.push(failure("handoff_summary_missing", null));
  } else {
    try {
      const summary = await readJson(resolveEvidencePath(handoffSummaryEntry.path, manifestDir));
      if (!hasQuotedPreflightCommand(summary.preflightCheckCommand)) {
        failures.push(failure("handoff_summary_preflight_command_invalid", summary.preflightCheckCommand ?? null));
      }
      failures.push(...verifyPortableEvidence(summary, entries));
      const commands = summary.releaseCommands;
      if (!Array.isArray(commands)) {
        failures.push(failure("handoff_summary_release_commands_missing", null));
      } else {
        for (const required of ["npm run public-preview-package -- --json", "npm run release-artifacts", "desktop-verification-fill", "desktop-fixture-close"]) {
          if (requiredCommandMissing(commands, required)) {
            failures.push(failure("handoff_summary_release_command_missing", required));
          }
        }
        if (Array.isArray(releaseReadinessCommands) && !includesAllCommands(commands, releaseReadinessCommands)) {
          failures.push(failure("handoff_summary_release_commands_mismatch", {
            expected: releaseReadinessCommands,
            actual: commands
          }));
        }
      }
    } catch (error) {
      failures.push(failure("handoff_summary_unreadable", error.message));
    }
  }

  if (!handoffEntry) {
    failures.push(failure("handoff_missing", null));
  } else {
    try {
      const handoff = await readFile(resolveEvidencePath(handoffEntry.path, manifestDir), "utf8");
      if (!handoff.includes("Release Command Checklist")) {
        failures.push(failure("handoff_release_command_checklist_missing", null));
      }
      if (!handoff.includes("Preflight Check Command") || !hasQuotedPreflightCommand(handoff)) {
        failures.push(failure("handoff_preflight_check_command_missing", null));
      }
      if (!handoff.includes("Portable Evidence Paths")) {
        failures.push(failure("handoff_portable_evidence_section_missing", null));
      }
      if (!handoff.includes("desktop-verification-fill")) {
        failures.push(failure("handoff_release_command_missing", "desktop-verification-fill"));
      }
    } catch (error) {
      failures.push(failure("handoff_unreadable", error.message));
    }
  }

  return failures;
}

export async function checkDesktopPreflightManifest(options = {}) {
  const manifestArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  const manifestPath = resolveManifestPath(options.manifestPath ?? manifestArg);
  let manifest;
  try {
    manifest = await readJson(manifestPath);
  } catch (error) {
    return {
      ok: false,
      releaseTarget: "v0.1.1",
      manifestPath,
      failures: [failure("manifest_unreadable", { path: manifestPath, error: error.message })],
      files: []
    };
  }

  const shapeFailures = [
    manifest.releaseTarget !== "v0.1.1" && failure("release_target_mismatch", manifest.releaseTarget),
    manifest.manifestType !== "desktop-preflight" && failure("manifest_type_mismatch", manifest.manifestType),
    !Array.isArray(manifest.files) && failure("files_missing", null),
    Array.isArray(manifest.files) && manifest.fileCount !== manifest.files.length && failure("file_count_mismatch", { expected: manifest.fileCount, actual: manifest.files.length })
  ].filter(Boolean);

  const manifestDir = path.dirname(manifestPath);
  const fileResults = Array.isArray(manifest.files)
    ? await Promise.all(manifest.files.map((entry) => verifyFile(entry, manifestDir)))
    : [];
  const fileFailures = fileResults.flatMap((item) => item.failures);
  const semanticFailures = await verifyHandoffSemantics(manifest, manifestDir);
  const failures = [...shapeFailures, ...fileFailures, ...semanticFailures];

  return {
    ok: failures.length === 0,
    releaseTarget: "v0.1.1",
    manifestPath,
    manifestType: manifest.manifestType,
    fileCount: manifest.fileCount ?? 0,
    checkedFileCount: fileResults.length,
    failures,
    files: fileResults.map((item) => ({
      key: item.key,
      path: item.path,
      ok: item.ok,
      bytes: item.bytes ?? 0,
      sha256: item.sha256 ?? ""
    }))
  };
}

function shouldOutputJson() {
  return process.argv.includes("--json") ||
         process.env.NODE_TEST_CONTEXT !== undefined ||
         process.env.NODE_ENV === "test";
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkDesktopPreflightManifest();
  if (shouldOutputJson()) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.ok) {
      console.log(`=== Desktop Preflight Check: PASS ===`);
      console.log(`Manifest verified. Checked ${result.checkedFileCount} files.`);
    } else {
      console.log(`=== Desktop Preflight Check: FAILED ===`);
      console.log(`Failing Checks:`);
      for (const failure of result.failures) {
        console.log(`- ${failure.code}: ${typeof failure.detail === 'object' ? JSON.stringify(failure.detail) : failure.detail}`);
      }
      console.log(`\nNext Action: Regenerate preflight package or check evidence directory.`);
    }
  }
  if (!result.ok) {
    process.exitCode = 1;
  }
}
