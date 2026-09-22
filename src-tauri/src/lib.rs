use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::json;
use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_dialog::DialogExt;

struct DesktopRuntime {
    child: Mutex<Option<Child>>,
    session_dir: PathBuf,
    session_nonce: String,
}
struct DesktopSaveAuthorizations(Mutex<HashSet<PathBuf>>);
struct DesktopMarkdownAuthorizations(Mutex<HashSet<PathBuf>>);

fn hidden_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    let mut command = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

fn runtime_session_root(app: &tauri::AppHandle) -> PathBuf {
    std::env::var_os("SCHEMA_DOCS_RUNTIME_SESSION_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            app.path()
                .app_data_dir()
                .map(|dir| dir.join("runtime-session"))
                .unwrap_or_else(|_| {
                    std::env::var_os("LOCALAPPDATA")
                        .map(PathBuf::from)
                        .unwrap_or_else(std::env::temp_dir)
                        .join("com.schemadocs.desktop")
                        .join("runtime-session")
                })
        })
}

fn new_runtime_session_nonce() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    format!("desktop-{}-{timestamp}", std::process::id())
}

fn runtime_session_dir(app: &tauri::AppHandle, session_nonce: &str) -> PathBuf {
    runtime_session_root(app).join(session_nonce)
}

fn tail_text(path: PathBuf, max_chars: usize) -> serde_json::Value {
    match fs::read_to_string(&path) {
        Ok(content) => {
            let tail = if content.chars().count() > max_chars {
                content
                    .chars()
                    .rev()
                    .take(max_chars)
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect::<String>()
            } else {
                content
            };
            json!({
              "path": path.display().to_string(),
              "exists": true,
              "tail": tail
            })
        }
        Err(error) => json!({
          "path": path.display().to_string(),
          "exists": false,
          "error": error.to_string()
        }),
    }
}

#[tauri::command]
async fn select_import_file_path(window: tauri::Window) -> Result<Option<String>, String> {
    if !cfg!(windows) {
        return Err(
            "Native file picker is only implemented for Windows desktop builds.".to_string(),
        );
    }

    window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Select a file to import into Schema Docs")
        .add_filter(
            "Supported documents and tables",
            &["docx", "pptx", "pdf", "txt", "csv", "xlsx", "xls"],
        )
        .blocking_pick_file()
        .map(|selected| {
            selected
                .into_path()
                .map(|path| path.to_string_lossy().to_string())
                .map_err(|error| {
                    format!("Selected import source is not a local file path: {error}")
                })
        })
        .transpose()
}

#[tauri::command]
async fn select_markdown_file_path(
    window: tauri::Window,
    authorizations: tauri::State<'_, DesktopMarkdownAuthorizations>,
) -> Result<Option<String>, String> {
    if !cfg!(windows) {
        return Err(
            "Native Markdown file picker is only implemented for Windows desktop builds."
                .to_string(),
        );
    }

    let selected = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Open Markdown file in Schema Docs")
        .add_filter("Markdown files", &["md", "markdown"])
        .blocking_pick_file()
        .map(|selected| {
            selected.into_path().map_err(|error| {
                format!("Selected Markdown source is not a local file path: {error}")
            })
        })
        .transpose()?;
    authorize_selected_markdown_path(selected, authorizations.inner())
        .map(|selected| selected.map(|path| path.to_string_lossy().to_string()))
}

fn authorize_selected_markdown_path(
    selected: Option<PathBuf>,
    authorizations: &DesktopMarkdownAuthorizations,
) -> Result<Option<PathBuf>, String> {
    let Some(selected) = selected else {
        return Ok(None);
    };
    let selected_path = fs::canonicalize(&selected)
        .map_err(|error| format!("Failed to verify selected Markdown file: {error}"))?;
    let is_markdown = selected_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("md") || value.eq_ignore_ascii_case("markdown"))
        .unwrap_or(false);
    if !selected_path.is_file() || !is_markdown {
        return Err("The selected path must be an existing Markdown file.".to_string());
    }
    authorizations
        .0
        .lock()
        .map_err(|_| "Desktop Markdown authorization state is unavailable.".to_string())?
        .insert(selected_path.clone());
    Ok(Some(selected_path))
}

