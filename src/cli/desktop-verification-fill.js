import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function requireText(name, value) {
  if (!value || !value.trim()) {
    throw new Error(`Missing required ${name}.`);
  }
  return value.trim();
}

function optionalArgValue(name) {
  const value = argValue(name);
  return value ? value : undefined;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function quoteCommandArg(value) {
  return `"${String(value).replaceAll("\"", "\\\"")}"`;
}

export function fillDesktopVerificationRecord(record, options = {}) {
  const filled = cloneJson(record);
  if (filled.recordType !== "desktop-verification") {
    throw new Error("Input record must have recordType=desktop-verification.");
  }
  const diagnosticsPass = options.visibleUiPass || options.diagnosticsPass;
  const firstWorkflowPass = options.visibleUiPass || options.firstWorkflowPass;
  const workspacePickerPass = options.visibleUiPass || options.workspacePickerPass;
  const filePickerPass = options.visibleUiPass || options.filePickerPass;

  filled.environment = {
    ...(filled.environment ?? {}),
    windowsVersion: options.windowsVersion ?? filled.environment?.windowsVersion ?? "",
    webView2Present: options.webView2Present ?? filled.environment?.webView2Present ?? "unknown",
    nodeVersion: options.nodeVersion ?? filled.environment?.nodeVersion ?? "",
    machineProfile: options.machineProfile ?? filled.environment?.machineProfile ?? "developer"
  };

  if (diagnosticsPass || firstWorkflowPass || workspacePickerPass || filePickerPass) {
    filled.visibleUi = {
      ...(filled.visibleUi ?? {})
    };
  }

  if (diagnosticsPass) {
    filled.visibleUi.desktopDiagnostics = {
      ...(filled.visibleUi?.desktopDiagnostics ?? {}),
      status: "pass",
      nodeAvailable: true,
      apiHealthOk: true,
      runtimePathsVisible: true,
      sessionLogsVisible: true,
      notes: options.visibleNotes ?? filled.visibleUi?.desktopDiagnostics?.notes ?? "Confirmed through packaged Desktop UI diagnostics."
    };
  }

  if (firstWorkflowPass) {
    filled.visibleUi.firstWorkflow = {
      ...(filled.visibleUi?.firstWorkflow ?? {}),
      status: "pass",
      readBackValid: true,
      notes: options.visibleNotes ?? filled.visibleUi?.firstWorkflow?.notes ?? "Confirmed through visible first-workflow check."
    };
  }

  if (workspacePickerPass) {
    filled.visibleUi.workspacePicker = {
      ...(filled.visibleUi?.workspacePicker ?? {}),
      status: "pass",
      pathFilled: true,
      workspaceOpened: true,
      notes: options.visibleNotes ?? filled.visibleUi?.workspacePicker?.notes ?? "Confirmed through native workspace folder picker."
    };
  }

  if (filePickerPass) {
    filled.visibleUi.filePicker = {
      ...(filled.visibleUi?.filePicker ?? {}),
      status: "pass",
      pathFilled: true,
      importSucceeded: true,
      notes: options.visibleNotes ?? filled.visibleUi?.filePicker?.notes ?? "Confirmed through native supported-file picker."
    };
  }

  if (options.resultPass) {
    const tester = requireText("--tester <name>", options.tester ?? "");
    filled.result = {
      ...(filled.result ?? {}),
      status: "pass",
      tester,
      testedAt: options.testedAt ?? new Date().toISOString(),
      notes: options.resultNotes ?? filled.result?.notes ?? "Filled after manual visible Desktop UI verification."
    };
  } else if (options.tester || options.testedAt || options.resultNotes) {
    filled.result = {
      ...(filled.result ?? {}),
      tester: options.tester ?? filled.result?.tester ?? "",
      testedAt: options.testedAt ?? filled.result?.testedAt ?? "",
      notes: options.resultNotes ?? filled.result?.notes ?? ""
    };
  }

  return filled;
}

export async function runDesktopVerificationFill(options = {}) {
  const input = options.recordPath ?? argValue("--record");
  if (!input) {
    throw new Error("Missing required --record <desktop-verification-record.json>.");
  }
  const recordPath = path.resolve(root, input);
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  const filled = fillDesktopVerificationRecord(record, {
    visibleUiPass: options.visibleUiPass ?? hasFlag("--visible-ui-pass"),
    diagnosticsPass: options.diagnosticsPass ?? hasFlag("--diagnostics-pass"),
    firstWorkflowPass: options.firstWorkflowPass ?? hasFlag("--first-workflow-pass"),
    workspacePickerPass: options.workspacePickerPass ?? hasFlag("--workspace-picker-pass"),
    filePickerPass: options.filePickerPass ?? hasFlag("--file-picker-pass"),
    resultPass: options.resultPass ?? hasFlag("--result-pass"),
    tester: options.tester ?? optionalArgValue("--tester"),
    testedAt: options.testedAt ?? optionalArgValue("--tested-at"),
    windowsVersion: options.windowsVersion ?? optionalArgValue("--windows-version"),
    nodeVersion: options.nodeVersion ?? optionalArgValue("--node-version"),
    webView2Present: options.webView2Present ?? optionalArgValue("--webview2-present"),
    machineProfile: options.machineProfile ?? optionalArgValue("--machine-profile"),
    visibleNotes: options.visibleNotes ?? optionalArgValue("--visible-notes"),
    resultNotes: options.resultNotes ?? optionalArgValue("--result-notes")
  });

  const outPath = options.outPath ?? argValue("--out");
  if (outPath) {
    const resolvedOutPath = path.resolve(root, outPath);
    await mkdir(path.dirname(resolvedOutPath), { recursive: true });
    await writeFile(resolvedOutPath, `${JSON.stringify(filled, null, 2)}\n`, "utf8");
    const quotedOutPath = quoteCommandArg(resolvedOutPath);
    return {
      ok: true,
      recordPath,
      outPath: resolvedOutPath,
      nextCommand: `npm run desktop-verification-check -- --strict ${quotedOutPath}`,
      closeCommand: `npm run desktop-fixture-close -- --record ${quotedOutPath} --write`
    };
  }

  return filled;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runDesktopVerificationFill();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      ok: false,
      error: error.message
    }, null, 2));
    process.exitCode = 1;
  }
}
