import path from "node:path";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const applicationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export async function digestFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function applicationFiles(root = applicationRoot) {
  const files = [];
  async function visit(relative) {
    for (const entry of await readdir(path.join(root, relative), {withFileTypes:true}).catch(e => {
      if(e.code === "ENOENT") return []; throw e;
    })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Runtime file must not be a link: ${name}`);
      if (entry.isDirectory() && entry.name !== "__pycache__") await visit(name);
      else if (entry.isFile() && !/\.py[co]$/.test(name)) files.push(name);
    }
  }
  for (const directory of ["src","public","config"]) await visit(directory);
  for (const file of ["package.json","runtime/manifest.json"]) if (await stat(path.join(root,file)).catch(()=>null)) files.push(file);
  return files.sort();
}

export async function collectRuntimeIdentity(root = applicationRoot) {
  const files = {};
  for (const file of await applicationFiles(root)) files[file] = await digestFile(path.join(root,file));
  const manifest = await readFile(path.join(root,"runtime/manifest.json"),"utf8").then(JSON.parse).catch(e=>{
    if(e.code === "ENOENT") return null; throw e;
  });
  // Bind the actual native libraries and models as well as their receipt.
  const dependencyFiles = {};
  for (const entry of manifest?.files || []) {
    dependencyFiles[entry.path] = await digestFile(path.join(root,"runtime",entry.path));
    if (dependencyFiles[entry.path] !== entry.sha256) throw new Error(`Runtime dependency mismatch: ${entry.path}`);
  }
  const buildId = createHash("sha256").update(JSON.stringify({files,dependencyFiles})).digest("hex");
  return { buildId, root, files, dependencyFiles, node: process.version, nodeExecutable:process.execPath,
    pythonExecutable:manifest ? path.join(root,"runtime/python/python.exe") : null,
    dependencyVersions:manifest ? {python:manifest.python,packages:manifest.packages,tesseract:manifest.tesseract} : null,
    platform:process.platform,arch:process.arch };
}

export async function verifyStagedRuntime(root = applicationRoot) {
  const receipt = JSON.parse(await readFile(path.join(root, 'runtime-build-manifest.json'), 'utf8'));
  const identity = await collectRuntimeIdentity(root);
  if (receipt.buildId !== identity.buildId || JSON.stringify(receipt.sourceFiles) !== JSON.stringify(identity.files)) {
    throw new Error('Staged application differs from its build receipt.');
  }
  if (await digestFile(path.join(root, 'node.exe')) !== receipt.nodeExecutableHash) throw new Error('Staged Node differs from its build receipt.');
  return identity;
}
