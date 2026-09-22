import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function verifyConversionRuntime(directory, { publicRelease = false } = {}) {
  const root = await realpath(directory);
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  if (manifest.schema !== "schema-docs.conversion-runtime.v1" || !manifest.files?.length) throw new Error("Invalid conversion runtime manifest");
  if (publicRelease && manifest.nativeTransitiveNotices !== "verified") throw new Error("Native runtime redistribution notices have not been verified");
  let bytes = 0;
  const seen = new Set();
  for (const entry of manifest.files) {
    const target = path.resolve(root, entry.path);
    if (!target.startsWith(`${root}${path.sep}`) || seen.has(target) || path.isAbsolute(entry.path)) throw new Error("Invalid runtime inventory path");
    seen.add(target);
    if (!(await realpath(target)).startsWith(`${root}${path.sep}`)) throw new Error("Runtime file escapes its inventory root");
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== entry.bytes) throw new Error(`Runtime file changed: ${entry.path}`);
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(target)) digest.update(chunk);
    if (digest.digest("hex") !== entry.sha256) throw new Error(`Runtime checksum mismatch: ${entry.path}`);
    bytes += info.size;
  }
  if (bytes !== manifest.bytes) throw new Error("Runtime total differs from inventory");
  async function inspect(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, item.name);
      if (item.isSymbolicLink()) throw new Error("Runtime contains a symbolic link");
      if (item.isDirectory()) await inspect(target);
      else if (target !== path.join(root, "manifest.json") && !seen.has(target)) throw new Error(`Unlisted runtime file: ${path.relative(root, target)}`);
    }
  }
  await inspect(root);
  return { verified: true, fileCount: seen.size, bytes, nativeTransitiveNotices: manifest.nativeTransitiveNotices };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await verifyConversionRuntime(path.resolve(import.meta.dirname, "../runtime"),
      { publicRelease: process.argv.includes("--public") }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
