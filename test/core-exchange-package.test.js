import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openOrCreateWorkspace } from "../src/core/manifest.js";
import { createAppService } from "../src/core/appService.js";
import { createExchangeMarkdown, frontMatter, readExchangePackage } from "../src/core/exchangePackage.js";
import { readZipEntry } from "../src/core/zip.js";
import { pdfBufferToMarkdown } from "../src/adapters/pdfMarkdownConverter.js";
async function tempDir(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}
test("creates markdown-centered exchange package", () => {
  const markdown = createExchangeMarkdown({
    title: "Daily Note",
    source: "manual",
    apiBaseUrl: "https://api.example.test",
    model: "model-a",
    body: "Main Markdown body.",
    queryResult: {
      columns: ["name", "value"],
      rows: [{ name: "alpha", value: "1" }]
    },
    aiResult: "API response text.",
    audit: {
      contentHash: "abc",
      willSend: { content: true, apiKey: false }
    },
    evidence: {
      sentContentHash: "sha256:abc",
      policyDecision: "preview_only"
    }
  });
  assert.match(frontMatter({ title: "A" }), /title: "A"/);
  assert.match(markdown, /^---/);
  assert.match(markdown, /# Daily Note/);
  assert.match(markdown, /## Query Result/);
  assert.match(markdown, /## API Result/);
  assert.match(markdown, /## Exchange Audit/);
  assert.match(markdown, /## Evidence/);
});
test("writes directory-based markdown exchange package", async () => {
  const workspace = await tempDir("lft-exchange-package-");
  const service = createAppService(workspace);
  await service.openWorkspace();
  const saved = await service.saveExchangePackage(path.join("packages", "daily"), {
    title: "Daily Package",
    source: "test",
    body: "Package body.",
    queryResult: {
      columns: ["name", "value"],
      rows: [{ name: "alpha", value: "1" }]
    },
    exportFormats: ["docx", "pdf", "html"],
    evidence: {
      id: "evidence_test",
      policyDecision: "local_only"
    }
  });
  assert.match(saved.documentPath, /document\.md$/);
  assert.match(await readFile(saved.documentPath, "utf8"), /# Daily Package/);
  assert.match(await readFile(saved.documentPath, "utf8"), /policy_mode: "open-core"/);
  const packageManifest = JSON.parse(await readFile(saved.manifestPath, "utf8"));
  assert.equal(packageManifest.packageType, "markdown.exchange");
  assert.equal(packageManifest.policies.policyMode, "open-core");
  assert.equal(packageManifest.policies.openCoreFree, true);
  assert.ok(packageManifest.policies.enterpriseOnly.includes("dlp_policy_packs"));
  assert.equal(packageManifest.canonicalDocument.path, "document.md");
  assert.match(packageManifest.canonicalDocument.hash, /^sha256:/);
  assert.equal(packageManifest.documentSchema.path, "document.schema.json");
  assert.match(packageManifest.documentSchema.hash, /^sha256:/);
  assert.equal(packageManifest.capability.type, "document.exchange");
  assert.equal(packageManifest.capability.canonicalFormat, "markdown");
  assert.equal(packageManifest.tables[0].formats[0].path, "tables/query_result.csv");
  assert.match(packageManifest.tables[0].formats[0].hash, /^sha256:/);
  assert.equal(packageManifest.tables[0].rowCount, 1);
  assert.deepEqual(packageManifest.exports.map((entry) => entry.path).sort(), ["exports/document.docx", "exports/document.html", "exports/document.pdf"]);
  assert.ok(packageManifest.exports.every((entry) => entry.hash.startsWith("sha256:")));
  assert.equal(packageManifest.evidence.id, "evidence_test");
  assert.equal(packageManifest.evidence.policyMode, "");
  assert.equal(packageManifest.evidenceFile.path, "evidence.jsonl");
  assert.match(packageManifest.evidenceFile.hash, /^sha256:/);
  assert.equal(packageManifest.policies.storesApiKey, false);
  assert.match(await readFile(saved.evidencePath, "utf8"), /"evidence_test"/);
  assert.match(await readFile(saved.documentSchemaPath, "utf8"), /Markdown Exchange Document/);
  assert.match(await readFile(saved.queryCsvPath, "utf8"), /alpha,1/);
  assert.match(await readFile(saved.queryMarkdownPath, "utf8"), /\| alpha \| 1 \|/);
  assert.match(readZipEntry(await readFile(path.join(saved.exportsDir, "document.docx")), "word/document.xml").toString("utf8"), /Daily Package/);
  assert.match(await pdfBufferToMarkdown(await readFile(path.join(saved.exportsDir, "document.pdf")), "document.pdf"), /Daily Package/);
  const htmlContent = await readFile(path.join(saved.exportsDir, "document.html"), "utf8");
  assert.match(htmlContent, /<!DOCTYPE html>/i);
  assert.match(htmlContent, /<style>/i);
  assert.match(htmlContent, /Daily Package/);
  assert.match(saved.exportsDir, /exports$/);
  assert.match(saved.tablesDir, /tables$/);
  assert.match(saved.assetsDir, /assets$/);
  const readBack = await readExchangePackage(workspace, path.join("packages", "daily"));
  assert.equal(readBack.valid, true);
  assert.equal(readBack.manifest.title, "Daily Package");
  assert.equal(readBack.document.frontmatter.title, "Daily Package");
  assert.equal(readBack.document.headings[0].title, "Daily Package");
  assert.ok(readBack.files.some((file) => file.path === "document.md" && file.hash.startsWith("sha256:")));
  assert.ok(readBack.files.some((file) => file.path === "exports/document.docx"));
  await writeFile(saved.evidencePath, "{\"tampered\":true}\n", "utf8");
  await assert.rejects(() => readExchangePackage(workspace, path.join("packages", "daily")), {
    code: "exchange_package_hash_mismatch"
  });
  await writeFile(saved.evidencePath, "{\"id\":\"evidence_test\",\"policyDecision\":\"local_only\"}\n", "utf8");
  await writeFile(saved.documentPath, "# Tampered\n", "utf8");
  await assert.rejects(() => readExchangePackage(workspace, path.join("packages", "daily")), {
    code: "exchange_package_hash_mismatch"
  });
});
test("Exchange package manifest and explanation verification", async () => {
  const workspace = await tempDir("lft-exchange-pkg-verify-");
  await openOrCreateWorkspace(workspace);
  const service = createAppService(workspace);
  const pkgRes = await service.saveExchangePackage("packages/my-package", {
    title: "Verify Test Package",
    body: "# Test\nHello world",
    packageVersion: "1.2.3",
    knownLimits: ["limit 1"],
    exportFormats: ["docx"]
  });
  assert.ok(pkgRes.packageRoot);
  const pkgRead = await service.readExchangePackage("packages/my-package");
  assert.equal(pkgRead.valid, true);
  assert.equal(pkgRead.manifest.packageVersion, "1.2.3");
  assert.equal(pkgRead.manifest.createdByVersion, "0.1.2");
  const explanation = await service.explainExchangePackage("packages/my-package");
  assert.equal(explanation.title, "Verify Test Package");
  assert.equal(explanation.knownLimitsCount, 1);
  assert.equal(explanation.exportsCount, 1);
  assert.equal(explanation.readiness.quality, "pass");
  assert.equal(explanation.receiverSummary.verdict, "trusted_with_warnings");
  assert.ok(explanation.recommendedActions.length > 0);
});