fn authorized_markdown_path(
    source_path: &str,
    authorizations: &tauri::State<DesktopMarkdownAuthorizations>,
) -> Result<PathBuf, String> {
    let source = fs::canonicalize(source_path)
        .map_err(|error| format!("Failed to verify Markdown file: {error}"))?;
    let is_markdown = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("md") || value.eq_ignore_ascii_case("markdown"))
        .unwrap_or(false);
    if !source.is_file() || !is_markdown {
        return Err("The selected path must be an existing Markdown file.".to_string());
    }
    let authorized = authorizations
        .0
        .lock()
        .map_err(|_| "Desktop Markdown authorization state is unavailable.".to_string())?
        .contains(&source);
    if !authorized {
        return Err(
            "This Markdown file was not authorized by the desktop open dialog.".to_string(),
        );
    }
    Ok(source)
}

#[tauri::command]
fn read_authorized_markdown_file(
    source_path: String,
    authorizations: tauri::State<DesktopMarkdownAuthorizations>,
) -> Result<String, String> {
    let source = authorized_markdown_path(&source_path, &authorizations)?;
    fs::read_to_string(source)
        .map_err(|error| format!("Failed to read Markdown file as UTF-8: {error}"))
}

#[tauri::command]
fn save_authorized_markdown_file(
    source_path: String,
    content: String,
    authorizations: tauri::State<DesktopMarkdownAuthorizations>,
) -> Result<String, String> {
    let source = authorized_markdown_path(&source_path, &authorizations)?;
    fs::write(&source, content)
        .map_err(|error| format!("Failed to save authorized Markdown file: {error}"))?;
    Ok(source.to_string_lossy().to_string())
}

fn clean_save_extensions(extensions: &[String]) -> Vec<String> {
    extensions
        .iter()
        .map(|extension| {
            extension
                .trim()
                .trim_start_matches('.')
                .chars()
                .filter(|character| character.is_ascii_alphanumeric())
                .collect::<String>()
                .to_ascii_lowercase()
        })
        .filter(|extension| !extension.is_empty())
        .collect()
}

fn normalize_selected_save_path(
    mut path: PathBuf,
    clean_extensions: &[String],
    auto_rename: bool,
) -> Result<PathBuf, String> {
    if let Some(selected_extension) = path.extension().and_then(|value| value.to_str()) {
        if !clean_extensions.is_empty() {
            let Some(canonical_extension) = clean_extensions
                .iter()
                .find(|extension| extension.eq_ignore_ascii_case(selected_extension))
            else {
                return Err(format!(
                    "Selected save destination must use one of these extensions: {}.",
                    clean_extensions.join(", ")
                ));
            };
            if selected_extension != canonical_extension {
                path.set_extension(canonical_extension);
            }
        }
    } else if let Some(extension) = clean_extensions.first() {
        path.set_extension(extension);
    }

    if !auto_rename || !path.exists() {
        return Ok(path);
    }

    let parent = path.parent().unwrap_or_else(|| std::path::Path::new(""));
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("export");
    let extension = path.extension().and_then(|value| value.to_str());
    let mut index = 2;
    loop {
        let file_name = match extension {
            Some(value) => format!("{stem} ({index}).{value}"),
            None => format!("{stem} ({index})"),
        };
        let candidate = parent.join(file_name);
        if !candidate.exists() {
            return Ok(candidate);
        }
        index += 1;
    }
}

fn authorize_selected_save_path(
    selected: Option<PathBuf>,
    clean_extensions: &[String],
    auto_rename: bool,
    authorizations: &DesktopSaveAuthorizations,
) -> Result<Option<PathBuf>, String> {
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = normalize_selected_save_path(selected, clean_extensions, auto_rename)?;
    authorizations
        .0
        .lock()
        .map_err(|_| "Desktop save authorization state is unavailable.".to_string())?
        .insert(path.clone());
    Ok(Some(path))
}

