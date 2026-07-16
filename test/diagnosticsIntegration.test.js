import { lookupError } from "../src/core/errorCatalog.js";
import { getKnownLimits } from "../src/core/knownLimits.js";
import { getActionSuggestions } from "../src/core/actionSuggestions.js";
import { generateFeedbackBundle } from "../src/core/feedback.js";
import { runSecuritySecretsAudit } from "../src/core/secretsAudit.js";
import { generateReproductionScript } from "../src/core/repro.js";
import { openOrCreateWorkspace } from "../src/core/manifest.js";
import { createAppService } from "../src/core/appService.js";
import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile } from "node:fs/promises";
export async function run(t) {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "schema-docs-doctor-integrated-"));
  await openOrCreateWorkspace(workspacePath);
  const service = createAppService(workspacePath);
  const queryLimits = await service.getKnownLimits({ area: "query" });
  if (!queryLimits.some(l => l.id === "sql_advanced_join_limited")) {
    throw new Error("Failed query limits filter");
  }
  const suggs = await service.getActionSuggestions(["scannedLikely", "joinUnsupported"]);
  if (suggs.length !== 2 || !suggs.some(s => s.action.includes("OCR")) || !suggs.some(s => s.action.includes("INNER JOIN"))) {
    throw new Error("Failed specific suggestions lookup");
  }
  await service.updateWorkspaceSettings("defaultApiBaseUrl", "https://localhost/api?token=sk-99999999999999999999999999999999");
  const secretsAudit = await service.runSecuritySecretsAudit();
  if (secretsAudit.ok || secretsAudit.failures.length === 0) {
    throw new Error("Secrets audit failed to flag credentials in settings!");
  }
  const bundle = await service.generateFeedbackBundle(null, true);
  const summaryJson = JSON.parse(await readFile(path.join(bundle.bundlePath, "summary.json"), "utf8"));
  if (summaryJson.settings.defaultApiBaseUrl !== "[REDACTED_SECRET]") {
    throw new Error("Feedback bundle leaked the secret defaultApiBaseUrl!");
  }
  const pkgDir = "packages/test-verify-repro";
  const pkgWrite = await service.saveExchangePackage(pkgDir, {
    title: "Verify Test",
    body: "Body of verification package",
    source: "integration-test",
    exportFormats: ["docx", "pdf"]
  });
  const verified = await service.verifyExchangePackage(pkgDir);
  if (!verified.ok || !verified.manifestComplete || !verified.hasMarkdown || verified.schemaVersion !== 1) {
    throw new Error("verifyExchangePackage failed to pass clean package!");
  }
  const explained = await service.explainExchangePackage(pkgDir);
  if (!explained.aiExposureDescription || !explained.sanitizationStatus || !explained.rawVsMarkdownMapping) {
    throw new Error("explainExchangePackage is missing enriched explanation metadata fields!");
  }
  if (!explained.readiness || !explained.receiverSummary || !Array.isArray(explained.recommendedActions)) {
    throw new Error("explainExchangePackage is missing receiver-facing readiness fields!");
  }
  console.log("Integrated diagnostics, secrets audit, feedback, exchange package verify and explain validation passed.");
}