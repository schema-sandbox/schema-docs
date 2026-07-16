import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

function check(name, ok, detail = "") {
  return { name, ok: Boolean(ok), detail };
}

const [tauriLib, appJs, aiSummonPanel, html, css, localServer] = await Promise.all([
  read("src-tauri/src/lib.rs"),
  read("public/app.js"),
  read("public/aiSummonPanel.js"),
  read("public/index.html"),
  read("public/styles.css"),
  read("src/server/localServer.js")
]);
const webSummonSources = `${appJs}\n${aiSummonPanel}`;
const localMaskIndex = localServer.indexOf("route === \"/api/mask\"");
const localMaskBeforeWorkspaceService = localServer.slice(
  localMaskIndex,
  localServer.indexOf("const service = createAppService(workspacePath)", localMaskIndex)
);

const checks = [
  check(
    "tauri_command_registered",
    tauriLib.includes("fn summon_ai_gate") && tauriLib.includes("summon_ai_gate"),
    "Tauri command exists and is registered."
  ),
  check(
    "tauri_focuses_main_window",
    tauriLib.includes("get_webview_window(\"main\")")
      && tauriLib.includes("window.unminimize")
      && tauriLib.includes("window.show")
      && tauriLib.includes("window.set_focus"),
    "Command focuses the main window before emitting the event."
  ),
  check(
    "tauri_emits_ai_summon_event",
    tauriLib.includes("schema-docs-ai-summon")
      && tauriLib.includes("\"target\": \"ai-send-gate\"")
      && tauriLib.includes("\"source\": \"desktop-command\"")
      && tauriLib.includes("\"shortcut\": \"Ctrl+Alt+A\"")
      && tauriLib.includes("\"scope\": \"desktop-window\""),
    "Command emits a source-aware desktop AI summon event."
  ),
  check(
    "web_listens_for_desktop_event",
    appJs.includes("bindDesktopAiSummonEvent")
      && appJs.includes("listen(\"schema-docs-ai-summon\"")
      && appJs.includes("source: event?.payload?.source ?? \"desktop-command\"")
      && appJs.includes("target: event?.payload?.target ?? \"ai-send-gate\""),
    "Web app binds the desktop event to the source-aware AI Send Gate flow."
  ),
  check(
    "web_keyboard_shortcut_present",
    appJs.includes("event.ctrlKey && event.altKey && event.code === \"KeyA\"")
      && appJs.includes("event.preventDefault()")
      && appJs.includes("aiAssistantPanel.toggle()"),
    "Ctrl+Alt+A opens the contextual AI assistant inside the app."
  ),
  check(
    "web_summon_opens_send_gate_panel",
    webSummonSources.includes("summonAiGate")
      && webSummonSources.includes("aiSendGateTitle")
      && webSummonSources.includes("scrollIntoView")
      && webSummonSources.includes("$(\"aiContent\")?.focus()")
      && webSummonSources.includes("sendGateSummary")
      && webSummonSources.includes("AI summon key opened"),
    "Summon flow scrolls to AI Send Gate, focuses the AI content box, and updates the Send Gate summary."
  ),
  check(
    "web_summon_refreshes_current_record_preview",
    webSummonSources.includes("const recordId = $(\"recordId\")?.value.trim()")
      && webSummonSources.includes("await updateAiWillSeePanel()")
      && webSummonSources.includes("catch {\n}"),
    "When a record is selected, summon attempts to refresh AI Will See without making the shortcut brittle."
  ),
  check(
    "web_summon_masks_clipboard_through_local_api",
    aiSummonPanel.includes("/api/mask")
      && aiSummonPanel.includes("\"x-ai-doc-exchange-token\": token")
      && aiSummonPanel.includes("payload.data?.maskedText")
      && aiSummonPanel.includes("Clipboard not staged: local masking unavailable."),
    "Clipboard text is routed through the local masking API with the local session token before staging, and raw clipboard text is not staged when masking is unavailable."
  ),
  check(
    "local_mask_api_does_not_require_workspace",
    localMaskIndex >= 0
      && localMaskBeforeWorkspaceService.includes("maskSensitiveData(body.content)")
      && localServer.includes("Invalid local session token."),
    "The local mask API remains token-protected but can mask clipboard text before any workspace is selected."
  ),
  check(
    "floating_button_present",
    html.includes("id=\"aiSummonKey\"")
      && html.includes("Ctrl+Alt+A")
      && css.includes(".ai-summon-key")
      && appJs.includes("$(\"aiSummonKey\")?.addEventListener")
      && appJs.includes("aiAssistantPanel.toggle()"),
    "The optional AI summon key remains wired when advanced tools are shown."
  )
];

const failedChecks = checks.filter((item) => !item.ok).map((item) => item.name);
const result = {
  ok: failedChecks.length === 0,
  command: "summon_ai_gate",
  event: "schema-docs-ai-summon",
  shortcut: "Ctrl+Alt+A",
  checks,
  failedChecks
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
