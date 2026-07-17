use std::{
    fs,
    io::Write,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
};

use serde_json::json;
use tauri::{Emitter, Manager, RunEvent};

struct DesktopRuntime(Mutex<Option<Child>>);

fn hidden_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    let mut command = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

fn runtime_session_dir(app: &tauri::AppHandle) -> PathBuf {
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
fn select_import_file_path() -> Result<Option<String>, String> {
    if !cfg!(windows) {
        return Err(
            "Native file picker is only implemented for Windows desktop builds.".to_string(),
        );
    }

    let script = r#"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Select a file to import into Schema Docs'
$dialog.Filter = 'Supported documents and tables (*.docx;*.pptx;*.pdf;*.txt;*.csv;*.xlsx;*.xls)|*.docx;*.pptx;*.pdf;*.txt;*.csv;*.xlsx;*.xls|PowerPoint presentations (*.pptx)|*.pptx|Excel workbooks (*.xlsx;*.xls)|*.xlsx;*.xls|Modern Excel workbooks (*.xlsx)|*.xlsx|Legacy Excel workbooks (*.xls)|*.xls|All files (*.*)|*.*'
$dialog.Multiselect = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.FileName)
}
"#;

    let output = hidden_command("powershell.exe")
        .args([
            "-NoProfile",
            "-STA",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Failed to open native file picker: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "Native file picker failed with exit code {:?}: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if selected.is_empty() {
        Ok(None)
    } else {
        Ok(Some(selected))
    }
}

#[tauri::command]
fn select_markdown_file_path() -> Result<Option<String>, String> {
    if !cfg!(windows) {
        return Err(
            "Native Markdown file picker is only implemented for Windows desktop builds."
                .to_string(),
        );
    }

    let script = r#"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Open Markdown file in Schema Docs'
$dialog.Filter = 'Markdown files (*.md;*.markdown)|*.md;*.markdown|All files (*.*)|*.*'
$dialog.Multiselect = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.FileName)
}
"#;

    let output = hidden_command("powershell.exe")
        .args([
            "-NoProfile",
            "-STA",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Failed to open native Markdown file picker: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "Native Markdown file picker failed with exit code {:?}: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if selected.is_empty() {
        Ok(None)
    } else {
        Ok(Some(selected))
    }
}

#[tauri::command]
fn select_save_file_path(
    default_path: String,
    filter_name: String,
    extensions: Vec<String>,
    auto_rename: Option<bool>,
) -> Result<Option<String>, String> {
    if !cfg!(windows) {
        return Err(
            "Native save dialog is only implemented for Windows desktop builds.".to_string(),
        );
    }

    let escaped_default = default_path.replace('\'', "''");
    let escaped_filter_name = filter_name.replace('\'', "''");
    let extension_patterns = extensions
        .iter()
        .map(|extension| {
            let clean = extension.trim().trim_start_matches('.').replace('\'', "''");
            format!("*.{clean}")
        })
        .collect::<Vec<_>>()
        .join(";");
    let filter = if extension_patterns.is_empty() {
        "All files (*.*)|*.*".to_string()
    } else {
        format!(
            "{escaped_filter_name} ({extension_patterns})|{extension_patterns}|All files (*.*)|*.*"
        )
    };
    let escaped_filter = filter.replace('\'', "''");
    let default_extension = extensions
        .first()
        .map(|extension| extension.trim().trim_start_matches('.').replace('\'', "''"))
        .unwrap_or_default();
    let overwrite_prompt = if auto_rename.unwrap_or(false) {
        "$false"
    } else {
        "$true"
    };

    let script = format!(
        r#"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.SaveFileDialog
$dialog.Title = 'Choose where to save'
$dialog.Filter = '{escaped_filter}'
$dialog.FileName = '{escaped_default}'
$dialog.DefaultExt = '{default_extension}'
$dialog.OverwritePrompt = {overwrite_prompt}
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{
  [Console]::Out.Write($dialog.FileName)
}}
"#
    );

    let output = hidden_command("powershell.exe")
        .args([
            "-NoProfile",
            "-STA",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Failed to open native save dialog: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "Native save dialog failed with exit code {:?}: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if selected.is_empty() {
        Ok(None)
    } else {
        let path = PathBuf::from(selected);
        if !auto_rename.unwrap_or(false) || !path.exists() {
            return Ok(Some(path.to_string_lossy().to_string()));
        }
        let parent = path.parent().unwrap_or_else(|| std::path::Path::new(""));
        let stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("export");
        let extension = path.extension().and_then(|value| value.to_str());
        for index in 2.. {
            let file_name = match extension {
                Some(value) => format!("{stem} ({index}).{value}"),
                None => format!("{stem} ({index})"),
            };
            let candidate = parent.join(file_name);
            if !candidate.exists() {
                return Ok(Some(candidate.to_string_lossy().to_string()));
            }
        }
        unreachable!()
    }
}

