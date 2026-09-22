import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectPdfLayoutExtractor, runLayoutProcess } from "./pdfLayoutExtractor.js";

// Match balanced Word elements. Text boxes can contain paragraphs/runs inside
// another paragraph/run; stopping at the first closing tag truncates images.
export function getBalancedXmlBlocks(xml, tags) {
  const names = Array.isArray(tags) ? tags : [tags];
  const pattern = new RegExp(`<(/?)(${names.join("|")})(?=[\\s/>])[^>]*>`, "g");
  const blocks = [];
  let depth = 0, start = 0;
  for (const match of String(xml).matchAll(pattern)) {
    const closing = match[1] === "/", selfClosing = /\/\s*>$/.test(match[0]);
    if (!closing) {
      if (depth === 0) start = match.index;
      if (!selfClosing) depth++;
    } else if (depth > 0) depth--;
    if (depth === 0) blocks.push(xml.slice(start, match.index + match[0].length));
  }
  return blocks;
}

export function selectDocxAlternatives(xml) {
  const blocks = getBalancedXmlBlocks(xml, "mc:AlternateContent");
  for (const block of blocks) {
    const choice = getBalancedXmlBlocks(block, "mc:Choice")[0] || "";
    const fallback = getBalancedXmlBlocks(block, "mc:Fallback")[0] || "";
    const hasImage = value => /<(?:a:blip|v:imagedata)\b/.test(value);
    const selected = !hasImage(choice) && hasImage(fallback) ? fallback : choice || fallback;
    xml = xml.replace(block, selected.includes("<mc:AlternateContent") ? selectDocxAlternatives(selected) : selected);
  }
  return xml;
}

export async function preserveDocxDrawings(xml, input, mediaTargets) {
  xml = selectDocxAlternatives(xml);
  const namespaces = [...xml.matchAll(/\bxmlns(?::[\w.-]+)?="[^"]*"/g)].map(match => match[0]);
  const declarations = [...new Map(namespaces.map(value => [value.split("=")[0], value])).values()].join(" ");
  const unique = new Map(), blocks = [];
  for (const block of getBalancedXmlBlocks(xml, "w:drawing")) {
    if (/<a:blip\b/.test(block)) continue;
    const id = `drawing-${createHash("sha256").update(block).digest("hex").slice(0, 20)}`;
    unique.set(id, { id, xml: `<root ${declarations}>${block}</root>` });
    blocks.push({ id, block });
  }
  if (!blocks.length || !input.assetDir) return { xml, rendered: 0, failed: blocks.length, details: [] };
  const python = await detectPdfLayoutExtractor();
  if (!python.available) return { xml, rendered: 0, failed: blocks.length, details: [], unavailable: true };
  const temporary = await mkdtemp(path.join(os.tmpdir(), "schema-word-drawings-"));
  let details;
  try {
    const result = path.join(temporary, "result.json");
    const config = path.join(temporary, "config.json");
    await writeFile(config, JSON.stringify({ drawings: [...unique.values()], output: path.resolve(input.assetDir), result }));
    await runLayoutProcess(python, [path.join(import.meta.dirname, "docxDrawingRenderer.py"), config], {
      timeout: Math.min(15 * 60 * 1000, 30000 + blocks.length * 1000),
      maxBuffer: 1024 * 1024, assertNotCancelled: input.assertNotCancelled
    });
    details = JSON.parse(await readFile(result, "utf8"));
  } catch (error) {
    if (error.code === "job_cancelled") throw error;
    return { xml, rendered: 0, failed: blocks.length, details: [], error: String(error.message).slice(0, 500) };
  } finally { await rm(temporary, { recursive: true, force: true }); }
  const successes = new Set(details.filter(item => item.status === "rendered").map(item => item.id));
  let rendered = 0;
  for (const { id, block } of blocks) {
    if (!successes.has(id)) continue;
    mediaTargets.set(id, `${String(input.assetRelativeBase || "assets").replaceAll("\\", "/").replace(/\/$/, "")}/${id}.png`);
    xml = xml.replace(block, `<w:drawing><a:blip r:embed="${id}"/></w:drawing>`);
    rendered++;
  }
  await writeFile(path.join(input.assetDir, "drawings.json"), JSON.stringify({ rendered, failed: blocks.length-rendered, drawings: details }, null, 2));
  return { xml, rendered, failed: blocks.length-rendered, details };
}
