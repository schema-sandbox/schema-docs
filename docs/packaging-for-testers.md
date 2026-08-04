# Windows Packages for Testers

## Package choice

| File | Use |
| --- | --- |
| `schema-docs_0.1.4_x64-portable.zip` | No-install testing. Extract the entire ZIP and keep `app.exe` beside `runtime/`. |
| `schema-docs_0.1.4_x64-setup.exe` | Recommended interactive Windows installer. |
| `schema-docs_0.1.4_x64_en-US.msi` | Enterprise, silent, or managed deployment. |

The build-tree `app.exe` is not a standalone release: it needs the sibling `runtime/` directory. Distribute the portable ZIP or an installer.

## Requirements and sanity check

- The package includes `runtime/node.exe`; system Node is only a fallback if that resource is missing.
- Windows 10/11 needs Microsoft WebView2 Evergreen Runtime, normally already installed.

After installation:

1. Open **Desktop diagnostics** from the top bar.
2. Confirm `Node: v22+`, `isBundled: true`, and `API Health: 200`.
3. If startup fails, capture diagnostics and session logs before trying system Node.

## Release operator commands

```bash
npm run desktop:build
npm run release:windows:prepare
```

`release:windows:prepare` requires a completed Tauri build. It checks matching versions in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`; verifies runtime and docs; then atomically refreshes the MSI, NSIS, portable ZIP, and `release/windows/SHA256SUMS.txt`. Failure leaves prior assets unchanged.

Before tester handoff, run:

```bash
npm run release:public-preview
```

This runs the public-preview RC gate and refreshes the artifact index and package reports under `docs/` and `samples/`.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| Blank launcher | Install Microsoft Edge WebView2 Runtime. |
| Port 4177 busy | The app automatically tries ports 4178–4199; reload the client. |
| Workspace access denied | Keep files inside the active workspace. |
