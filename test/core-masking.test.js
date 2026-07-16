import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openOrCreateWorkspace } from "../src/core/manifest.js";
import { createAppService } from "../src/core/appService.js";
import { appendEvidenceRecord } from "../src/core/evidence.js";
async function tempDir(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}
function joinSecret(parts, separator = "") {
  return parts.join(separator);
}
test("masks and unmasks sensitive PII and credential data", async () => {
  const { maskSensitiveData, unmaskSensitiveData } = await import("../src/core/masking.js");
  const awsKey = joinSecret(["AKIA", "1234567890ABCDEF"]);
  const original = [
    "Contact user at alice@example.com or phone +86 138-1234-5678.",
    "Server IP: 192.168.1.100.",
    "Api-Key: sk-abcdef123456.",
    "Standalone key sk-abc123xyz.",
    "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.super-secret-token.",
    `Cloud key ${awsKey}.`,
    "token: 550e8400-e29b-41d4-a716-446655440000."
  ].join(" ");
  const { maskedText, mapping } = maskSensitiveData(original);
  assert.ok(maskedText.includes("[MASK_EMAIL_1]"));
  assert.ok(maskedText.includes("[MASK_PHONE_1]"));
  assert.ok(maskedText.includes("[MASK_IP_1]"));
  assert.ok(maskedText.includes("[MASK_SECRET_1]"));
  assert.ok(maskedText.includes("[MASK_SECRET_2]"));
  assert.ok(!maskedText.includes("sk-abc123xyz"));
  assert.ok(!maskedText.includes("eyJhbGciOiJIUzI1NiJ9.super-secret-token"));
  assert.ok(!maskedText.includes(awsKey));
  assert.ok(!maskedText.includes("550e8400-e29b-41d4-a716-446655440000"));
  assert.equal(mapping["[MASK_EMAIL_1]"], "alice@example.com");
  assert.equal(mapping["[MASK_PHONE_1]"], "+86 138-1234-5678");
  assert.equal(mapping["[MASK_IP_1]"], "192.168.1.100");
  const maskedSecrets = Object.values(mapping);
  assert.ok(maskedSecrets.includes("sk-abcdef123456"));
  assert.ok(maskedSecrets.includes("sk-abc123xyz"));
  assert.ok(maskedSecrets.includes("eyJhbGciOiJIUzI1NiJ9.super-secret-token"));
  assert.ok(maskedSecrets.includes(awsKey));
  assert.ok(maskedSecrets.includes("550e8400-e29b-41d4-a716-446655440000"));
  const restored = unmaskSensitiveData(maskedText, mapping);
  assert.equal(restored, original);
});
test("masking preserves literal placeholders and reuses placeholders for repeated values", async () => {
  const { maskSensitiveData, unmaskSensitiveData } = await import("../src/core/masking.js");
  const original = "Literal [MASK_EMAIL_1]; alice@example.com; alice@example.com";
  const { maskedText, mapping } = maskSensitiveData(original);
  assert.match(maskedText, /^Literal \[MASK_EMAIL_1\]/);
  assert.equal((maskedText.match(/\[MASK_EMAIL_2\]/g) ?? []).length, 2);
  assert.deepEqual(mapping, { "[MASK_EMAIL_2]": "alice@example.com" });
  assert.equal(unmaskSensitiveData(maskedText, mapping), original);
});
test("phone masking avoids dates amounts order IDs and dotted numeric expressions", async () => {
  const { maskSensitiveData, unmaskSensitiveData } = await import("../src/core/masking.js");
  const ordinary = "version 1.2.3 date 2026-07-14 amount 12345678 order 202607140001 formula 1.234.567.890";
  assert.deepEqual(maskSensitiveData(ordinary), { maskedText: ordinary, mapping: {} });
  const phones = "mobile 13800138000; tel 010-88886666; international +1 (415) 555-2671; phone: 88886666";
  const result = maskSensitiveData(phones);
  assert.equal((result.maskedText.match(/\[MASK_PHONE_\d+\]/g) ?? []).length, 4);
  assert.equal(unmaskSensitiveData(result.maskedText, result.mapping), phones);
});
test("masks DevOps tokens and Chinese identifiers before phone fallback", async () => {
  const { maskSensitiveData, unmaskSensitiveData } = await import("../src/core/masking.js");
  const githubToken = joinSecret(["ghp", "1234567890abcdefghijklmnopqrstuvwxyzABCDEF"], "_");
  const slackToken = joinSecret(["xoxb", "123456789012", "1234567890123", "abcdefghijklmnopqrstuvwx"], "-");
  const stripeToken = joinSecret(["sk", "live", "4eC39HqLyjWDarjtT1zdp7dc"], "_");
  const original = [
    `Github PAT: ${githubToken}`,
    `Slack: ${slackToken}`,
    `Stripe: ${stripeToken}`,
    "SSH: -----BEGIN OPENSSH PRIVATE KEY-----\nprivate-key-body\n-----END OPENSSH PRIVATE KEY-----",
    "Chinese ID: 110101199003078888",
    "银行卡 6222021234567890123",
    "QQ 12345678"
  ].join("\n");
  const { maskedText, mapping } = maskSensitiveData(original);
  assert.ok(maskedText.includes("[MASK_SECRET_1]"));
  assert.ok(maskedText.includes("[MASK_SECRET_2]"));
  assert.ok(maskedText.includes("[MASK_SECRET_3]"));
  assert.ok(maskedText.includes("[MASK_SECRET_4]"));
  assert.ok(maskedText.includes("[MASK_ID_1]"));
  assert.ok(maskedText.includes("[MASK_BANK_1]"));
  assert.ok(maskedText.includes("[MASK_PII_1]"));
  assert.equal(maskedText.includes(githubToken.slice(0, 14)), false);
  assert.equal(maskedText.includes(slackToken.slice(0, 17)), false);
  assert.equal(maskedText.includes(stripeToken), false);
  assert.equal(maskedText.includes("110101199003078888"), false);
  assert.equal(maskedText.includes("6222021234567890123"), false);
  assert.equal(maskedText.includes("QQ 12345678"), false);
  assert.equal(maskedText.includes("[MASK_PHONE_"), false);
  const maskedValues = Object.values(mapping);
  assert.ok(maskedValues.includes(githubToken));
  assert.ok(maskedValues.includes(slackToken));
  assert.ok(maskedValues.includes(stripeToken));
  assert.ok(maskedValues.some((value) => /BEGIN OPENSSH PRIVATE KEY/.test(value)));
  assert.equal(mapping["[MASK_ID_1]"], "110101199003078888");
  assert.equal(mapping["[MASK_BANK_1]"], "6222021234567890123");
  assert.equal(mapping["[MASK_PII_1]"], "12345678");
  assert.equal(unmaskSensitiveData(maskedText, mapping), original);
});
test("masks short labeled passwords and Chinese bank-card labels without hiding ordinary long IDs", async () => {
  const { maskSensitiveData, unmaskSensitiveData } = await import("../src/core/masking.js");
  const original = [
    "\u5bc6\u7801\uff1aabc123",
    "\u5361\u53f7\uff1a6216697000020517698",
    "\u5907\u7528\u5361 6216 6970 0002 0517 698",
    "\u8ba2\u5355 202607140001234567"
  ].join("\n");
  const { maskedText, mapping } = maskSensitiveData(original);
  assert.match(maskedText, /\u5bc6\u7801\uff1a\[MASK_SECRET_1\]/);
  assert.match(maskedText, /\u5361\u53f7\uff1a\[MASK_BANK_1\]/);
  assert.match(maskedText, /\u5907\u7528\u5361 \[MASK_BANK_2\]/);
  assert.match(maskedText, /\u8ba2\u5355 202607140001234567/);
  assert.equal(mapping["[MASK_SECRET_1]"], "abc123");
  assert.equal(mapping["[MASK_BANK_1]"], "6216697000020517698");
  assert.equal(mapping["[MASK_BANK_2]"], "6216 6970 0002 0517 698");
  assert.equal(unmaskSensitiveData(maskedText, mapping), original);
});
test("security secrets audit ignores Send Gate signal labels but flags real evidence leaks", async () => {
  const workspace = await tempDir("lft-secrets-audit-");
  await openOrCreateWorkspace(workspace);
  const service = createAppService(workspace);
  await appendEvidenceRecord(workspace, {
    kind: "ai_send_blocked",
    sourceRef: "doc_signal_only",
    outputType: "api_send_blocked",
    aiSent: false,
    sendGateDecision: "review_required",
    sendGateSignals: ["bearer_token_like", "uuid_token_like", "credential_like_text"],
    policyDecision: "blocked_review_required"
  });
  const signalOnlyAudit = await service.runSecuritySecretsAudit();
  assert.equal(signalOnlyAudit.ok, true);
  await appendEvidenceRecord(workspace, {
    kind: "ai_send_blocked",
    sourceRef: "doc_leak",
    outputType: "api_send_blocked",
    aiSent: false,
    sendGateDecision: "review_required",
    sendGateSignals: ["credential_like_text"],
    policyDecision: "blocked_review_required",
    converter: "debug-sk-abcdefghijklmnopqrstuvwxyz123456"
  });
  const leakedAudit = await service.runSecuritySecretsAudit();
  assert.equal(leakedAudit.ok, false);
  assert.ok(leakedAudit.failures.some((failure) => failure.code === "secret_leaked_in_evidence"));
});
test("security secrets audit flags DevOps token leaks in evidence", async () => {
  const workspace = await tempDir("lft-devops-secrets-audit-");
  await openOrCreateWorkspace(workspace);
  const service = createAppService(workspace);
  const stripeToken = joinSecret(["sk", "live", "4eC39HqLyjWDarjtT1zdp7dc"], "_");
  await appendEvidenceRecord(workspace, {
    kind: "ai_send_blocked",
    sourceRef: "doc_devops_leak",
    outputType: "api_send_blocked",
    aiSent: false,
    sendGateDecision: "review_required",
    policyDecision: "blocked_review_required",
    converter: `Stripe key ${stripeToken}`
  });
  const audit = await service.runSecuritySecretsAudit();
  assert.equal(audit.ok, false);
  assert.ok(audit.failures.some((failure) => failure.code === "secret_leaked_in_evidence"));
});

