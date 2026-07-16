import path from "node:path";
import { existsSync } from "node:fs";
import { openOrCreateWorkspace, readManifest } from "../core/manifest.js";
import { queryResultToExport } from "../core/exporters.js";
import { createAppService } from "../core/appService.js";
import { toErrorRecord } from "../core/errors.js";
import { handleRecordManagementCommand } from "./record-management-commands.js";
import { handleWorkspaceCommand } from "./workspace-commands.js";

const DOCUMENT_CONVERT_COMMANDS = new Set(["convert-text", "convert-docx", "convert-pdf"]);
const EXCHANGE_PACKAGE_READ_SUBCOMMANDS = new Set([
  "verify",
  "inspect",
  "explain",
  "trust-report",
  "receiver-report"
]);

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function withoutFlags(args, flags) {
  return args.filter((arg) => !flags.includes(arg));
}

function optionValue(args, flag, fallback = null) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function requireArg(value, message) {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function resolveImportSourcePath(workspace, sourceFile) {
  if (path.isAbsolute(sourceFile)) {
    return sourceFile;
  }

  const cwdRelativePath = path.resolve(sourceFile);
  if (existsSync(cwdRelativePath)) {
    return cwdRelativePath;
  }

  const workspaceRelativePath = path.resolve(workspace, sourceFile);
  const relativeToWorkspace = path.relative(workspace, workspaceRelativePath);
  if (!relativeToWorkspace.startsWith("..") && !path.isAbsolute(relativeToWorkspace)) {
    return workspaceRelativePath;
  }

  return cwdRelativePath;
}

function parseListFlag(args, prefix, { remove = false } = {}) {
  const index = args.findIndex((arg) => arg.startsWith(prefix));
  if (index === -1) {
    return undefined;
  }
  const flag = remove ? args.splice(index, 1)[0] : args[index];
  return flag
    .slice(prefix.length)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function printMaybeSummary(summary, data, summaryPrinter) {
  if (summary) {
    summaryPrinter(data);
  } else {
    printJson(data);
  }
}

function printAiContextSummary(kind, data) {
  const plan = data.aiIntakePlan ?? {};
  const lines = [
    `AI context ${kind}`,
    `record: ${data.recordIdOrPackagePath}`,
    `mode: ${plan.mode ?? data.recommendedSendStrategy ?? "unknown"}`,
    `sendGate: ${data.sendGateDecision ?? "unknown"}`
  ];
  if (kind === "plan") {
    lines.push(`chunks: ${Number(plan.chunkCount ?? 0)} | preview: ${Number(plan.previewChunkCount ?? 0)} | truncated: ${Boolean(plan.truncated)}`);
    lines.push(`tokens: ${Number(data.tokenEstimate ?? plan.tokenEstimate ?? 0)} | rangeBudget: ${Number(plan.defaultRangeTokenBudget ?? 0)} | estimatedBatches: ${Number(plan.estimatedRangeCount ?? 0)}`);
    if (plan.feedingPlan) {
      lines.push(`feeding: ${plan.feedingPlan.mode} | priority: ${plan.feedingPlan.priority} | continuousLoop: ${plan.feedingPlan.suitableForContinuousAgentLoop ? "yes" : "no"}`);
    }
    if (data.batchPlanPreview) {
      lines.push(`batchPreview: ${Number(data.batchPlanPreview.previewBatchCount ?? 0)}/${Number(data.batchPlanPreview.totalBatchCount ?? 0)} | omitted: ${Number(data.batchPlanPreview.omittedBatchCount ?? 0)}`);
    }
    if (data.continuation) {
      lines.push(`continuation: ${data.continuation.canContinue ? "ready" : "complete"} | remainingBatches: ${Number(data.continuation.remainingRangeCount ?? 0)}`);
    }
    lines.push(`nextChunk: ${data.nextChunkCommand || ""}`);
    lines.push(`nextRange: ${data.nextRangeCommand || ""}`);
  } else {
    lines.push(`tokens: ${Number(data.tokenEstimate ?? 0)}${data.tokenBudget ? `/${Number(data.tokenBudget)}` : ""}`);
    if (data.progress) {
      lines.push(`progress: ${data.progress.completedChunks}/${data.totalChunkCount} chunks (${data.progress.percentComplete}%)`);
    }
    if (data.continuation) {
      lines.push(`continuation: ${data.continuation.canContinue ? "ready" : "complete"} | remainingBatches: ${Number(data.continuation.remainingRangeCount ?? 0)}`);
    }
    lines.push(`evidence: ${data.evidenceId || ""}`);
    lines.push(`nextChunk: ${data.nextChunkCommand || ""}`);
    lines.push(`nextRange: ${data.nextRangeCommand || ""}`);
  }
  console.log(lines.join("\n"));
}

function printAiFeedRunbookSummary(data) {
  console.log([
    "AI feed runbook",
    `record: ${data.recordIdOrPackagePath}`,
    `mode: ${data.feedingPlan?.mode || "unknown"} | priority: ${data.feedingPlan?.priority || "unknown"}`,
    `batches: ${Number(data.totalBatchCount || 0)} | chunks: ${Number(data.totalChunkCount || 0)} | tokenBudget: ${Number(data.tokenBudget || 0)}`,
    `status: completed ${Number(data.statusSummary?.completedBatches || 0)} | blocked ${Number(data.statusSummary?.blockedBatches || 0)} | next ${data.statusSummary?.nextPlannedBatchIndex ?? "none"}`,
    `sendGate: ${data.sendGateDecision || "unknown"} | bodyFree: ${data.bodyFree ? "yes" : "no"}`,
    `markdown: ${data.markdownRelativePath}`,
    `json: ${data.jsonRelativePath}`,
    `nextRange: ${data.continuation?.nextRangeCommand || ""}`
  ].join("\n"));
}

function printAiHandoffBundleSummary(data) {
  console.log([
    "AI handoff bundle",
    `path: ${data.relativePath}`,
    `record: ${data.recordIdOrPackagePath || "staged-context"}`,
    `evidence: ${data.evidenceId || ""}`,
    `tokens: ${Number(data.tokenEstimate || 0)}`,
    `range: ${data.selectionRange ? `${data.selectionRange.startChunkIndex}-${data.selectionRange.endChunkIndex}` : (data.chunkIndex || "staged")}`
  ].join("\n"));
}

function usage() {
  console.log(`Usage: node src/cli/index.js <command> [...]
Commands:
  init <workspace>
  manifest <workspace>
  formats <workspace>
  adapter-capabilities <workspace>
  capability <workspace>
  note <workspace> <relative-md-path> <content>
  import <workspace> <source-file>
  inspect-csv <workspace> <dataset-id>
  inspect-xlsx <workspace> <dataset-id>
  convert-text|convert-docx|convert-pdf <workspace> <document-id>
  convert-all <workspace>
  document-to <workspace> <document-id> <md|docx|pdf> <relative-output-path>
  md-to-docx|md-to-pdf <workspace> <relative-md-path> <relative-output-path>
  tables <workspace>
  query <workspace> <sql>
  query-export <workspace> <markdown|csv> <sql>
  query-ai-context <workspace> <sql>
  query-ai-handoff <workspace> <relative-output-path> <sql> [--summary]
  prepare-ai <workspace> <record-id>
  ai-context <workspace> preview <record-id-or-package-path>
  ai-context <workspace> plan <record-id-or-package-path> [--summary]
  ai-context <workspace> chunk <record-id-or-package-path> [chunkIndex] [--summary]
  ai-context <workspace> range <record-id-or-package-path> <startChunkIndex> <endChunkIndex> [tokenBudget] [--summary]
  ai-context <workspace> runbook <record-id-or-package-path> [tokenBudget] [--summary]
  ai-context <workspace> runbook-status <json-relative-path> [--summary]
  ai-context <workspace> runbook-batch <json-relative-path> <batchIndex> <status> [note] [--summary]
  ai-context <workspace> handoff <record-id-or-package-path> [relative-output-path] [chunkIndex] [--range=start:end] [--budget=9000] [--summary]
  ai-preview <workspace> <operation> [--mask] <content>
  ai-result-writeback <workspace> <relative-output-path> <ai-result> [context-body]
  profile-list|profile-save|profile-delete <workspace> [...]
  audit-list|audit-delete <workspace> [...]
  conversion-list|conversion-delete <workspace> [...]
  evidence-list|evidence-get|evidence-delete <workspace> [...]
  exchange <workspace> <relative-md-path> <title> <body>
  exchange-package <workspace> <relative-package-dir> <title> [--exports=docx,pdf] <body>
  exchange-package <workspace> from-record|receiver-report|verify|inspect|explain|trust-report ...
  exchange-package <workspace> <relative-package-dir> verify|inspect|explain|trust-report|receiver-report
  exchange-package-read <workspace> <relative-package-dir>
  search <workspace> <keyword>
  refresh-source <workspace> [preview] <record-id>
  refresh-all <workspace> [--check-only|--write]
  records|list-records <workspace> [--status]
  inbox|timeline|settings|real-sample-check <workspace> [...]
  versions <workspace> <relativePath>
  versions <workspace> list [relativePath]
  versions <workspace> promote|diff [...]
  mask <workspace> <content>
  unmask <workspace> <maskedText> <mappingJson>
`);
}

async function main(argv) {
  const [command, rawWorkspaceArg, ...rawRest] = argv;

  if (!command || command === "help" || command === "--help") {
    usage();
    return;
  }

  const defaultWorkspaceCommands = new Set([
    "feedback-bundle",
    "secrets-audit",
    "known-limits",
    "repro",
    "repro-script"
  ]);
  const shouldDefaultWorkspace = defaultWorkspaceCommands.has(command)
    && (!rawWorkspaceArg || rawWorkspaceArg.startsWith("--"));
  const workspaceArg = shouldDefaultWorkspace ? "." : (rawWorkspaceArg ?? "");
  const rest = shouldDefaultWorkspace ? argv.slice(1) : rawRest;

  if (!workspaceArg) {
    throw new Error("Workspace path is required.");
  }

  const workspace = path.resolve(workspaceArg);
  const service = createAppService(workspace);

  if (command === "init") {
    printJson(await openOrCreateWorkspace(workspace));
    return;
  }

  if (command === "manifest") {
    printJson(await readManifest(workspace));
    return;
  }

  if (command === "formats") {
    printJson(service.listDocumentExchangeCapabilities());
    return;
  }

  if (command === "mask") {
    const content = rest.join(" ");
    if (!content) {
      throw new Error("Text content is required for masking.");
    }
    const result = service.maskSensitiveData(content);
    printJson(result);
    return;
  }

  if (command === "unmask") {
    const [maskedText, mappingJson] = rest;
    if (!maskedText || !mappingJson) {
      throw new Error("Masked text and mapping JSON are required for unmasking.");
    }
    let mapping;
    try {
      mapping = JSON.parse(mappingJson);
    } catch {
      throw new Error("Mapping argument must be a valid JSON string.");
    }
    const result = service.unmaskSensitiveData(maskedText, mapping);
    printJson({ unmaskedText: result });
    return;
  }

  if (command === "adapter-capabilities") {
    printJson(await service.detectAdapterCapabilities());
    return;
  }

  if (command === "capability") {
    printJson(service.getDocumentCapabilityManifest());
    return;
  }

  if (command === "note") {
    const [relativePath, ...contentParts] = rest;
    if (!relativePath || contentParts.length === 0) {
      throw new Error("note requires <relative-md-path> and <content>.");
    }
    await openOrCreateWorkspace(workspace);
    const savedPath = await service.saveMarkdown(relativePath, contentParts.join(" "));
    printJson({ savedPath });
    return;
  }

  if (command === "import") {
    const [sourceFile] = rest;
    if (!sourceFile) {
      throw new Error("import requires <source-file>.");
    }
    await openOrCreateWorkspace(workspace);
    printJson(await service.importFile(resolveImportSourcePath(workspace, sourceFile)));
    return;
  }

  if (command === "inspect-csv") {
    const [datasetId] = rest;
    if (!datasetId) {
      throw new Error("inspect-csv requires <dataset-id>.");
    }
    printJson(await service.inspectDataset(datasetId));
    return;
  }

  if (command === "inspect-xlsx") {
    const [datasetId] = rest;
    if (!datasetId) {
      throw new Error("inspect-xlsx requires <dataset-id>.");
    }
    printJson(await service.inspectDataset(datasetId));
    return;
  }

  if (DOCUMENT_CONVERT_COMMANDS.has(command)) {
    const [documentId] = rest;
    if (!documentId) {
      throw new Error(`${command} requires <document-id>.`);
    }
    printJson(await service.convertDocument(documentId));
    return;
  }

  if (command === "convert-all") {
    printJson(await service.convertAllDocuments());
    return;
  }

  if (command === "document-to") {
    const [documentId, format, outputPath] = rest;
    if (!documentId || !format || !outputPath) {
      throw new Error("document-to requires <document-id> <md|docx|pdf> <relative-output-path>.");
    }
    printJson(await service.convertDocumentToFormat(documentId, outputPath, format));
    return;
  }

  if (command === "md-to-docx" || command === "md-to-pdf") {
    const [markdownPath, outputPath] = rest;
    if (!markdownPath || !outputPath) {
      throw new Error(`${command} requires <relative-md-path> and <relative-output-path>.`);
    }
    const format = command === "md-to-docx" ? "docx" : "pdf";
    printJson({
      savedPath: await service.exportMarkdownDocument(markdownPath, outputPath, format)
    });
    return;
  }

  if (command === "tables") {
    printJson(await service.listTables());
    return;
  }

  if (command === "query") {
    const sql = rest.join(" ");
    if (!sql) {
      throw new Error("query requires <sql>.");
    }
    printJson(await service.runQuery(sql));
    return;
  }

  if (command === "query-export") {
    const [format, ...sqlParts] = rest;
    const sql = sqlParts.join(" ");
    if (!format || !sql) {
      throw new Error("query-export requires <markdown|csv> and <sql>.");
    }
    const job = await service.runQuery(sql);
    if (job.status !== "succeeded") {
      printJson(job);
      process.exitCode = 1;
      return;
    }
    console.log(queryResultToExport(job.output, format));
    return;
  }

  if (command === "query-ai-context") {
    const sql = rest.join(" ");
    if (!sql) {
      throw new Error("query-ai-context requires <sql>.");
    }
    printJson(await service.prepareQueryForAi(sql));
    return;
  }

  if (command === "query-ai-handoff") {
    const summary = hasFlag(rest, "--summary");
    const cleanArgs = withoutFlags(rest, ["--summary"]);
    const [relativePath, ...sqlParts] = cleanArgs;
    const sql = sqlParts.join(" ");
    if (!relativePath || !sql) {
      throw new Error("query-ai-handoff requires <relative-output-path> <sql>.");
    }
    await openOrCreateWorkspace(workspace);
    const { queryContext, handoffBundle } = await service.saveQueryAiHandoffBundle(relativePath, sql, {
      input: { source: "cli-query-ai-handoff" }
    });
    if (summary) {
      printAiHandoffBundleSummary(handoffBundle);
    } else {
      printJson({ queryContext, handoffBundle });
    }
    return;
  }

  if (command === "prepare-ai") {
    const [recordId] = rest;
    if (!recordId) {
      throw new Error("prepare-ai requires <record-id>.");
    }
    await openOrCreateWorkspace(workspace);
    printJson(await service.prepareRecordForAi(recordId));
    return;
  }

  if (command === "ai-preview") {
    const [operation, ...contentParts] = rest;
    if (!operation || contentParts.length === 0) {
      throw new Error("ai-preview requires <operation> and <content>.");
    }
    const maskFlagIndex = contentParts.indexOf("--mask");
    let maskEnabled = false;
    if (maskFlagIndex !== -1) {
      contentParts.splice(maskFlagIndex, 1);
      maskEnabled = true;
    }
    if (contentParts.length === 0) {
      throw new Error("ai-preview requires <content> after optional flags.");
    }
    await openOrCreateWorkspace(workspace);
    let content = contentParts.join(" ");
    let mapping = null;
    if (maskEnabled) {
      const maskResult = service.maskSensitiveData(content);
      content = maskResult.maskedText;
      mapping = maskResult.mapping;
    }
    const previewResult = await service.previewAiPayload({
      operation,
      content,
      model: "not-configured",
      apiBaseUrl: "not-configured",
      sourceRef: "cli"
    });
    if (maskEnabled) {
      previewResult.maskMapping = mapping;
    }
    printJson(previewResult);
    return;
  }

  if (await handleRecordManagementCommand({ command, workspace, rest, printJson })) {
    return;
  }

  if (command === "exchange") {
    const [relativePath, title, ...bodyParts] = rest;
    if (!relativePath || !title || bodyParts.length === 0) {
      throw new Error("exchange requires <relative-md-path> <title> and <body>.");
    }
    await openOrCreateWorkspace(workspace);
    const savedPath = await service.saveExchangeMarkdown(relativePath, {
      title,
      body: bodyParts.join(" "),
      source: "cli"
    });
    printJson({ savedPath });
    return;
  }

  if (command === "ai-result-writeback") {
    const [relativePath, aiResult, ...bodyParts] = rest;
    if (!relativePath || !aiResult) {
      throw new Error("ai-result-writeback requires <relative-output-path> <ai-result> [context-body].");
    }
    await openOrCreateWorkspace(workspace);
    printJson(await service.writeBackAiResult(relativePath, {
      title: "AI Result Write-back",
      source: "cli-ai-result-writeback",
      aiResult,
      body: bodyParts.join(" ")
    }));
    return;
  }

  if (command === "exchange-package") {
    const [subcommand, ...subArgs] = rest;
    const pathFirstReadSubcommand = EXCHANGE_PACKAGE_READ_SUBCOMMANDS.has(rest[1]) ? rest[1] : "";
    const readSubcommand = EXCHANGE_PACKAGE_READ_SUBCOMMANDS.has(subcommand)
      ? subcommand
      : pathFirstReadSubcommand;
    const readPackagePath = readSubcommand === subcommand ? subArgs[0] : rest[0];

    if (readSubcommand === "verify") {
      const packagePath = requireArg(readPackagePath, "exchange-package verify requires <packagePath>.");
      printJson(await service.verifyExchangePackage(packagePath));
      return;
    }
    if (readSubcommand === "inspect") {
      const packagePath = requireArg(readPackagePath, "exchange-package inspect requires <packagePath>.");
      const pkg = await service.readExchangePackage(packagePath);
      printJson(pkg.manifest);
      return;
    }
    if (readSubcommand === "explain") {
      const packagePath = requireArg(readPackagePath, "exchange-package explain requires <packagePath>.");
      printJson(await service.explainExchangePackage(packagePath));
      return;
    }
    if (readSubcommand === "trust-report") {
      const packagePath = requireArg(readPackagePath, "exchange-package trust-report requires <packagePath>.");
      printJson(await service.generateTrustReport(packagePath));
      return;
    }
    if (readSubcommand === "receiver-report") {
      const packagePath = requireArg(readPackagePath, "exchange-package receiver-report requires <packagePath>.");
      printJson(await service.writeExchangePackageReceiverReport(packagePath));
      return;
    }
    if (subcommand === "from-record") {
      const [packagePath, recordId, ...optionParts] = subArgs;
      if (!packagePath || !recordId) {
        throw new Error("exchange-package from-record requires <relative-package-dir> <record-id>.");
      }
      const exportFormats = parseListFlag(optionParts, "--exports=");
      await openOrCreateWorkspace(workspace);
      printJson(await service.saveExchangePackageFromRecord(recordId, packagePath, {
        source: "cli",
        ...(exportFormats ? { exportFormats } : {})
      }));
      return;
    }

    const [relativePath, title, ...bodyParts] = rest;
    if (!relativePath || !title || bodyParts.length === 0) {
      throw new Error("exchange-package requires <relative-package-dir> <title> and <body> (or verify/inspect/explain/trust-report/receiver-report before or after <relative-package-dir>).");
    }
    const exportFormats = parseListFlag(bodyParts, "--exports=", { remove: true }) ?? ["docx", "pdf"];
    if (bodyParts.length === 0) {
      throw new Error("exchange-package requires <body> after optional flags.");
    }
    await openOrCreateWorkspace(workspace);
    printJson(await service.saveExchangePackage(relativePath, {
      title,
      body: bodyParts.join(" "),
      source: "cli",
      exportFormats
    }));
    return;
  }

  if (command === "search") {
    const [keyword] = rest;
    if (!keyword) {
      throw new Error("search requires <keyword>.");
    }
    printJson(await service.searchWorkspace(keyword));
    return;
  }

  if (command === "exchange-package-read") {
    const [relativePath] = rest;
    if (!relativePath) {
      throw new Error("exchange-package-read requires <relative-package-dir>.");
    }
    printJson(await service.readExchangePackage(relativePath));
    return;
  }

  if (command === "refresh-source") {
    const [first, second] = rest;
    if (first === "preview") {
      if (!second) {
        throw new Error("refresh-source preview requires <record-id>.");
      }
      printJson(await service.previewRecordRefresh(second));
      return;
    }
    if (!first) {
      throw new Error("refresh-source requires <record-id>.");
    }
    printJson(await service.refreshRecord(first));
    return;
  }

  if (command === "refresh-all") {
    const checkOnly = rest.includes("--check-only");
    const write = rest.includes("--write");
    printJson(await service.refreshAll({ write: write && !checkOnly }));
    return;
  }

  if (command === "records" || command === "list-records") {
    const isStatus = rest.includes("--status");

    if (isStatus) {
      printJson(await service.getRecordStatuses());
      return;
    }

    const manifest = await service.getManifest();
    const changes = await service.checkUpdates();
    const changedIds = new Set(changes.filter((c) => c.changed).map((c) => c.id));
    const missingIds = new Set(changes.filter((c) => c.missing).map((c) => c.id));

    const recordsList = [];
    for (const doc of manifest.documents ?? []) {
      recordsList.push({
        id: doc.id,
        kind: "document",
        title: doc.title,
        sourceType: doc.sourceType,
        originalSourcePath: doc.originalSourcePath || "local",
        importedCopyPath: doc.sourcePath,
        stale: changedIds.has(doc.id),
        missing: missingIds.has(doc.id),
        status: doc.status,
        lastExtractedAt: doc.lastExtractedAt
      });
    }
    for (const ds of manifest.datasets ?? []) {
      recordsList.push({
        id: ds.id,
        kind: "dataset",
        name: ds.name,
        sourceType: ds.sourceType,
        originalSourcePath: ds.originalSourcePath || "local",
        importedCopyPath: ds.sourcePath,
        stale: changedIds.has(ds.id),
        missing: missingIds.has(ds.id),
        status: ds.status
      });
    }
    printJson(recordsList);
    return;
  }

  if (await handleWorkspaceCommand({ command, workspace, rest, printJson })) {
    return;
  }

  if (command === "feedback-bundle") {
    await openOrCreateWorkspace(workspace);
    const redact = !rest.includes("--no-redact");
    const outDir = optionValue(rest, "--out");
    printJson(await service.generateFeedbackBundle(outDir, redact));
    return;
  }

  if (command === "repro-script" || command === "repro") {
    await openOrCreateWorkspace(workspace);
    const fromFeedbackBundle = optionValue(rest, "--from-feedback");
    const fixture = optionValue(rest, "--fixture");
    const outPath = optionValue(rest, "--out");
    const recordId = rest.find(arg => !arg.startsWith("--") && arg !== outPath && arg !== fromFeedbackBundle && arg !== fixture);
    printJson(await service.generateReproductionScript({ recordId, fromFeedbackBundle, fixture }, outPath));
    return;
  }

  if (command === "secrets-audit") {
    await openOrCreateWorkspace(workspace);
    printJson(await service.runSecuritySecretsAudit());
    return;
  }

  if (command === "known-limits") {
    const format = optionValue(rest, "--format", undefined);
    const area = optionValue(rest, "--area", undefined);
    printJson(await service.getKnownLimits({ format, area }));
    return;
  }

  if (command === "ai-context") {
    const [subcommand, ...subArgs] = rest;
    const summary = hasFlag(subArgs, "--summary");
    const cleanSubArgs = withoutFlags(subArgs, ["--summary"]);
    if (subcommand === "preview") {
      const idOrPath = requireArg(cleanSubArgs[0], "ai-context preview requires <documentId/packagePath>.");
      await openOrCreateWorkspace(workspace);
      printJson(await service.compileAiContextPreview(idOrPath));
      return;
    }
    if (subcommand === "chunk") {
      const [idOrPath, chunkIndex = "1"] = cleanSubArgs;
      requireArg(idOrPath, "ai-context chunk requires <documentId/packagePath> [chunkIndex].");
      await openOrCreateWorkspace(workspace);
      const chunkData = await service.resolveAiContextChunk(idOrPath, Number(chunkIndex));
      printMaybeSummary(summary, chunkData, (data) => printAiContextSummary("chunk", data));
      return;
    }
    if (subcommand === "plan") {
      const idOrPath = requireArg(cleanSubArgs[0], "ai-context plan requires <documentId/packagePath>.");
      await openOrCreateWorkspace(workspace);
      const planData = await service.compileAiIntakeManifest(idOrPath);
      printMaybeSummary(summary, planData, (data) => printAiContextSummary("plan", data));
      return;
    }
    if (subcommand === "runbook") {
      const [idOrPath, tokenBudget] = cleanSubArgs;
      requireArg(idOrPath, "ai-context runbook requires <documentId/packagePath> [tokenBudget].");
      await openOrCreateWorkspace(workspace);
      const runbook = await service.compileAiFeedRunbook(idOrPath, tokenBudget ? { tokenBudget: Number(tokenBudget) } : {});
      printMaybeSummary(summary, runbook, printAiFeedRunbookSummary);
      return;
    }
    if (subcommand === "runbook-status") {
      const jsonRelativePath = requireArg(cleanSubArgs[0], "ai-context runbook-status requires <json-relative-path>.");
      await openOrCreateWorkspace(workspace);
      const runbook = await service.readAiFeedRunbook(jsonRelativePath);
      printMaybeSummary(summary, runbook, printAiFeedRunbookSummary);
      return;
    }
    if (subcommand === "runbook-batch") {
      const [jsonRelativePath, batchIndex, status, ...noteParts] = cleanSubArgs;
      if (!jsonRelativePath || !batchIndex || !status) {
        throw new Error("ai-context runbook-batch requires <json-relative-path> <batchIndex> <status> [note].");
      }
      await openOrCreateWorkspace(workspace);
      const runbook = await service.updateAiFeedRunbookBatch(jsonRelativePath, Number(batchIndex), status, noteParts.join(" "));
      printMaybeSummary(summary, runbook, printAiFeedRunbookSummary);
      return;
    }
    if (subcommand === "range") {
      const [idOrPath, startChunkIndex = "1", endChunkIndex = startChunkIndex, tokenBudget] = cleanSubArgs;
      requireArg(idOrPath, "ai-context range requires <documentId/packagePath> <startChunkIndex> <endChunkIndex> [tokenBudget].");
      await openOrCreateWorkspace(workspace);
      const rangeData = await service.resolveAiContextChunkRange(idOrPath, Number(startChunkIndex), Number(endChunkIndex), tokenBudget ? Number(tokenBudget) : undefined);
      printMaybeSummary(summary, rangeData, (data) => printAiContextSummary("range", data));
      return;
    }
    if (subcommand === "handoff") {
      const optionArgs = cleanSubArgs.filter((arg) => arg.startsWith("--"));
      const positionalArgs = cleanSubArgs.filter((arg) => !arg.startsWith("--"));
      const [idOrPath, relativePath, chunkIndex = "1"] = positionalArgs;
      requireArg(idOrPath, "ai-context handoff requires <documentId/packagePath> [relative-output-path] [chunkIndex].");
      const rangeFlag = optionArgs.find((arg) => arg.startsWith("--range="));
      const budgetFlag = optionArgs.find((arg) => arg.startsWith("--budget="));
      const rangeParts = rangeFlag
        ? rangeFlag.slice("--range=".length).split(":").map((part) => Number(part))
        : [];
      await openOrCreateWorkspace(workspace);
      const handoff = await service.saveAiHandoffBundle(relativePath, {
        recordIdOrPackagePath: idOrPath,
        source: "cli-ai-handoff-bundle",
        operation: "handoff",
        chunkIndex: Number(chunkIndex || 1),
        ...(rangeParts.length === 2 ? { startChunkIndex: rangeParts[0], endChunkIndex: rangeParts[1] } : {}),
        ...(budgetFlag ? { tokenBudget: Number(budgetFlag.slice("--budget=".length)) } : {})
      });
      printMaybeSummary(summary, handoff, printAiHandoffBundleSummary);
      return;
    }
    throw new Error(`Unknown ai-context subcommand: ${subcommand}`);
  }

  throw new Error(`Unknown command: ${command}`);

}

main(process.argv.slice(2)).catch((error) => {
  printJson({
    ok: false,
    error: toErrorRecord(error)
  });
  process.exitCode = 1;
});
