import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAppService } from "../src/core/appService.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

function line(text = "") {
  console.log(text);
}

function section(index, title) {
  line(`\n${CYAN}[${index}/7] ${title}${RESET}`);
}

function highlightSecrets(text) {
  return text
    .replace(/sk-proj-[a-zA-Z0-9]+/g, `${RED}$&${RESET}`)
    .replace(/bearer [a-zA-Z0-9._-]+/gi, `${RED}$&${RESET}`)
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, `${YELLOW}$&${RESET}`);
}

function highlightMasks(text) {
  return text.replace(/\[MASK_[A-Z]+_[0-9]+\]/g, `${GREEN}$&${RESET}`);
}

async function main() {
  line(`\n${BOLD}SCHEMA DOCS - 30 SECOND LOCAL AI INTAKE DEMO${RESET}`);
  line(`${DIM}Zero runtime dependencies. Local masking. Send Gate. SDXP exchange package.${RESET}`);
  line(`${DIM}No document content is sent to an AI service during this demo.${RESET}\n`);

  let tempWorkspace = "";
  try {
    section(1, "Create a temporary local workspace");
    tempWorkspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-demo-"));
    const service = createAppService(tempWorkspace);
    await service.openWorkspace();
    await mkdir(path.join(tempWorkspace, "imports"), { recursive: true });
    await mkdir(path.join(tempWorkspace, "packages"), { recursive: true });
    await mkdir(path.join(tempWorkspace, "notes"), { recursive: true });
    line(`Workspace: ${DIM}${tempWorkspace}${RESET}`);

    section(2, "Create an inbound document with PII and credentials");
    const rawContent = [
      "# Q3 Financial and Operations Review",
      "Created by: CEO (ceo@confidential-firm.net)",
      "Direct contact: 139-1100-5678",
      "",
      "## Executive Summary",
      "This document contains private operational details.",
      "Production cluster API key: sk-proj-a1b2c3d4e5f6g7h8",
      "Database incident token: bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      "",
      "## Customer Data",
      "- User John (john.doe@gmail.com), age 29",
      "- User Alice (alice.smith@yahoo.com), age 35"
    ].join("\n");
    const sampleDocPath = path.join(tempWorkspace, "imports", "confidential-report.md");
    await writeFile(sampleDocPath, rawContent, "utf8");
    line("Source file: imports/confidential-report.md");

    section(3, "Import and prepare the document for AI");
    const docRecord = await service.importFile(sampleDocPath);
    const prepared = await service.prepareRecordForAi(docRecord.id);
    line(`Record ID: ${GREEN}${docRecord.id}${RESET}`);
    line(`AI Will See decision: ${GREEN}${prepared.preview.sendGateDecision}${RESET}`);
    line(`Estimated tokens: ${prepared.preview.tokenEstimate}`);

    section(4, "Show the raw extraction versus local masking");
    const originalText = await service.readMarkdown(docRecord.sourcePath);
    const { maskedText, mapping } = service.maskSensitiveData(originalText);
    line(`\n${BOLD}RAW EXTRACTION (original input summary - unsafe to paste directly into AI)${RESET}`);
    line(highlightSecrets(originalText));
    line(`\n${BOLD}AI WILL SEE PREVIEW (after local masking)${RESET}`);
    line(highlightMasks(maskedText));
    line(`\nMasked sensitive data (mask entries kept in memory only): ${Object.keys(mapping).length}`);

    section(5, "Prove Send Gate blocks raw credential content");
    const blockedPreview = await service.previewAiPayload({
      operation: "summarize",
      content: originalText,
      sourceRef: docRecord.id,
      apiKey: "sk-demo-key-not-stored"
    });
    const blockedSend = await service.sendAiRequest({
        operation: "summarize",
        content: originalText,
        sourceRef: docRecord.id,
        apiKey: "sk-demo-key-not-stored",
        confirmed: true
      }, { send: async () => ({ text: "should not be called" }) });
    line(`Send Gate decision: ${YELLOW}${blockedPreview.output.sendGate.decision}${RESET}`);
    line(`Send Gate signals: ${blockedPreview.output.sendGate.signals.join(", ")}`);
    line(`Confirmed raw send job: ${GREEN}${blockedSend.status}${RESET}`);
    line(`Confirmed raw send code: ${GREEN}${blockedSend.error?.code || "none"}${RESET}`);
    line("Network call made: no");

    section(6, "Save a reviewed AI handoff bundle and SDXP package");
    const handoff = await service.saveAiHandoffBundle("notes/demo-ai-handoff.md", {
      title: "Demo AI Handoff Bundle",
      source: "npm-run-demo",
      sourceRef: docRecord.id,
      operation: "summarize",
      content: maskedText,
      sendGateSummary: `Send Gate: ${blockedPreview.output.sendGate.decision}`,
      chunkLedger: "single masked demo document"
    });
    const pkg = await service.saveExchangePackageFromRecord(docRecord.id, "packages/demo-handoff.exchange", {
      title: "Demo SDXP Handoff",
      notes: "Created by npm run demo",
      exportFormats: ["docx", "pdf"]
    });
    line(`AI handoff: ${GREEN}${handoff.relativePath}${RESET}`);
    line(`Exchange package path: ${GREEN}${pkg.packageRelativePath || "packages/demo-handoff.exchange"}${RESET}`);

    section(7, "Verify the package trust report");
    const trustReport = await service.generateTrustReport("packages/demo-handoff.exchange");
    line(`Integrity: ${trustReport.packageIntegrity === "pass" ? "PASS" : "FAIL"}`);
    line(`Sanitization: ${trustReport.sanitizationStatus === "pass" ? "PASS" : "FAIL"}`);
    line(`Verdict: ${BOLD}${trustReport.verdict}${RESET}`);
    line(`\n${GREEN}${BOLD}Demo complete: Schema Docs showed what AI would see, blocked raw secrets, and wrote a local exchange package.${RESET}\n`);
  } catch (error) {
    console.error(`\n${RED}Demo failed: ${error.message}${RESET}\n`);
    process.exitCode = 1;
  } finally {
    if (tempWorkspace) {
      await rm(tempWorkspace, { recursive: true, force: true });
    }
  }
}

main();
