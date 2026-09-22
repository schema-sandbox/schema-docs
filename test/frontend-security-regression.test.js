import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { desktopNativePickersPresent } from "../src/cli/release-check-desktop-checks.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readProjectFile(relativePath) {
  return readFile(path.join(projectRoot, relativePath), "utf8");
}

test("AI context preview escapes imported headings before writing HTML", async () => {
  const source = await readProjectFile("public/aiContextPanel.js");

  assert.match(source, /markdownSections = \(preview\.markdownSections \?\? \[\]\)\.map\(escapeHtml\)/);
  assert.doesNotMatch(source, /preview\.markdownSections\.join\(/);
  assert.match(source, /escapeHtml\(preview\.recommendedNextAction \|\| ""\)/);
});

test("toast alerts render provider and runtime errors as text", async () => {
  const source = await readProjectFile("public/alertPanel.js");

  assert.match(source, /messageSpan\.textContent = String\(message \?\? ""\)/);
  assert.doesNotMatch(source, /innerHTML = `<span style="flex: 1;">\$\{message\}/);
});

test("manifest card metadata treats workspace manifest paths as text", async () => {
  const source = await readProjectFile("public/manifestPanel.js");

  assert.match(source, /item\.append\(labelSpan, ` \$\{String\(val \|\| "-"\)\}`\)/);
  assert.doesNotMatch(source, /<span class="record-meta-label">\$\{label\}:<\/span> \$\{val \|\| "-"\}/);
});

test("frontend does not dynamically import remote editor code", async () => {
  const source = await readProjectFile("public/markdownEditorAdapter.js");

  assert.doesNotMatch(source, /https?:\/\//);
  assert.doesNotMatch(source, /esm\.sh/);
});

test("global error banner treats runtime error details as text", async () => {
  const source = await readProjectFile("public/index.html");

  assert.match(source, /message\.textContent = String\(msg \|\| "Unknown error"\)/);
  assert.match(source, /dismiss\.addEventListener\("click", \(\) => div\.remove\(\)\)/);
  assert.doesNotMatch(source, /div\.innerHTML/);
  assert.doesNotMatch(source, /onclick=/);
});

test("PDF export does not disable the Chromium sandbox", async () => {
  const source = await readProjectFile("src/core/markdownExportPipeline.js");

  assert.doesNotMatch(source, /["']--no-sandbox["']/);
  assert.doesNotMatch(source, /unpkg\.com/);
});

test("PDF diagnostics escape status text parsed from imported Markdown", async () => {
  const source = await readProjectFile("public/markdownWorkbenchPanel.js");

  assert.match(source, /escapeHtml\(t\("quality_" \+ quality\)\)/);
  assert.match(source, /escapeHtml\(t\("status_" \+ a\.status\)\)/);
  assert.match(source, /const charCount = Number\(state\.selectedRecord\?\.markdownOutputs\?\.readableStats\?\.characters\) \|\| 0/);
  assert.doesNotMatch(source, /\$\{t\("status_" \+ a\.status\)\}/);
});

test("segment banner coerces workspace manifest line ranges to numbers", async () => {
  const source = await readProjectFile("public/markdownWorkbenchPanel.js");

  assert.match(source, /const startLine = Number\(curSeg\.startLine\) \|\| 0/);
  assert.match(source, /const endLine = Number\(curSeg\.endLine\) \|\| 0/);
  assert.doesNotMatch(source, /Mapped source lines \$\{curSeg\.startLine\}-\$\{curSeg\.endLine\}/);
});

test("desktop CSP permits only the secured loopback workspace image endpoint", async () => {
  const config = JSON.parse(await readProjectFile("src-tauri/tauri.conf.json"));
  const secureServer = await readProjectFile("src/server/secureLocalServer.js");
  const directives = new Map(
    config.app.security.csp
      .split(";")
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...sources] = directive.split(/\s+/);
        return [name, sources];
      })
  );
  const imageSources = directives.get("img-src") ?? [];
  const networkImageSources = imageSources.filter((source) => /^https?:/i.test(source));

  assert.deepEqual(networkImageSources.sort(), [
    "http://127.0.0.1:*/api/workspace-asset",
    "http://localhost:*/api/workspace-asset"
  ]);
  assert.equal(imageSources.includes("*"), false);
  assert.equal(imageSources.includes("http:"), false);
  assert.equal(imageSources.includes("https:"), false);
  assert.equal(imageSources.some((source) => /192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[01])\./.test(source)), false);
  assert.deepEqual(directives.get("script-src"), ["'self'"]);
  for (const source of networkImageSources) {
    assert.match(secureServer, new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("desktop file and folder pickers are owned by the app window and do not spawn PowerShell", async () => {
  const cargo = await readProjectFile("src-tauri/Cargo.toml");
  const source = (await readProjectFile("src-tauri/src/lib.rs")).replace(/\r\n/g, "\n");
  assert.match(cargo, /tauri-plugin-dialog\s*=\s*"2"/);
  assert.match(source, /\.plugin\(tauri_plugin_dialog::init\(\)\)/);
  assert.equal(desktopNativePickersPresent(source), true);

  const pickers = [
    ["select_import_file_path", "\n#[tauri::command]\nasync fn select_markdown_file_path", "blocking_pick_file"],
    ["select_markdown_file_path", "\nfn authorize_selected_markdown_path", "blocking_pick_file"],
    ["select_save_file_path", "\nfn copy_directory_recursive", "blocking_save_file"],
    ["select_workspace_path", "\n#[tauri::command]\nasync fn select_import_directory_path", "blocking_pick_folder"],
    ["select_import_directory_path", "\n#[tauri::command]\nfn get_desktop_runtime_diagnostics", "blocking_pick_folder"]
  ];
  for (const [name, endMarker, blockingMethod] of pickers) {
    const start = source.indexOf(`async fn ${name}(`);
    const end = source.indexOf(endMarker, start);
    const picker = source.slice(start, end);
    assert.notEqual(start, -1, `${name} must be asynchronous`);
    assert.notEqual(end, -1, `${name} block must be discoverable`);
    assert.match(picker, /window:\s*tauri::Window/, `${name} must receive the app window`);
    assert.match(picker, /\.set_parent\(&window\)/, `${name} must own its native dialog`);
    assert.match(picker, new RegExp(`\\.${blockingMethod}\\(\\)`), `${name} must use the dialog plugin`);
    assert.doesNotMatch(picker, /powershell\.exe|OpenFileDialog|FolderBrowserDialog|SaveFileDialog|ShowDialog|\.output\(\)/);
  }
});

test("desktop native picker release gate rejects unsafe or incomplete implementations", async () => {
  const source = await readProjectFile("src-tauri/src/lib.rs");
  const invalidSources = [
    source.replace("async fn select_save_file_path(", "fn select_save_file_path("),
    source.replace(".set_parent(&window)", ".set_parent_removed(&window)"),
    source.replace(".blocking_pick_folder()", ".blocking_pick_folder_removed()"),
    source.replace('"xlsx"', '"xlsx-filter-removed"'),
    source.replace(
      '.add_filter("Markdown files", &["md", "markdown"])',
      '.add_filter("Markdown files", &["md"])'
    ),
    source.replace(".blocking_save_file()", ".blocking_save_file() // powershell.exe"),
    source.replace("            select_import_directory_path,", "")
  ];

  assert.equal(desktopNativePickersPresent(source.replace(/\n/g, "\r\n")), true);
  for (const invalidSource of invalidSources) {
    assert.notEqual(invalidSource, source, "test mutation must alter the picker implementation");
    assert.equal(desktopNativePickersPresent(invalidSource), false);
  }
});
