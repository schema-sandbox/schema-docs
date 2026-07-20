# Public Preview Manual Verification Checklist (v0.1.2)

This checklist guides manual testers through validating the core workflows of Schema Docs on Windows. Follow the steps in sequence and record your results.

> [!IMPORTANT]
> **Primary Target Platform**: Windows is the prioritized target for the v0.1.2 public preview. Verification on other operating systems is not promised or officially supported for this release.

> [!WARNING]
> **Privacy Safety Warning**: Do NOT paste or record real production API keys, production tokens, or actual credentials in the workspace settings, prompt preview field, or verification records. Use mock keys (e.g. `sk-proj-123456...` or `bearer eyJ...`) for verification.

---

## Verification Steps

### Step 1: Client Installation
* **Instructions**: Verify that the application installer runs correctly without requiring administrative rights.
* **Steps**:
  1. Double-click `schema-docs_0.1.2_x64-setup.exe`.
  2. Follow the setup wizard to complete the installation.
  3. Verify that a shortcut named **Schema Docs** is created on your Desktop.

| Test Case | Expected Result | Pass | Fail | Notes / Anomalies |
|---|---|---|---|---|
| Installer Wizard Launches | Setup window opens with clear guidance and no errors | | | |
| Desktop Shortcut Created | Icon appears on desktop after installation finishes | | | |
| No Admin UAC Required | The installer runs within the user scope without elevation prompts | | | |

---

### Step 2: First Open & Diagnostics
* **Instructions**: Verify that the application boots and initializes the local backend runtime bridge automatically.
* **Steps**:
  1. Launch the app using the desktop shortcut.
  2. Click **Desktop diagnostics**.
  3. Observe the diagnostics output and API health status.
  4. Optional: Click **Run first workflow** to run the initial demo loop and verify everything passes.

| Test Case | Expected Result | Pass | Fail | Notes / Anomalies |
|---|---|---|---|---|
| GUI Launches Successfully | Main workspace dashboard displays with no errors | | | |
| Local API Status | Indicates green / healthy | | | |
| Node Runtime | Displays the bundled `runtime/node.exe` path or a system `node` fallback, plus the detected Node version | | | |
| WebView2 Active | Dashboard renders cleanly with no layout distortion | | | |

---

### Step 3: Entry Mode Selection
* **Instructions**: Verify that the workspace environment correctly structures the target context interface.
* **Steps**:
  1. Click to open or initialize a workspace.
  2. Confirm you can select or toggle the workspace configuration mode.

| Test Case | Expected Result | Pass | Fail | Notes / Anomalies |
|---|---|---|---|---|
| Office-First Mode | Interface switches to a file-based intake dashboard with drop zones | | | |
| Markdown/API-First Mode | Interface exposes developer API endpoints, schemas, and token parameters | | | |

---

### Step 4: Local Document Intake
* **Instructions**: Test the offline text extraction performance of the AI Context Intake Layer.
* **Steps**:
  1. Under Office-first mode, drag and drop a `.docx` or `.xlsx` file into the dashboard.
  2. Or click **Create sample Word and import** to load the pre-built mock file.
  3. Alternatively, click **Choose local file** to pick a file via the native Windows file selection dialog.

| Test Case | Expected Result | Pass | Fail | Notes / Anomalies |
|---|---|---|---|---|
| Import File | The file is listed in the dashboard with correct size and type | | | |
| Local Extraction | Select the record and click **Extract to Markdown**; clean Markdown opens in the editor | | | |
| Formula Edit | In Preview/Read mode, single-click a paragraph or table cell containing a formula; the editor shows the original `$...$` / `$$...$$` LaTeX on normal lines, not one rendered character per line | | | |
| CJK Formula PDF Export | Export a note containing Chinese text plus inline and display formulas, then open the PDF. Chinese text and rendered formulas are legible; no mojibake, raw `$...$`, `\frac`, or Markdown markers remain | | | |

---