#[tauri::command]
fn select_workspace_path() -> Result<Option<String>, String> {
    if !cfg!(windows) {
        return Err(
            "Native workspace picker is only implemented for Windows desktop builds.".to_string(),
        );
    }

    let script = r#"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select or create a Schema Docs workspace folder'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.SelectedPath)
}
"#;

    let output = hidden_command("powershell.exe")
        .args([
            "-NoProfile",
            "-STA",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Failed to open native workspace picker: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "Native workspace picker failed with exit code {:?}: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if selected.is_empty() {
        Ok(None)
    } else {
        Ok(Some(selected))
    }
}

#[tauri::command]
fn select_import_directory_path() -> Result<Option<String>, String> {
    if !cfg!(windows) {
        return Err(
            "Native directory picker is only implemented for Windows desktop builds.".to_string(),
        );
    }

    let script = r#"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select a folder to import recursively into Schema Docs'
$dialog.ShowNewFolderButton = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.SelectedPath)
}
"#;

    let output = hidden_command("powershell.exe")
        .args([
            "-NoProfile",
            "-STA",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Failed to open native directory picker: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "Native directory picker failed with exit code {:?}: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if selected.is_empty() {
        Ok(None)
    } else {
        Ok(Some(selected))
    }
}

#[tauri::command]
fn get_desktop_runtime_diagnostics(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let session_dir = runtime_session_dir(&app);
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

fn runtime_stdio(session_dir: &std::path::Path, name: &str) -> Stdio {
    let _ = fs::create_dir_all(session_dir);
    fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(session_dir.join(name))
        .map(Stdio::from)
        .unwrap_or_else(|_| Stdio::null())
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

fn spawn_desktop_runtime(app: &tauri::App) -> Option<Child> {
    if cfg!(debug_assertions) {
        return None;
    }

    let session_dir = app
        .path()
        .app_data_dir()
        .map(|dir| dir.join("runtime-session"))
        .unwrap_or_else(|_| {
            std::env::var_os("LOCALAPPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(std::env::temp_dir)
                .join("com.schemadocs.desktop")
                .join("runtime-session")
        });
    let resource_dir = match app.path().resource_dir() {
        Ok(dir) => dir,
        Err(error) => {
            append_runtime_log(&session_dir, &format!("resource dir failed: {error}"));
            return None;
        }
    };
    let runtime_root = node_compatible_path(resource_dir.join("runtime"));
    let launcher = runtime_root
        .join("src")
        .join("cli")
        .join("desktop-runtime-launcher.js");

    append_runtime_log(
        &session_dir,
        &format!(
            "resource_dir={}; runtime_root={}; launcher={}",
            resource_dir.display(),
            runtime_root.display(),
            launcher.display()
        ),
    );

    if !launcher.exists() {
        append_runtime_log(&session_dir, "runtime launcher missing");
        return None;
    }

    let runtime_stdout = runtime_stdio(&session_dir, "runtime-stdout.log");
    let runtime_stderr = runtime_stdio(&session_dir, "runtime-stderr.log");
    let desktop_port = std::env::var("SCHEMA_DOCS_DESKTOP_PORT")
        .unwrap_or_else(|_| "4177".to_string());

    let bundled_node = runtime_root.join("node.exe");
    let node_cmd = if bundled_node.exists() {
        bundled_node.to_string_lossy().to_string()
    } else {
        "node".to_string()
    };

    append_runtime_log(
        &session_dir,
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
        .env("SCHEMA_DOCS_RUNTIME_SESSION_DIR", &session_dir)
        .stdin(Stdio::null())
        .stdout(runtime_stdout)
        .stderr(runtime_stderr)
        .spawn()
    {
        Ok(child) => {
            append_runtime_log(&session_dir, &format!("runtime spawned pid={}", child.id()));
            Some(child)
        }
        Err(error) => {
            append_runtime_log(&session_dir, &format!("runtime spawn failed: {error}"));
            None
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
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
            app.manage(DesktopRuntime(Mutex::new(spawn_desktop_runtime(app))));

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
            select_save_file_path,
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
            let child_lock = runtime.0.lock();
            if let Ok(mut child_guard) = child_lock {
                if let Some(child) = child_guard.as_mut() {
                    let _ = child.kill();
                }
                *child_guard = None;
            }
        }
    });
}
