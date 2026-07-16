import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { hasKnownMojibake } from "./mojibake-guard.js";

const execFileAsync = promisify(execFile);
const defaultRoot = path.resolve(import.meta.dirname, "../..");

const binaryExtensions = new Set([
  ".exe", ".dll", ".msi", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".icns", ".pdf", ".docx", ".xlsx", ".zip", ".woff", ".woff2"
]);

const defaultEnglishPatterns = [
  /^README\.md$/,
  /^CONTRIBUTING\.md$/,
  /^CODE_OF_CONDUCT\.md$/,
  /^LICENSE$/,
  /^package\.json$/,
  /^SECURITY\.md$/,
  /^public\//,
  /^src\//,
  /^samples\/known-limits\.json$/,
  /^docs\/api-contract\.md$/,
  /^docs\/desktop-runtime-gap\.md$/,
  /^docs\/desktop-verification-protocol\.md$/,
  /^docs\/error-catalog\.md$/,
  /^docs\/implementation-status\.md$/,
  /^docs\/known-limits\.md$/,
  /^docs\/packaging-for-testers\.md$/,
  /^docs\/private-beta-checklist\.md$/,
  /^docs\/release-candidate-process\.md$/,
  /^docs\/release-checklist\.md$/,
  /^docs\/security-boundaries\.md$/,
  /^docs\/supported-formats\.md$/,
  /^docs\/sdxp-primer\.md$/,
  /^docs\/tester-onboarding\.md$/,
  /^docs\/v0\.1\.0-release-notes\.md$/,
  /^docs\/v0\.1\.0-release-plan\.md$/,
  /^docs\/sdxp-spec-v1\.0\.md$/,
];

const allowedMultilingualPatterns = [
  /^public\/i18nPanel\.js$/,
  /^public\/queryI18n\.js$/,
  /^test\//,
  /^test-fixtures\//,
  /^samples\//,
  /^docs\/sample-scenarios\.md$/,
  /^docs\/real-sample-regression\.md$/,
  /^file_exchange_solution_strategy\.md$/,
  /^technical_roadmap\.md$/,
  /^test\/manual\/external-sync\.mjs$/,
  /^src\/core\/dlp-rules\.json$/,
  /^docs\/github-release-draft-v0\.1\.0\.md$/,
  /^docs\/public-preview-manual-test-checklist\.md$/,
  /^docs\/public-preview-sample-report\.md$/,
  /^docs\/demo-flow\.md$/,
  /^VERSION-ROADMAP\.md$/,
  /^office_worker_testing_report\.md$/,
  /^officecli_analysis\.md$/,
  /^\u6d4b\u8bd5\u8bc4\u4f30\u62a5\u544a\.md$/,
  /^src\/cli\/release-user-flow-check\.js$/
];

const ignoredGeneratedContentPatterns = [
  /^github_readiness_report\.md$/,
  /^test-workspace(?:-[^/]+)?\//,
  /^customer-(?:test|v\d+)-workspace\//,
  /^customer-fresh-test\//,
  /^clean-retest-\d{4}-\d{2}-\d{2}\//,
  /^retest-v\d+\//,
  /^docs\/\u5ba2\u6237\u89c6\u89d2\u5168\u9762\u6d4b\u8bd5\u62a5\u544a_\d{4}-\d{2}-\d{2}(?:_v\d+|-[^/]+)?\.md$/
];

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function hasDefaultEnglishBoundary(relativePath) {
  return defaultEnglishPatterns.some((pattern) => pattern.test(relativePath));
}

function isAllowedMultilingual(relativePath) {
  return allowedMultilingualPatterns.some((pattern) => pattern.test(relativePath));
}

function isIgnoredGeneratedContent(relativePath) {
  return ignoredGeneratedContentPatterns.some((pattern) => pattern.test(relativePath));
}

function hasMojibake(text) {
  return hasKnownMojibake(text);
}

