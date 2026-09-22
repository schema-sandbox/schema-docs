import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { listZipEntries, readZipEntry } from "../core/zip.js";
import { getAttribute, getXmlTextValues, hasTag, stripXmlTags } from "../core/xml.js";
import { getBalancedXmlBlocks as getXmlBlocks, selectDocxAlternatives, preserveDocxDrawings } from "./docxXmlStructure.js";
import { AppError } from "../core/errors.js";
import { markdownTable, escapeMarkdownTableCell } from "../core/markdownFormatting.js";
const execFileAsync = promisify(execFile);
async function convertWindowsMetafile(sourcePath, outputPath) {
  if (process.platform !== "win32" || !/\.(?:wmf|emf)$/i.test(sourcePath)) return false;
  const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;
  const script = [
    "Add-Type -AssemblyName System.Drawing",
    `$img=[Drawing.Image]::FromFile(${psQuote(sourcePath)})`,
    `try{$scale=[Math]::Min(1.0,[Math]::Min(2400.0/$img.Width,1200.0/$img.Height));$w=[Math]::Max(1,[int][Math]::Round($img.Width*$scale));$h=[Math]::Max(1,[int][Math]::Round($img.Height*$scale));$bmp=[Drawing.Bitmap]::new($w,$h);$g=[Drawing.Graphics]::FromImage($bmp);try{$g.Clear([Drawing.Color]::White);$g.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic;$g.DrawImage($img,0,0,$w,$h);$bmp.Save(${psQuote(outputPath)},[Drawing.Imaging.ImageFormat]::Png)}finally{$g.Dispose();$bmp.Dispose()}}finally{$img.Dispose()}`
  ].join(";");
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}
function readRelationshipTargets(relsXml = "") {
const targets = new Map();
const relTags = relsXml.match(/<Relationship(?:\s[^>]*)?\/?>/g) ?? [];
for (const tag of relTags) {
const id = getAttribute(tag, "Id");
const target = getAttribute(tag, "Target");
if (id && target) {
targets.set(id, target);
}
}
return targets;
}
function escapeInlineMarkdown(value) {
return String(value ?? "")
.replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/`/g, "\\`");
}
function unwrapWholeParagraphStrong(markdown) {
  const match = /^(\s*)\*\*([\s\S]*?)\*\*(\s*)$/.exec(String(markdown ?? ""));
  if (!match) return markdown;
  const inner = match[2];
  if (!inner.trim() || inner.includes("**") || inner.includes("\n")) return markdown;
  return `${match[1]}${inner}${match[3]}`;
}
function imageRelationshipIds(runXml) {
  return [...runXml.matchAll(/<(?:a:blip|v:imagedata)\b[^>]*>/gi)].map(([tag]) =>
    getAttribute(tag, "r:embed") || getAttribute(tag, "r:link") || getAttribute(tag, "r:id") || getAttribute(tag, "o:relid") || "");
}
function embeddedObjectPlaceholder(runXml, mediaTargets = new Map()) {
  if (hasTag(runXml, "w:drawing") || hasTag(runXml, "w:pict") || hasTag(runXml, "w:object") || hasTag(runXml, "o:OLEObject")) {
    const images = imageRelationshipIds(runXml).filter(id => mediaTargets.has(id));
    if (images.length) return images.map(id => `![Word image](<${mediaTargets.get(id)}>)`).join(" ");
    if (hasTag(runXml, "w:object") || hasTag(runXml, "o:OLEObject")) return "[Embedded object omitted]";
    return "[Drawing not converted; inspect the original Word document]";
  }
  return "";
}
function parseXmlTree(xml) {
  const root = { name: "root", attrs: {}, children: [] };
  const stack = [root];
  for (const token of String(xml || "").match(/<[^>]+>|[^<]+/g) || []) {
    if (token.startsWith("<?") || token.startsWith("<!--")) continue;
    if (token.startsWith("</")) { if (stack.length > 1) stack.pop(); continue; }
    if (token.startsWith("<")) {
      const name = /^<\s*([^\s/>]+)/.exec(token)?.[1] || "";
      if (!name) continue;
      const attrs = {};
      for (const match of token.matchAll(/([^\s=]+)="([^"]*)"/g)) attrs[match[1]] = match[2];
      const node = { name, attrs, children: [] };
      stack.at(-1).children.push(node);
      if (!/\/\s*>$/.test(token)) stack.push(node);
    } else if (token) stack.at(-1).children.push({ name: "#text", text: token, attrs: {}, children: [] });
  }
  return root;
}
function localName(node) { return String(node?.name || "").split(":").at(-1); }
function child(node, name) { return node?.children?.find((item) => localName(item) === name); }
function descendantAttribute(node, name, attribute = "m:val") {
  if (!node) return "";
  if (localName(node) === name) return node.attrs?.[attribute] || node.attrs?.["w:val"] || "";
  for (const item of node.children || []) { const value = descendantAttribute(item, name, attribute); if (value) return value; }
  return "";
}
function mathText(value) {
  const commands = new Set([
    "alpha", "beta", "gamma", "delta", "epsilon", "eta", "theta", "lambda", "mu", "phi", "psi", "rho", "tau", "omega",
    "Gamma", "Delta", "Theta", "Lambda", "Phi", "Psi", "Omega",
    "hbar", "hat", "bar", "vec", "sum", "prod", "int", "sqrt", "exp", "sin", "cos", "log", "ln",
    "otimes", "oplus", "infty", "partial", "nabla", "langle", "rangle", "dagger", "Longrightarrow", "Rightarrow",
    "underbrace", "overbrace", "operatorname"
  ]);
  return String(value || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\\/g, "\\backslash ")
    .replace(/[{}]/g, (char) => `\\${char}`)
    .replace(/\b[A-Za-z]+\b/g, (word) => commands.has(word) ? `\\${word}` : word);
}
function renderOmmlNode(node) {
  const name = localName(node);
  if (name === "#text") return mathText(node.text);
  if (/Pr$/.test(name) || ["ctrlPr", "rPr"].includes(name)) return "";
  const render = (item) => (item?.children || []).map(renderOmmlNode).join("");
  if (name === "t") return render(node);
  if (name === "f") return `\\frac{${render(child(node, "num"))}}{${render(child(node, "den"))}}`;
  if (name === "sSup") return `{${render(child(node, "e"))}}^{${render(child(node, "sup"))}}`;
  if (name === "sSub") return `{${render(child(node, "e"))}}_{${render(child(node, "sub"))}}`;
  if (name === "sSubSup") return `{${render(child(node, "e"))}}_{${render(child(node, "sub"))}}^{${render(child(node, "sup"))}}`;
  if (name === "rad") {
    const degree = render(child(node, "deg"));
    return degree ? `\\sqrt[${degree}]{${render(child(node, "e"))}}` : `\\sqrt{${render(child(node, "e"))}}`;
  }
  if (name === "d") {
    const open = descendantAttribute(node, "begChr") || "(";
    const close = descendantAttribute(node, "endChr") || ")";
    return `\\left${open}${render(child(node, "e"))}\\right${close}`;
  }
  if (name === "nary") {
    const symbol = descendantAttribute(node, "chr") || "∫";
    const command = ({ "∫": "\\int", "∑": "\\sum", "∏": "\\prod" })[symbol] || mathText(symbol);
    const sub = render(child(node, "sub"));
    const sup = render(child(node, "sup"));
    return `${command}${sub ? `_{${sub}}` : ""}${sup ? `^{${sup}}` : ""}${render(child(node, "e"))}`;
  }
  if (name === "acc") {
    const accent = descendantAttribute(node, "chr") || "^";
    const command = ({ "^": "hat", "¯": "bar", "→": "vec", "~": "tilde" })[accent] || "hat";
    return `\\${command}{${render(child(node, "e"))}}`;
  }
  if (name === "eqArr") return (node.children || []).filter((item) => localName(item) === "e").map(render).join(" \\\\ ");
  if (name === "m") return `\\begin{matrix}${(node.children || []).filter((item) => localName(item) === "mr").map(renderOmmlNode).join(" \\\\ ")}\\end{matrix}`;
  if (name === "mr") return (node.children || []).filter((item) => localName(item) === "e").map(render).join(" & ");
  return render(node);
}
function ommlToLatex(xml) {
  return renderOmmlNode(parseXmlTree(xml))
    .replace(/\\operatorname\s*\\?([A-Za-z]+)/g, "\\operatorname{$1}")
    .replace(/\\sqrt\s*([0-9A-Za-z]+)/g, "\\sqrt{$1}")
    .replace(/\s+/g, " ")
    .trim();
}
function noteReferenceMarkdown(runXml, notes = new Map()) {
  const refs = [];
  const footnoteTags = runXml.match(/<w:footnoteReference\b[^>]*\/?>/g) ?? [];
  const endnoteTags = runXml.match(/<w:endnoteReference\b[^>]*\/?>/g) ?? [];
  for (const tag of footnoteTags) {
    const id = getAttribute(tag, "w:id") ?? getAttribute(tag, "id");
    if (id && notes.has(`footnote:${id}`)) {
      refs.push(`[^footnote-${id}]`);
    }
  }
  for (const tag of endnoteTags) {
    const id = getAttribute(tag, "w:id") ?? getAttribute(tag, "id");
    if (id && notes.has(`endnote:${id}`)) {
      refs.push(`[^endnote-${id}]`);
    }
  }
  return refs.join("");
}
function isStyleActive(xml, tagName) {
  if (!hasTag(xml, tagName)) return false;
  const match = xml.match(new RegExp(`<${tagName}(?:\\s[^>]*)?\\/?>`));
  if (!match) return false;
  const tag = match[0];
  const val = getAttribute(tag, "w:val");
  if (val !== undefined && (val === "false" || val === "0" || val === "none")) {
    return false;
  }
  return true;
}
function runToMarkdown(runXml, notes = new Map(), mediaTargets = new Map()) {
  let text = getXmlTextValues(runXml, "w:t").join("");
  if (hasTag(runXml, "w:tab")) {
    text += " ";
  }
  if (hasTag(runXml, "w:br")) {
    text += "\n";
  }
  const noteRefs = noteReferenceMarkdown(runXml, notes);
  if (!text) return `${embeddedObjectPlaceholder(runXml, mediaTargets)}${noteRefs}`;
  let markdown = escapeInlineMarkdown(text);
  if (isStyleActive(runXml, "w:b")) {
    markdown = `**${markdown}**`;
  }
  if (isStyleActive(runXml, "w:i")) {
    markdown = `*${markdown}*`;
  }
  if (isStyleActive(runXml, "w:strike") || isStyleActive(runXml, "w:dstrike")) {
    markdown = `~~${markdown}~~`;
  }
  if (hasTag(runXml, "w:drawing") || hasTag(runXml, "w:pict") || hasTag(runXml, "w:object") || hasTag(runXml, "o:OLEObject")) {
    markdown = `${markdown} ${embeddedObjectPlaceholder(runXml, mediaTargets)}`.trim();
  }
  return `${markdown}${noteRefs}`;
}
function normalizeGeneratedStrong(markdown) {
  // Word emits one strong wrapper per run. Only remove wrappers that contain
  // no text. In particular, do not consume the whitespace between two runs:
  // `**alpha** **beta**` must keep the source space, and `**post**code` must
  // remain `postcode` rather than acquiring a new space. The former cleanup
  // used a cross-wrapper regex and silently changed document content.
  return String(markdown || "")
    .replace(/\*\*([ \t]*)\*\*/g, "$1")
    .replace(/\*\*\n\*\*/g, "\n");
}
function inlineContentToMarkdown(xml, relationshipTargets, notes = new Map(), mediaTargets = new Map()) {
  const parts = [];
  for (const block of getXmlBlocks(xml, ["m:oMath", "w:hyperlink", "w:r"])) {
    if (block.startsWith("<m:oMath")) {
      const latex = ommlToLatex(block);
      if (latex) parts.push(`$${latex}$`);
      continue;
    }
    if (block.startsWith("<w:hyperlink")) {
      const text = getXmlBlocks(block, "w:r").map((run) => runToMarkdown(run, notes, mediaTargets)).join("").trim();
      const relId = getAttribute(block, "r:id");
      const target = relId ? relationshipTargets.get(relId) : "";
      if (text && target && /^https?:/i.test(target)) {
        parts.push(`[${text}](${target})`);
      } else if (text) {
        parts.push(text);
      }
      continue;
    }
    parts.push(runToMarkdown(block, notes, mediaTargets));
  }
  return normalizeGeneratedStrong(parts.join("")).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}