### Step 5: "AI Will See" Preview Verification
* **Instructions**: Verify that prompt content is visible and masked before network transmission.
* **Steps**:
  1. Select the imported document record.
  2. Click **Extract to Markdown** or stage the extracted Markdown in the AI Send Gate panel.
  3. Keep **Enable local reversible masking gateway (PII/Secret Masking)** checked.
  4. Click **Generate send preview** or **Review staged context**.
  5. Confirm the **AI Will See** panel shows the exact reviewed context.

| Test Case | Expected Result | Pass | Fail | Notes / Anomalies |
|---|---|---|---|---|
| Preview Visibility | AI Will See matches the exact characters staged for sending | | | |
| Masking Replacement | PII (phone numbers, emails) are replaced with `[MASK_*]` placeholders | | | |

---

### Step 6: Send Gate Protection Test
* **Instructions**: Verify that the Privacy & Safety Gateway intercepts credential leaks.
* **Steps**:
  1. In the Markdown editor, paste a raw AWS key or API key like `sk-proj-123456...`.
  2. Click **Generate send preview**.
  3. Check **Confirm sending the reviewed content to the model service**.
  4. Click **Confirm send**.
  5. Verify that Send Gate intercepts the payload and blocks the transmission.
  6. Clear or mask the key, then regenerate the preview and verify the decision changes.

| Test Case | Expected Result | Pass | Fail | Notes / Anomalies |
|---|---|---|---|---|
| Credential Hard Block | Red warning appears and confirmed send is blocked locally | | | |
| Safety Gate Reset | Send Gate decision changes once credentials are removed or masked | | | |

---

### Step 7: Handoff & Exchange Package Export
* **Instructions**: Verify that the Handoff & Exchange Interface packages SDXP directories.
* **Steps**:
  1. Set the package path in the **Exchange Package** panel.
  2. Click **Save exchange package**.
  3. Click **Read and verify package**.
  4. Click **Write receiver report**.
  5. Click **View trust report** to see the structured trust guidance report in the UI.
  6. Verify the existence of `manifest.json`, `document.md`, `receiver-report.md`, and `trust-report.json`.

| Test Case | Expected Result | Pass | Fail | Notes / Anomalies |
|---|---|---|---|---|
| SDXP Directory Created | An exchange package folder is generated in your workspace path | | | |
| Receiver Report Written | `receiver-report.md` exists and shows correct trust parameters | | | |

---

### Step 8: Problem Reporting & Diagnostics Export
* **Instructions**: Verify that diagnostic logs are packaged without exposing secrets.
* **Steps**:
  1. Click **Desktop diagnostics**.
  2. In the Settings tab, click **Generate diagnostic bundle** if available.
  3. Confirm the diagnostics output points to sanitized local evidence or session logs.

| Test Case | Expected Result | Pass | Fail | Notes / Anomalies |
|---|---|---|---|---|
| Feedback Bundle Generation | A sanitized feedback bundle or diagnostics path is produced | | | |

---

## Test Environment Metadata

Please fill out the following table for the target testing system:

| Parameter | Value / Status |
|---|---|
| **Windows Version** | (e.g., Windows 11 23H2 Build 22631) |
| **WebView2 Presence** | (e.g., Installed / System Default) |
| **Node.js Version** | (e.g., v20.11.0 / Not Found) |
| **Installer Type** | (NSIS .exe Setup / MSI Enterprise Bundle) |
| **Local Model / API Provider** | (e.g., None / Local Ollama / Mock API) |
| **Test Files Used** | (e.g., sample-contract.docx, patient-records.pdf) |

---

## Evidence to Capture

When submitting verification records or bug reports, please compile the following files/artifacts:

1. **Screenshot Names**:
   - `01_diagnostics_screen.png` (Showing green lights for Local API & Node)
   - `02_ai_will_see_panel.png` (Showing masked customer PII)
   - `03_send_gate_blocked.png` (Showing red safety block notification)
2. **Logs Path**: `.ai-doc-exchange/logs/session.log`
3. **Feedback Bundle Path**: `diagnostics-feedback-bundle.zip`
4. **Exchange Package Path**: `my-workspace/packages/my-file.exchange/`
5. **Trust Report Path**: `my-workspace/packages/my-file.exchange/receiver-report.md` (or `trust-report.json`)

