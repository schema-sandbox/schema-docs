import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeFile, mkdir } from "node:fs/promises";
import { buildReleaseArtifactManifest } from "./release-artifacts.js";
import { buildReleaseReadiness, isPublicPreviewMode, isSupportedReleaseMode } from "./release-readiness.js";

const root = path.resolve(import.meta.dirname, "../..");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function resolveFromRoot(value) {
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}

function artifactHandoff(artifactPath, mode) {
  if (artifactPath.endsWith("-setup.exe")) {
    if (!isSupportedReleaseMode(mode)) {
      return {
        role: "unsupported-mode-installer",
        handoffAction: "Do not hand off this installer until the release mode is corrected."
      };
    }
    return isPublicPreviewMode(mode)
      ? {
          role: "primary-public-preview-installer",
          handoffAction: "Use this as the ordinary Windows public preview installer."
        }
      : {
          role: "primary-private-beta-installer",
          handoffAction: "Send this to ordinary Windows private beta testers first."
        };
  }
  if (artifactPath.endsWith(".msi")) {
    return {
      role: "managed-windows-installer",
      handoffAction: "Use this for managed install or enterprise deployment review."
    };
  }
  if (artifactPath.endsWith("-portable.zip")) {
    return {
      role: "portable-windows-package",
      handoffAction: "Extract the complete package and keep app.exe beside its runtime directory for no-install Windows testing."
    };
  }
  return {
    role: "direct-smoke-app",
    handoffAction: "Use this for direct packaged app smoke verification."
  };
}

function commandChecklist(mode) {
  return [
    `npm run release-readiness -- --mode ${mode}`,
    "npm run release-check",
    "npm run size-check",
    "npm run large-intake-check",
    "npm run language-boundary-check",
    "npm run doctor",
    "npm run ui-check",
    "npm run web-ui-smoke",
    "npm run desktop:app-smoke -- --check-only",
    "npm run desktop:workflow-smoke -- --check-only",
    "npm run desktop:ai-summon-smoke",
    `npm run rc-check -- --mode ${mode}`,
    `npm run beta-check -- --mode ${mode} --json`
  ];
}

function summarizeArtifacts(artifacts, mode) {
  return artifacts.map((artifact) => ({ ...artifact, ...artifactHandoff(artifact.path, mode) }));
}

function buildDecision({ readiness, artifacts, mode }) {
  const missingArtifacts = artifacts.filter((artifact) => artifact.exists !== true);
  const supportedMode = isSupportedReleaseMode(mode);
  const primaryRole = supportedMode
    ? (isPublicPreviewMode(mode) ? "primary-public-preview-installer" : "primary-private-beta-installer")
    : "";
  const primaryInstaller = primaryRole ? artifacts.find((artifact) => artifact.role === primaryRole) : null;
  const ready = readiness.status === "ready"
    && readiness.readyForPublicTag === true
    && missingArtifacts.length === 0
    && primaryInstaller?.exists === true;

  const blockers = [];
  if (readiness.status !== "ready" || readiness.readyForPublicTag !== true) {
    blockers.push("release-readiness is not ready for the selected mode");
  }
  for (const item of readiness.blockingItems ?? []) {
    blockers.push(`${item.id}: ${item.reason ?? item.status ?? "blocked"}`);
  }
  for (const artifact of missingArtifacts) {
    blockers.push(`missing artifact: ${artifact.path}`);
  }
  if (supportedMode && primaryInstaller?.exists !== true) {
    blockers.push(`primary NSIS ${isPublicPreviewMode(mode) ? "public preview" : "private beta"} installer is missing`);
  }

  return {
    ready,
    recommendedAudience: ready
      ? (isPublicPreviewMode(mode) ? "public-preview-testers" : "private-beta-testers")
      : "internal-only",
    primaryInstallerPath: primaryInstaller?.path ?? "",
    blockers
  };
}

function renderMarkdown(report) {
  const artifactRows = report.artifacts.map((artifact) => (
    `| ${artifact.role} | ${artifact.exists ? "yes" : "no"} | \`${artifact.path}\` | ${artifact.bytes ?? 0} | \`${artifact.sha256 ?? "missing"}\` | ${artifact.handoffAction} |`
  ));
  const blockers = report.decision.blockers.length
    ? report.decision.blockers.map((item) => `- ${item}`)
    : ["- None"];
  const nextActions = report.nextActions.length
    ? report.nextActions.map((item) => `- ${item}`)
    : ["- Run a final human install pass on the exact tester machine before broader sharing."];
  const commands = report.commands.map((command) => `- \`${command}\``);

  const title = isPublicPreviewMode(report.releaseMode) ? "Public Preview Package Report" : "Private Beta Package Report";

  return `# ${title}

Generated At: ${report.generatedAt}
Release Target: ${report.releaseTarget}
Release Mode: ${report.releaseMode}
Ready: ${report.decision.ready ? "yes" : "no"}
Recommended Audience: ${report.decision.recommendedAudience}
Primary Installer: \`${report.decision.primaryInstallerPath || "missing"}\`

## Desktop Artifacts

| Role | Exists | Path | Size (Bytes) | SHA-256 | Handoff Action |
|------|--------|------|--------------|---------|----------------|
${artifactRows.join("\n")}

## Blockers

${blockers.join("\n")}

## Next Actions

${nextActions.join("\n")}

## Verification Commands

${commands.join("\n")}
`;
}

export async function buildPrivateBetaPackageReport(options = {}) {
  const mode = options.mode ?? argValue("--mode", "private-beta");
  const generatedBy = isPublicPreviewMode(mode) ? "npm run public-preview-package" : "npm run private-beta-package";
  const artifactManifest = await buildReleaseArtifactManifest();
  const resultsPath = options.resultsPath ?? argValue("--results");
  const readiness = await buildReleaseReadiness({ mode, resultsPath });
  const artifacts = summarizeArtifacts(artifactManifest.artifacts, mode);
  const decision = buildDecision({ readiness, artifacts, mode });

  return {
    releaseTarget: "v0.1.0",
    generatedBy,
    generatedAt: new Date().toISOString(),
    releaseMode: mode,
    decision,
    artifacts,
    releaseReadiness: {
      status: readiness.status,
      readyForPublicTag: readiness.readyForPublicTag,
      automaticChecksPassed: readiness.automaticChecksPassed,
      fixtureStrictPassed: readiness.fixtureStrictPassed,
      blockingItems: readiness.blockingItems ?? [],
      realSampleSummary: readiness.realSampleSummary ?? null,
      desktopGate: readiness.desktopGate
    },
    commands: commandChecklist(mode),
    nextActions: readiness.nextActions ?? []
  };
}

async function main() {
  const resultsPath = argValue("--results");
  const report = await buildPrivateBetaPackageReport({ resultsPath });
  const outPath = argValue("--out");
  const markdownPath = argValue("--markdown");

  if (outPath) {
    const resolved = resolveFromRoot(outPath);
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  if (markdownPath) {
    const resolved = resolveFromRoot(markdownPath);
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, renderMarkdown(report), "utf8");
  }

  if (hasFlag("--json") || !markdownPath) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const label = isPublicPreviewMode(report.releaseMode) ? "Public preview" : "Private beta";
    console.log(`${label} package report written to ${path.relative(root, resolveFromRoot(markdownPath)).split(path.sep).join("/")}`);
  }

  if (!report.decision.ready && !hasFlag("--report-only")) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