function readNumbering(numberingXml = "") {
  const abstracts = new Map();
  for (const block of getXmlBlocks(numberingXml, "w:abstractNum")) {
    const abstractId = getAttribute(block, "w:abstractNumId");
    const levels = new Map();
    for (const level of getXmlBlocks(block, "w:lvl")) {
      const ilvl = Number(getAttribute(level, "w:ilvl") || 0);
      const formatTag = /<w:numFmt\b[^>]*>/i.exec(level)?.[0] || "";
      const startTag = /<w:start\b[^>]*>/i.exec(level)?.[0] || "";
      levels.set(ilvl, {
        format: getAttribute(formatTag, "w:val") || "bullet",
        start: Math.max(Number(getAttribute(startTag, "w:val") || 1), 1)
      });
    }
    if (abstractId) abstracts.set(abstractId, levels);
  }
  const nums = new Map();
  for (const block of getXmlBlocks(numberingXml, "w:num")) {
    const numId = getAttribute(block, "w:numId");
    const abstractTag = /<w:abstractNumId\b[^>]*>/i.exec(block)?.[0] || "";
    const abstractId = getAttribute(abstractTag, "w:val");
    if (numId && abstracts.has(abstractId)) nums.set(numId, abstracts.get(abstractId));
  }
  return nums;
}
function listPrefix(paragraphXml, numbering = new Map(), counters = new Map()) {
  const numPr = /<w:numPr[\s\S]*?<\/w:numPr>/.exec(paragraphXml)?.[0] ?? "";
  const ilvl = /<w:ilvl\b[^>]*>/i.exec(numPr)?.[0] ?? "";
  const level = Math.max(Number(getAttribute(ilvl, "w:val") ?? "0") || 0, 0);
  const numIdTag = /<w:numId\b[^>]*>/i.exec(numPr)?.[0] || "";
  const numId = getAttribute(numIdTag, "w:val") || "";
  const definition = numbering.get(numId)?.get(level);
  if (!definition || definition.format === "bullet" || definition.format === "none") {
    return `${"  ".repeat(Math.min(level, 6))}- `;
  }
  const key = `${numId}:${level}`;
  const value = counters.has(key) ? counters.get(key) + 1 : definition.start;
  counters.set(key, value);
  return `${"  ".repeat(Math.min(level, 6))}${value}. `;
}
function paragraphToMarkdown(paragraphXml, relationshipTargets = new Map(), notes = new Map(), mediaTargets = new Map(), numbering = new Map(), counters = new Map()) {
  const trimmed = unwrapWholeParagraphStrong(inlineContentToMarkdown(paragraphXml, relationshipTargets, notes, mediaTargets).trim());
  if (!trimmed) return "";
  if (hasTag(paragraphXml, "m:oMathPara")) return `$$\n${trimmed.replace(/^\$|\$$/g, "")}\n$$`;
  const style = getAttribute(paragraphXml, "w:val") ?? "";
  if (/Heading1/i.test(style)) {
    return `# ${trimmed}`;
  }
  if (/Heading2/i.test(style)) {
    return `## ${trimmed}`;
  }
  if (/Heading3/i.test(style)) {
    return `### ${trimmed}`;
  }
  if (hasTag(paragraphXml, "w:numPr") || /ListParagraph/i.test(style)) {
    return `${listPrefix(paragraphXml, numbering, counters)}${trimmed}`;
  }
  if (hasTag(paragraphXml, "w:lastRenderedPageBreak")) {
    return `${trimmed}\n\n---`;
  }
  return trimmed;
}
function noteXmlToMarkdownMap(noteXml, tagName, prefix, relationshipTargets = new Map()) {
  const notes = new Map();
  for (const block of getXmlBlocks(noteXml, tagName)) {
    const id = getAttribute(block, "w:id") ?? getAttribute(block, "id");
    if (!id || Number(id) < 1) {
      continue;
    }
    const content = getXmlBlocks(block, "w:p")
      .map((paragraph) => paragraphToMarkdown(paragraph, relationshipTargets, new Map()))
      .filter(Boolean)
      .join(" ")
      .trim();
    if (content) {
      notes.set(`${prefix}:${id}`, content);
    }
  }
  return notes;
}
function readNotes({ footnotesXml = "", endnotesXml = "" } = {}, relationshipTargets = new Map()) {
  return new Map([
    ...noteXmlToMarkdownMap(footnotesXml, "w:footnote", "footnote", relationshipTargets),
    ...noteXmlToMarkdownMap(endnotesXml, "w:endnote", "endnote", relationshipTargets)
  ]);
}
function renderNotes(notes) {
  if (!notes.size) return [];
  const lines = ["## Notes", ""];
  for (const [key, value] of notes.entries()) {
    const [kind, id] = key.split(":");
    lines.push(`[^${kind}-${id}]: ${value}`);
  }
  return lines;
}
function tableToMarkdown(tableXml, relationshipTargets = new Map(), notes = new Map(), mediaTargets = new Map()) {
  const rows = [], anchors = [];
  let active = new Map();
  for (const rowXml of getXmlBlocks(tableXml, "w:tr")) {
    const before = Number(getAttribute(/<w:gridBefore\b[^>]*>/.exec(rowXml)?.[0] || "", "w:val") || 0);
    if (!Number.isInteger(before) || before < 0 || before > 1000) throw new AppError("document_budget_exceeded", "Word table grid exceeds the supported size.");
    const cells = Array(before).fill(""), next = new Map(), row = rows.length;
    for (const cellXml of getXmlBlocks(rowXml, "w:tc")) {
      const paragraphs = getXmlBlocks(cellXml, "w:p")
        .map((paragraph) => paragraphToMarkdown(paragraph, relationshipTargets, notes, mediaTargets))
        .filter(Boolean);
      const cell = paragraphs.length > 0 ? paragraphs.join("<br>") : stripXmlTags(cellXml).trim();
      const properties = getXmlBlocks(cellXml, "w:tcPr")[0] || "";
      const span = Number(getAttribute(/<w:gridSpan\b[^>]*>/.exec(properties)?.[0] || "", "w:val") || 1);
      if (!Number.isInteger(span) || span < 1 || span + cells.length > 1000) throw new AppError("document_budget_exceeded", "Word table grid exceeds the supported size.");
      const mergeTag = /<w:vMerge\b[^>]*>/.exec(properties)?.[0];
      const column = cells.length, previous = active.get(column);
      if (mergeTag && getAttribute(mergeTag, "w:val") !== "restart" && !cell.trim() && previous?.[3] === span) {
        previous[2]++;
        next.set(column, previous);
        cells.push(...Array(span).fill(""));
      } else {
        const anchor = [row, column, 1, span];
        anchors.push(anchor);
        if (mergeTag) next.set(column, anchor);
        cells.push(cell, ...Array(span-1).fill(""));
      }
    }
    active = next;
    if (cells.length) rows.push(cells);
  }
  const spans = anchors.filter(([, , height, width]) => height > 1 || width > 1);
  if (spans.length) {
    const width = Math.max(...rows.map(row => row.length));
    if (rows.length * width > 100000) throw new AppError("document_budget_exceeded", "Word table grid exceeds the supported size.");
    const padded = rows.map(row => Array.from({ length: width }, (_, i) => escapeMarkdownTableCell(row[i] || "")));
    const line = row => `| ${row.join(" | ")} |`;
    return `<!-- schema-table: ${JSON.stringify({ v: 1, rows: rows.length, cols: width, spans })} -->\n`
      + [line(padded[0]), line(Array(width).fill("---")), ...padded.slice(1).map(line)].join("\n");
  }
  return markdownTable(rows);
}
export function docxDocumentXmlToMarkdown(documentXml, sourceName = "source.docx", relsXml = "", noteXmls = {}, options = {}) {
  documentXml = selectDocxAlternatives(documentXml);
  const relationshipTargets = readRelationshipTargets(relsXml);
  const notes = readNotes(noteXmls, relationshipTargets);
  const body = getXmlBlocks(documentXml, "w:body")[0] ?? documentXml;
  const blocks = [];
  const numbering = readNumbering(options.numberingXml);
  const counters = new Map();
  const listStack = [];
  for (const blockXml of getXmlBlocks(body, ["w:p", "w:tbl"])) {
    let markdown = blockXml.startsWith("<w:tbl")
      ? tableToMarkdown(blockXml, relationshipTargets, notes, options.mediaTargets)
      : paragraphToMarkdown(blockXml, relationshipTargets, notes, options.mediaTargets, numbering, counters);
    if (markdown) {
      const list = /^( *)(\d+\. |[-+*] )/.exec(markdown);
      if (list && (hasTag(blockXml, "w:numPr") || /ListParagraph/i.test(blockXml))) {
        const level = list[1].length;
        while (listStack.length && listStack.at(-1).level > level) listStack.pop();
        if (!listStack.length || listStack.at(-1).level < level) {
          const indent = listStack.length ? listStack.at(-1).contentIndent : (level < 4 ? level : 0);
          listStack.push({ level, indent, contentIndent: indent + list[2].length });
        }
        listStack.at(-1).contentIndent = listStack.at(-1).indent + list[2].length;
        // Word levels may resume after ordinary prose without a Markdown
        // parent. Orphan indentation would turn text and images into code.
        markdown = " ".repeat(listStack.at(-1).indent) + markdown.trimStart();
      } else listStack.length = 0;
      blocks.push(markdown);
    }
  }
  const title = path.parse(sourceName).name || "Untitled";
  return [
    `# ${title}`,
    "",
    ...blocks.flatMap((block) => [block, ""]),
    ...renderNotes(notes)
  ].join("\n").trimEnd() + "\n";
}
export const docxMarkdownConverter = {
  name: "docx-markdown-converter",
  cacheVersion: "9",
  canHandle(file) {
    return path.extname(file.sourcePath ?? file).toLowerCase() === ".docx";
  },
  async convert(input) {
    let documentXml;
    let relsXml = "";
    let footnotesXml = "";
    let endnotesXml = "";
    let numberingXml = "";
    const mediaTargets = new Map();
    let convertedMetafiles = 0;
    try {
      const archive = await readFile(input.sourcePath);
      documentXml = readZipEntry(archive, "word/document.xml").toString("utf8");
      try {
        relsXml = readZipEntry(archive, "word/_rels/document.xml.rels").toString("utf8");
      } catch {
        relsXml = "";
      }
      try {
        footnotesXml = readZipEntry(archive, "word/footnotes.xml").toString("utf8");
      } catch {
        footnotesXml = "";
      }
      try {
        endnotesXml = readZipEntry(archive, "word/endnotes.xml").toString("utf8");
      } catch {
        endnotesXml = "";
      }
      try {
        numberingXml = readZipEntry(archive, "word/numbering.xml").toString("utf8");
      } catch {
        numberingXml = "";
      }
      if (input.assetDir && relsXml) {
        const relationships = readRelationshipTargets(relsXml);
        const entries = new Set(listZipEntries(archive).map((entry) => entry.fileName));
        await mkdir(input.assetDir, { recursive: true });
        for (const [relId, target] of relationships.entries()) {
          const normalizedTarget = String(target).replace(/\\/g, "/").replace(/^\.\//, "");
          if (!normalizedTarget.startsWith("media/")) continue;
          const entryName = `word/${normalizedTarget}`;
          if (!entries.has(entryName)) continue;
          const fileName = path.basename(normalizedTarget).replace(/[^A-Za-z0-9._-]/g, "_");
          const diskPath = path.join(input.assetDir, fileName);
          await writeFile(diskPath, readZipEntry(archive, entryName));
          let renderedName = fileName;
          if (/\.(?:wmf|emf)$/i.test(fileName)) {
            const pngName = fileName.replace(/\.(?:wmf|emf)$/i, ".png");
            if (await convertWindowsMetafile(diskPath, path.join(input.assetDir, pngName))) {
              renderedName = pngName;
              convertedMetafiles += 1;
            }
          }
          mediaTargets.set(relId, `${String(input.assetRelativeBase || "assets").replace(/\\/g, "/").replace(/\/$/, "")}/${renderedName}`);
        }
      }
    } catch (err) {
      throw new AppError("document_corrupt", `DOCX is corrupt or invalid. Confirm the file opens locally in Word or WPS. Cause: ${err.message}`, {
        originalError: err.message
      });
    }
    const drawingResult = await preserveDocxDrawings(documentXml, input, mediaTargets);
    const markdown = docxDocumentXmlToMarkdown(drawingResult.xml, input.sourceName || path.basename(input.sourcePath), relsXml, {
      footnotesXml,
      endnotesXml
    }, { mediaTargets, numberingXml });
    const hasTables = documentXml.includes("<w:tbl");
    const hasLinks = relsXml.includes("Hyperlink") || documentXml.includes("<w:hyperlink");
    const hasNotes = Boolean(footnotesXml || endnotesXml) && /<w:(footnote|endnote)\b/.test(`${footnotesXml}\n${endnotesXml}`);
    const warnings = [];
    if (hasTables) {
      warnings.push("Table styles simplified; supported Word grid spans are retained in Markdown geometry metadata and structured exports. Nested tables and irregular merge declarations still require review.");
    }
    if (hasLinks) {
      warnings.push("Hyperlinks preserved where DOCX relationship targets are available.");
    }
    if (hasNotes) {
      warnings.push("Footnotes and endnotes preserved as Markdown reference notes where note bodies are available.");
    }
    warnings.push("Page layout simplified: complex Word/WPS layout, comments, and revisions are not preserved; text, headings, lists, and basic tables are extracted.");
    if (mediaTargets.size) warnings.push(`Extracted ${mediaTargets.size} Word/WPS media asset(s); only referenced media is linked in Markdown.`);
    const omittedDrawings = (markdown.match(/\[Drawing not converted;/g) || []).length;
    if (drawingResult.rendered) warnings.push(`Preserved ${drawingResult.rendered} Word drawing group(s) from source geometry as images; visual review is required and mathematical meaning has not been reconstructed.`);
    if (omittedDrawings) warnings.push(`${omittedDrawings} Word drawing groups could not be converted; inspect them in the retained source document.`);
    if (convertedMetafiles) warnings.push(`Converted ${convertedMetafiles} legacy Word/WPS WMF/EMF preview image(s) to browser-compatible PNG.`);
    if (hasTag(documentXml, "m:oMath")) warnings.push("Word/WPS equations converted from OMML to editable Markdown LaTeX where supported.");
    warnings.push("Unsupported Word/WPS rich objects such as SmartArt, embedded OLE objects, macros, and VBA are not executed during Markdown extraction.");
    const extractionQuality = {
      textLayerDetected: true,
      scannedLikely: false,
      tableSimplified: hasTables,
      layoutSimplified: true,
      possibleMojibake: false,
      unsupportedFeatures: ["styles", "annotations", "revisions", "smartart", "embedded_objects", "macros", "vba"],
      confidence: omittedDrawings || drawingResult.rendered ? "medium" : "high",
      omittedDrawings,
      visualFallbackRegions: drawingResult.rendered,
      failedVisualRegions: omittedDrawings
    };
    return {
      markdown,
      warnings,
      quality: {
        hasTextLayer: true,
        hasTablesSimplified: hasTables,
        hasOcrMissing: false,
        confidence: omittedDrawings || drawingResult.rendered ? "medium" : "high"
      },
      extractionQuality
    };
  }
};
