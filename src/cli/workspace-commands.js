import path from "node:path";
import { writeFile } from "node:fs/promises";
import { openOrCreateWorkspace } from "../core/manifest.js";
import { createAppService } from "../core/appService.js";

export async function handleWorkspaceCommand({ command, workspace, rest, printJson }) {
  if (command === "workspace") {
    let workspacePath = workspace;
    let subcommand = rest[0];
    if (workspace.endsWith(`${path.sep}inspect`) || workspace.endsWith(`${path.sep}summary`) || workspace.endsWith(`${path.sep}export-manifest`)) {
      subcommand = path.basename(workspace);
      workspacePath = ".";
    }

    if (!subcommand) {
      throw new Error("workspace requires a subcommand: inspect, summary, or export-manifest.");
    }

    const resolvedWorkspace = path.resolve(workspacePath);
    await openOrCreateWorkspace(resolvedWorkspace);
    const service = createAppService(resolvedWorkspace);
    const summaryData = await service.compileWorkspaceManifest();

    if (subcommand === "inspect") {
      printJson(summaryData);
      return true;
    }

    if (subcommand === "summary") {
      let output = `Workspace Summary:\n`;
      output += `==================\n`;
      output += `Workspace ID: ${summaryData.workspaceId}\n`;
      output += `Created At:   ${summaryData.createdAt}\n`;
      output += `Updated At:   ${summaryData.updatedAt}\n\n`;

      output += `Source Files (${summaryData.sourceFiles.length}):\n`;
      for (const f of summaryData.sourceFiles) {
        output += `  - ${f}\n`;
      }
      output += `\n`;

      output += `Markdown Documents (${summaryData.markdownDocuments.length}):\n`;
      for (const d of summaryData.markdownDocuments) {
        output += `  - ${d.relativePath} (${d.status}, extracted: ${d.lastExtractedAt || "N/A"})\n`;
      }
      output += `\n`;

      output += `Exchange Packages (${summaryData.exchangePackages.length}):\n`;
      for (const p of summaryData.exchangePackages) {
        output += `  - ${p.name} (v${p.packageVersion || "0.1.1"}, created: ${p.createdAt})\n`;
        output += `    receiver-report: ${p.receiverReport?.exists ? "yes" : "no"}, trust-report: ${p.trustReport?.exists ? "yes" : "no"}\n`;
      }
      output += `\n`;

      output += `Recent AI Send Gate Decisions (${summaryData.aiSendGateDecisions.length}):\n`;
      for (const d of summaryData.aiSendGateDecisions) {
        output += `  - [${d.type}] ${d.decision} (signals: ${(d.signals || []).join(", ") || "none"}, at: ${d.createdAt})\n`;
      }
      output += `\n`;

      output += `Recent AI Context Selections (${summaryData.aiContextSelections?.length ?? 0}):\n`;
      for (const selection of summaryData.aiContextSelections ?? []) {
        const range = selection.selectionRange
          ? (selection.selectionRange.kind === "range"
              ? `chunks ${selection.selectionRange.startChunkIndex}-${selection.selectionRange.endChunkIndex}/${selection.selectionRange.totalChunkCount || "?"}`
              : `chunk ${selection.selectionRange.chunkIndex || selection.selectionRange.startChunkIndex}/${selection.selectionRange.totalChunkCount || "?"}`)
          : "range unknown";
        const continuation = selection.continuation
          ? `remaining ${selection.continuation.remainingChunks || 0} chunks / ${selection.continuation.remainingRangeCount || 0} batches`
          : "continuation unknown";
        const queryShape = selection.queryShape
          ? `, query tables ${selection.queryShape.tableCount || 0}, join ${selection.queryShape.hasJoin ? "yes" : "no"}`
          : "";
        output += `  - [${selection.type}] ${selection.outputType || "context"} from ${selection.sourceRef || "unknown"} (${range}, ${continuation}${queryShape}, tokens~${selection.estimatedTokens || 0}, sent: ${selection.aiSent ? "yes" : "no"}, at: ${selection.createdAt})\n`;
      }
      output += `\n`;

      output += `Recent AI Handoff Bundles (${summaryData.aiHandoffBundles?.length ?? 0}):\n`;
      for (const bundle of summaryData.aiHandoffBundles ?? []) {
        output += `  - ${bundle.relativePath || "unknown path"} from ${bundle.recordId || "staged-context"} (evidence: ${bundle.evidenceId || "none"}, at: ${bundle.createdAt})\n`;
      }
      output += `\n`;

      output += `Recent Refreshes (${summaryData.refreshHistory.length}):\n`;
      for (const h of summaryData.refreshHistory) {
        output += `  - [${h.type}] ${h.summary} (at: ${h.timestamp})\n`;
      }

      console.log(output);
      return true;
    }

    if (subcommand === "export-manifest") {
      const outPath = path.join(resolvedWorkspace, "workspace-manifest.json");
      await writeFile(outPath, JSON.stringify(summaryData, null, 2), "utf8");
      printJson({ ok: true, exportedPath: outPath });
      return true;
    }

    throw new Error(`Unknown workspace subcommand: ${subcommand}`);
  }

  if (command === "inbox") {
    const [subcommand, ...subArgs] = rest;
    const service = createAppService(workspace);
    await openOrCreateWorkspace(workspace);
    if (!subcommand || subcommand === "list") {
      printJson(await service.getInbox());
      return true;
    }
    if (subcommand === "archive") {
      const [itemId] = subArgs;
      if (!itemId) {
        throw new Error("inbox archive requires <itemId>.");
      }
      printJson(await service.archiveInbox(itemId));
      return true;
    }
    if (subcommand === "unarchive") {
      const [itemId] = subArgs;
      if (!itemId) {
        throw new Error("inbox unarchive requires <itemId>.");
      }
      printJson(await service.unarchiveInbox(itemId));
      return true;
    }
    if (subcommand === "recommendations" || subcommand === "rec") {
      const [itemId] = subArgs;
      if (!itemId) {
        throw new Error("inbox recommendations requires <itemId>.");
      }
      printJson(await service.getInboxRecommendations(itemId));
      return true;
    }
    throw new Error(`Unknown inbox subcommand: ${subcommand}`);
  }

  if (command === "timeline") {
    const [recordId] = rest;
    const service = createAppService(workspace);
    await openOrCreateWorkspace(workspace);
    printJson(await service.getTimeline(recordId || null));
    return true;
  }

  if (command === "versions") {
    const [subcommand, ...subArgs] = rest;
    const service = createAppService(workspace);
    await openOrCreateWorkspace(workspace);
    if (!subcommand) {
      throw new Error("versions requires <relativePath> or a subcommand: list, all, promote, diff. Example: versions list outputs/document.md");
    }
    if (subcommand === "all") {
      printJson(await service.listMarkdownVersions());
      return true;
    }
    if (subcommand === "list" || !["promote", "diff"].includes(subcommand)) {
      const [relativePath] = subcommand === "list" ? subArgs : [subcommand];
      if (!relativePath) {
        throw new Error("versions list requires <relativePath>. Please enter the Markdown file path, for example: versions list outputs/document.md");
      }
      printJson(await service.listMarkdownVersions(relativePath));
      return true;
    }
    if (subcommand === "promote") {
      const [relativePath, versionId] = subArgs;
      if (!relativePath || !versionId) {
        throw new Error("versions promote requires <relativePath> and <versionId>.");
      }
      printJson(await service.promoteMarkdownVersion(relativePath, versionId));
      return true;
    }
    if (subcommand === "diff") {
      const [pathA, pathB] = subArgs;
      if (!pathA || !pathB) {
        throw new Error("versions diff requires <pathA> and <pathB>.");
      }
      printJson(await service.diffMarkdownVersions(pathA, pathB));
      return true;
    }
    throw new Error(`Unknown versions subcommand: ${subcommand}`);
  }

  if (command === "settings") {
    const [subcommand, ...subArgs] = rest;
    const service = createAppService(workspace);
    await openOrCreateWorkspace(workspace);
    if (!subcommand || subcommand === "get") {
      printJson(await service.getWorkspaceSettings());
      return true;
    }
    if (subcommand === "set") {
      const [key, value] = subArgs;
      if (!key || value === undefined) {
        throw new Error("settings set requires <key> and <value>.");
      }
      printJson(await service.updateWorkspaceSettings(key, value));
      return true;
    }
    throw new Error(`Unknown settings subcommand: ${subcommand}`);
  }

  if (command === "real-sample-check") {
    const service = createAppService(workspace);
    await openOrCreateWorkspace(workspace);
    const summary = await service.getRealSampleSummary();
    if (rest.includes("--report-only")) {
      printJson(summary);
      return true;
    }
    const report = await service.writeRealSampleReportMd();
    printJson({
      summary,
      reportPath: report.reportPath,
      report
    });
    return true;
  }

  return false;
}
