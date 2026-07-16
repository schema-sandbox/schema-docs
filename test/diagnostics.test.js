import { openOrCreateWorkspace } from "../src/core/manifest.js";
import { createAppService } from "../src/core/appService.js";
import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile } from "node:fs/promises";
async function main() {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "schema-docs-doctor-"));
  await openOrCreateWorkspace(workspacePath);
  const service = createAppService(workspacePath);
  console.log("Running Core Diagnostics Tests...");
  const pdfLimits = await service.getKnownLimits({ format: "pdf" });
  if (pdfLimits.length > 0 && pdfLimits.every(l => l.appliesToFormats.includes("pdf") || l.appliesToFormats.length === 0)) {
    console.log("✔ getKnownLimits filtering by PDF format passed.");
  } else {
    throw new Error("Failed getKnownLimits filtering");
  }
  const generalSugs = await service.getActionSuggestions(["unsupported_format"]);
  if (generalSugs.length === 1 && generalSugs[0].action.includes("DOCX")) {
    console.log("✔ getActionSuggestions fallback lookup passed.");
  } else {
    throw new Error("Failed getActionSuggestions lookup");
  }
  await service.updateWorkspaceSettings("defaultApiBaseUrl", "https://api.openai.com/v1?key=sk-1234567890abcdef1234567890abcdef");
  const bundle = await service.generateFeedbackBundle(null, true);
  if (bundle.ok) {
    console.log("✔ generateFeedbackBundle generated successfully.");
  } else {
    throw new Error("Failed generateFeedbackBundle");
  }
  const summaryRaw = await readFile(path.join(bundle.bundlePath, "summary.json"), "utf8");
  const summaryJson = JSON.parse(summaryRaw);
  if (summaryJson.settings.defaultApiBaseUrl === "[REDACTED_SECRET]") {
    console.log("✔ generateFeedbackBundle redacted settings credentials successfully.");
  } else {
    throw new Error("Feedback bundle leaked api credentials!");
  }
  const audit = await service.runSecuritySecretsAudit();
  if (!audit.ok && audit.failures.some(f => f.code === "secret_leaked_in_settings")) {
    console.log("✔ runSecuritySecretsAudit successfully detected setting leak.");
  } else {
    throw new Error("Failed runSecuritySecretsAudit detection");
  }
  const repro = await service.generateReproductionScript({ recordId: "nonexistent" });
  if (repro.ok && repro.markdown.includes("Issue Reproduction Script Template")) {
    console.log("✔ generateReproductionScript generated template.");
  } else {
    throw new Error("Failed generateReproductionScript");
  }
  console.log("ALL CORE DIAGNOSTICS TESTS PASSED.");
}
main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});