---

## 30-Minute Public Preview Smoke Script

This runbook helps you verify the end-to-end functionality of Schema Docs in under 30 minutes.

### 1. Install & Launch (Time: 3 mins)
* **Action**: Run the installer (`schema-docs_0.1.2_x64-setup.exe`) and launch the application from the desktop shortcut.
* **Expected Result**: The installer runs without administrative elevation (UAC) prompts, creates a desktop shortcut, and launches a clean graphical user interface (GUI) without any error dialogs.

### 2. Run Diagnostics & Bridge Check (Time: 3 mins)
* **Action**: Click the **Desktop diagnostics** button in the top workspace panel, then click **Generate diagnostic bundle**.
* **Expected Result**: Both the **Local API Status** and **Node Runtime** indicators are green. Clicking the bundle button produces a sanitized `diagnostics-feedback-bundle.zip` on your system.

### 3. Workspace Initialization & File Intake (Time: 10 mins)
* **Action**: Click **Choose workspace** to select or create a temporary workspace folder. Switch to **Office-first** product entry mode if prompted. Import the following four sample file formats:
  1. **DOCX**: Click **Create sample Word and import** (or drag and drop a `.docx` file).
  2. **PDF**: Drag and drop a digital `.pdf` file.
  3. **CSV**: Drag and drop a `.csv` data table.
  4. **XLSX**: Drag and drop an `.xlsx` spreadsheet.
* **Expected Result**:
  - All four files are successfully imported, listed in the inbox with correct names, extensions, and file sizes.
  - Selecting each file and clicking **Extract to Markdown** (or **Inspect dataset** for CSV/XLSX) loads the raw text or structural rows into the workspace.

### 4. "AI Will See" & Local Reversible Masking (Time: 5 mins)
* **Action**: Select the imported DOCX or PDF document. Check the box for **Mask PII and secrets before sending (local, reversible)**, then click **Generate send preview**.
* **Expected Result**: The **AI Will See** preview panel displays. All sensitive phone numbers, emails, and names are fully masked with standard placeholders (e.g. `[MASK_PHONE_1]`, `[MASK_EMAIL_1]`).

### 5. Send Gate Safety Gateway Interception (Time: 4 mins)
* **Action**: Paste a mock AWS-style key such as `AWS Key: AKIA...MOCK...ABCDEF` into the staged context textbox. Click **Generate send preview**. Check the **Confirm sending the reviewed content to the model service** box, then click **Confirm send**.
* **Expected Result**: The safety gateway intercepts the action, displays a red Send Gate block notification in the alert container saying `ai_send_gate_review_required`, and successfully blocks transmission.

### 6. Exchange Package Export & Trust Report (Time: 5 mins)
* **Action**: Clear the mock credential from the text field. Click **Save exchange package** to build an SDXP bundle. Click **Read and verify package**, then **Write receiver report**, and finally **View trust report**.
* **Expected Result**:
  - A portable `.exchange` directory is created in the workspace packages folder containing `manifest.json`, `document.md`, and `evidence.jsonl`.
  - The UI updates the SDXP summary showing file integrity validation checks as green/successful.
  - The trust report displays a structured summary showing the trust verdict (`trusted` or `trusted_with_warnings`).

---

## Failure Report Template

If any step in the checklist fails, please fill out this template and submit it on GitHub:

```markdown
### Environment
- OS / Windows Build:
- WebView2 / Node Version:
- Installer Used (MSI / NSIS):

### Steps to Reproduce
1. (Describe step-by-step actions)
2.

### Diagnostic Metadata
- File Type & Extension:
- Action Attempted:
- Expected Result:
- Actual Result:
- Send Gate Decision (Allowed / Blocked):
- Quality Warnings Displayed (if any):
- Diagnostic Bundle Path / Logs:
- Screenshots Attached: (e.g. 03_send_gate_blocked.png)
```