test("sanitizeFolderForAi recursively converts and masks files", async () => {
  const { sanitizeFolderForAi } = await import("../src/core/appService.js");
  const { existsSync } = await import("node:fs");
  const { mkdtemp, readFile } = await import("node:fs/promises");
  const baseTemp = await mkdtemp(path.join(os.tmpdir(), "lft-folder-sanitize-test-"));
  const sourceFolder = path.join(baseTemp, "source");
  const subFolder = path.join(sourceFolder, "alice@example.com");

  const outputFolder = path.join(baseTemp, "output");

  const txtPath = path.join(sourceFolder, "contract.txt");
  const subCsvPath = path.join(subFolder, "token-sk-abc123xyz.csv");
  const pngPath = path.join(sourceFolder, "picture.png");

  await import("node:fs").then(fs => {
    fs.mkdirSync(subFolder, { recursive: true });
    fs.writeFileSync(txtPath, "My API key: sk-Uj12345abcdef67890xyz. Reach me at test@example.com.\n", "utf8");
    fs.writeFileSync(subCsvPath, "name,phone,id\nalpha,+86 13800138000,110101199003072345\n", "utf8");
    fs.writeFileSync(pngPath, "binary content", "utf8");
  });

  const result = await sanitizeFolderForAi(sourceFolder, { outputFolderPath: outputFolder });

  assert.equal(result.ok, true);
  assert.equal(result.processedCount, 2);
  assert.equal(result.skippedCount, 1);

  const outTxtPath = path.join(outputFolder, "contract-AI-safe.md");
  const csvResult = result.items.find(it => it.type === "csv");
  const outCsvPath = path.join(outputFolder, ...csvResult.outputRelativePath.split("/"));
  const outReportJson = path.join(outputFolder, "sanitization-report.json");
  const outReportMd = path.join(outputFolder, "sanitization-report.md");

  assert.ok(existsSync(outTxtPath));
  assert.ok(existsSync(outCsvPath));
  assert.ok(existsSync(outReportJson));
  assert.ok(existsSync(outReportMd));

  const txtContent = await readFile(outTxtPath, "utf8");
  assert.doesNotMatch(txtContent, /sk-Uj12345abcdef67890xyz/);
  assert.doesNotMatch(txtContent, /test@example.com/);
  assert.match(txtContent, /MASK_SECRET/);
  assert.match(txtContent, /MASK_EMAIL/);

  const csvContent = await readFile(outCsvPath, "utf8");
  assert.doesNotMatch(csvContent, /110101199003072345/);
  assert.doesNotMatch(csvContent, /\+86 13800138000/);

  const reportJson = JSON.parse(await readFile(outReportJson, "utf8"));
  assert.equal(reportJson.skippedCount, 1);
  const portableJson = await readFile(outReportJson, "utf8");
  const portableMarkdown = await readFile(outReportMd, "utf8");
  for (const portableReport of [portableJson, portableMarkdown]) {
    assert.doesNotMatch(portableReport, /alice@example\.com/);
    assert.doesNotMatch(portableReport, /sk-abc123xyz/);
    assert.equal(portableReport.includes(baseTemp), false);
    assert.equal(portableReport.includes(sourceFolder), false);
    assert.equal(portableReport.includes(outputFolder), false);
  }
  assert.equal(Object.hasOwn(reportJson, "outputFolderPath"), false);
  assert.ok(reportJson.items.every(it => !Object.hasOwn(it, "originalPath") && !Object.hasOwn(it, "relativePath")));

  const pngEntry = reportJson.items.find(it => it.type === "png");
  assert.equal(pngEntry.status, "skipped");
  assert.equal(pngEntry.reason, "unsupported format");

  await import("node:fs/promises").then(fs => fs.rm(baseTemp, { recursive: true, force: true }));
});
