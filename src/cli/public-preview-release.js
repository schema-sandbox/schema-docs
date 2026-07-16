import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

function hasFlag(name) {
  return process.argv.includes(name);
}

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function displayCommand(step) {
  const args = step.args.length ? ` -- ${step.args.join(" ")}` : "";
  return `npm run ${step.script}${args}`;
}

export function buildPublicPreviewReleasePlan(options = {}) {
  const mode = options.mode ?? "public-preview";
  const packageJsonPath = options.packageJsonPath ?? "samples/public-preview-package.json";
  const packageMarkdownPath = options.packageMarkdownPath ?? "docs/public-preview-package.md";

  return {
    mode,
    generatedBy: "npm run release:public-preview",
    steps: [
      {
        id: "rc-preflight",
        label: "Run the full public-preview RC gate",
        script: "rc-check",
        args: ["--mode", mode]
      },
      {
        id: "artifact-manifest",
        label: "Refresh release artifact manifest",
        script: "release-artifacts",
        args: []
      },
      {
        id: "artifact-index",
        label: "Refresh public-preview artifact index",
        script: "release-index",
        args: ["--mode", mode]
      },
      {
        id: "installer-handoff",
        label: "Refresh public-preview installer handoff report",
        script: "public-preview-package",
        args: ["--json", "--out", packageJsonPath, "--markdown", packageMarkdownPath]
      }
    ]
  };
}

async function runStep(step) {
  const args = ["run", step.script];
  if (step.args.length) {
    args.push("--", ...step.args);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand(), args, {
      stdio: "inherit",
      shell: process.platform === "win32"
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${displayCommand(step)} failed with exit code ${code}`));
    });
  });
}

async function runPlan(plan) {
  for (const step of plan.steps) {
    console.log(`\n[${step.id}] ${step.label}`);
    console.log(displayCommand(step));
    await runStep(step);
  }
}

async function main() {
  const plan = buildPublicPreviewReleasePlan({
    mode: argValue("--mode", "public-preview"),
    packageJsonPath: argValue("--package-json", "samples/public-preview-package.json"),
    packageMarkdownPath: argValue("--package-markdown", "docs/public-preview-package.md")
  });

  if (hasFlag("--json") || hasFlag("--dry-run")) {
    const report = {
      mode: plan.mode,
      dryRun: hasFlag("--dry-run"),
      commands: plan.steps.map(displayCommand),
      steps: plan.steps
    };
    console.log(JSON.stringify(report, null, 2));
  }

  if (hasFlag("--dry-run")) {
    return;
  }

  await runPlan(plan);
  console.log("\nPublic preview release handoff is ready.");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