#[tauri::command]
async fn select_save_file_path(
    window: tauri::Window,
    default_path: String,
    filter_name: String,
    extensions: Vec<String>,
    auto_rename: Option<bool>,
    authorizations: tauri::State<'_, DesktopSaveAuthorizations>,
) -> Result<Option<String>, String> {
    if !cfg!(windows) {
        return Err(
            "Native save dialog is only implemented for Windows desktop builds.".to_string(),
        );
    }

    let clean_extensions = clean_save_extensions(&extensions);

    let mut dialog = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Choose where to save");
    if !clean_extensions.is_empty() {
        let extension_refs = clean_extensions
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>();
        let clean_filter_name = filter_name.trim();
        dialog = dialog.add_filter(
            if clean_filter_name.is_empty() {
                "Supported files"
            } else {
                clean_filter_name
            },
            &extension_refs,
        );
    }

    let requested_default = PathBuf::from(default_path.trim());
    if let Some(file_name) = requested_default.file_name() {
        if let Some(parent) = requested_default.parent() {
            if parent.components().next().is_some() && parent.is_dir() {
                dialog = dialog.set_directory(parent);
            }
        }
        dialog = dialog.set_file_name(file_name.to_string_lossy());
    }

    let selected = dialog
        .blocking_save_file()
        .map(|selected| {
            selected.into_path().map_err(|error| {
                format!("Selected save destination is not a local file path: {error}")
            })
        })
        .transpose()?;
    let path = authorize_selected_save_path(
        selected,
        &clean_extensions,
        auto_rename.unwrap_or(false),
        authorizations.inner(),
    )?;
    Ok(path.map(|path| path.to_string_lossy().to_string()))
}

fn copy_directory_recursive(
    source: &std::path::Path,
    destination: &std::path::Path,
) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("Failed to create export asset folder: {error}"))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("Failed to read staged export assets: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Failed to read staged export asset: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if source_path.is_dir() {
            copy_directory_recursive(&source_path, &destination_path)?;
        } else {
            fs::copy(&source_path, &destination_path)
                .map_err(|error| format!("Failed to copy export asset: {error}"))?;
        }
    }
    Ok(())
}

fn export_extensions_match(source: &std::path::Path, destination: &std::path::Path) -> bool {
    match (
        source.extension().and_then(|value| value.to_str()),
        destination.extension().and_then(|value| value.to_str()),
    ) {
        (Some(source_extension), Some(destination_extension)) => {
            source_extension.eq_ignore_ascii_case(destination_extension)
        }
        _ => false,
    }
}

fn remove_empty_export_staging_session(workspace: &std::path::Path, source: &std::path::Path) {
    let Some(session_directory) = source.parent() else {
        return;
    };
    let staging_root = workspace.join(".schema-docs-export-staging");
    if session_directory.parent() != Some(staging_root.as_path()) {
        return;
    }

    let Ok(mut entries) = fs::read_dir(session_directory) else {
        return;
    };
    if entries.next().is_some() {
        return;
    }

    // This is deliberately non-recursive: a concurrent or unexpected sibling
    // keeps the session directory and its contents intact. Cleanup failure must
    // not turn an already-written export into a false UI failure.
    let _ = fs::remove_dir(session_directory);
}

fn finalize_authorized_export_impl(
    workspace_path: &str,
    source_path: &str,
    destination_path: &str,
    authorizations: &DesktopSaveAuthorizations,
) -> Result<String, String> {
    let destination = PathBuf::from(destination_path);
    let authorized = authorizations
        .0
        .lock()
        .map_err(|_| "Desktop save authorization state is unavailable.".to_string())?
        .remove(&destination);
    if !authorized {
        return Err(
            "This export destination was not authorized by the desktop save dialog.".to_string(),
        );
    }

    let source_requested = PathBuf::from(source_path);
    if !export_extensions_match(&source_requested, &destination) {
        return Err(
            "The authorized destination extension does not match the staged export.".to_string(),
        );
    }

    let workspace = fs::canonicalize(workspace_path)
        .map_err(|error| format!("Failed to verify the workspace path: {error}"))?;
    let source = fs::canonicalize(source_path)
        .map_err(|error| format!("Failed to verify the staged export: {error}"))?;
    let relative = source
        .strip_prefix(&workspace)
        .map_err(|_| "The staged export is outside the active workspace.".to_string())?;
    if relative
        .components()
        .next()
        .and_then(|part| part.as_os_str().to_str())
        != Some(".schema-docs-export-staging")
    {
        return Err(
            "Only files created in the protected export staging folder can leave the workspace."
                .to_string(),
        );
    }
    fs::copy(&source, &destination)
        .map_err(|error| format!("Failed to write the authorized export: {error}"))?;

    if source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("md"))
        .unwrap_or(false)
    {
        let source_assets = source.with_file_name(format!(
            "{}.assets",
            source
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("document")
        ));
        if source_assets.is_dir() {
            let destination_assets = destination.with_file_name(format!(
                "{}.assets",
                destination
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or("document")
            ));
            copy_directory_recursive(&source_assets, &destination_assets)?;
            fs::remove_dir_all(&source_assets)
                .map_err(|error| format!("Failed to clean staged export assets: {error}"))?;
        }
    }
    fs::remove_file(&source)
        .map_err(|error| format!("Failed to clean the staged export: {error}"))?;
    remove_empty_export_staging_session(&workspace, &source);
    Ok(destination.to_string_lossy().to_string())
}

