import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createSchemaDocsLocalClient } from "../sdk/localApiClient.js";
import { KATEX_WOFF2_FONT_FILES } from "../core/katexRuntimeAssets.js";

const root = path.resolve(import.meta.dirname, "../..");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const checkOnly = process.argv.includes("--check-only");
const appPath = path.resolve(argValue("--app", path.join(root, "src-tauri", "target", "release", "app.exe")));
const host = "127.0.0.1";
const startPort = Number(argValue("--start-port", process.env.SCHEMA_DOCS_DESKTOP_PORT ?? 4177));
const endPort = Number(argValue("--end-port", startPort + 22));
const timeoutMs = Number(argValue("--timeout-ms", 20000));
const fetchBlockedPorts = new Set([4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);

function inspectPackagedRuntime(executablePath) {
  const runtimeRoot = path.join(path.dirname(executablePath), "runtime");
  const requiredFiles = {
    node: path.join(runtimeRoot, "node.exe"),
    packageJson: path.join(runtimeRoot, "package.json"),
    launcher: path.join(runtimeRoot, "src", "cli", "desktop-runtime-launcher.js"),
    publicIndex: path.join(runtimeRoot, "public", "index.html"),
    markdownIt: path.join(runtimeRoot, "public", "libs", "markdown-it.min.js"),
    docx: path.join(runtimeRoot, "public", "libs", "docx.js"),
    katex: path.join(runtimeRoot, "public", "libs", "katex", "katex.min.js"),
    katexCss: path.join(runtimeRoot, "public", "libs", "katex", "katex.min.css"),
    ...Object.fromEntries(KATEX_WOFF2_FONT_FILES.map((fontName) => [
      `katexFont:${fontName}`,
      path.join(runtimeRoot, "public", "libs", "katex", "fonts", fontName)
    ]))
  };
  const missingFiles = Object.values(requiredFiles).filter((filePath) => !existsSync(filePath));
  return {
    ok: missingFiles.length === 0,
    runtimeRoot,
    requiredFiles,
    missingFiles
  };
}

const packagedRuntime = inspectPackagedRuntime(appPath);

function printAndExit(result) {
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

async function readJson(url) {
  const response = await fetch(url);
  const body = await response.json();
  return { status: response.status, ok: response.ok, body };
}

async function readHealth(baseUrl) {
  const health = await readJson(`${baseUrl}/api/health`);
  return { ...health, ok: health.ok && health.body?.ok === true && health.body?.data?.service === "schema-docs-local-api" };
}

async function discoverRuntime() {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  let lastProbe = null;
  while (Date.now() < deadline) {
    for (let port = startPort; port <= endPort; port += 1) {
      if (fetchBlockedPorts.has(port)) {
        continue;
      }
      const baseUrl = `http://${host}:${port}`;
      try {
        const health = await readHealth(baseUrl);
        lastProbe = { baseUrl, status: health.status, body: health.body };
        if (health.ok) return { ok: true, baseUrl, port, health };
      } catch (error) {
        lastError = error.message;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { ok: false, lastError, lastProbe };
}

async function stopProcessTree(pid) {
  if (!pid) return { attempted: false, method: "none" };

  if (process.platform === "win32") {
    return await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
      killer.once("exit", (code) => {
        const stillRunning = isProcessRunning(pid);
        resolve({ attempted: true, method: "taskkill", ok: code === 0 || !stillRunning, exitCode: code, stillRunning });
      });
      killer.once("error", (error) => {
        try {
          process.kill(pid);
        } catch {
          // Best effort cleanup. The app might already be closed by the user.
        }
        resolve({ attempted: true, method: "process.kill", ok: !isProcessRunning(pid), stillRunning: isProcessRunning(pid), error: error.message });
      });
    });
  }

  try {
    process.kill(pid);
    return { attempted: true, method: "process.kill", ok: true };
  } catch (error) {
    return { attempted: true, method: "process.kill", ok: false, error: error.message };
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function runWorkflow(runtime, token) {
  const apiBaseUrl = runtime.baseUrl;
  const bootstrapClient = createSchemaDocsLocalClient({ baseUrl: apiBaseUrl, token });
  const createdWorkspace = await bootstrapClient.createTempWorkspace();
  const workspace = createdWorkspace.workspacePath;
  const client = createSchemaDocsLocalClient({ baseUrl: apiBaseUrl, workspacePath: workspace, token });

  const opened = createdWorkspace.manifest;
  await client.request("/api/markdown/save", {
    relativePath: "notes/desktop.md",
    content: "# Desktop Workflow\n\nMarkdown is the exchange center.\n"
  });
  const docxExport = await client.exportDocument("docx", {
    relativePath: "notes/desktop.md",
    outputRelativePath: "exports/desktop.docx"
  });
  const pdfExport = await client.exportDocument("pdf", {
    relativePath: "notes/desktop.md",
    outputRelativePath: "exports/desktop.pdf"
  });
  const sampleDocx = await client.createSampleDocx();
  const ingestedDocx = sampleDocx.document;
  const preparedDocxForAi = await client.prepareRecordForAi(ingestedDocx.id);
  const extractedDocx = await client.extract({ documentId: ingestedDocx.id });
  const readablePath = extractedDocx.output?.readableMarkdownPath || extractedDocx.output?.readableArtifactPath || path.join(workspace, "outputs", "readable", "sample-word.readable.md");
  const readableMarkdown = existsSync(readablePath) ? await readFile(readablePath, "utf8") : "";
  const selectedChunk = await client.resolveAiContextChunk(ingestedDocx.id, 1);
  const cleanAiReadyRelativePath = `ai-ready/${ingestedDocx.id}-clean-ai-ready.md`;
  const cleanAiReady = await client.request("/api/exchange/save", { relativePath: cleanAiReadyRelativePath, input: { title: "Clean AI-Ready Copy", source: "desktop-workflow-clean-ai-ready-copy", body: `## Clean AI-Ready Copy\n\n- Record: ${ingestedDocx.id}\n- AI chunk ledger: chunk 1/${selectedChunk.totalChunkCount}\n- Send Gate: ${selectedChunk.sendGateDecision}\n- Evidence: ${selectedChunk.evidenceId}\n\n## Content\n\n${selectedChunk.content}`, evidenceId: selectedChunk.evidenceId } });
  const cleanAiReadyBody = await readFile(cleanAiReady, "utf8");
  const aiHandoffBundle = await client.saveAiHandoffBundle("notes/desktop-ai-handoff.md", { recordIdOrPackagePath: ingestedDocx.id, chunkIndex: 1, source: "desktop-workflow-ai-handoff", operation: "handoff", sendGateSummary: `Send Gate: ${selectedChunk.sendGateDecision}` });
  const documentPdfExport = await client.exportDocument("pdf", {
    documentId: ingestedDocx.id,
    outputRelativePath: "exports/imported-docx.pdf"
  });
  const normalized = await client.normalize({
    packageRelativePath: "packages/desktop-workflow",
    input: {
      title: "Desktop Workflow Package",
      body: "Packaged desktop runtime generated this Markdown exchange package.",
      exportFormats: ["docx", "pdf"]
    }
  });
  const readBack = await client.readPackage("packages/desktop-workflow");
  const receiverReport = await client.writeReceiverReport("packages/desktop-workflow");
  const ordinaryAiPreview = await client.previewAiPayload({
    operation: "summarize",
    content: "Desktop workflow uses Markdown as the exchange center.",
    sourceRef: "desktop-workflow"
  });
  const sensitiveAiPreview = await client.previewAiPayload({
    operation: "summarize",
    content: "Contact test@example.com or 155 0000 0000 for a review.",
    sourceRef: "desktop-workflow-sensitive"
  });
  let blockedAiSend = null;
  try {
    const blockedJob = await client.sendAiRequest({
      operation: "summarize",
      content: "api_key: local-preview-secret",
      sourceRef: "desktop-workflow-blocked",
      apiBaseUrl: "https://example.invalid",
      model: "schema-docs-preview",
      confirmed: true
    });
    blockedAiSend = {
      code: blockedJob.error?.code,
      status: blockedJob.status,
      signals: blockedJob.error?.details?.signals ?? []
    };
  } catch (error) {
    blockedAiSend = {
      code: error.code,
      status: error.status,
      signals: error.details?.signals ?? []
    };
  }

  return {
    workspace,
    workspaceId: opened.workspaceId,
    docxExportOk: typeof docxExport === "string" && docxExport.endsWith(".docx") && existsSync(docxExport),
    pdfExportOk: typeof pdfExport === "string" && pdfExport.endsWith(".pdf") && existsSync(pdfExport),
    sampleDocxOk: sampleDocx.sourcePath?.endsWith(".docx") && existsSync(sampleDocx.sourcePath),
    ingestOk: ingestedDocx.sourceType === "docx" && ingestedDocx.id?.startsWith("doc_"),
    prepareRecordForAiOk: preparedDocxForAi.kind === "document"
      && preparedDocxForAi.preview?.sendGateDecision === "allow"
      && preparedDocxForAi.preview.markdownSections.some((section) => section.includes("Schema Docs Sample Word")),
    extractOk: extractedDocx.status === "succeeded" && extractedDocx.output?.outputMarkdownPath?.endsWith(".md"),
    readableMarkdownOk: readablePath.endsWith(".readable.md")
      && readableMarkdown.includes("Schema Docs Sample Word")
      && !readableMarkdown.includes("Human-readable Markdown view"),
    cleanAiReadyCopyOk: cleanAiReadyRelativePath.endsWith(".md") && cleanAiReadyBody.includes("Clean AI-Ready Copy") && cleanAiReadyBody.includes(selectedChunk.evidenceId),
    aiHandoffBundleOk: aiHandoffBundle.relativePath === "notes/desktop-ai-handoff.md" && aiHandoffBundle.body.includes("AI Handoff Bundle") && aiHandoffBundle.body.includes("Send Gate"),
    importedDocxToPdfOk: documentPdfExport.outputPath?.endsWith(".pdf") && existsSync(documentPdfExport.outputPath),
    packageOk: normalized.documentPath?.endsWith("document.md") && normalized.packageExports?.length === 2,
    readBackOk: readBack.valid === true
      && readBack.files.some((file) => file.path === "document.schema.json")
      && readBack.files.some((file) => file.path === "exports/document.docx")
      && readBack.files.some((file) => file.path === "exports/document.pdf"),
    receiverReportOk: receiverReport.markdownPath?.endsWith("receiver-report.md")
      && receiverReport.jsonPath?.endsWith("trust-report.json")
      && receiverReport.markdownHash?.startsWith("sha256:")
      && receiverReport.jsonHash?.startsWith("sha256:"),
    aiPreviewOk: ordinaryAiPreview.output?.sendGate?.decision === "selected_context_preview",
    aiSensitivePreviewOk: sensitiveAiPreview.output?.sendGate?.decision === "review_recommended"
      && sensitiveAiPreview.output.sendGate.signals.includes("email")
      && sensitiveAiPreview.output.sendGate.signals.includes("phone_or_numeric_identifier"),
    aiBlockedSendOk: blockedAiSend?.code === "ai_send_gate_review_required"
      && (blockedAiSend.status === "failed" || blockedAiSend.status >= 400)
      && blockedAiSend.signals.includes("credential_like_text")
  };
}

if (!existsSync(appPath)) {
  printAndExit({
    ok: false,
    mode: checkOnly ? "check-only" : "launch",
    appPath,
    error: "Packaged app executable is missing. Run npm run desktop:build first."
  });
} else if (!packagedRuntime.ok) {
  printAndExit({
    ok: false,
    mode: checkOnly ? "check-only" : "launch",
    appPath,
    packagedRuntime,
    error: "Packaged runtime resources are missing beside the app executable. Keep app.exe with its generated runtime directory or run npm run desktop:build first."
  });
} else if (checkOnly) {
  printAndExit({
    ok: true,
    mode: "check-only",
    appPath,
    packagedRuntime,
    scanRange: `${host}:${startPort}-${endPort}`
  });
} else {
  const smokeToken = randomBytes(24).toString("hex");
  const child = spawn(appPath, [], {
    stdio: "ignore",
    env: {
      ...process.env,
      SCHEMA_DOCS_DESKTOP_PORT: String(startPort),
      SCHEMA_DOCS_DESKTOP_TOKEN: smokeToken
    }
  });
  const appExit = {
    exited: false,
    code: null,
    signal: null
  };
  child.once("exit", (code, signal) => {
    appExit.exited = true;
    appExit.code = code;
    appExit.signal = signal;
  });

  let runtime = await discoverRuntime();
  let workflow = null;
  let workflowError = "";
  if (runtime.ok) {
    try {
      workflow = await runWorkflow(runtime, smokeToken);
    } catch (error) {
      workflowError = error.message;
    }
  }
  const cleanup = await stopProcessTree(child.pid);
  const workflowOk = Boolean(
    workflow?.docxExportOk
    && workflow?.pdfExportOk
    && workflow?.sampleDocxOk
    && workflow?.ingestOk
    && workflow?.extractOk
    && workflow?.readableMarkdownOk
    && workflow?.cleanAiReadyCopyOk
    && workflow?.aiHandoffBundleOk
    && workflow?.importedDocxToPdfOk
    && workflow?.packageOk
    && workflow?.readBackOk
    && workflow?.receiverReportOk
    && workflow?.aiPreviewOk
    && workflow?.aiSensitivePreviewOk
    && workflow?.aiBlockedSendOk
  );

  printAndExit({
    ok: runtime.ok && workflowOk,
    mode: "launch",
    appPath,
    packagedRuntime,
    appPid: child.pid,
    appExit,
    scanRange: `${host}:${startPort}-${endPort}`,
    cleanup,
    runtime,
    workflow,
    workflowError
  });
}
