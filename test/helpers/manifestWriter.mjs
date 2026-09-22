import { readManifest, writeManifest, openOrCreateWorkspace } from "../../src/core/manifest.js";
import { saveMarkdown } from "../../src/core/markdown.js";
import { addMarkdownVersion } from "../../src/core/versions.js";
if (process.send) await run();
async function run() {
const [workspace, mode, id] = process.argv.slice(2);
const next = () => new Promise(resolve => process.once("message", resolve));
const manifest = mode === "initialize" ? null : await readManifest(workspace);
process.send({ event: "ready" });
await next();
try {
  if (mode === "initialize") await openOrCreateWorkspace(workspace);
  else if (mode === "save") {
    process.send({ event: "attempt" });
    await saveMarkdown(workspace, id, "Edited by another process");
  }
  else if (mode === "version") await addMarkdownVersion(workspace, id, "manual_save", "doc", `Edit ${process.pid}`);
  else {
    if (mode === "edit") manifest.documents.find(item => item.id === id).title = `Edited ${process.pid}`;
    else if (mode === "delete") manifest.documents = manifest.documents.filter(item => item.id !== id);
    else if (mode === "switch") manifest.documents.find(item => item.id === "doc").outputMarkdownPath = id;
    else manifest.documents.push({ id, title: id });
    process.send({ event: "attempt" });
    await writeManifest(workspace, manifest, ["hold", "switch"].includes(mode) ? { beforeCommit: async () => {
      process.send({ event: "locked" });
      await next();
    } } : {});
  }
  process.send({ event: "done", ok: true });
} catch (error) { process.send({ event: "done", ok: false, code: error.code, message: error.message }); }
process.disconnect();
}