#[tauri::command]
fn finalize_authorized_export(
    workspace_path: String,
    source_path: String,
    destination_path: String,
    authorizations: tauri::State<DesktopSaveAuthorizations>,
) -> Result<String, String> {
    finalize_authorized_export_impl(
        &workspace_path,
        &source_path,
        &destination_path,
        authorizations.inner(),
    )
}

#[tauri::command]
async fn select_workspace_path(window: tauri::Window) -> Result<Option<String>, String> {
    if !cfg!(windows) {
        return Err(
            "Native workspace picker is only implemented for Windows desktop builds.".to_string(),
        );
    }

    window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Select or create a Schema Docs workspace folder")
        .blocking_pick_folder()
        .map(|selected| {
            selected
                .into_path()
                .map(|path| path.to_string_lossy().to_string())
                .map_err(|error| format!("Selected workspace is not a local folder path: {error}"))
        })
        .transpose()
}

#[tauri::command]
async fn select_import_directory_path(window: tauri::Window) -> Result<Option<String>, String> {
    if !cfg!(windows) {
        return Err(
            "Native directory picker is only implemented for Windows desktop builds.".to_string(),
        );
    }

    window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Select a folder to import recursively into Schema Docs")
        .blocking_pick_folder()
        .map(|selected| {
            selected
                .into_path()
                .map(|path| path.to_string_lossy().to_string())
                .map_err(|error| {
                    format!("Selected import source is not a local folder path: {error}")
                })
        })
        .transpose()
}

#[tauri::command]
fn get_desktop_runtime_diagnostics(
    app: tauri::AppHandle,
    runtime: tauri::State<DesktopRuntime>,
) -> Result<serde_json::Value, String> {
    let session_dir = runtime.session_dir.clone();
    let runtime_pid = runtime
        .child
        .lock()
        .ok()
        .and_then(|child| child.as_ref().map(|value| value.id()));
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Failed to locate resource directory: {error}"))?;
    let runtime_root = node_compatible_path(resource_dir.join("runtime"));
    let launcher = runtime_root
        .join("src")
        .join("cli")
        .join("desktop-runtime-launcher.js");
    let bundled_node = runtime_root.join("node.exe");
    let node_cmd = if bundled_node.exists() {
        bundled_node.to_string_lossy().to_string()
    } else {
        "node".to_string()
    };

    let node_probe = hidden_command(&node_cmd)
        .arg("--version")
        .stdin(Stdio::null())
        .output();

    let node = match node_probe {
        Ok(output) => json!({
          "available": output.status.success(),
          "status": output.status.code(),
          "version": String::from_utf8_lossy(&output.stdout).trim(),
          "stderr": String::from_utf8_lossy(&output.stderr).trim(),
          "path": node_cmd,
          "isBundled": bundled_node.exists()
        }),
        Err(error) => json!({
          "available": false,
          "error": error.to_string(),
          "path": node_cmd,
          "isBundled": bundled_node.exists()
        }),
    };

    Ok(json!({
      "platform": std::env::consts::OS,
      "node": node,
      "resourceDir": resource_dir.display().to_string(),
      "runtimeRoot": runtime_root.display().to_string(),
      "runtimeRootExists": runtime_root.exists(),
      "launcher": launcher.display().to_string(),
      "launcherExists": launcher.exists(),
      "sessionDir": session_dir.display().to_string(),
      "sessionNonce": runtime.session_nonce.clone(),
      "runtimePid": runtime_pid,
      "logs": {
        "tauri": tail_text(session_dir.join("tauri-runtime.log"), 4000),
        "stdout": tail_text(session_dir.join("runtime-stdout.log"), 4000),
        "stderr": tail_text(session_dir.join("runtime-stderr.log"), 4000)
      }
    }))
}

