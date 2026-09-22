import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listenSecureLocalServer } from "../src/server/secureLocalServer.js";

async function withSecureServer(run) {
  const server = await listenSecureLocalServer({
    port: 0,
    token: "api-token-for-test",
    assetToken: "asset-token-for-test"
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function assetUrl(baseUrl, workspacePath, markdownPath, assetPath, token = "asset-token-for-test") {
  const url = new URL(`${baseUrl}/api/workspace-asset`);
  url.searchParams.set("workspacePath", workspacePath);
  url.searchParams.set("markdownPath", markdownPath);
  url.searchParams.set("assetPath", assetPath);
  url.searchParams.set("token", token);
  return url;
}

const trustedAssetHeaders = { referer: "tauri://localhost/" };

test("secure desktop route serves PPTX and PDF images with Unicode paths", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-secure-assets-"));
  const markdownPath = path.join("outputs", "readable", "预览 note.md");
  const fixtures = [
    ["../assets/让孩子 & 学习.pptx/slide 1.png", "pptx-image"],
    ["../assets/math deep.pdf/page 1-image.png", "pdf-image"]
  ];
  await mkdir(path.join(workspace, "outputs", "readable"), { recursive: true });
  await writeFile(path.join(workspace, markdownPath), "# Preview\n", "utf8");
  for (const [relativePath, content] of fixtures) {
    const absolutePath = path.resolve(path.dirname(path.join(workspace, markdownPath)), relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from(content));
  }

  await withSecureServer(async (baseUrl) => {
    for (const [relativePath, content] of fixtures) {
      const response = await fetch(assetUrl(baseUrl, workspace, markdownPath, relativePath), {
        headers: trustedAssetHeaders
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/png");
      assert.equal(Buffer.from(await response.arrayBuffer()).toString(), content);
    }
  });
});

test("secure desktop route serves parent assets for an absolute Markdown path inside the workspace", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-secure-absolute-assets-中文 & "));
  const markdownPath = path.join(workspace, "outputs", "readable", "数学 deep.readable_1.md");
  const relativeImagePath = "../assets/数学 deep.pdf/page-21-formula.png";
  const imagePath = path.resolve(path.dirname(markdownPath), relativeImagePath);
  await mkdir(path.dirname(markdownPath), { recursive: true });
  await mkdir(path.dirname(imagePath), { recursive: true });
  await writeFile(markdownPath, `![Formula](<${relativeImagePath}>)`, "utf8");
  await writeFile(imagePath, Buffer.from("pdf-formula"));
  const openedMarkdownPaths = [...new Set([markdownPath, path.toNamespacedPath(markdownPath)])];

  await withSecureServer(async (baseUrl) => {
    for (const openedMarkdownPath of openedMarkdownPaths) {
      const response = await fetch(assetUrl(baseUrl, workspace, openedMarkdownPath, relativeImagePath), {
        headers: trustedAssetHeaders
      });
      assert.equal(response.status, 200);
      assert.equal(Buffer.from(await response.arrayBuffer()).toString(), "pdf-formula");
    }
  });
});

test("secure desktop image route rejects untrusted tokens, origins, traversal, and file types", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "schema-docs-secure-assets-reject-"));
  const markdownPath = path.join("outputs", "readable", "note.md");
  const imagePath = "../assets/deck.pptx/slide.png";
  const textPath = "../assets/deck.pptx/source.txt";
  await mkdir(path.join(workspace, "outputs", "readable"), { recursive: true });
  await mkdir(path.join(workspace, "outputs", "assets", "deck.pptx"), { recursive: true });
  await writeFile(path.join(workspace, markdownPath), "# Preview\n", "utf8");
  await writeFile(path.join(workspace, "outputs", "assets", "deck.pptx", "slide.png"), Buffer.from("image"));
  await writeFile(path.join(workspace, "outputs", "assets", "deck.pptx", "source.txt"), "not an image", "utf8");

  await withSecureServer(async (baseUrl) => {
    assert.equal((await fetch(assetUrl(baseUrl, workspace, markdownPath, imagePath, "wrong-token"), {
      headers: trustedAssetHeaders
    })).status, 403);
    assert.equal((await fetch(assetUrl(baseUrl, workspace, markdownPath, imagePath), {
      headers: { origin: "https://example.invalid" }
    })).status, 403);
    assert.equal((await fetch(assetUrl(baseUrl, workspace, markdownPath, "../../../outside.png"), {
      headers: trustedAssetHeaders
    })).status, 404);
    assert.equal((await fetch(assetUrl(baseUrl, workspace, markdownPath, textPath), {
      headers: trustedAssetHeaders
    })).status, 404);
  });
});
