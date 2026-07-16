/**
 * Schema Docs Core SDK - Local Installation Helper
 * Automates setting up a local copy of the Schema Docs core SDK
 * inside external Node.js projects.
 */

import { cp, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

async function main() {
  const args = process.argv.slice(2);
  const targetDir = args[0] ? path.resolve(args[0]) : null;

  if (!targetDir) {
    console.error("Error: Please specify a target directory for the SDK installation.");
    console.error("Usage: npm run install-sdk <target-directory-path>");
    process.exit(1);
  }

  console.log(`=== Schema Docs SDK Installation ===`);
  console.log(`Target path: ${targetDir}`);

  try {
    // 1. Ensure target directory exists
    await mkdir(targetDir, { recursive: true });

    // 2. Resolve source directories relative to this file
    const rootDir = path.resolve(import.meta.dirname, "..");

    // 3. Define directories to copy
    const itemsToCopy = [
      { from: path.join(rootDir, "index.js"), to: path.join(targetDir, "schema-docs.js") },
      { from: path.join(rootDir, "src", "core"), to: path.join(targetDir, "src", "core") },
      { from: path.join(rootDir, "src", "adapters"), to: path.join(targetDir, "src", "adapters") }
    ];

    for (const item of itemsToCopy) {
      console.log(`- Copying: ${path.relative(rootDir, item.from)} -> ${path.relative(targetDir, item.to)}`);
      await cp(item.from, item.to, { recursive: true });
    }

    // 4. Update the exported imports in the local schema-docs.js to point correctly
    // The relative paths inside schema-docs.js (which was index.js) are:
    // export { createAppService } from "./src/core/appService.js";
    // Since we copied src/core to targetDir/src/core and index.js to targetDir/schema-docs.js,
    // the relative import paths are exactly the same! This is extremely elegant.

    // 5. Output a sample integration file for the developer
    const sampleCode = `/**
 * Schema Docs SDK Integration Example
 * Verify local document intake and privacy masking gateway.
 */
import { maskSensitiveData, detectAdapterCapabilities } from "./schema-docs.js";

// 1. Check system converters (LibreOffice, Pandoc, Tesseract OCR)
const capabilities = await detectAdapterCapabilities();
console.log("System Adapter Capabilities:", capabilities);

// 2. Perform local privacy masking
const originalText = "System password is 'admin123' and admin email is boss@enterprise.com.";
const { maskedText, mapping } = maskSensitiveData(originalText);

console.log("\\n--- Original Text ---");
console.log(originalText);

console.log("\\n--- Masked Context (Safe for LLM) ---");
console.log(maskedText);
`;

    await writeFile(path.join(targetDir, "demo-integration.js"), sampleCode, "utf8");
    console.log(`- Created: demo-integration.js`);

    console.log(`\n===================================================`);
    console.log(`[SUCCESS] Schema Docs Core SDK installed successfully!`);
    console.log(`To run the integration verification demo:`);
    console.log(`  cd "${targetDir}"`);
    console.log(`  node demo-integration.js`);
    console.log(`===================================================`);
  } catch (err) {
    console.error("Installation failed:", err.message);
    process.exit(1);
  }
}

main();