---

# Schema Docs Manual QA Smoke Test Checklist

Use this guide to verify all stability, feedback, layout, and localization changes introduced in Task Package D.

All test fixtures are located at: `test-fixtures/manual-smoke/`

---

## 1. Import & Progress Inspection (一键导入与状态可见性)
- **Action**: Open the application, select **Product Entry (产品入口)** -> Choose **Document-first (Office-first)** workspace.
- **Action**: Click the Drag-and-Drop area or input path `test-fixtures/manual-smoke/simple.docx` or `simple.xlsx` to import.
- **Verification**:
  - The import button should temporarily show `Importing...` / `正在导入...` and become disabled to prevent double clicks.
  - On complete, the button shows `Success` / `成功` for 1 second, then reverts to normal.
  - The status timeline updates with step logs. No operations should fail silently.

## 2. PDF Diagnostics & OCR Warning UI (PDF 低可读性诊断与美化提示)
- **Action**: Import `test-fixtures/manual-smoke/bad-ocr-required.pdf`. This PDF has no readable text layer.
- **Action**: Go to the **Markdown Workspace (Markdown 工作区)** and open this note.
- **Verification**:
  - The workspace reading panel should **NOT** render raw mojibake/garbled text.
  - Instead, it must display a beautifully styled **PDF Diagnostics Board (PDF 提取诊断与优化建议)**.
  - Switch language to **中文界面**. The board should translate fully to Chinese: showing extractor (`built-in`), character count, readability rating (`low` / `低可读性`), and AI send gate status (`Review Required` / `需人工审核`).
  - Compare this with importing `test-fixtures/manual-smoke/readable.pdf` which should render normal text paragraphs immediately.

## 3. Left Outline & Segmented Navigation (章节大纲隐藏与分段导航)
- **Action**: Open `test-fixtures/manual-smoke/simple.md` (which has only 1 heading).
- **Verification**:
  - The left outline panel (大纲) should auto-hide (`style.display = "none"`) to avoid empty space clutter.
- **Action**: Import `test-fixtures/manual-smoke/long.md` (a large file which splits into multiple segments). Go to the Markdown Workspace.
- **Verification**:
  - The left大纲 should auto-hide due to duplicate/high chapter count (keeping outline minimal).
  - Prepend to the document metadata section: A **Segment Navigation Panel (文档分段导航)** is displayed, showing:
    - Current segment index (e.g. `Current: Part 1 / 5`).
    - Active buttons: `← Prev`, `Next →`, and `Open Index` (打开完整目录).
    - Clicking `Next →` loads the next chunk instantly with complete button state feedback.

## 4. Absolute Export Paths & Folder Opener (导出绝对路径与打开文件夹)
- **Action**: Click **Export Word** / **Export PDF** / **Export HTML** inside the workbench.
- **Verification**:
  - The export button temporarily shows `Exporting...` / `正在导出...` and becomes disabled.
  - On complete, it displays the **absolute path** (e.g., `<project-root>\exports\simple.docx`) rather than just `exports/...`.
  - Open the exported PDF and confirm Chinese text and rendered formulas are legible, with no mojibake, raw `$...$`, `\frac`, or Markdown markers.
  - Click **Open Folder (打开文件夹)**. If local folder opening fails (e.g., in headless or browser bridge mode), an alert explicitly prompts: *"Failed to open folder: [Error details]. Please manually open the path: [absolutePath]"*.

## 5. Editor Mode Simplification & Localization (极简编辑区与全中文巡检)
- **Action**: Switch global language to **中文界面**.
- **Verification**:
  - Every button text, hint, sidebar statistics, status log, and error message must render in pure Chinese. No english fallback strings like "Extraction confidence: high" (which must show "提取置信度：高").
- **Action**: Toggle **Advanced Tools (高级工具)** off.
- **Verification**:
  - Split-view, code-view, formatting toolbars, global/local search boxes, and batch actions are automatically hidden.
  - The interface simplifies into a clean, unified Obsidian-like editor workspace with a single reading pane.
