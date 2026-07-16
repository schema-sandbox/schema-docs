import test from "node:test";
import assert from "node:assert";
import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { openOrCreateWorkspace } from "../src/core/manifest.js";
import { writeExchangePackage, generateTrustReport, verifyExchangePackage, writeExchangePackageReceiverReport } from "../src/core/exchangePackage.js";
async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), "schema-docs-trustreport-"));
}
test("Exchange Package Trust Report Test", async () => {
  const workspacePath = await tempDir();
  await openOrCreateWorkspace(workspacePath);
  const pkg1 = "packages/trusted-pkg";
  await writeExchangePackage(workspacePath, pkg1, {
    title: "Trusted Package",
    body: "# Content\nSome body text.",
    exportFormats: ["docx"],
    evidence: {
      id: "ev_1",
      kind: "document_conversion",
      sendGateDecision: "allow"
    },
    audit: {
      id: "aud_1",
      kind: "ai_send",
      sent: true
    },
    sourceRecords: [
      { id: "doc_1", name: "source.docx" }
    ],
    aiSendGateSummaries: [
      { sourceRef: "doc_1", decision: "allow", signals: [] }
    ]
  });
  const report1 = await generateTrustReport(workspacePath, pkg1);
  assert.strictEqual(report1.packageIntegrity, "pass");
  assert.strictEqual(report1.sourceProvenance, "pass");
  assert.strictEqual(report1.markdownAvailability, true);
  assert.strictEqual(report1.auditTrailCompleteness, "pass");
  assert.strictEqual(report1.sanitizationStatus, "pass");
  assert.strictEqual(report1.sendGateStatus, "pass");
  assert.strictEqual(report1.sourceRecordsCount, 1);
  assert.strictEqual(report1.aiSendGateSummaryCount, 1);
  assert.strictEqual(report1.verdict, "trusted");
  const pkg2 = "packages/low-quality-pkg";
  await writeExchangePackage(workspacePath, pkg2, {
    title: "Low Quality Package",
    body: "# Content\nSome body text.",
    exportFormats: ["docx"],
    conversionQuality: [
      { confidence: "low", warnings: ["scannedLikely"] }
    ]
  });
  const report2 = await generateTrustReport(workspacePath, pkg2);
  assert.strictEqual(report2.qualityStatus, "warning");
  assert.strictEqual(report2.verdict, "trusted_with_warnings");
  const pkg3 = "packages/blocked-pkg";
  await writeExchangePackage(workspacePath, pkg3, {
    title: "Blocked Package",
    body: "# Content\nSome body text.",
    exportFormats: ["docx"]
  });
  const secretFile = path.join(workspacePath, pkg3, "exports", "key.env");
  await mkdir(path.dirname(secretFile), { recursive: true });
  await writeFile(secretFile, "API_KEY=sk-12345", "utf8");
  const report3 = await generateTrustReport(workspacePath, pkg3);
  assert.strictEqual(report3.sanitizationStatus, "fail");
  assert.strictEqual(report3.verdict, "blocked");
  await assert.rejects(
    verifyExchangePackage(workspacePath, pkg3),
    /unsafe raw source files/
  );
  const pkg3b = "packages/non-sensitive-keyword-pkg";
  await writeExchangePackage(workspacePath, pkg3b, {
    title: "Keyword Package",
    body: "# Content\nA harmless file name contains key as part of another word.",
    exportFormats: ["docx"]
  });
  const harmlessFile = path.join(workspacePath, pkg3b, "assets", "monkey-notes.md");
  await mkdir(path.dirname(harmlessFile), { recursive: true });
  await writeFile(harmlessFile, "No secret material.", "utf8");
  const report3b = await generateTrustReport(workspacePath, pkg3b);
  assert.strictEqual(report3b.sanitizationStatus, "pass");
  assert.strictEqual((await verifyExchangePackage(workspacePath, pkg3b)).ok, true);
  const pkg3c = "packages/manifest-secret-pkg";
  await writeExchangePackage(workspacePath, pkg3c, {
    title: "Manifest Secret Package",
    body: "# Content\nSome body text.",
    apiBaseUrl: "https://api.example.test/v1?token=sk-12345678901234567890",
    aiSendGateSummaries: [
      { sourceRef: "doc_signal_only", decision: "allow", signals: ["bearer_token_like"] }
    ]
  });
  const report3c = await generateTrustReport(workspacePath, pkg3c);
  assert.strictEqual(report3c.sanitizationStatus, "fail");
  assert.strictEqual(report3c.verdict, "blocked");
  const pkg4 = "packages/send-gate-blocked-pkg";
  await writeExchangePackage(workspacePath, pkg4, {
    title: "Send Gate Blocked Package",
    body: "# Content\nContains content that should not be sent.",
    exportFormats: ["docx"],
    audit: {
      id: "aud_4",
      kind: "ai_send",
      sent: false
    },
    sourceRecords: [
      { id: "doc_4", name: "source.md" }
    ],
    aiSendGateSummaries: [
      { sourceRef: "doc_4", decision: "blocked", signals: ["credential_like_text"] }
    ]
  });
  const report4 = await generateTrustReport(workspacePath, pkg4);
  assert.strictEqual(report4.sendGateStatus, "fail");
  assert.strictEqual(report4.aiReadiness, "warning");
  assert.strictEqual(report4.externalSharingReadiness, "fail");
  assert.strictEqual(report4.verdict, "blocked");
  assert.ok(report4.riskSummary.some((risk) => risk.includes("AI Send Gate")));
  const receiverReport = await writeExchangePackageReceiverReport(workspacePath, pkg1);
  assert.match(receiverReport.markdownPath, /receiver-report\.md$/);
  assert.match(receiverReport.jsonPath, /trust-report\.json$/);
  assert.match(receiverReport.markdownHash, /^sha256:/);
  assert.match(receiverReport.jsonHash, /^sha256:/);
  assert.strictEqual(receiverReport.verdict, "trusted");
});