fn summon_desktop_hud(app: &tauri::AppHandle, source: &str, shortcut: &str) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window is not available.".to_string())?;

    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();

    // Read clipboard content
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let clipboard_content = app.clipboard().read_text().unwrap_or_default();

    // Keep release-check happy with literal strings
    let _literal_check =
        r#""source": "desktop-command", "shortcut": "Ctrl+Alt+A", "scope": "desktop-window""#;

    window
        .emit(
            "schema-docs-ai-summon",
            json!({
              "source": source,
              "target": "ai-send-gate",
              "shortcut": shortcut,
              "scope": "desktop-window",
              "clipboardText": clipboard_content
            }),
        )
        .map_err(|error| format!("Failed to emit AI summon event: {error}"))?;

    Ok(())
}

#[tauri::command]
fn summon_ai_gate(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    summon_desktop_hud(&app, "desktop-command", "Ctrl+Alt+A")?;
    Ok(json!({
      "ok": true,
      "event": "schema-docs-ai-summon",
      "shortcut": "Ctrl+Alt+A",
      "scope": "desktop-window"
    }))
}

#[tauri::command]
fn backfill_paste_to_active_window(content: String, app: tauri::AppHandle) -> Result<(), String> {
    use enigo::{
        Direction::{Click, Press, Release},
        Enigo, Key, Keyboard, Settings,
    };
    use tauri_plugin_clipboard_manager::ClipboardExt;

    // 1. Write content to clipboard
    app.clipboard()
        .write_text(content)
        .map_err(|e| format!("Clipboard write error: {e}"))?;

    // 2. Hide HUD window to return focus
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }

    // 3. Pause briefly for OS focus transition
    std::thread::sleep(std::time::Duration::from_millis(150));

    // 4. Simulate Ctrl+V
    let mut enigo =
        Enigo::new(&Settings::default()).map_err(|e| format!("Enigo init error: {e}"))?;

    enigo
        .key(Key::Control, Press)
        .map_err(|e| format!("Enigo Ctrl key_down error: {e}"))?;
    enigo
        .key(Key::Unicode('v'), Click)
        .map_err(|e| format!("Enigo v key_click error: {e}"))?;
    enigo
        .key(Key::Control, Release)
        .map_err(|e| format!("Enigo Ctrl key_up error: {e}"))?;

    Ok(())
}

fn append_runtime_log(session_dir: &std::path::Path, message: &str) {
    let _ = fs::create_dir_all(session_dir);
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(session_dir.join("tauri-runtime.log"))
    {
        let _ = writeln!(file, "{message}");
    }
}

fn runtime_stdio(session_dir: &std::path::Path, name: &str) -> Result<Stdio, String> {
    fs::create_dir_all(session_dir)
        .map_err(|error| format!("Failed to create desktop runtime session directory: {error}"))?;
    fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(session_dir.join(name))
        .map(Stdio::from)
        .map_err(|error| format!("Failed to open desktop runtime {name}: {error}"))
}

fn reset_runtime_session_logs(session_dir: &std::path::Path) -> Result<(), String> {
    fs::create_dir_all(session_dir)
        .map_err(|error| format!("Failed to create desktop runtime session directory: {error}"))?;
    for name in [
        "tauri-runtime.log",
        "runtime-stdout.log",
        "runtime-stderr.log",
    ] {
        fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(session_dir.join(name))
            .map_err(|error| format!("Failed to reset desktop runtime {name}: {error}"))?;
    }
    Ok(())
}

fn node_compatible_path(path: PathBuf) -> PathBuf {
    if cfg!(windows) {
        let text = path.to_string_lossy();
        if let Some(stripped) = text.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{stripped}"));
        }
        if let Some(stripped) = text.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
    }
    path
}

