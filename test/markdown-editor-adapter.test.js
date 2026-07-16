import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Markdown editor stays offline and does not load remote or legacy editor assets", async () => {
  const [adapter, html] = await Promise.all([
    readFile(path.join(projectRoot, "public", "markdownEditorAdapter.js"), "utf8"),
    readFile(path.join(projectRoot, "public", "index.html"), "utf8")
  ]);

  assert.doesNotMatch(adapter, /https?:\/\//);
  assert.doesNotMatch(adapter, /esm\.sh/);
  assert.match(adapter, /activateReadableFallback/);
  assert.match(adapter, /addEventListener\("click", \(event\) => \{/);
  assert.doesNotMatch(adapter, /addEventListener\("dblclick"/);
  assert.doesNotMatch(adapter, /new window\.Vditor/);
  assert.doesNotMatch(html, /libs\/vditor/);
});
