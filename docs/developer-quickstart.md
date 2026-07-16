# Schema Docs Developer Quickstart

Welcome to the development guide for **Schema Docs: AI Document Intake and Send Gate**. This guide is designed to help new contributors get running and understand the architecture in 10 minutes.

---

## 1. Repository Layout

* **`src/core/`**: The core business logic (workspace manifests, desensitization masking, version history, exchange packaging, timeline events). This layer is offline-first and designed to stay environment-agnostic.
* **`src/adapters/`**: Integrations with external file formats, database formats, and LLM APIs.
* **`src/server/`**: Local HTTP REST API wrapping the core service layer.
* **`src/cli/`**: CLI command-line entry points, preflight checkers, size auditors, and release runners.
* **`public/`**: Frontend served Web UI dashboard, composed of pure, framework-free browser modules.
* **`src-tauri/`**: Desktop WebView2 shell and summon key listening bridges compiled using Rust.
* **`docs/`**: Standard Markdown documentation, specifications, release plan, and implementation status.
* **`samples/`**: Default messy regression specimens, fixture plans, and verification records.

---

## 2. Core Policies

### No Runtime Dependencies Policy
To guarantee maximum security, portability, and zero-trust verification, the project enforces a **0 runtime dependencies** rule in `package.json`.
- All parsing, formatting, and networking are built using Node built-in modules (`fs`, `path`, `zlib`, etc.) or written as custom light-weight code.
- Any new third-party utility is strictly disallowed unless it is registered under `devDependencies` and used purely for testing or building (e.g. `@tauri-apps/cli` or `jest`).

### Sizing and Budget Rules
Sizing is audited on every release check using `npm run size-check`. The budgets are:
* Runtime files count: $\le$ 76
* Source files count: $\le$ 170
* Runtime size: $\le$ 1.16MB
* Total repository source code: $\le$ 1.7MB
* Individual public browser module: $\le$ 100KB
* Largest checked runtime file: $\le$ 125KB
* Largest checked source file: $\le$ 100KB

### English-Only Runtime Rule
All runtime source code, error messages, configurations, and user interfaces must use **default English** to keep public preview boundaries clear.
- Multilingual strings are only allowed in tests, regression specimens, and whitelist files.
- Run `npm run language-boundary-check` to verify compliance.

---

## 3. How to Run Locally

### Run Web UI & Local Server
1. Install development dependencies:
   ```bash
   npm install
   ```
2. Start the local HTTP server:
   ```bash
   npm run serve
   ```
   This serves the Web UI and local workspace APIs on `http://127.0.0.1:4177`.

### Run Tests
```bash
# Run Node unit and integration tests
npm test

# Run offline smoke suite
npm run smoke
```

### Run Desktop Preview
If you have Rust and Tauri preflight tooling installed:
```bash
# Start desktop Tauri preview shell
npm run desktop:dev
```

---

## 4. Extending the Codebase

### How to Add a Document Converter Adapter
1. Create a new file in `src/adapters/` (e.g. `src/adapters/myFormatConverter.js`).
2. Export a converter object with the standard adapter fields:
   ```javascript
   export const myFormatConverter = {
     name: "my-format-converter",
     canHandle(file) {
       return file.endsWith(".myfmt");
     },
     async convert(input) {
       return {
         markdown: "# My Content\n...",
         warnings: ["Simplified layout"],
         quality: { hasTextLayer: true, confidence: "high" }
       };
     }
   };
   ```
3. Register the new converter in `src/core/appService.js` under `documentConverterForType`:
   ```javascript
   import { myFormatConverter } from "../adapters/myFormatConverter.js";
   // ...
   function documentConverterForType(sourceType) {
     if (sourceType === "myfmt") return myFormatConverter;
     // ...
   }
   ```

### How to Add a Send Gate Rule
PII and credentials masking rules are configuration-driven.
1. Open `src/core/dlp-rules.json`.
2. Append a new regex rule:
   ```json
   {
     "name": "MY_CUSTOM_SECRET",
     "pattern": "custom_secret_[0-9A-Za-z]{12}",
     "label": "custom_secret_like",
     "level": "red"
   }
   ```
3. The rules are compiled automatically at runtime by `src/core/masking.js`.

### How to Add a Public UI Module
1. Write a new panel module in `public/` (e.g. `public/customPanel.js` exporting an initialization function).
2. Wire it in `public/app.js` and load it:
   ```javascript
   import { initCustomPanel } from "./customPanel.js";
   // ...
   initCustomPanel(workspaceManager);
   ```
3. Insert corresponding DOM nodes in `public/index.html` with unique and descriptive IDs.
4. Update `src/cli/ui-check.js` to whitelist new DOM element IDs if they are required.
