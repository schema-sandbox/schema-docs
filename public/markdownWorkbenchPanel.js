export function createMarkdownWorkbenchPanel({ $, state, run, saveCurrentNote, refreshVersions, escapeHtml, openMarkdownPath, api, localApiBaseUrl, showAlert, onNoteClosed }) {
let activeSearchIndex = 0;
let renderTimer = 0;
let inputTimer = 0;
let slashActiveIndex = 0;
let slashMenuEl = null;
let isSlashOpen = false;
async function chooseNativeSavePath(inputId, filterName, extensions) {
 const input = $(inputId);
 const rawDefaultPath = input?.value || "";
 const defaultPath = String(rawDefaultPath).trim().split(/[\\/]/).pop() || rawDefaultPath;
 const invoke = window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke;
 if (typeof invoke === "function") {
  const selected = await invoke("select_save_file_path", {
   defaultPath,
   filterName,
   extensions
  });
  if (selected && input) input.value = selected;
  return selected;
 }
 if (window.__TAURI__?.dialog?.save) {
  const selected = await window.__TAURI__.dialog.save({
   defaultPath,
   filters: [{ name: filterName, extensions }]
  });
  if (selected && input) input.value = selected;
  return selected;
 }
 const rawWebMsg = "Browser mode does not support native save dialogue. Type an output path in the input field.";
 const webMsg = (typeof window.translateText === "function") ? window.translateText(rawWebMsg) : rawWebMsg;
 showAlert("info", webMsg);
 return "";
}
function safeMarkdownUrl(value) {
const url = String(value ?? "").trim();
if (/^(https?:|\/|\.\/|\.\.\/|#)/i.test(url)) {
return escapeHtml(url);
}
return "#";
}
function workspaceAssetUrl(markdownPath, assetPath) {
 const params = new URLSearchParams({
  workspacePath: state.workspacePath || "",
  markdownPath: markdownPath || "",
  assetPath: assetPath || "",
  token: globalThis.window?.AI_DOC_EXCHANGE_TOKEN || ""
 });
 const apiBase = typeof localApiBaseUrl === "function" ? localApiBaseUrl() : "http://127.0.0.1:4177";
 return `${apiBase}/api/workspace-asset?${params}`;
}
function renderMarkdownImage(alt, url) {
 const readableAlt = String(alt ?? "").replace(/\\([\[\]\\])/g, "$1");
 const target = String(url ?? "").trim()
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">");
 if (!/^(?:https?:|data:|#)/i.test(target) && state.workspacePath) {
  const markdownPath = $("notePath")?.value?.trim() || "";
  const formulaClass = /Formula preserved from PDF/i.test(readableAlt) || /-formula-\d/i.test(target) ? " pdf-formula-image" : "";
  return `<img loading="lazy" class="workspace-asset-image${formulaClass}" src="${escapeHtml(workspaceAssetUrl(markdownPath, target))}" alt="${escapeHtml(readableAlt)}" data-markdown-path="${escapeHtml(markdownPath)}" data-asset-path="${escapeHtml(target)}">`;
 }
 const apiBase = typeof localApiBaseUrl === "function" ? localApiBaseUrl() : "";
 if (/^https?:/i.test(target) && (!apiBase || !target.startsWith(apiBase))) {
  return `<span class="markdown-image-blocked" title="External images are blocked for privacy">Image not loaded: ${escapeHtml(readableAlt || target)}</span>`;
 }
 return `<img src="${safeMarkdownUrl(target)}" alt="${escapeHtml(readableAlt)}">`;
}
async function retryWorkspaceAssetImage(image) {
 if (!image || image.dataset.assetRetried === "true") return;
 image.dataset.assetRetried = "true";
 const refresh = globalThis.window?.schemaDocsRefreshLocalApiConfig;
 if (typeof refresh === "function") {
  try {
   await refresh();
  } catch {}
 }
 const markdownPath = image.dataset.markdownPath || $("notePath")?.value?.trim() || "";
 const assetPath = image.dataset.assetPath || "";
 if (!state.workspacePath || !markdownPath || !assetPath || !globalThis.window?.AI_DOC_EXCHANGE_TOKEN) {
  image.replaceWith(Object.assign(document.createElement("span"), {
   className: "markdown-image-blocked",
   textContent: `Image unavailable: ${image.alt || assetPath || "local asset"}`
  }));
  return;
 }
 image.src = workspaceAssetUrl(markdownPath, assetPath);
}
function stripAiCitationArtifacts(value) {
return String(value ?? "").replace(/[\u25a0-\u25a1\u25aa-\u25ab\u25cc-\u25cf\u25fb-\u25ff\uE000-\uF8FF]*cite(?:[\u25a0-\u25a1\u25aa-\u25ab\u25cc-\u25cf\u25fb-\u25ff\uE000-\uF8FF]*turn\d+[A-Za-z]+\d+)+[\u25a0-\u25a1\u25aa-\u25ab\u25cc-\u25cf\u25fb-\u25ff\uE000-\uF8FF]*/gi, "");
}
function escapeTokenPattern(value) {
return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function collisionFreeTokenPrefix(source, base) {
let prefix = base;
while (String(source).includes(prefix)) prefix += "X";
return prefix;
}
function findClosingBackticks(source, start, runLength) {
let cursor = start;
while (cursor < source.length) {
const next = source.indexOf("`", cursor);
if (next < 0) return -1;
let length = 1;
while (source[next + length] === "`") length += 1;
if (length === runLength) return next;
cursor = next + length;
}
return -1;
}
function findInlineMathDelimiter(source, start, delimiter, stopAtNewline) {
for (let cursor = start; cursor < source.length; cursor++) {
if (source[cursor] === "\\" && cursor + 1 < source.length) {
cursor += 1;
continue;
}
if (stopAtNewline && (source[cursor] === "\n" || source[cursor] === "\r")) return -1;
if (source.startsWith(delimiter, cursor)) return cursor;
}
return -1;
}
function findLinkDestinationEnd(source, start) {
let depth = 1;
for (let cursor = start; cursor < source.length; cursor++) {
if (source[cursor] === "\\" && cursor + 1 < source.length) {
cursor += 1;
continue;
}
if (source[cursor] === "(") depth += 1;
if (source[cursor] === ")") {
depth -= 1;
if (depth === 0) return cursor;
}
}
return -1;
}
function renderInlineMarkdown(value) {
const mathTokens = [];
const codeTokens = [];
const source = stripAiCitationArtifacts(value);
const codeTokenPrefix = collisionFreeTokenPrefix(source, "SCHEMADOSCODETOKEN");
const mathTokenPrefix = collisionFreeTokenPrefix(`${source}${codeTokenPrefix}`, "SCHEMADOSMATHTOKEN");
let protectedValue = "";
let cursor = 0;
while (cursor < source.length) {
if (source.startsWith("![", cursor)) {
const image = /^!\[(?:\\.|[^\]\\])*\]\((?:<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\)/.exec(source.slice(cursor));
if (image) {
protectedValue += image[0];
cursor += image[0].length;
continue;
}
}
if (source[cursor] === "`") {
let runLength = 1;
while (source[cursor + runLength] === "`") runLength += 1;
const closing = findClosingBackticks(source, cursor + runLength, runLength);
if (closing >= 0) {
const token = `${codeTokenPrefix}${codeTokens.length}XEND`;
codeTokens.push(`<code>${escapeHtml(source.slice(cursor + runLength, closing))}</code>`);
protectedValue += token;
cursor = closing + runLength;
continue;
}
}
if (source.startsWith("](", cursor)) {
const destinationEnd = findLinkDestinationEnd(source, cursor + 2);
if (destinationEnd >= 0) {
protectedValue += source.slice(cursor, destinationEnd + 1);
cursor = destinationEnd + 1;
continue;
}
}
if (source[cursor] === "<") {
const autolink = /^<(?:https?:\/\/|mailto:)[^>\n]*>/i.exec(source.slice(cursor));
if (autolink) {
protectedValue += autolink[0];
cursor += autolink[0].length;
continue;
}
}
const bareUrl = /^(?:(?:(?:https?|ftp):\/\/|mailto:|www\.)[^\s<]+|[^\s<>()]+@[^\s<>()]+\.[^\s<>()]+)/i.exec(source.slice(cursor));
if (bareUrl) {
protectedValue += bareUrl[0];
cursor += bareUrl[0].length;
continue;
}
if (source[cursor] === "\\" && cursor + 1 < source.length) {
protectedValue += source.slice(cursor, cursor + 2);
cursor += 2;
continue;
}
if (source[cursor] === "$") {
const displayMode = source[cursor + 1] === "$";
const delimiter = displayMode ? "$$" : "$";
const formulaStart = cursor + delimiter.length;
const closing = findInlineMathDelimiter(source, formulaStart, delimiter, !displayMode);
if (closing >= formulaStart && source.slice(formulaStart, closing).trim()) {
const token = `${mathTokenPrefix}${mathTokens.length}XEND`;
mathTokens.push({ formula: source.slice(formulaStart, closing).trim(), displayMode });
protectedValue += token;
cursor = closing + delimiter.length;
continue;
}
}
protectedValue += source[cursor];
cursor += 1;
}
  let rendered = escapeHtml(protectedValue)
   .replace(/!\[((?:\\.|[^\]\\])*)\]\((?:&lt;(.+?)&gt;|([^)\s]+))\)/g, (_match, alt, angleUrl, plainUrl) => renderMarkdownImage(alt, angleUrl || plainUrl))
   .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label, url) => {
    const target = String(url || "").trim();
    if (/^(?:\.{1,2}\/)?[^?#]+\.md(?:#[^?\s]+)?$/i.test(target)) {
     return `<button type="button" class="markdown-file-link" data-markdown-relative-link="${escapeHtml(target)}">${label}</button>`;
    }
    return `<a href="${safeMarkdownUrl(target)}" target="_blank" rel="noreferrer">${label}</a>`;
   })
   .replace(/\[\^([^\]]+)\]/g, (_match, id) => `<sup class="footnote-ref">[${escapeHtml(id)}]</sup>`)
   .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target, label) => `<span class="wiki-link" title="${escapeHtml(target)}">${escapeHtml(label || target)}</span>`)
   .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
   .replace(/~~([^~]+)~~/g, "<del>$1</del>")
   .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
   .replace(/(^|\s)#([A-Za-z][A-Za-z0-9_-]{1,48})\b/g, '$1<span class="markdown-tag">#$2</span>')
   .replace(/\\([\\*_`\[\]$])/g, "$1");
  const mathPattern = new RegExp(`${escapeTokenPattern(mathTokenPrefix)}(\\d+)XEND`, "g");
  const restoreMathToken = (_token, rawIndex, plainText = false) => {
   const item = mathTokens[Number(rawIndex)];
   if (!item) return "";
   if (plainText) return escapeHtml(item.displayMode ? `$$${item.formula}$$` : `$${item.formula}$`);
   const className = item.displayMode ? "katex-math display-mode" : "katex-math inline-mode";
   const tag = item.displayMode ? "div" : "span";
   return `<${tag} class="${className}" data-math="${escapeHtml(item.formula)}">${escapeHtml(item.displayMode ? `$$${item.formula}$$` : `$${item.formula}$`)}</${tag}>`;
  };
  rendered = rendered.split(/(<[^>]*>)/g).map((segment, index) => {
   mathPattern.lastIndex = 0;
   return segment.replace(mathPattern, (token, rawIndex) => restoreMathToken(token, rawIndex, index % 2 === 1));
  }).join("");
  const codePattern = new RegExp(`${escapeTokenPattern(codeTokenPrefix)}(\\d+)XEND`, "g");
  rendered = rendered.replace(codePattern, (_token, rawIndex) => {
   return codeTokens[Number(rawIndex)] || "";
  });
  return rendered;
 }
 function normalizeRelativeMarkdownPath(basePath, link) {
  const cleanLink = String(link || "").split("#")[0].replace(/\\/g, "/");
  if (!cleanLink || /^https?:/i.test(cleanLink) || cleanLink.startsWith("/")) {
   return "";
  }
  const baseParts = String(basePath || "").replace(/\\/g, "/").split("/");
  baseParts.pop();
  for (const part of cleanLink.split("/")) {
   if (!part || part === ".") continue;
   if (part === "..") {
    baseParts.pop();
   } else {
    baseParts.push(part);
   }
  }
  return baseParts.filter(Boolean).join("/");
 }
 function slugifyHeading(value, index) {
  const base = String(value ?? "")
   .toLowerCase()
   .replace(/<[^>]+>/g, "")
   .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
   .replace(/^-+|-+$/g, "");
  return base ? `${base}-${index}` : `heading-${index}`;
 }
 function isLikelyMarkdownStructure(line) {
  return /^#{1,6}\s+\S/.test(line)
   || /^[-*+]\s+/.test(line)
   || /^\d+[.)]\s+/.test(line)
   || /^>\s*/.test(line)
   || /^\|.*\|$/.test(line)
   || /^```/.test(line);
}
function getMarkdownHeadings(markdown) {
const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
return lines.reduce((headings, raw, lineIndex) => {
const trimmed = raw.trim();
const atx = /^(#{1,6})\s+(.+)$/.exec(trimmed);
if (atx) {
const title = atx[2].replace(/[*_`[\]()]/g, "").trim();
    headings.push({
     id: slugifyHeading(title, headings.length + 1),
     level: Math.min(atx[1].length, 4),
     title,
     lineIndex
    });
    return headings;
   }
   const nextLine = lines[lineIndex + 1]?.trim() ?? "";
   if (
    trimmed
    && (/^={3,}$/.test(nextLine) || /^-{3,}$/.test(nextLine))
    && !isLikelyMarkdownStructure(trimmed)
    && !/[.!?;:]$/.test(trimmed)
   ) {
    const title = trimmed.replace(/[*_`[\]()]/g, "").trim();
headings.push({
id: slugifyHeading(title, headings.length + 1),
level: nextLine.startsWith("=") ? 1 : 2,
title,
lineIndex
});
}
return headings;
}, []);
}
function markdownStats(markdown) {
const text = String(markdown ?? "");
const words = (text.match(/[A-Za-z0-9_]+|[\u4e00-\u9fa5]/g) || []).length;
return {
words,
characters: text.length,
headings: getMarkdownHeadings(text).length,
tables: (text.match(/^\|.*\|$/gm) || []).length
};
}
function uniqueSorted(values) {
return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function getMarkdownMetadata(markdown) {
const text = String(markdown ?? "");
const tags = uniqueSorted((text.match(/(^|\s)#([A-Za-z][A-Za-z0-9_-]{1,48})\b/g) || [])
.map((item) => item.trim().replace(/^#/, "")));
const wikiLinks = uniqueSorted([...text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)]
.map((match) => match[1].trim()));
return {
tags,
wikiLinks,
footnotes: (text.match(/^\[\^[^\]]+\]:/gm) || []).length,
openTasks: (text.match(/^[-*+]\s+\[ \]\s+/gm) || []).length,
doneTasks: (text.match(/^[-*+]\s+\[[xX]\]\s+/gm) || []).length
};
}
function markdownToReadableHtml(markdown) {
const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
const footnotes = [];
const html = [];
let paragraph = [];
let listType = "";
let table = [];
let codeOpen = false;
let headingIndex = 0;
let lineIndex = 0;
const flushParagraph = () => {
if (paragraph.length) {
const start = lineIndex - paragraph.length;
const end = lineIndex - 1;
html.push(`<p data-line-start="${start}" data-line-end="${end}" data-line-num="${start + 1}">${renderInlineMarkdown(paragraph.join(" "))}</p>`);
paragraph = [];
}
};
const flushList = () => {
if (listType) {
html.push(`</${listType}>`);
listType = "";
}
};
const openList = (type) => {
if (listType === type) return;
flushList();
html.push(`<${type}>`);
listType = type;
};
const flushTable = () => {
if (!table.length) return;
 html.push('<div class="markdown-table-scroll"><table>');
table.forEach((row, index) => {
if (/^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(row.text)) return;
const cells = splitMarkdownTableRow(row.text).cells.map((cell) => renderInlineMarkdown(cell));
const tag = index === 0 ? "th" : "td";
html.push(`<tr data-line-start="${row.line}">${cells.map((cell, cellIndex) => `<${tag} data-line-start="${row.line}" data-table-cell="${cellIndex}">${cell}</${tag}>`).join("")}</tr>`);
});
 html.push("</table></div>");
table = [];
};
let startLine = 0;
if (lines[0]?.trim() === "---") {
const end = lines.slice(1, 80).findIndex((line) => line.trim() === "---");
if (end >= 0) {
const frontmatterLines = lines.slice(1, end + 1).filter((line) => line.trim());
if (frontmatterLines.length) {
html.push('<section class="markdown-frontmatter">');
html.push("<strong>Properties</strong>");
html.push("<dl>");
for (const item of frontmatterLines) {
const match = /^([^:]+):\s*(.*)$/.exec(item);
if (match) {
html.push(`<dt>${escapeHtml(match[1].trim())}</dt><dd>${renderInlineMarkdown(match[2].trim())}</dd>`);
} else {
html.push(`<dt>value</dt><dd>${renderInlineMarkdown(item.trim())}</dd>`);
}
}
html.push("</dl></section>");
}
startLine = end + 2;
}
}
for (lineIndex = startLine; lineIndex < lines.length; lineIndex += 1) {
const raw = lines[lineIndex];
const line = raw.trimEnd();
const trimmed = line.trim();
const footnote = /^\[\^([^\]]+)\]:\s+(.+)$/.exec(trimmed);
if (footnote) {
flushParagraph();
flushList();
flushTable();
footnotes.push({
id: footnote[1],
body: footnote[2]
});
continue;
}
if (/^```/.test(trimmed)) {
    flushParagraph();
    flushList();
    flushTable();
    html.push(codeOpen ? "</code></pre>" : "<pre><code>");
    codeOpen = !codeOpen;
    continue;
   }
   if (codeOpen) {
    html.push(escapeHtml(line));
    continue;
   }
   if (!trimmed) {
    flushParagraph();
    flushList();
    flushTable();
    continue;
   }
   if (trimmed.startsWith("$$")) {
    flushParagraph();
    flushList();
    flushTable();
    const mathStart = lineIndex;
    const mathLines = [];
    let current = trimmed.slice(2);
    if (current.endsWith("$$") && current.length > 2) {
     mathLines.push(current.slice(0, -2).trim());
    } else {
     if (current.trim()) mathLines.push(current.trim());
     while (lineIndex + 1 < lines.length) {
      lineIndex += 1;
      const nextMathLine = lines[lineIndex].trim();
      if (nextMathLine.endsWith("$$")) {
       const beforeClose = nextMathLine.slice(0, -2).trim();
       if (beforeClose) mathLines.push(beforeClose);
       break;
      }
      mathLines.push(nextMathLine);
     }
    }
    const formula = mathLines.join("\n").trim();
    html.push(`<div class="markdown-math-block" data-line-start="${mathStart}" data-line-end="${lineIndex}" data-line-num="${mathStart + 1}" data-hover-hint="✎ Click to edit">${renderInlineMarkdown(`$$${formula}$$`)}</div>`);
    continue;
   }
   if (/^\|.*\|$/.test(trimmed)) {
    flushParagraph();
    flushList();
    table.push({ text: trimmed, line: lineIndex });
    continue;
   }
   flushTable();
   const nextLine = lines[lineIndex + 1]?.trim() ?? "";
   if (
    trimmed
    && (/^={3,}$/.test(nextLine) || /^-{3,}$/.test(nextLine))
    && !isLikelyMarkdownStructure(trimmed)
    && !/[.!?;:]$/.test(trimmed)
   ) {
    flushParagraph();
    flushList();
    headingIndex += 1;
    const level = nextLine.startsWith("=") ? 1 : 2;
    const id = slugifyHeading(trimmed, headingIndex);
    html.push(`<h${level} id="${id}" data-line-start="${lineIndex}" data-line-end="${lineIndex + 1}" data-line-num="${lineIndex + 1}">${renderInlineMarkdown(trimmed)}</h${level}>`);
    lineIndex += 1;
    continue;
   }
   const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
   if (heading) {
    flushParagraph();
    flushList();
    headingIndex += 1;
    const level = Math.min(heading[1].length, 4);
    const id = slugifyHeading(heading[2], headingIndex);
    html.push(`<h${level} id="${id}" data-line-start="${lineIndex}" data-line-end="${lineIndex}" data-line-num="${lineIndex + 1}">${renderInlineMarkdown(heading[2])}</h${level}>`);
    continue;
   }
   if (/^---+$/.test(trimmed)) {
    flushParagraph();
    flushList();
    html.push("<hr>");
    continue;
   }
   if (/^>\s?/.test(trimmed)) {
    flushParagraph();
    flushList();
    const quote = trimmed.replace(/^>\s?/, "");
    const callout = /^\[!([A-Za-z]+)\]\s*(.*)$/.exec(quote);
    if (callout) {
     const bodyLines = callout[2] ? [callout[2]] : [];
     while (lineIndex + 1 < lines.length && /^>\s?/.test(lines[lineIndex + 1].trimEnd())) {
      const nextQuote = lines[lineIndex + 1].trimEnd().replace(/^>\s?/, "");
      if (/^\[!([A-Za-z]+)\]/.test(nextQuote.trim())) break;
      bodyLines.push(nextQuote);
      lineIndex += 1;
     }
     const body = bodyLines
      .join("\n")
      .split(/\n\s*\n/)
      .map((block) => block.split("\n").map((item) => item.trim()).filter(Boolean).join(" "))
      .filter(Boolean)
      .map((block) => `<p>${renderInlineMarkdown(block)}</p>`)
      .join("");
     html.push(`<aside class="markdown-callout" data-callout="${escapeHtml(callout[1].toLowerCase())}"><strong>${escapeHtml(callout[1])}</strong>${body}</aside>`);
    } else {
     const quoteLines = [quote];
     const startLine = lineIndex;
     while (lineIndex + 1 < lines.length && /^>\s?/.test(lines[lineIndex + 1].trimEnd())) {
      const nextQuote = lines[lineIndex + 1].trimEnd().replace(/^>\s?/, "");
      if (/^\[!([A-Za-z]+)\]/.test(nextQuote.trim())) break;
      quoteLines.push(nextQuote);
      lineIndex += 1;
     }
     const content = quoteLines
      .join("\n")
      .split(/\n\s*\n/)
      .map((block) => block.split("\n").map((item) => item.trim()).filter(Boolean).join(" "))
      .filter(Boolean)
      .map((block) => `<p>${renderInlineMarkdown(block)}</p>`)
      .join("");
     html.push(`<blockquote data-line-start="${startLine}" data-line-end="${lineIndex}" data-line-num="${startLine + 1}">${content}</blockquote>`);
    }
    continue;
   }
   const task = /^[-*+]\s+\[( |x|X)\]\s+(.+)$/.exec(trimmed);
   if (task) {
    flushParagraph();
    openList("ul");
    const checked = task[1].toLowerCase() === "x" ? " checked" : "";
    const indent = Math.min(Math.floor((line.match(/^\s*/)?.[0].length ?? 0) / 2), 6);
    html.push(`<li class="task-list-item markdown-list-indent-${indent}" data-line-start="${lineIndex}" data-line-end="${lineIndex}" data-line-num="${lineIndex + 1}"><input type="checkbox" disabled${checked}>${renderInlineMarkdown(task[2])}</li>`);
    continue;
   }
   const bullet = /^[-*+]\s+(.+)$/.exec(trimmed);
   if (bullet) {
    flushParagraph();
    openList("ul");
    const indent = Math.min(Math.floor((line.match(/^\s*/)?.[0].length ?? 0) / 2), 6);
    html.push(`<li class="markdown-list-indent-${indent}" data-line-start="${lineIndex}" data-line-end="${lineIndex}" data-line-num="${lineIndex + 1}">${renderInlineMarkdown(bullet[1])}</li>`);
    continue;
   }
   const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
   if (ordered) {
    flushParagraph();
    openList("ol");
    const indent = Math.min(Math.floor((line.match(/^\s*/)?.[0].length ?? 0) / 2), 6);
    html.push(`<li class="markdown-list-indent-${indent}" data-line-start="${lineIndex}" data-line-end="${lineIndex}" data-line-num="${lineIndex + 1}">${renderInlineMarkdown(ordered[1])}</li>`);
    continue;
   }
   paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  flushTable();
  if (codeOpen) html.push("</code></pre>");
  if (footnotes.length) {
   html.push('<section class="markdown-footnotes"><h4>Footnotes</h4><ol>');
   for (const note of footnotes) {
    html.push(`<li id="footnote-${escapeHtml(note.id)}">${renderInlineMarkdown(note.body)}</li>`);
   }
   html.push("</ol></section>");
  }
  let resultHtml = html.join("\n");
  if (typeof window !== "undefined") {
   resultHtml = resultHtml.replace(/<(p|h1|h2|h3|h4|li|blockquote)([\s>])/g, '<$1 data-hover-hint="✎ Click to edit"$2');
  } else {
   resultHtml = resultHtml.replace(/\s+data-line-start="\d+"\s+data-line-end="\d+"\s+data-line-num="\d+"/g, "");
  }
  return resultHtml;
 }
 function searchMatches(markdown, term) {
  const needle = String(term ?? "").trim().toLowerCase();
  if (!needle) return [];
  const haystack = String(markdown ?? "").toLowerCase();
  const matches = [];
  let index = haystack.indexOf(needle);
  while (index >= 0 && matches.length < 1000) {
   matches.push(index);
   index = haystack.indexOf(needle, index + Math.max(needle.length, 1));
  }
  return matches;
 }
 function updateSearchCount() {
  const count = $("markdownSearchCount");
  if (!count) return;
  const term = $("markdownDocSearch")?.value ?? "";
  const matches = searchMatches($("noteContent")?.value ?? "", term);
  if (!matches.length) {
   activeSearchIndex = 0;
   count.textContent = "0 matches";
   return;
  }
  activeSearchIndex = Math.min(activeSearchIndex, matches.length - 1);
  count.textContent = `${activeSearchIndex + 1} / ${matches.length}`;
 }
 function applyMarkdownSearchHighlights() {
  const view = $("markdownReadView");
  const term = $("markdownDocSearch")?.value?.trim() ?? "";
  if (!view || !term) {
   updateSearchCount();
   return;
  }
  const walker = document.createTreeWalker(view, NodeFilter.SHOW_TEXT, {
   acceptNode(node) {
    if (!node.nodeValue || !node.nodeValue.toLowerCase().includes(term.toLowerCase())) {
     return NodeFilter.FILTER_REJECT;
    }
    return NodeFilter.FILTER_ACCEPT;
   }
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let hitIndex = 0;
  for (const node of nodes) {
   const fragment = document.createDocumentFragment();
   const source = node.nodeValue;
   const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
   let lastIndex = 0;
   let match;
   while ((match = pattern.exec(source)) !== null) {
    fragment.append(document.createTextNode(source.slice(lastIndex, match.index)));
    const mark = document.createElement("mark");
    mark.className = `markdown-search-hit${hitIndex === activeSearchIndex ? " active" : ""}`;
    mark.textContent = match[0];
    fragment.append(mark);
    hitIndex += 1;
    lastIndex = match.index + match[0].length;
   }
   fragment.append(document.createTextNode(source.slice(lastIndex)));
   node.parentNode.replaceChild(fragment, node);
  }
  const active = view.querySelector(".markdown-search-hit.active");
  if (active && state.markdownViewMode !== "edit") {
   active.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  updateSearchCount();
 }
 function renderMarkdownReadView() {
  const view = $("markdownReadView");
  if (!view) return;
  if (renderTimer) {
   clearTimeout(renderTimer);
   renderTimer = 0;
  }
  const markdown = $("noteContent")?.value ?? "";
  if (markdown.includes("PDF extraction needs another path")) {
   view.innerHTML = renderPdfDiagnosticsHtml(markdown);
   const ignoreBtn = view.querySelector("#btnIgnoreDiagnostics");
   if (ignoreBtn) {
    ignoreBtn.style.background = "var(--primary)";
    ignoreBtn.style.color = "var(--button-text, #ffffff)";
    ignoreBtn.style.border = "none";
    ignoreBtn.addEventListener("click", () => {
     const srcNameMatch = markdown.match(/Source file:\s*(.*)/i);
     const srcName = srcNameMatch ? srcNameMatch[1].trim() : "document.pdf";
     const title = `# ${srcName.replace(/\.[^.]+$/, "")}\n\n`;
     const editor = $("noteContent");
     if (editor) {
      editor.value = title;
     }
     if (window.markdownEditor && typeof window.markdownEditor.setValue === "function") {
      window.markdownEditor.setValue(title);
     }
     if (state.selectedRecord) {
      if (state.selectedRecord.extractionQuality) {
       state.selectedRecord.extractionQuality.lowReadableText = false;
      }
      state.selectedRecord.warnings = [];
     }
     setMarkdownViewMode("edit");
     if (typeof saveCurrentNote === "function") {
      run(async () => {
       await saveCurrentNote();
       renderMarkdownReadView();
       const warningsContainer = document.getElementById("editorWarnings");
       if (warningsContainer) {
        warningsContainer.classList.add("hidden");
        warningsContainer.innerHTML = "";
       }
      });
     }
    });
   }
   renderMarkdownOutline();
   renderMarkdownStatus();
   document.dispatchEvent(new CustomEvent("schema-docs:markdown-rendered"));
   return;
  }
  let html = markdown.trim() ? markdownToReadableHtml(markdown) : "<p>Import or write a Markdown document to read it here.</p>";
  html = html.replace(/\[([a-zA-Z_]+)_(\d+)\]/g, (match) => {
   const decrypted = state.lastMaskMapping ? state.lastMaskMapping[match] : "";
   return `<span class="masked-pill" data-original="${escapeHtml(decrypted || '')}" data-token="${escapeHtml(match)}">${escapeHtml(match)}</span>`;
  });
  view.innerHTML = html;
  view.querySelectorAll("img.workspace-asset-image").forEach((image) => {
   image.addEventListener("error", () => {
    retryWorkspaceAssetImage(image);
   }, { once: true });
  });
  enhancePptxSlideReadView(view, markdown);
  view.querySelectorAll(".masked-pill").forEach((pill) => {
   pill.addEventListener("click", (event) => {
    event.preventDefault(); event.stopPropagation();
    const original = pill.dataset.original, token = pill.dataset.token;
    if (!original) {
     if (typeof showAlert === "function") showAlert("info", "No decryption mapping available for: " + token);
     return;
    }
    if (pill.classList.contains("revealed")) {
     pill.textContent = token; pill.classList.remove("revealed");
    } else {
     pill.textContent = original; pill.classList.add("revealed");
    }
   });
  });
  view.querySelectorAll("[data-markdown-relative-link]").forEach((button) => {
   button.addEventListener("click", () => {
    const targetPath = normalizeRelativeMarkdownPath($("notePath")?.value || "", button.dataset.markdownRelativeLink);
    if (targetPath && typeof openMarkdownPath === "function") run(() => openMarkdownPath(targetPath));
   });
  });
  renderMathInView(view);
  applyMarkdownSearchHighlights();
  renderMarkdownOutline();
  renderMarkdownStatus();
  document.dispatchEvent(new CustomEvent("schema-docs:markdown-rendered"));
 }
function renderMathInView(view) {
  if (!view) return;
  view.querySelectorAll(".katex-math").forEach((el) => {
   const math = el.getAttribute("data-math");
   const displayMode = el.classList.contains("display-mode");
   if (window.katex) {
    try {
     window.katex.render(math, el, {
      displayMode: displayMode,
      throwOnError: false
     });
    } catch (err) {
     el.textContent = displayMode ? `$$${math}$$` : `$${math}$`;
    }
   } else {
    el.textContent = displayMode ? `$$${math}$$` : `$${math}$`;
    el.classList.add("math-fallback");
   }
  });
 }

 function isPptxSlideMarkdown(markdown) {
  const text = String(markdown ?? "");
  const recordType = String(state.currentRecord?.sourceType || state.selectedRecord?.sourceType || "").toLowerCase();
  return recordType === "pptx"
   || (/^##\s+Slide\s+\d+(?::|\s*$)/im.test(text) && /!\[Slide\s+\d+\s+(?:preview|image)\]/i.test(text));
 }

 function enhancePptxSlideReadView(view, markdown) {
  if (!view || !isPptxSlideMarkdown(markdown)) return;
  const slideHeadings = [...view.querySelectorAll("h2")]
   .filter((heading) => /^Slide\s+\d+(?::|\s*$)/i.test(heading.textContent.trim()));
  if (!slideHeadings.length) return;

  const savedMode = state.pptxReadMode || localStorage.getItem("schemaDocsPptxReadMode");
  const mode = savedMode === "outline" ? "outline" : "slides";
  state.pptxReadMode = mode;
  view.classList.add("pptx-document-view");

  const controls = document.createElement("div");
  controls.className = "pptx-layer-toggle";
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", "PowerPoint view");
  controls.innerHTML = `
   <button type="button" data-pptx-mode="slides" title="Original slide appearance">Slides</button>
   <button type="button" data-pptx-mode="outline" title="Editable extracted text for search and AI">Text outline</button>
  `;
  slideHeadings[0].parentNode.insertBefore(controls, slideHeadings[0]);

  for (let index = 0; index < slideHeadings.length; index += 1) {
   const heading = slideHeadings[index];
   const nextHeading = slideHeadings[index + 1] || null;
   const nodes = [];
   let cursor = heading;
   while (cursor && cursor !== nextHeading) {
    const next = cursor.nextSibling;
    nodes.push(cursor);
    cursor = next;
   }

   const section = document.createElement("section");
   section.className = "pptx-slide-section";
   heading.parentNode.insertBefore(section, heading);
   nodes.forEach((node) => section.appendChild(node));
   heading.classList.add("pptx-slide-heading");

   const preview = [...section.children].find((element) => {
    const image = element.matches?.("img") ? element : element.querySelector?.("img");
    return image && /^Slide\s+\d+\s+(?:preview|image)$/i.test(image.getAttribute("alt") || "");
   });
   if (preview) {
    preview.classList.add("pptx-slide-preview");
   } else {
    section.classList.add("pptx-slide-without-preview");
   }

   const textLayer = document.createElement("div");
   textLayer.className = "pptx-slide-text-layer";
   [...section.children].forEach((element) => {
    if (element !== heading && element !== preview && element !== textLayer) textLayer.appendChild(element);
   });
   section.appendChild(textLayer);
   if (!textLayer.children.length && !textLayer.textContent.trim()) textLayer.classList.add("empty");
  }

  const applyMode = (nextMode) => {
   const normalized = nextMode === "outline" ? "outline" : "slides";
   state.pptxReadMode = normalized;
   localStorage.setItem("schemaDocsPptxReadMode", normalized);
   view.dataset.pptxMode = normalized;
   controls.querySelectorAll("button[data-pptx-mode]").forEach((button) => {
    const active = button.dataset.pptxMode === normalized;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
   });
  };
  controls.querySelectorAll("button[data-pptx-mode]").forEach((button) => {
   button.addEventListener("click", () => applyMode(button.dataset.pptxMode));
  });
  applyMode(mode);

  if (typeof window.translateText === "function") {
   const slidesButton = controls.querySelector('[data-pptx-mode="slides"]');
   const outlineButton = controls.querySelector('[data-pptx-mode="outline"]');
   slidesButton.textContent = window.translateText("Slides");
   outlineButton.textContent = window.translateText("Text outline");
   slidesButton.title = window.translateText("Original slide appearance");
   outlineButton.title = window.translateText("Editable extracted text for search and AI");
  }
 }
function scheduleMarkdownReadRender(delay = 160) {
  if (renderTimer) {
   clearTimeout(renderTimer);
  }
  renderTimer = setTimeout(() => renderMarkdownReadView(), delay);
 }
 function renderMarkdownOutline() {
  const outline = $("markdownOutline");
  if (!outline) return;
  const headings = getMarkdownHeadings($("noteContent")?.value ?? "");
  let isGarbage = false;
  if (headings.length > 0) {
   const garbageHeadings = headings.filter(h => /\\(376|377|000)/.test(h.title) || h.title.includes("\\376\\377") || /[\u0000-\u0008\u000e-\u001f]/.test(h.title));
   const garbageRatio = garbageHeadings.length / headings.length;
   const titles = headings.map(h => h.title);
   const uniqueTitles = new Set(titles);
   const duplicateRatio = 1 - (uniqueTitles.size / headings.length);
   if (headings.length < 2 || garbageRatio > 0.15 || duplicateRatio > 0.35) {
    isGarbage = true;
   }
  } else {
   isGarbage = true;
  }
  if (isGarbage) {
   outline.style.display = "none";
  } else {
   outline.style.display = "block";
   outline.innerHTML = headings.map((heading) => (
    `<button type="button" data-heading-id="${heading.id}" style="padding-left: ${8 + (heading.level - 1) * 12}px">${escapeHtml(heading.title)}</button>`
   )).join("");
   outline.querySelectorAll("button[data-heading-id]").forEach((button) => {
    button.addEventListener("click", () => {
     const target = document.getElementById(button.dataset.headingId);
     if (target && state.markdownViewMode !== "edit") {
      target.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
     }
     setMarkdownViewMode("edit");
     const heading = getMarkdownHeadings($("noteContent")?.value ?? "").find((item) => item.id === button.dataset.headingId);
     focusEditorLine(Number(heading?.lineIndex || 0));
    });
   });
  }
  renderMarkdownDocMeta();
 }
 function renderMarkdownDocMeta() {
  const container = $("markdownDocMeta");
  if (!container) return;
  const meta = getMarkdownMetadata($("noteContent")?.value ?? "");
  const sections = [];
  if (meta.wikiLinks.length) {
   sections.push(`<div class="markdown-meta-section"><strong>Links</strong>${meta.wikiLinks.slice(0, 16).map((link) => `<button type="button" data-insert-search="${escapeHtml(link)}">[[${escapeHtml(link)}]]</button>`).join("")}</div>`);
  }
  if (meta.tags.length) {
   sections.push(`<div class="markdown-meta-section"><strong>Tags</strong>${meta.tags.slice(0, 20).map((tag) => `<button type="button" data-insert-search="#${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`).join("")}</div>`);
  }
  if (meta.footnotes || meta.openTasks || meta.doneTasks) {
   sections.push(`<div class="markdown-meta-section compact"><strong>Stats</strong><span>${meta.openTasks} open tasks</span><span>${meta.doneTasks} done</span><span>${meta.footnotes} footnotes</span></div>`);
  }
  container.innerHTML = sections.join("") || '<div class="markdown-meta-empty">No links, tags, tasks, or footnotes</div>';
  container.querySelectorAll("[data-insert-search]").forEach((button) => {
   button.addEventListener("click", () => {
    const search = $("markdownDocSearch");
    if (search) {
     search.value = button.dataset.insertSearch;
     activeSearchIndex = 0;
     renderMarkdownReadView();
    }
   });
  });
  renderSegmentNavigation();
 }
 function renderSegmentNavigation() {
  const container = $("markdownDocMeta");
  if (!container || !state.selectedRecord) return;
  container.querySelectorAll(".segment-navigation-section").forEach(el => el.remove());
  const segmentsObj = state.selectedRecord?.markdownOutputs?.readableSegments;
  const banner = $("segmentBanner");
  if (!segmentsObj || !segmentsObj.segmented || !segmentsObj.segments?.length) {
   if (banner) banner.classList.add("hidden");
   return;
  }
  const currentPath = $("notePath").value.trim();
  const workspaceRoot = state.workspacePath || "";
  let currentIndex = -1;
  const segments = segmentsObj.segments;
  for (let i = 0; i < segments.length; i++) {
   let segPath = segments[i].relativePath;
   if (workspaceRoot && segPath.startsWith(workspaceRoot)) {
    segPath = segPath.slice(workspaceRoot.length).replace(/^[\\\/]+/, "").replace(/\\/g, "/");
   }
   if (segPath === currentPath) {
    currentIndex = i;
    break;
   }
  }
  let labelText = window.translateText ? window.translateText("Document Segments") : "Document Segments";
  let curText = window.translateText ? window.translateText("Current") : "Current";
  let openIndexText = window.translateText ? window.translateText("Open Index") : "Open Index";
  let partText = window.translateText ? window.translateText("Part") : "Part";
  let indexText = window.translateText ? window.translateText("Index / Full") : "Index / Full";
  const navDiv = document.createElement("div");
  navDiv.className = "markdown-meta-section segment-navigation-section";
  navDiv.style.borderBottom = "1px solid var(--border-color)";
  navDiv.style.paddingBottom = "10px";
  navDiv.style.marginBottom = "10px";
  let html = `<strong>${labelText}</strong>`;
  if (currentIndex !== -1) {
   html += `<span class="segment-current-badge">${curText}: Part ${currentIndex + 1} / ${segments.length}</span>`;
  } else {
   html += `<span class="segment-current-badge">${curText}: Index / Full</span>`;
  }

  const percent = currentIndex !== -1 ? Math.round(((currentIndex + 1) / segments.length) * 100) : 100;
  html += `
  <div class="segment-progress-container" style="background: var(--bg-surface-elevated); height: 6px; border-radius: 3px; overflow: hidden; margin-top: 8px; margin-bottom: 8px; border: 1px solid var(--border-color);">
    <div class="segment-progress-fill" style="background: linear-gradient(90deg, var(--primary) 0%, #10b981 100%); height: 100%; width: ${percent}%; box-shadow: 0 0 8px var(--primary); transition: width 0.3s ease;"></div>
  </div>`;

  html += `<div class="segment-nav-buttons" style="display: flex; gap: 6px; margin-top: 6px;">`;
  if (currentIndex > 0) {
   const prevSeg = segments[currentIndex - 1];
   let prevPath = prevSeg.relativePath;
   if (workspaceRoot && prevPath.startsWith(workspaceRoot)) {
    prevPath = prevPath.slice(workspaceRoot.length).replace(/^[\\\/]+/, "").replace(/\\/g, "/");
   }
   html += `<button type="button" class="secondary compact-button prev-segment-btn" data-target-path="${escapeHtml(prevPath)}" style="transition: all 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.12);">← Prev</button>`;
  } else {
   html += `<button type="button" class="secondary compact-button prev-segment-btn" disabled>← Prev</button>`;
  }
  if (currentIndex !== -1 && currentIndex < segments.length - 1) {
   const nextSeg = segments[currentIndex + 1];
   let nextPath = nextSeg.relativePath;
   if (workspaceRoot && nextPath.startsWith(workspaceRoot)) {
    nextPath = nextPath.slice(workspaceRoot.length).replace(/^[\\\/]+/, "").replace(/\\/g, "/");
   }
   html += `<button type="button" class="secondary compact-button next-segment-btn" data-target-path="${escapeHtml(nextPath)}" style="transition: all 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.12);">Next →</button>`;
  } else {
   html += `<button type="button" class="secondary compact-button next-segment-btn" disabled>Next →</button>`;
  }
  let indexPath = segmentsObj.indexRelativePath || segmentsObj.indexPath || "";
  if (workspaceRoot && indexPath.startsWith(workspaceRoot)) {
   indexPath = indexPath.slice(workspaceRoot.length).replace(/^[\\\/]+/, "").replace(/\\/g, "/");
  }
  html += `<button type="button" class="secondary compact-button index-segment-btn" data-target-path="${escapeHtml(indexPath)}" style="transition: all 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.12);">${openIndexText}</button>`;
  html += `</div>`;
  navDiv.innerHTML = html;
  container.insertBefore(navDiv, container.firstChild);
  navDiv.querySelectorAll("button[data-target-path]").forEach(btn => {
   btn.addEventListener("click", () => {
    const target = btn.dataset.targetPath;
    if (target && typeof openMarkdownPath === "function") {
     run(() => openMarkdownPath(target));
    }
   });
  });
  if (banner) {
    banner.classList.remove("hidden");
    banner.style.gridColumn = "1 / -1";
    banner.style.width = "100%";
    banner.style.maxWidth = "none";
    banner.style.boxSizing = "border-box";
    let titleText = window.translateText ? window.translateText("Large file: only one segment is loaded in the editor. Current: ") : "Large file: only one segment is loaded in the editor. Current: ";
    let curPartLabel = currentIndex !== -1 ? `${partText} ${currentIndex + 1} / ${segments.length}` : indexText;

    let docTitle = state.selectedRecord.title || "Document";
    let rangeInfo = "";
    if (currentIndex !== -1 && segments[currentIndex]) {
      const curSeg = segments[currentIndex];
      const startLine = Number(curSeg.startLine) || 0;
      const endLine = Number(curSeg.endLine) || 0;
      rangeInfo = `<span style="font-size: 11px; color: var(--text-muted); margin-left: 10px;">(Mapped source lines ${startLine}-${endLine})</span>`;
    }

    let bannerHtml = `<div class="segment-breadcrumbs" style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">`;
    bannerHtml += `<span class="breadcrumb-item" style="cursor: pointer; color: var(--primary); font-weight: bold; text-decoration: underline;" id="breadcrumbDocTitle" data-target-path="${escapeHtml(indexPath)}">${escapeHtml(docTitle)}</span>`;
    bannerHtml += `<span class="breadcrumb-separator">/</span>`;
    bannerHtml += `<span class="breadcrumb-item active" style="color: var(--foreground-bright); font-weight: bold;">Part ${currentIndex !== -1 ? currentIndex + 1 : 'Index'} of ${segments.length}</span>`;
    bannerHtml += rangeInfo;
    bannerHtml += `</div>`;

    bannerHtml += `<div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">`;
    bannerHtml += `<div><strong>${titleText}</strong> <span style="background: rgba(16, 185, 129, 0.15); padding: 2px 6px; border-radius: 4px; font-family: monospace; border: 1px solid var(--primary); font-weight: bold; color: var(--primary);">${curPartLabel}</span>`;
    let showPartsText = window.translateText ? window.translateText("Show all parts") : "Show all parts";
    bannerHtml += `<button type="button" id="btnToggleSegmentsGrid" class="secondary compact-button" style="padding: 2px 6px; font-size: 11px; margin-left: 8px; cursor: pointer;">${showPartsText} (${segments.length})</button></div>`;
    bannerHtml += `<div style="display: flex; gap: 6px;">`;
    if (currentIndex > 0) {
     const prevSeg = segments[currentIndex - 1];
     let prevPath = prevSeg.relativePath;
     if (workspaceRoot && prevPath.startsWith(workspaceRoot)) {
      prevPath = prevPath.slice(workspaceRoot.length).replace(/^[\\\/]+/, "").replace(/\\/g, "/");
     }
     bannerHtml += `<button type="button" class="secondary compact-button prev-segment-banner-btn" data-target-path="${escapeHtml(prevPath)}" style="padding: 2px 8px; font-size: 11px; transition: all 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.12);">← Prev</button>`;
     }
     if (currentIndex !== -1 && currentIndex < segments.length - 1) {
      const nextSeg = segments[currentIndex + 1];
      let nextPath = nextSeg.relativePath;
      if (workspaceRoot && nextPath.startsWith(workspaceRoot)) {
       nextPath = nextPath.slice(workspaceRoot.length).replace(/^[\\\/]+/, "").replace(/\\/g, "/");
      }
      bannerHtml += `<button type="button" class="secondary compact-button next-segment-banner-btn" data-target-path="${escapeHtml(nextPath)}" style="padding: 2px 8px; font-size: 11px; transition: all 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.12);">Next →</button>`;
     }
     bannerHtml += `<button type="button" class="secondary compact-button index-segment-banner-btn" data-target-path="${escapeHtml(indexPath)}" style="padding: 2px 8px; font-size: 11px; transition: all 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.12);">${openIndexText}</button>`;
     bannerHtml += `</div>`;
     bannerHtml += `</div>`;
     const isGridHidden = localStorage.getItem("schemaDocsSegmentsGridHidden") === "true";
     let gridStyle = isGridHidden ? "display: none;" : "display: grid;";
     bannerHtml += `<div id="segmentsGridPanel" style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border-color); ${gridStyle} grid-template-columns: repeat(auto-fill, minmax(42px, 1fr)); gap: 6px; max-height: 120px; overflow-y: auto; padding-right: 4px;">`;
     for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      let segPath = seg.relativePath;
      if (workspaceRoot && segPath.startsWith(workspaceRoot)) {
       segPath = segPath.slice(workspaceRoot.length).replace(/^[\\\/]+/, "").replace(/\\/g, "/");
      }
      const isActive = (i === currentIndex);
      const activeStyle = isActive
       ? "background: var(--primary) !important; color: white !important; font-weight: bold; border: 1px solid var(--primary);"
       : "cursor: pointer; transition: all 0.2s;";
      const tooltip = `Part ${i + 1}: ${seg.title || ''} (${seg.characters.toLocaleString()} chars, lines ${seg.startLine}-${seg.endLine})`;
      bannerHtml += `<button type="button" class="secondary compact-button segment-grid-btn" data-target-path="${escapeHtml(segPath)}" title="${escapeHtml(tooltip)}" style="padding: 4px 0; text-align: center; font-size: 11px; ${activeStyle}">${i + 1}</button>`;
     }
     bannerHtml += `</div>`;
      const saveScopeText = currentIndex !== -1
       ? (window.largeDocumentText?.("scope", { part: currentIndex + 1, total: segments.length })
        || `Save and normal export use only part ${currentIndex + 1} of ${segments.length}. Use the full-document export buttons below for the whole file.`)
       : (window.largeDocumentText?.("indexScope", { total: segments.length })
        || `This is the segment index. Open a part to edit, or use the full-document export buttons below.`);
      bannerHtml += `<div style="margin-top: 8px; padding: 8px 10px; border-radius: 6px; background: rgba(245, 158, 11, 0.10); border: 1px solid rgba(245, 158, 11, 0.35); color: var(--text-color); font-size: 12px; line-height: 1.45;">${escapeHtml(saveScopeText)}</div>`;
      let mergeLabel = window.translateText ? window.translateText("Merge and export all parts:") : "Merge and export all parts:";
     bannerHtml += `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-color); display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text-muted);">`;
     bannerHtml += `<span>${mergeLabel}</span>`;
     bannerHtml += `<button type="button" class="secondary compact-button merge-export-btn" data-format="docx" style="padding: 2px 6px; font-size: 10px; cursor: pointer; transition: all 0.2s;">Word</button>`;
     bannerHtml += `<button type="button" class="secondary compact-button merge-export-btn" data-format="pdf" style="padding: 2px 6px; font-size: 10px; cursor: pointer; transition: all 0.2s;">PDF</button>`;
     bannerHtml += `<button type="button" class="secondary compact-button merge-export-btn" data-format="html" style="padding: 2px 6px; font-size: 10px; cursor: pointer; transition: all 0.2s;">HTML</button>`;
     bannerHtml += `<button type="button" class="secondary compact-button merge-export-btn" data-format="md" style="padding: 2px 6px; font-size: 10px; cursor: pointer; transition: all 0.2s;">Markdown</button>`;
     bannerHtml += `</div>`;
     banner.innerHTML = bannerHtml;
     const toggleBtn = banner.querySelector("#btnToggleSegmentsGrid");
     const gridPanel = banner.querySelector("#segmentsGridPanel");
     if (toggleBtn && gridPanel) {
      toggleBtn.addEventListener("click", () => {
       const currentlyHidden = gridPanel.style.display === "none";
       gridPanel.style.display = currentlyHidden ? "grid" : "none";
       localStorage.setItem("schemaDocsSegmentsGridHidden", currentlyHidden ? "false" : "true");
       toggleBtn.textContent = currentlyHidden
        ? `${window.translateText ? window.translateText("Hide all parts") : "Hide all parts"} (${segments.length})`
        : `${window.translateText ? window.translateText("Show all parts") : "Show all parts"} (${segments.length})`;
      });
      toggleBtn.textContent = isGridHidden
       ? `${window.translateText ? window.translateText("Show all parts") : "Show all parts"} (${segments.length})`
       : `${window.translateText ? window.translateText("Hide all parts") : "Hide all parts"} (${segments.length})`;
     }

     const breadcrumbDocTitleBtn = banner.querySelector("#breadcrumbDocTitle");
     if (breadcrumbDocTitleBtn) {
       breadcrumbDocTitleBtn.addEventListener("click", () => {
         const target = breadcrumbDocTitleBtn.dataset.targetPath;
         if (target && typeof openMarkdownPath === "function") {
           run(() => openMarkdownPath(target));
         }
       });
     }

     banner.querySelectorAll("button[data-target-path]").forEach(btn => {
      btn.addEventListener("click", () => {
       const target = btn.dataset.targetPath;
       if (target && typeof openMarkdownPath === "function") {
        run(() => openMarkdownPath(target));
       }
      });
     });
     banner.querySelectorAll(".merge-export-btn").forEach(btn => {
      btn.addEventListener("click", () => {
       const format = btn.dataset.format;
       if (format && typeof window.exportMergedNote === "function") {
        run(() => window.exportMergedNote(format));
       }
      });
     });
    }
  }
  function getSegmentLoadContext() {
   const segmentsObj = state.selectedRecord?.markdownOutputs?.readableSegments;
   if (!segmentsObj?.segmented || !segmentsObj.segments?.length) return null;
   const workspaceRoot = state.workspacePath || "";
   const normalize = (value) => {
    let path = String(value || "").replace(/\\/g, "/");
    if (workspaceRoot && path.startsWith(workspaceRoot)) {
     path = path.slice(workspaceRoot.length).replace(/^\/+/, "");
    }
    return path;
   };
   const currentPath = normalize($("notePath")?.value?.trim() || "");
   const currentIndex = segmentsObj.segments.findIndex((segment) => normalize(segment.relativePath) === currentPath);
   const indexPath = normalize(segmentsObj.indexRelativePath || segmentsObj.indexPath || "");
   return {
    currentIndex,
    total: segmentsObj.segments.length,
    isIndex: Boolean(indexPath && currentPath === indexPath)
   };
  }
  function renderSegmentLoadHint() {
   const existing = $("segmentLoadHint");
   const context = getSegmentLoadContext();
   const statusBar = $("markdownStatus")?.closest(".markdown-status-bar");
   if (!context || !statusBar) {
    if (existing) existing.remove();
    return;
   }
   const hint = existing || document.createElement("div");
   hint.id = "segmentLoadHint";
   hint.className = "segment-load-hint";
   hint.style.marginTop = "10px";
   hint.style.marginBottom = "8px";
   hint.style.padding = "10px 12px";
   hint.style.borderRadius = "8px";
   hint.style.border = "1px solid rgba(245, 158, 11, 0.35)";
   hint.style.background = "rgba(245, 158, 11, 0.10)";
   hint.style.color = "var(--text-color)";
   hint.style.fontSize = "12px";
   hint.style.lineHeight = "1.5";
   if (context.currentIndex >= 0) {
    hint.textContent = window.largeDocumentText?.("loadHint", { part: context.currentIndex + 1, total: context.total })
     || `Large document: the editor currently holds part ${context.currentIndex + 1} of ${context.total}. "Load full file" loads this part completely, not the merged document. Use the segment card's Word/PDF/HTML/Markdown buttons to export the whole document.`;
   } else if (context.isIndex) {
    hint.textContent = window.largeDocumentText?.("indexHint", { total: context.total })
     || `Large document index: open a part to edit it, or use the segment card's Word/PDF/HTML/Markdown buttons to export all ${context.total} parts as one document.`;
   } else {
    hint.textContent = window.largeDocumentText?.("genericHint", { total: context.total })
     || `Large document: save and normal export use the current editor content. Use the segment card's full-document export buttons when you need all ${context.total} parts.`;
   }
   if (!existing) {
    statusBar.parentNode.insertBefore(hint, statusBar);
   }
  }
  function renderPdfDiagnosticsHtml(markdown) {
   const t = (txt) => window.translateText ? window.translateText(txt) : txt;
   const srcNameMatch = markdown.match(/Source file:\s*(.*)/i);
   const srcName = srcNameMatch ? srcNameMatch[1].trim() : "document.pdf";
   const attempts = [];
   const attemptRegex = /-\s+([^:]+):\s+(.*)/g;
   let match;
   const triedSection = markdown.split("## What Schema Docs tried")[1]?.split("##")[0] || "";
   while ((match = attemptRegex.exec(triedSection)) !== null) {
    attempts.push({ name: match[1].trim(), status: match[2].trim() });
   }
   const extractorMatch = markdown.match(/> Extractor:\s*(.*)/i);
   const extractor = extractorMatch ? extractorMatch[1].trim() : "built-in";
   const qualityMatch = markdown.match(/> Extraction quality:\s*(.*)/i);
   const quality = qualityMatch ? qualityMatch[1].trim() : "low";
   const charCount = Number(state.selectedRecord?.markdownOutputs?.readableStats?.characters) || 0;

   return `<div class="pdf-diagnostics-container"><div class="diagnostics-card"><div class="diagnostics-header"><svg class="warn-icon" viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg><h2>${t("pdf_no_readable_text")}</h2><p class="diagnostics-subtitle">${t("pdf_source_file")} <strong>${escapeHtml(srcName)}</strong></p></div><div class="diagnostics-body"><p class="diagnostics-info-desc"><strong>${t("pdf_notice")}</strong> ${t("pdf_diagnostics_desc")}</p><div class="diagnostics-metrics-grid"><div class="metric-item"><span class="metric-label">${t("pdf_active_extractor")}</span><strong class="metric-value">${escapeHtml(extractor)}</strong></div><div class="metric-item"><span class="metric-label">${t("pdf_extracted_chars")}</span><strong class="metric-value">${charCount} ${t("pdf_chars")}</strong></div><div class="metric-item"><span class="metric-label">${t("pdf_readability_rating")}</span><strong class="metric-value text-danger" style="color:#ef4444;">${escapeHtml(t("quality_" + quality))}</strong></div><div class="metric-item"><span class="metric-label">${t("pdf_ai_send_gate_status")}</span><strong class="metric-value text-warning" style="color:#f59e0b;">${t("pdf_review_required")}</strong></div></div><div class="diagnostics-advice-box"><h3>💡 ${t("pdf_suggested_actions")}</h3><ul><li><strong>${t("pdf_option_a")}</strong> ${t("pdf_re_import_searchable")}</li><li><strong>${t("pdf_option_b")}</strong> ${t("pdf_install_optional_extractors")}<div class="diagnostics-adapters-status">${attempts.map(a => `<span class="adapter-badge ${a.status === 'unavailable' ? 'badge-missing' : 'badge-active'}">${escapeHtml(a.name)}: ${escapeHtml(t("status_" + a.status))}</span>`).join('')}</div></li><li><strong>${t("pdf_option_c")}</strong> ${t("pdf_continue_to_ai_send_gate")}</li></ul><button type="button" id="btnIgnoreDiagnostics" class="primary" style="margin-top: 16px; width: 100%; height: 38px; border-radius: 6px; font-weight: bold; cursor: pointer;">${t("Ignore warning and edit this file")}</button></div></div></div></div>`;
 }
 function renderMarkdownStatus() {
  const status = $("markdownStatus");
  if (!status) return;
 const stats = markdownStats($("noteContent")?.value ?? "");
 status.textContent = `${stats.words.toLocaleString()} words / ${stats.characters.toLocaleString()} characters / ${stats.headings} headings / ${Math.max(0, stats.tables - 1)} table rows`;
  renderSegmentLoadHint();
 }
 function setMarkdownViewMode(mode) {
  state.markdownViewMode = ["read", "split", "edit"].includes(mode) ? mode : "edit";
  localStorage.setItem("schemaDocsMarkdownViewMode", state.markdownViewMode);
  document.body.dataset.markdownView = state.markdownViewMode;
  $("markdownReadMode")?.classList.toggle("active", state.markdownViewMode === "read");
  $("markdownSplitMode")?.classList.toggle("active", state.markdownViewMode === "split");
  $("markdownEditMode")?.classList.toggle("active", state.markdownViewMode === "edit");
  const readView = $("markdownReadView");
  const editView = $("vditorContainer");
  const fallbackTextarea = $("noteContent");
  const useFallback = window.markdownEditor && window.markdownEditor.isFallback;

  if (state.markdownViewMode === "read") {
   if (readView) readView.style.setProperty("display", "block", "important");
   if (editView) editView.style.setProperty("display", "none", "important");
   if (fallbackTextarea) fallbackTextarea.style.setProperty("display", "none", "important");
  } else if (state.markdownViewMode === "split") {
   if (readView) readView.style.setProperty("display", "block", "important");
   if (useFallback) {
    if (editView) editView.style.setProperty("display", "none", "important");
    if (fallbackTextarea) fallbackTextarea.style.setProperty("display", "none", "important");
   } else {
    if (editView) editView.style.setProperty("display", "block", "important");
    if (fallbackTextarea) fallbackTextarea.style.setProperty("display", "none", "important");
   }
  } else {
   if (useFallback) {
    if (readView) readView.style.setProperty("display", "block", "important");
    if (editView) editView.style.setProperty("display", "none", "important");
    if (fallbackTextarea) fallbackTextarea.style.setProperty("display", "none", "important");
   } else {
    if (readView) readView.style.setProperty("display", "none", "important");
    if (editView) editView.style.setProperty("display", "block", "important");
    if (fallbackTextarea) fallbackTextarea.style.setProperty("display", "none", "important");
   }
  }

  if (state.markdownViewMode === "split" || state.markdownViewMode === "read") {
   renderMarkdownReadView();
  } else {
   renderMarkdownOutline();
   renderMarkdownDocMeta();
   renderMarkdownStatus();
  }
 }
 function setMarkdownOutlineOpen(open) {
  document.body.dataset.markdownOutline = open ? "open" : "collapsed";
  localStorage.setItem("schemaDocsMarkdownOutline", open ? "open" : "collapsed");
  $("toggleMarkdownOutline")?.classList.toggle("active", open);
  $("toggleMarkdownOutline")?.setAttribute("aria-pressed", open ? "true" : "false");
 }
 function cycleMarkdownViewMode() {
  const modes = ["read", "split", "edit"];
  const current = modes.indexOf(state.markdownViewMode);
  setMarkdownViewMode(modes[(current + 1) % modes.length]);
 }
 function focusEditorLine(lineIndex) {
  if (window.markdownEditor && !window.markdownEditor.isFallback && typeof window.markdownEditor.focusLine === "function") {
   window.markdownEditor.focusLine(lineIndex);
   return;
  }
  const editor = $("noteContent");
  if (!editor) return;
  const lines = editor.value.split("\n");
  const offset = lines.slice(0, Math.max(0, lineIndex)).join("\n").length + (lineIndex > 0 ? 1 : 0);
  editor.focus();
  editor.setSelectionRange(offset, offset);
 }
 function focusEditorSearchMatch(direction = 1) {
  const editor = $("noteContent");
  const term = $("markdownDocSearch")?.value ?? "";
  if (!editor || !term.trim()) {
   updateSearchCount();
   return;
  }
  const matches = searchMatches(editor.value, term);
  if (!matches.length) {
   updateSearchCount();
   return;
  }
  activeSearchIndex = (activeSearchIndex + direction + matches.length) % matches.length;
  const start = matches[activeSearchIndex];
  const end = start + term.trim().length;
  if (state.markdownViewMode === "edit") {
   editor.focus();
   editor.setSelectionRange(start, end);
  } else {
   renderMarkdownReadView();
  }
  updateSearchCount();
 }
 function replaceSelectedLines(transform) {
  const editor = $("noteContent");
  if (!editor) return;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const lineStart = editor.value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const lineEndIndex = editor.value.indexOf("\n", end);
  const lineEnd = lineEndIndex === -1 ? editor.value.length : lineEndIndex;
  const block = editor.value.slice(lineStart, lineEnd);
  const replacement = block.split("\n").map(transform).join("\n");
  editor.setRangeText(replacement, lineStart, lineEnd, "select");
  renderMarkdownReadView();
 }
 function indentSelectedLines(outdent = false) {
  replaceSelectedLines((line) => {
   if (!outdent) return ` ${line}`;
   return line.startsWith("  ") ? line.slice(2) : line.replace(/^\t/, "");
  });
 }
 function syncSplitScroll(source) {
  if (state.markdownViewMode !== "split") return;
  if (window.markdownEditor && !window.markdownEditor.isFallback) return;
  const editor = $("noteContent");
  const view = $("markdownReadView");
  if (!editor || !view) return;
  const from = source === "editor" ? editor : view;
  const to = source === "editor" ? view : editor;
  const maxFrom = Math.max(from.scrollHeight - from.clientHeight, 1);
  const maxTo = Math.max(to.scrollHeight - to.clientHeight, 1);
  to.scrollTop = (from.scrollTop / maxFrom) * maxTo;
 }
 function markdownForEditedBlock(originalBlock, editedText) {
  const cleanText = String(editedText || "").replace(/\r\n?/g, "\n").trim();
  const source = String(originalBlock || "");
  if (!cleanText) return source;
  if (/^\s*\$\$/.test(source)) return cleanText;
  const setextHeading = /^([^\n]+)\n\s*(=+|-+)\s*$/.exec(source.trim());
  if (setextHeading) return `${cleanText}\n${setextHeading[2]}`;
  const heading = /^(#{1,6}\s+)([\s\S]*)$/.exec(source.trim());
  if (heading) return `${heading[1]}${cleanText}`;
  const quoteLines = source.split("\n").filter((line) => /^>\s?/.test(line.trim()));
  if (quoteLines.length && quoteLines.length === source.split("\n").filter((line) => line.trim()).length) {
   return cleanText.split("\n").map((line) => `> ${line}`).join("\n");
  }
  const listMatch = /^(\s*(?:-\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+))/.exec(source);
  if (listMatch) {
   const lines = cleanText.split("\n");
   return lines.map((line, index) => `${index === 0 ? listMatch[1] : "  "}${line}`).join("\n");
  }
  return cleanText;
 }
 function editableMarkdownForBlock(originalBlock) {
  const source = String(originalBlock || "").replace(/\r\n?/g, "\n").trim();
  if (!source || /^\s*\$\$/.test(source)) return source;
  const setextHeading = /^([^\n]+)\n\s*(?:=+|-+)\s*$/.exec(source);
  if (setextHeading) return setextHeading[1].trim();
  const heading = /^(#{1,6}\s+)([\s\S]*)$/.exec(source);
  if (heading) return heading[2];
  const sourceLines = source.split("\n");
  const quoteLines = sourceLines.filter((line) => line.trim());
  if (quoteLines.length && quoteLines.every((line) => /^>\s?/.test(line.trim()))) {
   return sourceLines.map((line) => line.replace(/^\s*>\s?/, "")).join("\n").trim();
  }
  const listMatch = /^(\s*(?:-\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+))/.exec(source);
  if (listMatch) return source.slice(listMatch[1].length).trim();
  return source;
 }
 function scanMarkdownTableText(value, onDelimiter) {
  const text = String(value || "");
  let result = "";
  let codeTicks = 0;
  let mathDelimiter = "";
  for (let index = 0; index < text.length; index++) {
   const character = text[index];
   if (character === "\\" && index + 1 < text.length) {
    result += character + text[index + 1];
    index++;
    continue;
   }
   if (character === "`") {
    let runLength = 1;
    while (text[index + runLength] === "`") runLength++;
    const marker = "`".repeat(runLength);
    if (!mathDelimiter) {
     if (!codeTicks) codeTicks = runLength;
     else if (codeTicks === runLength) codeTicks = 0;
    }
    result += marker;
    index += runLength - 1;
    continue;
   }
   if (character === "$" && !codeTicks) {
    const marker = text[index + 1] === "$" ? "$$" : "$";
    if (!mathDelimiter) mathDelimiter = marker;
    else if (mathDelimiter === marker) mathDelimiter = "";
    result += marker;
    index += marker.length - 1;
    continue;
   }
   if (character === "|" && !codeTicks && !mathDelimiter) {
    result += onDelimiter();
    continue;
   }
   result += character;
  }
  return result;
 }
 function splitMarkdownTableRow(source) {
  const trimmed = String(source || "").trim();
  const cells = scanMarkdownTableText(trimmed, () => "\u0000").split("\u0000").map((cell) => cell.trim());
  const leadingPipe = trimmed.startsWith("|");
  let trailingSlashCount = 0;
  for (let index = trimmed.length - 2; index >= 0 && trimmed[index] === "\\"; index--) trailingSlashCount++;
  const trailingPipe = trimmed.endsWith("|") && trailingSlashCount % 2 === 0;
  if (leadingPipe && cells[0] === "") cells.shift();
  if (trailingPipe && cells.at(-1) === "") cells.pop();
  return { cells, leadingPipe, trailingPipe };
 }
 function escapeMarkdownTableCell(value) {
  return scanMarkdownTableText(String(value || "").replace(/\r?\n/g, "<br>"), () => "\\|").trim();
 }
function beginInlineReadEdit(el, pointerEvent) {
  if (!el || el.dataset.inlineEditing === "true") return;
  const start = Number(el.dataset.lineStart);
  const end = Number(el.dataset.lineEnd ?? start);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  const editor = $("noteContent");
  if (!editor) return;
  const lines = editor.value.replace(/\r\n?/g, "\n").split("\n");
  const originalBlock = lines.slice(start, end + 1).join("\n");
  const originalHtml = el.innerHTML;
  const isMathBlock = el.classList.contains("markdown-math-block") || /^\s*\$\$/.test(originalBlock);
  const originalText = editableMarkdownForBlock(originalBlock);
  el.dataset.inlineEditing = "true";
  el.classList.add("inline-read-editor");
  if (isMathBlock) el.classList.add("inline-math-editor");
  el.setAttribute("contenteditable", "true");
  el.setAttribute("spellcheck", "true");
  el.textContent = originalText.trim();
  const selection = window.getSelection();
  let range = null;
  if (pointerEvent && typeof document.caretPositionFromPoint === "function") {
   const caret = document.caretPositionFromPoint(pointerEvent.clientX, pointerEvent.clientY);
   if (caret?.offsetNode && el.contains(caret.offsetNode)) {
    range = document.createRange();
    range.setStart(caret.offsetNode, caret.offset);
    range.collapse(true);
   }
  } else if (pointerEvent && typeof document.caretRangeFromPoint === "function") {
   const caretRange = document.caretRangeFromPoint(pointerEvent.clientX, pointerEvent.clientY);
   if (caretRange?.startContainer && el.contains(caretRange.startContainer)) range = caretRange;
  }
  if (!range) {
   range = document.createRange();
   range.selectNodeContents(el);
   range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
  el.focus();
  const finish = (commit = true) => {
   if (el.dataset.inlineEditing !== "true") return;
   el.dataset.inlineEditing = "false";
   el.removeAttribute("contenteditable");
   el.removeAttribute("spellcheck");
   el.classList.remove("inline-read-editor");
   el.classList.remove("inline-math-editor");
   if (!commit) {
    el.innerHTML = originalHtml;
    return;
   }
   const replacement = markdownForEditedBlock(originalBlock, el.innerText || el.textContent || "");
   lines.splice(start, end - start + 1, ...replacement.split("\n"));
   const nextValue = lines.join("\n");
   editor.value = nextValue;
   if (window.markdownEditor && typeof window.markdownEditor.setValue === "function") {
    window.markdownEditor.setValue(nextValue);
   }
   renderMarkdownReadView();
   if (typeof saveCurrentNote === "function") {
    run(() => saveCurrentNote());
   }
  };
  el.addEventListener("blur", () => finish(true), { once: true });
  el.addEventListener("keydown", (event) => {
   if (event.key === "Escape") {
    event.preventDefault();
    finish(false);
   } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    finish(true);
   }
  });
 }
 function beginInlineTableCellEdit(el) {
  const lineIndex = Number(el?.dataset.lineStart);
  const cellIndex = Number(el?.dataset.tableCell);
  const editor = $("noteContent");
  if (!el || !editor || !Number.isFinite(lineIndex) || !Number.isFinite(cellIndex) || el.dataset.inlineEditing === "true") return;
  const lines = editor.value.replace(/\r\n?/g, "\n").split("\n");
  const source = lines[lineIndex] || "";
  const indent = /^\s*/.exec(source)?.[0] || "";
  const { cells, leadingPipe, trailingPipe } = splitMarkdownTableRow(source);
  if (cellIndex >= cells.length) return;
  const originalHtml = el.innerHTML;
  el.dataset.inlineEditing = "true";
  el.classList.add("inline-read-editor");
  el.setAttribute("contenteditable", "true");
  el.setAttribute("spellcheck", "true");
  el.textContent = cells[cellIndex];
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  const finish = (commit = true) => {
   if (el.dataset.inlineEditing !== "true") return;
   el.dataset.inlineEditing = "false";
   el.removeAttribute("contenteditable");
   el.removeAttribute("spellcheck");
   el.classList.remove("inline-read-editor");
   if (!commit) { el.innerHTML = originalHtml; return; }
   cells[cellIndex] = escapeMarkdownTableCell(el.innerText || el.textContent || "");
   lines[lineIndex] = `${indent}${leadingPipe ? "| " : ""}${cells.join(" | ")}${trailingPipe ? " |" : ""}`;
   const nextValue = lines.join("\n");
   editor.value = nextValue;
   window.markdownEditor?.setValue?.(nextValue);
   renderMarkdownReadView();
   if (typeof saveCurrentNote === "function") run(() => saveCurrentNote());
  };
  el.addEventListener("blur", () => finish(true), { once: true });
  el.addEventListener("keydown", (event) => {
   if (event.key === "Escape") { event.preventDefault(); finish(false); }
   if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); finish(true); }
  });
 }
 function insertMarkdownSyntax(action) {
  if (window.markdownEditor && !window.markdownEditor.isFallback) {
   let text = "";
   if (action === "bold") text = "**bold text**";
   else if (action === "italic") text = "*italic text*";
   else if (action === "link") text = "[link text](https://)";
   else if (action === "wikilink") text = "[[Linked Note]]";
   else if (action === "quote") text = "\n> Quote\n";
   else if (action === "bullet") text = "\n- List item\n";
   else if (action === "ordered") text = "\n1. List item\n";
   else if (action === "task") text = "\n- [ ] Task item\n";
   else if (action === "code") text = "\n```\ncode\n```\n";
   else if (action === "table") text = "\n| Header | Header |\n| --- | --- |\n| Cell | Cell |\n";
   else if (action === "h1") text = "\n# Heading\n";
   else if (action === "h2") text = "\n## Heading\n";
   if (text) {
    window.markdownEditor.insertValue(text);
   }
   return;
  }
  const editor = $("noteContent");
  if (!editor) return;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const selected = editor.value.slice(start, end);
  const lineStart = editor.value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const lineEndIndex = editor.value.indexOf("\n", end);
  const lineEnd = lineEndIndex === -1 ? editor.value.length : lineEndIndex;
  const selectedLines = editor.value.slice(lineStart, lineEnd).split("\n");
  let replacement = selected || "";
  let replaceStart = start;
  let replaceEnd = end;
  if (action === "h1" || action === "h2") {
   const prefix = action === "h1" ? "# " : "## ";
   replaceStart = lineStart;
   replaceEnd = lineEnd;
   replacement = selectedLines.map((line) => `${prefix}${line.replace(/^#{1,6}\s+/, "") || "Heading"}`).join("\n");
  } else if (action === "bold") {
   replacement = `**${selected || "bold text"}**`;
  } else if (action === "italic") {
   replacement = `*${selected || "italic text"}*`;
  } else if (action === "link") {
   replacement = `[${selected || "link text"}](https://)`;
  } else if (action === "wikilink") {
   replacement = `[[${selected || "Linked Note"}]]`;
  } else if (action === "quote") {
   replaceStart = lineStart;
   replaceEnd = lineEnd;
   replacement = selectedLines.map((line) => `> ${line || "Quote"}`).join("\n");
  } else if (action === "bullet") {
   replaceStart = lineStart;
   replaceEnd = lineEnd;
   replacement = selectedLines.map((line) => `- ${line || "List item"}`).join("\n");
  } else if (action === "ordered") {
   replaceStart = lineStart;
   replaceEnd = lineEnd;
   replacement = selectedLines.map((line, index) => `${index + 1}. ${line || "List item"}`).join("\n");
  } else if (action === "task") {
   replaceStart = lineStart;
   replaceEnd = lineEnd;
   replacement = selectedLines.map((line) => `- [ ] ${line || "Task item"}`).join("\n");
  } else if (action === "code") {
   replacement = selected.includes("\n") ? `\`\`\`\n${selected || "code"}\n\`\`\`` : `\`${selected || "code"}\``;
} else if (action === "table") {
replacement = "| Column | Value |\n| --- | --- |\n| Item | Detail |";
} else if (action === "callout") {
replaceStart = lineStart;
replaceEnd = lineEnd;
replacement = selectedLines.map((line, index) => index === 0 ? `> [!NOTE] ${line || "Note"}` : `> ${line}`).join("\n");
} else if (action === "footnote") {
const footnoteId = "1";
replacement = `${selected || "claim"}[^${footnoteId}]\n\n[^${footnoteId}]: Evidence note.`;
} else if (action === "rule") {
replaceStart = lineStart;
replaceEnd = lineEnd;
replacement = "\n---\n";
} else if (action === "frontmatter") {
const hasFrontmatter = editor.value.trimStart().startsWith("---");
replacement = hasFrontmatter
? selected || "status: draft"
: `---\ntitle: ${selected || "Untitled"}\ntags: \n---\n\n`;
replaceStart = hasFrontmatter ? start : 0;
replaceEnd = hasFrontmatter ? end : 0;
}
editor.setRangeText(replacement, replaceStart, replaceEnd, "select");
editor.focus();
renderMarkdownReadView();
}
function bindMarkdownWorkbenchEvents() {
setMarkdownOutlineOpen(localStorage.getItem("schemaDocsMarkdownOutline") === "open");
$("toggleMarkdownOutline")?.addEventListener("click", () => setMarkdownOutlineOpen(document.body.dataset.markdownOutline !== "open"));
$("markdownReadView")?.addEventListener("click", (event) => {
  const selection = window.getSelection?.();
  if (selection && !selection.isCollapsed && $("markdownReadView")?.contains(selection.anchorNode)) return;
  if (event.target.closest("a, button, input, img")) return;
  const el = event.target.closest("td, th, p, h1, h2, h3, h4, li, blockquote, .markdown-math-block");
  if (!el) return;
  const start = Number(el.dataset.lineStart);
  if (isNaN(start)) return;
  if (el.matches("td, th")) {
   beginInlineTableCellEdit(el, event);
   return;
  }
  beginInlineReadEdit(el, event);
});
$("markdownReadMode")?.addEventListener("click", () => setMarkdownViewMode("read"));
$("markdownSplitMode")?.addEventListener("click", () => setMarkdownViewMode("split"));
$("markdownEditMode")?.addEventListener("click", () => setMarkdownViewMode("edit"));
$("reloadReadView")?.addEventListener("click", () => renderMarkdownReadView());
$("deleteNote")?.addEventListener("click", () => run(async () => {
const relPath = $("notePath")?.value.trim();
if (!relPath) return;
if (typeof window.confirmDiscardMarkdownChanges === "function" && !window.confirmDiscardMarkdownChanges("delete this note")) return;
const rawConfirmMsg = "Are you sure you want to permanently delete this note?";
const confirmMsg = (typeof window.translateText === "function")
? window.translateText(rawConfirmMsg)
: rawConfirmMsg;
if (!confirm(confirmMsg + ` (${relPath})`)) return;
try {
await api("/api/markdown/delete", { relativePath: relPath });
const successMsg = (typeof window.translateText === "function")
? window.translateText("Note file deleted successfully.")
: "Note file deleted successfully.";
showAlert("success", successMsg);
$("notePath").value = "";
const editor = $("noteContent");
if (editor) editor.value = "";
renderMarkdownReadView();
if (typeof onNoteClosed === "function") onNoteClosed();
$("searchNotes")?.click();
} catch (err) {
const errorMsg = (typeof window.translateText === "function")
? window.translateText("Failed to delete note. It might be locked or already deleted.")
: "Failed to delete note. It might be locked or already deleted.";
showAlert("error", errorMsg);
}
}));
$("closeNote")?.addEventListener("click", () => {
if (typeof window.confirmDiscardMarkdownChanges === "function" && !window.confirmDiscardMarkdownChanges("close this note")) return;
$("notePath").value = "";
const editor = $("noteContent");
if (editor) editor.value = "";
renderMarkdownReadView();
if (typeof onNoteClosed === "function") onNoteClosed();
});
$("btnChooseDocExportPath")?.addEventListener("click", () => run(async () => {
return chooseNativeSavePath("docExportPath", "Word Document", ["docx"]);
}));
$("btnChoosePdfExportPath")?.addEventListener("click", () => run(async () => {
return chooseNativeSavePath("pdfExportPath", "PDF Document", ["pdf"]);
}));
$("btnChooseHtmlExportPath")?.addEventListener("click", () => run(async () => {
return chooseNativeSavePath("htmlExportPath", "HTML Document", ["html"]);
}));
$("tabOutline")?.addEventListener("click", () => {
$("tabOutline").classList.add("active");
$("tabSearch")?.classList.remove("active");
$("sidebarOutlineSection")?.classList.remove("hidden");
$("sidebarSearchSection")?.classList.add("hidden");
});
$("tabSearch")?.addEventListener("click", () => {
$("tabSearch").classList.add("active");
$("tabOutline")?.classList.remove("active");
$("sidebarSearchSection")?.classList.remove("hidden");
$("sidebarOutlineSection")?.classList.add("hidden");
});
$("markdownDocSearch")?.addEventListener("input", () => {
activeSearchIndex = 0;
renderMarkdownReadView();
if (state.markdownViewMode === "edit") {
updateSearchCount();
}
});
$("markdownFindPrev")?.addEventListener("click", () => focusEditorSearchMatch(-1));
$("markdownFindNext")?.addEventListener("click", () => focusEditorSearchMatch(1));
if (!document.querySelector(".slash-menu")) {
slashMenuEl = document.createElement("div");
slashMenuEl.className = "slash-menu hidden";
slashMenuEl.innerHTML = `
    <button type="button" class="slash-item active" data-command="ai"><strong>/ai</strong> AI Send Gate</button>
    <button type="button" class="slash-item" data-command="mask"><strong>/mask</strong> PII Masking</button>
    <button type="button" class="slash-item" data-command="sql"><strong>/sql</strong> Local SQL Query</button>
   `;
document.body.appendChild(slashMenuEl);
slashMenuEl.querySelectorAll(".slash-item").forEach((btn, idx) => {
btn.addEventListener("click", () => triggerSlashCommand(btn.dataset.command));
btn.addEventListener("mouseenter", () => setSlashActiveIndex(idx));
});
} else {
slashMenuEl = document.querySelector(".slash-menu");
}
function setSlashActiveIndex(index) {
slashActiveIndex = index;
slashMenuEl.querySelectorAll(".slash-item").forEach((item, idx) => {
item.classList.toggle("active", idx === index);
});
}
function openSlashMenu() {
const editor = $("noteContent"); if (!editor) return;
isSlashOpen = true; setSlashActiveIndex(0);
const rect = editor.getBoundingClientRect();
slashMenuEl.style.left = `${window.scrollX + rect.left + 50}px`;
slashMenuEl.style.top = `${window.scrollY + rect.top + 60}px`;
slashMenuEl.classList.remove("hidden");
}
function closeSlashMenu() {
isSlashOpen = false; slashMenuEl?.classList.add("hidden");
}
function triggerSlashCommand(cmd) {
const editor = $("noteContent"); if (!editor) return;
closeSlashMenu();
const val = editor.value, pos = editor.selectionStart;
if (pos > 0 && val[pos - 1] === "/") {
editor.value = val.slice(0, pos - 1) + val.slice(pos);
editor.selectionStart = editor.selectionEnd = pos - 1;
}
editor.focus();
if (cmd === "ai") {
$("markdownPrepareForAi")?.click();
} else if (cmd === "mask") {
$("openMarkdownRedactionTool")?.click();
} else if (cmd === "sql") {
const targetTable = (state.workspaceManifest?.datasets && state.workspaceManifest.datasets[0])
? `${state.workspaceManifest.datasets[0].id}` : "employee_data";
const insertText = `\n\`\`\`sql\nSELECT * FROM ${targetTable} LIMIT 5;\n\`\`\`\n`;
const currentPos = editor.selectionStart;
editor.value = editor.value.slice(0, currentPos) + insertText + editor.value.slice(currentPos);
editor.selectionStart = editor.selectionEnd = currentPos + insertText.length;
if (!state.advancedToolsVisible) document.querySelector(".sql-query-panel")?.classList.remove("hidden");
$("listTables")?.click();
}
}
document.addEventListener("click", (event) => {
if (isSlashOpen && !slashMenuEl.contains(event.target) && event.target !== $("noteContent")) closeSlashMenu();
});
$("noteContent")?.addEventListener("input", () => {
if (state.markdownBaseline !== null && typeof window.markdownEditor?.getValue === "function") {
 state.markdownDirty = window.markdownEditor.getValue() !== state.markdownBaseline;
} else if (state.markdownBaseline !== null) {
 state.markdownDirty = $("noteContent").value !== state.markdownBaseline;
}
if (window.markdownEditor && !window.markdownEditor.isFallback) {
if (inputTimer) clearTimeout(inputTimer);
inputTimer = setTimeout(() => {
renderMarkdownOutline(); renderMarkdownStatus();
if (state.markdownViewMode !== "edit") scheduleMarkdownReadRender();
}, 250);
return;
}
const editor = $("noteContent"), pos = editor.selectionStart;
if (pos > 0 && editor.value[pos - 1] === "/") openSlashMenu();
else closeSlashMenu();
if (inputTimer) clearTimeout(inputTimer);
inputTimer = setTimeout(() => {
renderMarkdownOutline(); renderMarkdownStatus();
if (state.markdownViewMode !== "edit") scheduleMarkdownReadRender();
}, 250);
});
$("noteContent")?.addEventListener("keydown", (event) => {
if (isSlashOpen) {
if (event.key === "ArrowDown") {
event.preventDefault(); setSlashActiveIndex((slashActiveIndex + 1) % 3); return;
} else if (event.key === "ArrowUp") {
event.preventDefault(); setSlashActiveIndex((slashActiveIndex + 2) % 3); return;
} else if (event.key === "Enter") {
event.preventDefault();
const activeBtn = slashMenuEl.querySelectorAll(".slash-item")[slashActiveIndex];
if (activeBtn) triggerSlashCommand(activeBtn.dataset.command);
return;
} else if (event.key === "Escape") {
event.preventDefault(); closeSlashMenu(); return;
}
}
if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
event.preventDefault();
run(async () => {
const result = await saveCurrentNote();
renderMarkdownReadView(); refreshVersions();
return result;
});
} else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
event.preventDefault(); $("markdownDocSearch")?.focus();
} else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "e") {
event.preventDefault(); cycleMarkdownViewMode();
} else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
event.preventDefault(); insertMarkdownSyntax("bold");
} else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "i") {
event.preventDefault(); insertMarkdownSyntax("italic");
} else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
event.preventDefault(); insertMarkdownSyntax("link");
} else if (event.key === "Tab") {
if (window.markdownEditor && !window.markdownEditor.isFallback) {
return;
}
event.preventDefault(); indentSelectedLines(event.shiftKey);
}
});
$("noteContent")?.addEventListener("scroll", () => syncSplitScroll("editor"));
$("markdownReadView")?.addEventListener("scroll", () => syncSplitScroll("read"));
document.addEventListener("keydown", (event) => {
if (event.defaultPrevented) return;
if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "e") {
event.preventDefault(); cycleMarkdownViewMode();
}
});
document.querySelectorAll("[data-md-action]").forEach((button) => {
button.addEventListener("click", () => insertMarkdownSyntax(button.dataset.mdAction));
});
}
return {
bindMarkdownWorkbenchEvents,
renderMarkdownReadView,
setMarkdownViewMode,
_test: {
getMarkdownHeadings,
getMarkdownMetadata,
markdownToReadableHtml,
markdownForEditedBlock,
editableMarkdownForBlock,
splitMarkdownTableRow,
escapeMarkdownTableCell,
renderInlineMarkdown,
stripAiCitationArtifacts,
normalizeRelativeMarkdownPath,
isPptxSlideMarkdown
}
};
}
