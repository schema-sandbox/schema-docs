import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import { readManifest, writeManifest, openOrCreateWorkspace, getManifestPath } from "../src/core/manifest.js";

function writer(workspace, mode, id) {
  const child = spawn(process.execPath, [path.resolve("test/helpers/manifestWriter.mjs"), workspace, mode, id],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const messages = [], listeners = [];
  let stderr = "";
  child.stderr.on("data", data => { stderr += data; });
  child.on("message", message => {
    messages.push(message);
    for (const wake of listeners.splice(0)) wake();
  });
  const closed = once(child, "close");
  return { child, messages, closed, async wait(event) {
    const deadline = Date.now() + 15000;
    while (!messages.some(message => message.event === event)) {
      assert.equal(child.exitCode, null, stderr);
      assert.ok(Date.now() < deadline, `Timed out: ${event}; ${stderr}`);
      await Promise.race([new Promise(resolve => listeners.push(resolve)), delay(100)]);
    }
    return messages.find(message => message.event === event);
  } };
}

test("separate processes merge independent additions and reject competing record edits/deletions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "manifest-process-"));
  const children = [];
  try {
    await openOrCreateWorkspace(root);
    const a = writer(root, "add", "a"), b = writer(root, "add", "b");
    children.push(a, b);
    await Promise.all([a.wait("ready"), b.wait("ready")]);
    a.child.send("go"); b.child.send("go");
    assert.ok((await a.wait("done")).ok); assert.ok((await b.wait("done")).ok);
    assert.deepEqual((await readManifest(root)).documents.map(item => item.id).sort(), ["a", "b"]);
    const edit = writer(root, "edit", "a"), remove = writer(root, "delete", "a");
    children.push(edit, remove);
    await Promise.all([edit.wait("ready"), remove.wait("ready")]);
    edit.child.send("go"); assert.ok((await edit.wait("done")).ok);
    remove.child.send("go");
    assert.equal((await remove.wait("done")).code, "manifest_write_conflict");
    assert.match((await readManifest(root)).documents.find(item => item.id === "a").title, /^Edited/);
  } finally {
    for (const item of children) { if (item.child.exitCode === null) item.child.kill(); }
    await Promise.all(children.map(item => item.closed));
    await rm(root, { recursive: true, force: true });
  }
});

test("a live writer excludes another process and forced termination releases the lock without stealing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "manifest-killed-"));
  const children = [];
  try {
    await openOrCreateWorkspace(root);
    const held = writer(root, "hold", "uncommitted"), waiting = writer(root, "add", "survivor");
    children.push(held, waiting);
    await Promise.all([held.wait("ready"), waiting.wait("ready")]);
    held.child.send("go"); await held.wait("locked");
    waiting.child.send("go"); await waiting.wait("attempt");
    await delay(150);
    assert.ok(!waiting.messages.some(item => item.event === "done"));
    assert.deepEqual((await readManifest(root)).documents, []);
    held.child.kill("SIGKILL"); await held.closed;
    assert.ok((await waiting.wait("done")).ok);
    assert.deepEqual((await readManifest(root)).documents.map(item => item.id), ["survivor"]);
  } finally {
    for (const item of children) { if (item.child.exitCode === null) item.child.kill(); }
    await Promise.all(children.map(item => item.closed));
    await rm(root, { recursive: true, force: true });
  }
});

test("stale snapshots retain unrelated updates and corrupt manifests are never overwritten", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "manifest-snapshot-"));
  try {
    await openOrCreateWorkspace(root);
    const a = await readManifest(root), b = await readManifest(root);
    a.settings.defaultAiModel = "first";
    await writeManifest(root, a);
    b.settings.defaultQueryLimit = 25;
    await writeManifest(root, b);
    // Reusing a caller's own snapshot must not undo an unrelated update.
    a.settings.defaultAiModel = "second";
    await writeManifest(root, a);
    assert.equal((await readManifest(root)).settings.defaultQueryLimit, 25);
    const damaged = '{"incomplete":';
    await writeFile(getManifestPath(root), damaged);
    await assert.rejects(writeManifest(root, a));
    await assert.rejects(openOrCreateWorkspace(root));
    assert.equal(await readFile(getManifestPath(root), "utf8"), damaged);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a pointer commit excludes body edits and rejects a waiting save to the superseded revision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "revision-process-"));
  const children = [];
  try {
    await openOrCreateWorkspace(root);
    const oldPath = path.join(root, "outputs/revisions/doc/old/body.md");
    const newPath = path.join(root, "outputs/revisions/doc/new/body.md");
    for (const target of [oldPath, newPath]) {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, target === oldPath ? "Old body" : "New body");
    }
    const manifest = await readManifest(root);
    manifest.documents.push({ id: "doc", outputMarkdownPath: oldPath });
    await writeManifest(root, manifest);
    const commit = writer(root, "switch", newPath), save = writer(root, "save", oldPath);
    children.push(commit, save);
    await Promise.all(children.map(item => item.wait("ready")));
    commit.child.send("go"); await commit.wait("locked");
    save.child.send("go"); await save.wait("attempt");
    await delay(150);
    assert.ok(!save.messages.some(item => item.event === "done"));
    assert.equal(await readFile(oldPath, "utf8"), "Old body");
    commit.child.send("release"); assert.ok((await commit.wait("done")).ok);
    assert.equal((await save.wait("done")).code, "document_revision_conflict");
    assert.equal(await readFile(oldPath, "utf8"), "Old body");
    assert.equal(await readFile(newPath, "utf8"), "New body");
    assert.equal((await readManifest(root)).documents[0].outputMarkdownPath, newPath);
  } finally {
    for (const item of children) { if (item.child.exitCode === null) item.child.kill(); }
    await Promise.all(children.map(item => item.closed));
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent version saves allocate distinct increasing version numbers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "version-process-"));
  const children = [];
  try {
    await openOrCreateWorkspace(root);
    children.push(writer(root, "version", "notes/body.md"), writer(root, "version", "notes/body.md"));
    await Promise.all(children.map(item => item.wait("ready")));
    children.forEach(item => item.child.send("go"));
    for (const item of children) assert.ok((await item.wait("done")).ok);
    const versions = (await readManifest(root)).markdownVersions;
    assert.deepEqual(versions.map(item => item.version).sort(), [1, 2]);
    assert.equal(new Set(await Promise.all(versions.map(item => readFile(path.join(root, item.versionPath), "utf8")))).size, 2);
  } finally {
    for (const item of children) { if (item.child.exitCode === null) item.child.kill(); }
    await Promise.all(children.map(item => item.closed));
    await rm(root, { recursive: true, force: true });
  }
});
