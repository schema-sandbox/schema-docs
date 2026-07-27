import { readFile } from "node:fs/promises";
import path from "node:path";
import { initExportLibraries } from "../src/core/markdownExportPipeline.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node scripts/check-markdown-math.mjs <markdown-file>");
  process.exit(2);
}

const markdown = await readFile(path.resolve(inputPath), "utf8");
const { katex } = await initExportLibraries();
const formulas = [
  ...markdown.matchAll(/\$\$\s*([\s\S]*?)\s*\$\$/g),
  ...markdown.matchAll(/(?<!\$)\$([^$\n]+)\$(?!\$)/g)
].map((match) => match[1]);
const invalid = [];

for (const [index, formula] of formulas.entries()) {
  try {
    katex.renderToString(formula, {
      displayMode: true,
      throwOnError: true,
      strict: "ignore"
    });
  } catch (error) {
    invalid.push({
      index: index + 1,
      formula,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

console.log(JSON.stringify({
  file: path.resolve(inputPath),
  formulas: formulas.length,
  invalid
}, null, 2));
process.exitCode = invalid.length ? 1 : 0;
