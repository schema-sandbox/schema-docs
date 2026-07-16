import test from "node:test";
import assert from "node:assert";
import { openOrCreateWorkspace } from "../src/core/manifest.js";
import { createAppService } from "../src/core/appService.js";
import { createQualityReport } from "../src/core/qualityReport.js";
import path from "node:path";
import os from "node:os";
import { mkdtemp } from "node:fs/promises";
test("API Contract Validation", async (t) => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "schema-docs-contract-"));
  await openOrCreateWorkspace(workspacePath);
  const service = createAppService(workspacePath);
  await t.test("Quality Report schema fields validation", async () => {
    const report = await createQualityReport(
      workspacePath,
      "doc_contract_test",
      "imports/sample.pdf",
      "pdf",
      path.join(workspacePath, "outputs/sample.md"),
      "Sample markdown text",
      { textLayerDetected: true, scannedLikely: false, tableSimplified: true },
      ["Warning A"]
    );
    const requiredFields = [
      "id",
      "recordId",
      "inputType",
      "textLayerDetected",
      "scannedLikely",
      "tableSimplified",
      "possibleMojibake",
      "confidence",
      "matchedKnownLimits",
      "suggestedActions",
      "whetherAiSendGateBlocked",
      "recommendedNextStep"
    ];
    for (const field of requiredFields) {
      assert.ok(report[field] !== undefined, `Missing required field: ${field}`);
    }
    assert.strictEqual(typeof report.textLayerDetected, "boolean");
    assert.strictEqual(typeof report.scannedLikely, "boolean");
    assert.strictEqual(typeof report.whetherAiSendGateBlocked, "boolean");
    assert.ok(Array.isArray(report.matchedKnownLimits));
    assert.ok(Array.isArray(report.suggestedActions));
  });
  await t.test("AI Send Gate schema fields validation", async () => {
    const job = await service.previewAiPayload({ operation: "summarize", content: "This is an API preview content", sourceRef: "manual" });
    const preview = job.output;
    const requiredFields = [
      "decision",
      "reasons",
      "requiredActions",
      "optionalActions",
      "overrideAllowed",
      "overrideReasonRequired",
      "qualityScore",
      "knownLimitIds"
    ];
    for (const field of requiredFields) {
      assert.ok(preview[field] !== undefined, `Missing required field: ${field}`);
    }
    assert.ok(["allow", "review_required", "block"].includes(preview.decision));
    assert.ok(Array.isArray(preview.reasons));
    assert.ok(Array.isArray(preview.requiredActions));
    assert.strictEqual(typeof preview.overrideAllowed, "boolean");
    assert.strictEqual(typeof preview.overrideReasonRequired, "boolean");
    assert.strictEqual(typeof preview.qualityScore, "number");
    assert.ok(Array.isArray(preview.knownLimitIds));
  });
  await t.test("AI context route contract exposes local selection evidence", async () => {
    const manifest = await service.getDocumentCapabilityManifest();
    const chunkRoute = manifest.api_contract.routes.find((route) => route.path === "/api/ai/context-chunk");
    const rangeRoute = manifest.api_contract.routes.find((route) => route.path === "/api/ai/context-range");
    const intakeRoute = manifest.api_contract.routes.find((route) => route.path === "/api/ai/intake-plan");
    const runbookRoute = manifest.api_contract.routes.find((route) => route.path === "/api/ai/feed-runbook");
    const runbookStatusRoute = manifest.api_contract.routes.find((route) => route.path === "/api/ai/feed-runbook/status");
    const runbookBatchRoute = manifest.api_contract.routes.find((route) => route.path === "/api/ai/feed-runbook/batch");
    const queryRoute = manifest.api_contract.routes.find((route) => route.path === "/api/ai/query-context");
    const queryHandoffRoute = manifest.api_contract.routes.find((route) => route.path === "/api/ai/query-handoff");
    const workspaceManifestRoute = manifest.api_contract.routes.find((route) => route.path === "/api/workspace/manifest");
    const pluralPackageRoute = manifest.api_contract.routes.find((route) => route.path === "/api/exchange-packages");
    const pluralPackageExplainRoute = manifest.api_contract.routes.find((route) => route.path === "/api/exchange-packages/explain");
    const pluralPackageVerifyRoute = manifest.api_contract.routes.find((route) => route.path === "/api/exchange-packages/verify");
    const pluralPackageFromRecordRoute = manifest.api_contract.routes.find((route) => route.path === "/api/exchange-packages/from-record");
    assert.ok(intakeRoute);
    assert.ok(runbookRoute);
    assert.ok(runbookStatusRoute);
    assert.ok(runbookBatchRoute);
    assert.ok(chunkRoute);
    assert.ok(rangeRoute);
    assert.ok(queryRoute);
    assert.ok(queryHandoffRoute);
    assert.ok(workspaceManifestRoute);
    assert.ok(pluralPackageRoute);
    assert.ok(pluralPackageExplainRoute);
    assert.ok(pluralPackageVerifyRoute);
    assert.ok(pluralPackageFromRecordRoute);
    assert.match(workspaceManifestRoute.intent, /handoff summary/);
    assert.match(workspaceManifestRoute.intent, /AI context selection summaries/);
    assert.match(workspaceManifestRoute.intent, /AI handoff bundle summaries/);
    assert.match(workspaceManifestRoute.intent, /safe selection ranges/);
    assert.match(workspaceManifestRoute.intent, /continuation metadata/);
    assert.match(intakeRoute.intent, /continuation commands/);
    assert.match(intakeRoute.intent, /feeding plan metadata/);
    assert.match(intakeRoute.intent, /batch plan preview metadata/);
    assert.match(intakeRoute.intent, /structured continuation metadata/);
    assert.match(intakeRoute.intent, /progress metadata/);
    assert.match(intakeRoute.intent, /safety flags/);
    assert.match(runbookRoute.intent, /body-free AI feed runbook/);
    assert.match(runbookRoute.intent, /every planned range batch/);
    assert.match(runbookRoute.intent, /Send Gate requirements/);
    assert.match(runbookStatusRoute.intent, /body-free AI feed runbook status/);
    assert.match(runbookBatchRoute.intent, /Update one AI feed runbook batch status/);
    assert.match(runbookBatchRoute.intent, /body-free Markdown and JSON/);
    assert.match(chunkRoute.intent, /structured continuation metadata/);
    assert.match(chunkRoute.intent, /progress metadata/);
    assert.match(chunkRoute.intent, /local selection evidence/);
    assert.match(rangeRoute.intent, /continuation commands/);
    assert.match(rangeRoute.intent, /structured continuation metadata/);
    assert.match(rangeRoute.intent, /progress metadata/);
    assert.match(rangeRoute.intent, /local selection evidence/);
    assert.match(queryRoute.intent, /local selection evidence/);
    assert.match(queryHandoffRoute.intent, /AI Handoff Bundle/);
    assert.match(pluralPackageRoute.intent, /public plural route alias/);
    assert.match(pluralPackageExplainRoute.intent, /recommended actions/);
    assert.match(pluralPackageVerifyRoute.intent, /AI consumption readiness/);
    assert.match(pluralPackageFromRecordRoute.intent, /public plural route alias/);
  });
  await t.test("Exchange Package schema fields validation", async () => {
    const pkgDir = "packages/contract-package";
    const pkg = await service.saveExchangePackage(pkgDir, {
      title: "Contract Exchange",
      body: "Testing body schema compliance",
      source: "contract-test",
      exportFormats: ["docx"]
    });
    const readBack = await service.readExchangePackage(pkgDir);
    const m = readBack.manifest;
    const requiredFields = [
      "packageVersion",
      "packageType",
      "title",
      "canonicalDocument",
      "documentSchema",
      "createdAt",
      "includes"
    ];
    for (const field of requiredFields) {
      assert.ok(m[field] !== undefined, `Missing required field: ${field}`);
    }
    assert.strictEqual(m.packageType, "markdown.exchange");
    assert.strictEqual(typeof m.canonicalDocument.path, "string");
    assert.strictEqual(typeof m.canonicalDocument.hash, "string");
    assert.strictEqual(typeof m.includes.document, "boolean");
    assert.strictEqual(typeof m.includes.evidence, "boolean");
    assert.strictEqual(typeof m.includes.audit, "boolean");
  });
  await t.test("Feedback Bundle schema fields validation", async () => {
    const bundle = await service.generateFeedbackBundle(null, true);
    const summaryJson = JSON.parse(await readFile(path.join(bundle.bundlePath, "summary.json"), "utf8"));
    const requiredFields = [
      "generatedAt",
      "appVersion",
      "systemInfo",
      "settings",
      "documents",
      "datasets",
      "timeline"
    ];
    for (const field of requiredFields) {
      assert.ok(summaryJson[field] !== undefined, `Missing required field: ${field}`);
    }
    assert.strictEqual(typeof summaryJson.systemInfo.platform, "string");
    assert.strictEqual(typeof summaryJson.systemInfo.arch, "string");
    assert.ok(Array.isArray(summaryJson.documents));
    assert.ok(Array.isArray(summaryJson.datasets));
    assert.ok(Array.isArray(summaryJson.timeline));
  });
});
import { readFile } from "node:fs/promises";