function hasHan(text) {
  return /\p{Script=Han}/u.test(text);
}

function stripAllowedRuntimeLanguageSwitcherText(relativePath, text) {
  if (relativePath !== "public/index.html") {
    return text;
  }
  const chineseUiLabel = String.fromCodePoint(0x4e2d, 0x6587, 0x754c, 0x9762);
  return text.replaceAll(`>${chineseUiLabel}</button>`, "></button>");
}

function argValue(name, fallback = undefined, argv = process.argv.slice(2)) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

function resolveRoot(argv = process.argv.slice(2)) {
  return path.resolve(argValue("--root", defaultRoot, argv));
}

async function listFiles(root) {
  try {
    const { stdout } = await execFileAsync("rg", [
      "--files",
      "-g", "!node_modules/**",
      "-g", "!src-tauri/target/**",
      "-g", "!.git/**"
    ], {
      cwd: root,
      maxBuffer: 16 * 1024 * 1024
    });
    return stdout.split(/\r?\n/).filter(Boolean);
  } catch (err) {
    const results = [];
    async function scan(dir) {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(root, fullPath);
        const normRel = relPath.split(path.sep).join("/");
        if (
          normRel.startsWith("node_modules") ||
          normRel.startsWith("src-tauri/target") ||
          normRel.startsWith(".git") ||
          normRel.includes("/tmp-") ||
          normRel.startsWith("tmp-")
        ) {
          continue;
        }
        if (entry.isDirectory()) {
          await scan(fullPath);
        } else {
          results.push(relPath);
        }
      }
    }
    await scan(root);
    return results;
  }
}

export async function runLanguageBoundaryCheck(options = {}) {
  const root = path.resolve(options.root ?? defaultRoot);
  const files = await listFiles(root);
  const blocked = [];
  const allowed = [];
  const review = [];

  for (const file of files) {
    const relativePath = normalizePath(file);
    if (isIgnoredGeneratedContent(relativePath)) {
      continue;
    }
    if (relativePath.startsWith("public/libs/")) {
      continue;
    }
    const ext = path.extname(relativePath).toLowerCase();
    if (binaryExtensions.has(ext)) {
      continue;
    }

    let text;
    try {
      text = await readFile(path.join(root, file), "utf8");
    } catch {
      continue;
    }

    const boundaryText = stripAllowedRuntimeLanguageSwitcherText(relativePath, text);
    const containsHan = hasHan(boundaryText);
    const containsMojibake = hasMojibake(text);
    if (!containsHan && !containsMojibake) {
      continue;
    }

    const entry = { path: relativePath, containsHan, containsMojibake };
    if (containsMojibake) {
      blocked.push({ ...entry, reason: "mojibake" });
    } else if (isAllowedMultilingual(relativePath)) {
      allowed.push(entry);
    } else if (hasDefaultEnglishBoundary(relativePath)) {
      blocked.push(entry);
    } else {
      review.push(entry);
    }
  }

  return {
    ok: blocked.length === 0,
    policy: "Default runtime, release docs, and runtime config must be English-only. Multilingual content belongs in tests, fixtures, internal strategy docs, or locale resources. Mojibake is blocked everywhere.",
    blocked,
    allowedCount: allowed.length,
    allowed,
    review
  };
}

async function main() {
  const isJson = process.argv.includes("--json");
  const result = await runLanguageBoundaryCheck({ root: resolveRoot() });

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("=== Schema Docs Language Boundary Check ===");
    console.log(result.policy);
    console.log(`Blocked files: ${result.blocked.length}`);
    console.log(`Allowed multilingual files: ${result.allowedCount}`);
    console.log(`Needs review: ${result.review.length}`);
    for (const entry of result.blocked) {
      console.log(`- ${entry.path} (han=${entry.containsHan}, mojibake=${entry.containsMojibake})`);
    }
  }

  if (!result.ok) {
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