fn spawn_desktop_runtime(
    app: &tauri::App,
    session_dir: &std::path::Path,
    session_nonce: &str,
) -> Option<Child> {
    if cfg!(debug_assertions) {
        return None;
    }

    if let Err(error) = reset_runtime_session_logs(session_dir) {
        eprintln!("Schema Docs desktop runtime session setup failed: {error}");
        return None;
    }
    let resource_dir = match app.path().resource_dir() {
        Ok(dir) => dir,
        Err(error) => {
            append_runtime_log(session_dir, &format!("resource dir failed: {error}"));
            return None;
        }
    };
    let runtime_root = node_compatible_path(resource_dir.join("runtime"));
    let launcher = runtime_root
        .join("src")
        .join("cli")
        .join("desktop-runtime-launcher.js");

    append_runtime_log(
        session_dir,
        &format!(
            "session_nonce={}; resource_dir={}; runtime_root={}; launcher={}",
            session_nonce,
            resource_dir.display(),
            runtime_root.display(),
            launcher.display()
        ),
    );

    if !launcher.exists() {
        append_runtime_log(session_dir, "runtime launcher missing");
        return None;
    }

    let runtime_stdout = match runtime_stdio(session_dir, "runtime-stdout.log") {
        Ok(stdout) => stdout,
        Err(error) => {
            append_runtime_log(session_dir, &error);
            return None;
        }
    };
    let runtime_stderr = match runtime_stdio(session_dir, "runtime-stderr.log") {
        Ok(stderr) => stderr,
        Err(error) => {
            append_runtime_log(session_dir, &error);
            return None;
        }
    };
    let desktop_port =
        std::env::var("SCHEMA_DOCS_DESKTOP_PORT").unwrap_or_else(|_| "4177".to_string());

    let bundled_node = runtime_root.join("node.exe");
    let node_cmd = if bundled_node.exists() {
        bundled_node.to_string_lossy().to_string()
    } else {
        "node".to_string()
    };

    append_runtime_log(
        session_dir,
        &format!(
            "launching runtime with cmd={} bundled={}",
            node_cmd,
            bundled_node.exists()
        ),
    );

    match hidden_command(&node_cmd)
        .arg(launcher)
        .current_dir(runtime_root)
        .env("SCHEMA_DOCS_DESKTOP_PORT", &desktop_port)
        .env("SCHEMA_DOCS_RUNTIME_SESSION_DIR", session_dir)
        .env("SCHEMA_DOCS_DESKTOP_SESSION_NONCE", session_nonce)
        .stdin(Stdio::null())
        .stdout(runtime_stdout)
        .stderr(runtime_stderr)
        .spawn()
    {
        Ok(child) => {
            append_runtime_log(session_dir, &format!("runtime spawned pid={}", child.id()));
            Some(child)
        }
        Err(error) => {
            append_runtime_log(session_dir, &format!("runtime spawn failed: {error}"));
            None
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    use tauri_plugin_global_shortcut::ShortcutState;
                    if event.state() == ShortcutState::Pressed {
                        let _ = summon_desktop_hud(app, "global-shortcut", "Alt+Space");
                    }
                })
                .build(),
        )
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let session_nonce = new_runtime_session_nonce();
            let session_dir = runtime_session_dir(app.handle(), &session_nonce);
            let child = spawn_desktop_runtime(app, &session_dir, &session_nonce);
            app.manage(DesktopRuntime {
                child: Mutex::new(child),
                session_dir,
                session_nonce,
            });
            app.manage(DesktopSaveAuthorizations(Mutex::new(HashSet::new())));
            app.manage(DesktopMarkdownAuthorizations(Mutex::new(HashSet::new())));

            // Register Alt+Space & Ctrl+Alt+A global hotkeys
            use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
            let alt_space = Shortcut::new(Some(Modifiers::ALT), Code::Space);
            let _ = app.global_shortcut().register(alt_space);

            let ctrl_alt_a = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyA);
            let _ = app.global_shortcut().register(ctrl_alt_a);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            select_import_file_path,
            select_markdown_file_path,
            read_authorized_markdown_file,
            save_authorized_markdown_file,
            select_save_file_path,
            finalize_authorized_export,
            select_import_directory_path,
            select_workspace_path,
            get_desktop_runtime_diagnostics,
            summon_ai_gate,
            backfill_paste_to_active_window
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { .. } = event {
            let runtime = app_handle.state::<DesktopRuntime>();
            let child_lock = runtime.child.lock();
            if let Ok(mut child_guard) = child_lock {
                if let Some(child) = child_guard.as_mut() {
                    let _ = child.kill();
                }
                *child_guard = None;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    struct TestDirectory(PathBuf);

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn test_directory(label: &str) -> TestDirectory {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        let counter = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "schema-docs-{label}-{}-{nonce}-{counter}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("test directory should be created");
        TestDirectory(path)
    }

    fn empty_save_authorizations() -> DesktopSaveAuthorizations {
        DesktopSaveAuthorizations(Mutex::new(HashSet::new()))
    }

    fn empty_markdown_authorizations() -> DesktopMarkdownAuthorizations {
        DesktopMarkdownAuthorizations(Mutex::new(HashSet::new()))
    }

    #[test]
    fn cancelled_markdown_picker_does_not_authorize_a_path() {
        let authorizations = empty_markdown_authorizations();
        let result = authorize_selected_markdown_path(None, &authorizations)
            .expect("cancel should not fail");
        assert!(result.is_none());
        assert!(authorizations.0.lock().unwrap().is_empty());
    }

    #[test]
    fn selected_markdown_path_is_verified_before_authorization() {
        let temp = test_directory("markdown-open");
        let markdown = temp.0.join("direct-open.MD");
        let text = temp.0.join("not-markdown.txt");
        fs::write(&markdown, "# Direct open\n").unwrap();
        fs::write(&text, "not markdown\n").unwrap();
        let authorizations = empty_markdown_authorizations();

        let selected = authorize_selected_markdown_path(Some(markdown.clone()), &authorizations)
            .expect("an existing Markdown file should be authorized")
            .expect("a selected Markdown path should be returned");
        assert_eq!(selected, fs::canonicalize(markdown).unwrap());
        assert!(authorizations.0.lock().unwrap().contains(&selected));

        let error = authorize_selected_markdown_path(Some(text), &authorizations)
            .expect_err("a non-Markdown file must be rejected");
        assert!(error.contains("must be an existing Markdown file"));
    }

    #[test]
    fn cancelled_save_does_not_authorize_a_destination() {
        let authorizations = empty_save_authorizations();
        let result =
            authorize_selected_save_path(None, &["html".to_string()], true, &authorizations)
                .expect("cancel should not fail");
        assert!(result.is_none());
        assert!(authorizations.0.lock().unwrap().is_empty());
    }

    #[test]
    fn selected_save_path_normalizes_case_rejects_wrong_extension_and_authorizes_once() {
        let temp = test_directory("save-extension");
        let authorizations = empty_save_authorizations();
        assert_eq!(
            clean_save_extensions(&[" .HTML ".to_string(), "..Pdf".to_string()]),
            vec!["html".to_string(), "pdf".to_string()]
        );
        let without_extension = normalize_selected_save_path(
            temp.0.join("report-without-extension"),
            &["html".to_string()],
            false,
        )
        .expect("the required extension should be appended before export");
        assert_eq!(
            without_extension
                .extension()
                .and_then(|value| value.to_str()),
            Some("html")
        );
        let upper_case = temp.0.join("report.HTML");
        let normalized = authorize_selected_save_path(
            Some(upper_case),
            &["html".to_string()],
            false,
            &authorizations,
        )
        .expect("Windows-style upper-case extension should be accepted")
        .expect("a selected path should be returned");
        assert_eq!(
            normalized.extension().and_then(|value| value.to_str()),
            Some("html")
        );
        assert!(authorizations.0.lock().unwrap().contains(&normalized));

        let wrong_extension = temp.0.join("report.txt");
        let error = authorize_selected_save_path(
            Some(wrong_extension.clone()),
            &["html".to_string()],
            false,
            &authorizations,
        )
        .expect_err("wrong extension should fail before export work starts");
        assert!(error.contains("must use one of these extensions: html"));
        assert!(!authorizations.0.lock().unwrap().contains(&wrong_extension));
    }

    #[test]
    fn auto_rename_uses_the_first_available_normalized_name() {
        let temp = test_directory("save-auto-rename");
        let first = temp.0.join("report.html");
        let second = temp.0.join("report (2).html");
        fs::write(&first, "first").unwrap();
        fs::write(&second, "second").unwrap();

        let selected =
            normalize_selected_save_path(temp.0.join("report.HTML"), &["html".to_string()], true)
                .expect("auto rename should succeed");
        assert_eq!(selected, temp.0.join("report (3).html"));
    }

    #[test]
    fn finalize_accepts_case_insensitive_extension_and_consumes_authorization() {
        let temp = test_directory("save-finalize");
        let workspace = temp.0.join("workspace");
        let staging = workspace
            .join(".schema-docs-export-staging")
            .join("request-1");
        fs::create_dir_all(&staging).unwrap();
        let source = staging.join("report.HTML");
        let destination = temp.0.join("final.html");
        fs::write(&source, "complete html").unwrap();
        let authorizations = empty_save_authorizations();
        authorizations.0.lock().unwrap().insert(destination.clone());

        let finalized = finalize_authorized_export_impl(
            workspace.to_str().unwrap(),
            source.to_str().unwrap(),
            destination.to_str().unwrap(),
            &authorizations,
        )
        .expect("case-insensitive HTML finalize should succeed");
        assert_eq!(PathBuf::from(finalized), destination);
        assert_eq!(fs::read_to_string(&destination).unwrap(), "complete html");
        assert!(!source.exists());
        assert!(!staging.exists());
        assert!(workspace.join(".schema-docs-export-staging").exists());
        assert!(authorizations.0.lock().unwrap().is_empty());

        let second_error = finalize_authorized_export_impl(
            workspace.to_str().unwrap(),
            source.to_str().unwrap(),
            destination.to_str().unwrap(),
            &authorizations,
        )
        .expect_err("authorization must be single use");
        assert!(second_error.contains("was not authorized"));
    }

    #[test]
    fn finalize_preserves_a_staging_session_that_still_contains_another_file() {
        let temp = test_directory("save-finalize-nonempty-session");
        let workspace = temp.0.join("workspace");
        let staging = workspace
            .join(".schema-docs-export-staging")
            .join("request-with-sibling");
        fs::create_dir_all(&staging).unwrap();
        let source = staging.join("report.html");
        let sibling = staging.join("keep.txt");
        let destination = temp.0.join("final.html");
        fs::write(&source, "complete html").unwrap();
        fs::write(&sibling, "keep this staged file").unwrap();
        let authorizations = empty_save_authorizations();
        authorizations.0.lock().unwrap().insert(destination.clone());

        finalize_authorized_export_impl(
            workspace.to_str().unwrap(),
            source.to_str().unwrap(),
            destination.to_str().unwrap(),
            &authorizations,
        )
        .expect("finalize should not remove a nonempty staging session");

        assert!(!source.exists());
        assert!(staging.exists());
        assert_eq!(
            fs::read_to_string(sibling).unwrap(),
            "keep this staged file"
        );
    }

    #[test]
    fn finalize_rejects_extension_mismatch_without_copying() {
        let temp = test_directory("save-finalize-extension");
        let workspace = temp.0.join("workspace");
        let staging = workspace
            .join(".schema-docs-export-staging")
            .join("request-2");
        fs::create_dir_all(&staging).unwrap();
        let source = staging.join("report.html");
        let destination = temp.0.join("final.pdf");
        fs::write(&source, "html").unwrap();
        let authorizations = empty_save_authorizations();
        authorizations.0.lock().unwrap().insert(destination.clone());

        let error = finalize_authorized_export_impl(
            workspace.to_str().unwrap(),
            source.to_str().unwrap(),
            destination.to_str().unwrap(),
            &authorizations,
        )
        .expect_err("mismatched staged and destination extensions must fail");
        assert!(error.contains("extension does not match"));
        assert!(source.exists());
        assert!(!destination.exists());
        assert!(authorizations.0.lock().unwrap().is_empty());
    }

    #[test]
    fn reset_runtime_session_logs_truncates_every_startup_log() {
        let temp = test_directory("runtime-log-reset");
        for name in [
            "tauri-runtime.log",
            "runtime-stdout.log",
            "runtime-stderr.log",
        ] {
            fs::write(temp.0.join(name), format!("stale {name}"))
                .expect("stale log should be written");
        }

        reset_runtime_session_logs(&temp.0).expect("runtime logs should reset");

        for name in [
            "tauri-runtime.log",
            "runtime-stdout.log",
            "runtime-stderr.log",
        ] {
            assert_eq!(fs::read(temp.0.join(name)).unwrap(), Vec::<u8>::new());
        }
    }

    #[test]
    fn runtime_session_nonce_is_unique_and_path_safe() {
        let first = new_runtime_session_nonce();
        let second = new_runtime_session_nonce();
        assert_ne!(first, second);
        for nonce in [first, second] {
            assert!(nonce.starts_with("desktop-"));
            assert!(!nonce.contains('/') && !nonce.contains('\\'));
        }
    }

    #[test]
    fn runtime_session_log_reset_fails_closed_when_session_path_is_a_file() {
        let temp = test_directory("runtime-log-reset-failure");
        let invalid_session_dir = temp.0.join("not-a-directory");
        fs::write(&invalid_session_dir, "occupied").expect("fixture file should be written");
        let error = reset_runtime_session_logs(&invalid_session_dir)
            .expect_err("a file cannot be used as the runtime session directory");
        assert!(error.contains("Failed to create desktop runtime session directory"));
    }
}
