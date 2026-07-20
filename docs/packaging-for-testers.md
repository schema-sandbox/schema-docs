# Packaging and Installer Selection for Testers

This guide outlines available Windows build packages, system runtime requirements, and setup instructions.

## 1. Distribution Formats

| Package Name | File Type | Size | Intended Audience & Recommendations |
|--------------|-----------|------|-------------------------------------|
| `schema-docs_0.1.2_x64-portable.zip` | Portable ZIP | ~34.9MB | Extract the whole ZIP for no-install testing; keep `app.exe` beside `runtime/`. |
| `schema-docs_0.1.2_x64-setup.exe` | NSIS Setup Bundle | ~23.8MB | Normal manual testing and standard installer path. |
| `schema-docs_0.1.2_x64_en-US.msi` | MSI Deployment Package | ~35.0MB | Enterprise deployment, silent network installations, and bulk rollouts. |

The build-tree `app.exe` is not a standalone distribution file. It requires the generated sibling `runtime/` directory, so release operators should distribute the portable ZIP or an installer instead of copying the EXE alone.

## 2. Runtime Modes & Node Dependency
- **Packaged Runtime Bridge:** The Windows package includes `runtime/node.exe` and uses it to start the local background server. System Node is only a fallback if the bundled runtime resource is missing.
- **WebView2 Requirement:** Windows 10/11 requires the Microsoft WebView2 Evergreen Runtime installed (installed by default on modern Windows).

## 3. Environment Diagnosis & Setup Verification
After installing, perform these sanity steps:
1. Click **Desktop diagnostics** on the main topbar.
2. Confirm the diagnostics status reports `Node: v22+`, `isBundled: true`, and `API Health: 200`.
3. If the bundled runtime fails to start, capture Desktop diagnostics and session logs before trying system Node fallback.

## 4. Release Operator Shortcut

Build first, then prepare the three uploadable Windows assets:

```bash
npm run desktop:build
npm run release:windows:prepare
```

`release:windows:prepare` does not run a build. It requires the completed Tauri build tree, checks that `package.json` and `src-tauri/tauri.conf.json` use the same version, verifies the packaged runtime and documentation files, and atomically refreshes the MSI, NSIS installer, portable ZIP, and `release/windows/SHA256SUMS.txt`. A failed validation or compression leaves the previously prepared assets unchanged.

Before handing the prepared build to testers, run:

```bash
npm run release:public-preview
```

This runs the public-preview RC gate and refreshes:

- `docs/release-artifact-index.md`
- `samples/release-artifact-index.json`
- `docs/public-preview-package.md`
- `samples/public-preview-package.json`

## 5. Common Diagnostics and Resolutions

| Symptom | Cause | Resolution |
|---------|-------|------------|
| Black screens or blank launcher | Missing WebView2 | Install Microsoft Edge WebView2 runtime. |
| Port conflict warnings | Port 4177 is in use | The system will automatically fallback to 4178-4199. Try reloading the client. |
| Workspace access denied | File location security gate | Ensure files are located inside your active workspace directories. |
