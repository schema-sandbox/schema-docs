import { runInNewContext } from "node:vm";
import { readFile, writeFile, stat, realpath, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import os from "node:os";
import { deflateSync, inflateSync } from "node:zlib";
import { KATEX_WOFF2_FONT_FILES } from "./katexRuntimeAssets.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
let markdownitInstance = null;
let docxInstance = null;
let katexInstance = null;
let embeddedKatexCssInstance = null;
export function sanitizeXmlText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}
function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
export async function initExportLibraries() {
if (markdownitInstance && docxInstance && katexInstance) {
return { markdownit: markdownitInstance, docx: docxInstance, katex: katexInstance };
}
const [mdLib, docxLib, katexLib] = await Promise.all([
readFile(path.join(ROOT, "public/libs/markdown-it.min.js"), "utf8"),
readFile(path.join(ROOT, "public/libs/docx.js"), "utf8"),
readFile(path.join(ROOT, "public/libs/katex/katex.min.js"), "utf8")
]);
const mdSandbox = { window: {}, global: {}, exports: {}, module: { exports: {} }, process, Buffer, setTimeout, clearTimeout, setImmediate, clearImmediate };
mdSandbox.global = mdSandbox;
runInNewContext(mdLib, mdSandbox);
markdownitInstance = mdSandbox.window.markdownit || mdSandbox.markdownit || mdSandbox.module.exports;
const docxSandbox = { window: {}, global: {}, exports: {}, module: { exports: {} }, process, Buffer, setTimeout, clearTimeout, setImmediate, clearImmediate };
docxSandbox.global = docxSandbox;
runInNewContext(docxLib, docxSandbox);
docxInstance = docxSandbox.window.docx || docxSandbox.docx || docxSandbox.module.exports;
const katexSandbox = { window: {}, global: {}, exports: {}, module: { exports: {} }, process, Buffer, setTimeout, clearTimeout, setImmediate, clearImmediate };
katexSandbox.global = katexSandbox;
runInNewContext(katexLib, katexSandbox);
katexInstance = katexSandbox.window.katex || katexSandbox.katex || katexSandbox.module.exports;
if (typeof katexInstance?.renderToString !== "function") {
throw new Error("Bundled KaTeX runtime did not expose renderToString.");
}
return { markdownit: markdownitInstance, docx: docxInstance, katex: katexInstance };
}

async function embeddedKatexCss() {
if (embeddedKatexCssInstance !== null) return embeddedKatexCssInstance;
let css = await readFile(path.join(ROOT, "public/libs/katex/katex.min.css"), "utf8");
css = css.replace(/,url\(fonts\/[^)]+\.woff\) format\("woff"\),url\(fonts\/[^)]+\.ttf\) format\("truetype"\)/g, "");
const fontNames = [...new Set([...css.matchAll(/url\(fonts\/([^)]+\.woff2)\)/g)].map((match) => match[1]))].toSorted();
const expectedFontNames = [...KATEX_WOFF2_FONT_FILES].toSorted();
if (JSON.stringify(fontNames) !== JSON.stringify(expectedFontNames)) {
throw new Error(`Bundled KaTeX CSS/font registry mismatch: expected ${expectedFontNames.length} WOFF2 fonts, found ${fontNames.length}.`);
}
for (const fontName of fontNames) {
const source = `url(fonts/${fontName})`;
const data = await readFile(path.join(ROOT, "public/libs/katex/fonts", fontName));
const replacement = `url("data:font/woff2;base64,${data.toString("base64")}")`;
css = css.split(source).join(replacement);
}
embeddedKatexCssInstance = css;
return css;
}
function parseBalancedFrac(str) {
  let res = str;
  let index;
  while ((index = res.indexOf("\\frac")) !== -1) {
    const fracStart = index;
    let pos = fracStart + 5;
    while (pos < res.length && res[pos] !== "{") {
      pos++;
    }
    if (pos >= res.length) break;

    let numStart = pos + 1;
    let count = 1;
    pos++;
    while (pos < res.length && count > 0) {
      if (res[pos] === "{") count++;
      else if (res[pos] === "}") count--;
      pos++;
    }
    if (count > 0) break;
    let numEnd = pos - 1;
    let numerator = res.slice(numStart, numEnd);

    while (pos < res.length && res[pos] !== "{") {
      pos++;
    }
    if (pos >= res.length) break;

    let denStart = pos + 1;
    count = 1;
    pos++;
    while (pos < res.length && count > 0) {
      if (res[pos] === "{") count++;
      else if (res[pos] === "}") count--;
      pos++;
    }
    if (count > 0) break;
    let denEnd = pos - 1;
    let denominator = res.slice(denStart, denEnd);

    const before = res.slice(0, fracStart);
    const after = res.slice(pos);
    res = before + "(" + numerator + ")/(" + denominator + ")" + after;
  }
  return res;
}
function parseMathFormulas(t, force = false) {
  const raw = String(t || "").trim();
  const isComplex = /\\(begin|end|matrix|cases|sqrt|over|under|hat|tilde|bar|vec|dot|ddot|acute|grave|check|breve|dot|ddot|dddot|ddddot|widetilde|widehat)/.test(raw) ||
    /(\^|_)\{/.test(raw) ||
    (!/\\frac\{[^{}]+\}\{[^{}]+\}/.test(raw) && /\\frac/.test(raw));
  if (isComplex && !force) return raw;

  let cleaned = raw.replace(/^\$\$?/, "").replace(/\$\$?$/, "").trim();
  cleaned = cleaned.replace(/\\left/g, "").replace(/\\right/g, "");

  try {
    cleaned = parseBalancedFrac(cleaned);
  } catch (e) {
    let prev;
    do {
      prev = cleaned;
      cleaned = cleaned.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "($1)/($2)");
    } while (cleaned !== prev);
  }

  cleaned = cleaned.replace(/\\text\s*\{([^{}]+)\}/g, "$1");

  const symbolMap = {
    "\\\\cdot": " \u22c5 ",
    "\\\\approx": " \u2248 ",
    "\\\\pm": " \u00b1 ",
    "\\\\ge": " \u2265 ",
    "\\\\le": " \u2264 ",
    "\\\\ne": " \u2260 ",
    "\\\\times": " \u00d7 ",
    "\\\\div": " \u00f7 ",
    "\\\\infty": "\u221e",
    "\\\\partial": "\u2202",
    "\\\\nabla": "\u2207",
    "\\\\int": "\u222b",
    "\\\\sum": "\u2211",
    "\\\\prod": "\u220f",
    "\\\\coprod": "\u2210",
    "\\\\delta": "\u03b4",
    "\\\\Delta": "\u0394",
    "\\\\lambda": "\u03bb",
    "\\\\tau": "\u03c4",
    "\\\\beta": "\u03b2",
    "\\\\alpha": "\u03b1",
    "\\\\theta": "\u03b8",
    "\\\\pi": "\u03c0",
    "\\\\phi": "\u03c6",
    "\\\\omega": "\u03c9",
    "\\\\eta": "\u03b7",
    "\\\\gamma": "\u03b3",
    "\\\\Gamma": "\u0393",
    "\\\\sigma": "\u03c3",
    "\\\\Sigma": "\u03a3",
    "\\\\epsilon": "\u03b5",
    "\\\\ell": "\u2113",
    "\\\\min": "min",
    "\\\\max": "max",
    "\\\\sin": "sin",
    "\\\\cos": "cos",
    "\\\\tan": "tan",
    "\\\\log": "log",
    "\\\\ln": "ln",
    "\\\\lim": "lim"
  };

  for (const [key, val] of Object.entries(symbolMap)) {
    cleaned = cleaned.replace(new RegExp(key, "g"), val);
  }

  cleaned = cleaned.replace(/[\{\}]/g, "");
  cleaned = cleaned.replace(/\\([a-zA-Z]+)/g, "$1");
  cleaned = cleaned.replace(/\\/g, "");

  return cleaned.trim();
}
const latexCommandMap = new Map([
  ["alpha", "\u03b1"], ["beta", "\u03b2"], ["gamma", "\u03b3"], ["delta", "\u03b4"], ["epsilon", "\u03b5"],
  ["eta", "\u03b7"], ["theta", "\u03b8"], ["lambda", "\u03bb"], ["tau", "\u03c4"], ["mu", "\u03bc"], ["pi", "\u03c0"],
  ["sigma", "\u03c3"], ["phi", "\u03c6"], ["psi", "\u03c8"], ["rho", "\u03c1"], ["omega", "\u03c9"],
  ["Delta", "\u0394"], ["Gamma", "\u0393"], ["Theta", "\u0398"], ["Lambda", "\u039b"], ["Phi", "\u03a6"],
  ["Psi", "\u03a8"], ["Omega", "\u03a9"], ["Sigma", "\u03a3"], ["ell", "\u2113"], ["partial", "\u2202"], ["nabla", "\u2207"], ["infty", "\u221e"],
  ["cdot", "\u22c5"], ["times", "\u00d7"], ["div", "\u00f7"], ["pm", "\u00b1"], ["approx", "\u2248"],
  ["langle", "\u27e8"], ["rangle", "\u27e9"], ["otimes", "\u2297"], ["oplus", "\u2295"],
  ["sum", "\u2211"], ["prod", "\u220f"], ["hbar", "\u210f"], ["dagger", "\u2020"],
  ["rightarrow", "\u2192"], ["Rightarrow", "\u21d2"], ["Longrightarrow", "\u27f9"],
  ["ge", "\u2265"], ["le", "\u2264"], ["ne", "\u2260"], ["min", "min"], ["max", "max"],
  ["sin", "sin"], ["cos", "cos"], ["tan", "tan"], ["log", "log"], ["ln", "ln"], ["exp", "exp"]
]);
function readBracedGroup(source, start) {
  let pos = start;
  while (pos < source.length && /\s/.test(source[pos])) pos += 1;
  if (source[pos] !== "{") {
    if (source[pos] === "\\") {
      const match = /^\\([A-Za-z]+)/.exec(source.slice(pos));
      if (match) return { value: `\\${match[1]}`, end: pos + match[0].length };
    }
    return { value: source[pos] ?? "", end: Math.min(pos + 1, source.length) };
  }
  let depth = 1;
  let cursor = pos + 1;
  while (cursor < source.length && depth > 0) {
    if (source[cursor] === "{") depth += 1;
    else if (source[cursor] === "}") depth -= 1;
    cursor += 1;
  }
  return { value: source.slice(pos + 1, cursor - 1), end: cursor };
}
function latexToDocxMathChildren(docx, source) {
  const input = String(source ?? "").replace(/^\$\$?|\$\$?$/g, "").replace(/\\left|\\right/g, "");
  const nodes = [];
  let pos = 0;
  const run = (text) => new docx.MathRun(text);
  const group = (value) => latexToDocxMathChildren(docx, value);
  const mathProperty = (name, value) => {
    const component = new docx.XmlComponent(`m:${name}`);
    const attributes = new docx.XmlAttributeComponent({ value });
    attributes.xmlKeys = { value: "m:val" };
    component.root.push(attributes);
    return component;
  };
  const groupCharacter = (children, over = false) => {
    const properties = new docx.XmlComponent("m:groupChrPr");
    properties.root.push(mathProperty("chr", over ? "\u23de" : "\u23df"));
    properties.root.push(mathProperty("pos", over ? "top" : "bot"));
    properties.root.push(mathProperty("vertJc", over ? "top" : "bot"));
    const component = new docx.XmlComponent("m:groupChr");
    component.root.push(properties);
    component.root.push(new docx.MathBase(children));
    return component;
  };
  const readAtom = () => {
    if (input.startsWith("\\frac", pos)) {
      pos += 5;
      const numerator = readBracedGroup(input, pos);
      pos = numerator.end;
      const denominator = readBracedGroup(input, pos);
      pos = denominator.end;
      return new docx.MathFraction({ numerator: group(numerator.value), denominator: group(denominator.value) });
    }
    if (input.startsWith("\\text", pos)) {
      pos += 5;
      const textGroup = readBracedGroup(input, pos);
      pos = textGroup.end;
      return run(textGroup.value);
    }
    if (input.startsWith("\\operatorname", pos)) {
      pos += 13;
      const name = readBracedGroup(input, pos);
      pos = name.end;
      return run(name.value);
    }
    if (input.startsWith("\\hat", pos) || input.startsWith("\\bar", pos) || input.startsWith("\\vec", pos)) {
      const command = input.slice(pos).match(/^\\(hat|bar|vec)/)[1];
      pos += command.length + 1;
      const value = readBracedGroup(input, pos);
      pos = value.end;
      const plain = latexCommandMap.get(value.value.replace(/^\\/, "")) ?? value.value;
      const precomposedHat = new Map([["H", "\u0124"], ["h", "\u0125"]]);
      if (command === "hat" && precomposedHat.has(plain)) return run(precomposedHat.get(plain));
      const mark = command === "bar" ? "\u0305" : command === "vec" ? "\u20d7" : "\u0302";
      return run(`${plain}${mark}`);
    }
    if (input.startsWith("\\sqrt", pos)) {
      pos += 5;
      const value = readBracedGroup(input, pos);
      pos = value.end;
      return new docx.MathRadical({ children: group(value.value) });
    }
    if (input.startsWith("\\underbrace", pos) || input.startsWith("\\overbrace", pos)) {
      const over = input.startsWith("\\overbrace", pos);
      pos += over ? 10 : 11;
      const value = readBracedGroup(input, pos);
      pos = value.end;
      return groupCharacter(group(value.value), over);
    }
    if (input.startsWith("\\int", pos)) {
      pos += 4;
      let subScript;
      let superScript;
      while (input[pos] === "_" || input[pos] === "^") {
        const marker = input[pos];
        const scriptGroup = readBracedGroup(input, pos + 1);
        if (marker === "_") subScript = group(scriptGroup.value);
        else superScript = group(scriptGroup.value);
        pos = scriptGroup.end;
      }
      const children = group(input.slice(pos));
      pos = input.length;
      return new docx.MathIntegral({ children, subScript, superScript });
    }
    if (input.startsWith("\\sum", pos)) {
      pos += 4;
      let subScript;
      let superScript;
      while (input[pos] === "_" || input[pos] === "^") {
        const marker = input[pos];
        const scriptGroup = readBracedGroup(input, pos + 1);
        if (marker === "_") subScript = group(scriptGroup.value);
        else superScript = group(scriptGroup.value);
        pos = scriptGroup.end;
      }
      const children = group(input.slice(pos));
      pos = input.length;
      return new docx.MathSum({ children, subScript, superScript });
    }
    if (input[pos] === "\\") {
      const spacingCommand = input.slice(pos).match(/^\\(,|;|:|!|qquad|quad)/);
      if (spacingCommand) {
        pos += spacingCommand[0].length;
        return spacingCommand[1] === "!" ? undefined : run(" ");
      }
      const match = /^\\([A-Za-z]+)/.exec(input.slice(pos));
      if (match) {
        pos += match[0].length;
        return run(latexCommandMap.get(match[1]) ?? match[1]);
      }
      pos += 1;
      return run("\\");
    }
    if (input[pos] === "{") {
      const braced = readBracedGroup(input, pos);
      pos = braced.end;
      return group(braced.value);
    }
    let text = "";
    while (pos < input.length && !["\\", "{", "}", "_", "^"].includes(input[pos])) {
      text += input[pos];
      pos += 1;
    }
    return text ? run(text) : undefined;
  };
  while (pos < input.length) {
    if (input[pos] === "}") {
      pos += 1;
      continue;
    }
    const base = readAtom();
    let subScript;
    let superScript;
    while (input[pos] === "_" || input[pos] === "^") {
      const marker = input[pos];
      const scriptGroup = readBracedGroup(input, pos + 1);
      if (marker === "_") subScript = group(scriptGroup.value);
      else superScript = group(scriptGroup.value);
      pos = scriptGroup.end;
    }
    if (!base) continue;
    const baseChildren = Array.isArray(base) ? base : [base];
    if (subScript && superScript) nodes.push(new docx.MathSubSuperScript({ children: baseChildren, subScript, superScript }));
    else if (subScript) nodes.push(new docx.MathSubScript({ children: baseChildren, subScript }));
    else if (superScript) nodes.push(new docx.MathSuperScript({ children: baseChildren, superScript }));
    else if (Array.isArray(base)) nodes.push(...base);
    else nodes.push(base);
  }
  return nodes;
}
function createOfficeMathComponent(docx, formula) {
  const children = latexToDocxMathChildren(docx, formula);
  return new docx.Math({ children: children.length ? children : [new docx.MathRun(formula)] });
}
const markdownImagePattern = /!\[((?:\\.|[^\]\\])*)\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)/g;

function imageDimensions(buffer) {
  if (buffer.length >= 24 && buffer.subarray(1, 4).toString("ascii") === "PNG") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  return { width: 960, height: 640 };
}

function isPathInside(candidatePath, rootPath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function markdownImageMime(data) {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    return "image/jpeg";
  }
  return null;
}

export async function readSafeMarkdownImageAsset(source, baseDir, allowedRoot = baseDir) {
  if (!baseDir || !source) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(String(source).trim());
  } catch {
    return null;
  }
  if (!decoded || path.isAbsolute(decoded) || /^[/\\]{2}/.test(decoded) || /^[a-z][a-z0-9+.-]*:/i.test(decoded)) {
    return null;
  }
  try {
    const [baseReal, rootReal] = await Promise.all([realpath(baseDir), realpath(allowedRoot)]);
    if (!isPathInside(baseReal, rootReal)) return null;
    const candidateReal = await realpath(path.resolve(baseReal, decoded.replace(/\//g, path.sep)));
    if (!isPathInside(candidateReal, rootReal)) return null;
    const fileStat = await stat(candidateReal);
    if (!fileStat.isFile()) return null;
    const data = await readFile(candidateReal);
    const mime = markdownImageMime(data);
    if (!mime) return null;
    return { filePath: candidateReal, data, mime };
  } catch {
    return null;
  }
}

async function loadMarkdownImages(markdown, options = {}) {
  const images = new Map();
  for (const match of String(markdown || "").matchAll(markdownImagePattern)) {
    const source = match[2] || match[3] || "";
    if (images.has(source)) continue;
    const asset = await readSafeMarkdownImageAsset(source, options.baseDir, options.assetRoot || options.baseDir);
    if (!asset) continue;
    try {
      const { data, mime } = asset;
      const original = imageDimensions(data);
      const maxWidth = Number(options.maxImageWidth || 620);
      const maxHeight = Number(options.maxImageHeight || 760);
      const scale = Math.min(1, maxWidth / Math.max(1, original.width), maxHeight / Math.max(1, original.height));
      images.set(source, {
        data,
        width: Math.max(1, Math.round(original.width * scale)),
        height: Math.max(1, Math.round(original.height * scale)),
        mime
      });
    } catch {}
  }
  return images;
}

async function inlineMarkdownImages(markdown, options = {}) {
  const images = await loadMarkdownImages(markdown, options);
  return String(markdown).replace(markdownImagePattern, (full, alt, angleSource, plainSource) => {
    const source = angleSource || plainSource || "";
    const image = images.get(source);
    if (!image) {
      const label = String(alt || "image")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200)
        .replaceAll("`", "'");
      return `\`[Image omitted from export: ${label || "image"}]\``;
    }
    return `![${alt || ""}](data:${image.mime};base64,${image.data.toString("base64")})`;
  });
}

function pngImageForPdf(data) {
  if (data.length < 33 || data.subarray(1, 4).toString("ascii") !== "PNG") return null;
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  const bitDepth = data[24];
  const colorType = data[25];
  const interlace = data[28];
  if (bitDepth !== 8 || interlace !== 0 || ![0, 2, 4, 6].includes(colorType)) return null;
  const idat = [];
  let offset = 8;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString("ascii");
    const end = offset + 12 + length;
    if (end > data.length) return null;
    if (type === "IDAT") idat.push(data.subarray(offset + 8, offset + 8 + length));
    offset = end;
    if (type === "IEND") break;
  }
  if (!idat.length) return null;
  let colors = [2, 6].includes(colorType) ? 3 : 1;
  let stream = Buffer.concat(idat);
  if ([4, 6].includes(colorType)) {
    const sourceColors = colorType === 6 ? 4 : 2;
    const stride = width * sourceColors;
    let inflated;
    try { inflated = inflateSync(stream); } catch { return null; }
    if (inflated.length !== (stride + 1) * height) return null;
    const decoded = Buffer.alloc(stride * height);
    const paeth = (a, b, c) => {
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    };
    for (let row = 0; row < height; row++) {
      const filter = inflated[row * (stride + 1)];
      const sourceOffset = row * (stride + 1) + 1;
      const targetOffset = row * stride;
      for (let column = 0; column < stride; column++) {
        const raw = inflated[sourceOffset + column];
        const left = column >= sourceColors ? decoded[targetOffset + column - sourceColors] : 0;
        const up = row > 0 ? decoded[targetOffset + column - stride] : 0;
        const upperLeft = row > 0 && column >= sourceColors ? decoded[targetOffset + column - stride - sourceColors] : 0;
        const predictor = filter === 1 ? left
          : filter === 2 ? up
          : filter === 3 ? Math.floor((left + up) / 2)
          : filter === 4 ? paeth(left, up, upperLeft)
          : 0;
        decoded[targetOffset + column] = (raw + predictor) & 0xff;
      }
    }
    const rows = [];
    for (let row = 0; row < height; row++) {
      const output = Buffer.alloc(1 + width * colors);
      for (let column = 0; column < width; column++) {
        const sourceOffset = row * stride + column * sourceColors;
        const targetOffset = 1 + column * colors;
        const alpha = decoded[sourceOffset + sourceColors - 1];
        for (let channel = 0; channel < colors; channel++) {
          const value = decoded[sourceOffset + channel];
          output[targetOffset + channel] = Math.round((value * alpha + 255 * (255 - alpha)) / 255);
        }
      }
      rows.push(output);
    }
    stream = deflateSync(Buffer.concat(rows));
  }
  return {
    width,
    height,
    stream,
    dictionary: `/ColorSpace /${[2, 6].includes(colorType) ? "DeviceRGB" : "DeviceGray"} /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors ${colors} /BitsPerComponent 8 /Columns ${width} >>`
  };
}

function jpegImageForPdf(data) {
  if (data[0] !== 0xff || data[1] !== 0xd8) return null;
  const { width, height } = imageDimensions(data);
  if (!width || !height) return null;
  return { width, height, stream: data, dictionary: "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode" };
}

function packPdfObjects(objects) {
  const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary")];
  const offsets = [0];
  let length = chunks[0].length;
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = length;
    const header = Buffer.from(`${id} 0 obj\n`, "ascii");
    const footer = Buffer.from("\nendobj\n", "ascii");
    chunks.push(header, ...objects[id], footer);
    length += header.length + objects[id].reduce((sum, part) => sum + part.length, 0) + footer.length;
  }
  const xrefOffset = length;
  const xref = [
    `xref\n0 ${objects.length}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  ].join("");
  chunks.push(Buffer.from(xref, "ascii"));
  return Buffer.concat(chunks);
}

async function imageDeckMarkdownToPdf(markdown, options = {}) {
  const matches = [...String(markdown || "").matchAll(markdownImagePattern)];
  if (!matches.length || !options.baseDir) return null;
  const remaining = String(markdown || "").replace(markdownImagePattern, "").split(/\r?\n/)
    .map((line) => line.trim()).filter(Boolean);
  if (remaining.some((line) => !/^#{1,6}\s+\S/.test(line))) return null;
  const images = [];
  for (const match of matches) {
    const source = match[2] || match[3] || "";
    const asset = await readSafeMarkdownImageAsset(source, options.baseDir, options.assetRoot || options.baseDir);
    if (!asset) return null;
    const { data } = asset;
    const image = pngImageForPdf(data) || jpegImageForPdf(data);
    if (!image) return null;
    images.push(image);
  }
  const objects = new Array(3 + images.length * 3);
  const pageIds = images.map((_image, index) => 3 + index * 3);
  objects[1] = [Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii")];
  objects[2] = [Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`, "ascii")];
  images.forEach((image, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const pageWidth = 720;
    const pageHeight = Math.max(1, pageWidth * image.height / image.width);
    const imageName = `Im${index + 1}`;
    const content = Buffer.from(`q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/${imageName} Do\nQ`, "ascii");
    objects[pageId] = [Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /${imageName} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`, "ascii")];
    objects[contentId] = [Buffer.from(`<< /Length ${content.length} >>\nstream\n`, "ascii"), content, Buffer.from("\nendstream", "ascii")];
    objects[imageId] = [Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ${image.dictionary} /Length ${image.stream.length} >>\nstream\n`, "ascii"), image.stream, Buffer.from("\nendstream", "ascii")];
  });
  return packPdfObjects(objects);
}

export function compileTokensToDocxChildren(tokens, docx, mathTokens = [], imageTokens = new Map()) {
const children = [];
let index = 0;
const defaultFont = { ascii: "Segoe UI", eastAsia: "Microsoft YaHei", hAnsi: "Segoe UI" };
const paragraphSpacing = { line: 276, after: 120 };
const defaultTextSize = 22;
const listStack = [];
function parseInline(inlineToken, isHeading = false, headingLevel = 1, isBlockquote = false, textSize = null) {
const runs = [];
if (!inlineToken || !inlineToken.children) return runs;
const resolvedTextSize = textSize ?? (isHeading ? (headingLevel === 1 ? 36 : headingLevel === 2 ? 28 : 24) : defaultTextSize);
let isBold = false, isItalic = false;
for (const child of inlineToken.children) {
if (child.type === "strong_open") isBold = true;
else if (child.type === "strong_close") isBold = false;
else if (child.type === "em_open") isItalic = true;
else if (child.type === "em_close") isItalic = false;
else if (child.type === "code_inline") {
runs.push(new docx.TextRun({
text: child.content,
font: { ascii: "Consolas", eastAsia: "Microsoft YaHei" },
color: "b91c1c",
size: resolvedTextSize
}));
} else if (child.type === "text") {
let content = child.content;
if (content.includes("SCHEMA_DOCS_MATH_FORMULA_")) {
const parts = content.split(/(SCHEMA_DOCS_MATH_FORMULA_\d+)/g);
for (const part of parts) {
const match = part.match(/SCHEMA_DOCS_MATH_FORMULA_(\d+)/);
if (match) {
const idx = parseInt(match[1], 10);
const item = mathTokens[idx];
if (item) {
runs.push(createOfficeMathComponent(docx, item.formula));
}
} else if (part) {
const runOpts = {
text: part,
font: defaultFont,
size: resolvedTextSize,
color: isHeading ? (headingLevel === 1 ? "0f766e" : headingLevel === 2 ? "115e59" : "1f2937") : (isBlockquote ? "0f766e" : "1f2937")
};
if (isBold) runOpts.bold = true;
if (isItalic) runOpts.italics = true;
runs.push(new docx.TextRun(runOpts));
}
}
} else {
const runOpts = {
text: content,
font: defaultFont,
size: resolvedTextSize,
color: isHeading ? (headingLevel === 1 ? "0f766e" : headingLevel === 2 ? "115e59" : "1f2937") : (isBlockquote ? "0f766e" : "1f2937")
};
if (isBold) runOpts.bold = true;
if (isItalic) runOpts.italics = true;
runs.push(new docx.TextRun(runOpts));
}
} else if (child.type === "image") {
const source = typeof child.attrGet === "function" ? child.attrGet("src") : child.attrs?.find((entry) => entry[0] === "src")?.[1];
let decodedSource = source;
try {
decodedSource = decodeURIComponent(source || "");
} catch {}
const image = imageTokens.get(source) || imageTokens.get(decodedSource);
if (image) {
runs.push(new docx.ImageRun({
data: image.data,
transformation: { width: image.width, height: image.height }
}));
} else {
const alt = child.content || "[Image unavailable]";
runs.push(new docx.TextRun({ text: alt, font: defaultFont, color: "64748b", italics: true }));
}
} else if (child.type === "softbreak" || child.type === "hardbreak") {
runs.push(new docx.TextRun({ break: 1 }));
}
}
return runs;
}
while (index < tokens.length) {
const token = tokens[index];
if (token.type === "bullet_list_open") {
listStack.push({ type: "bullet" });
index++;
continue;
}
if (token.type === "bullet_list_close") {
listStack.pop();
index++;
continue;
}
if (token.type === "ordered_list_open") {
listStack.push({ type: "ordered", count: 1 });
index++;
continue;
}
if (token.type === "ordered_list_close") {
listStack.pop();
index++;
continue;
}
if (token.type === "list_item_open") {
if (listStack.length > 0) {
listStack[listStack.length - 1].itemHasPrefix = false;
}
index++;
continue;
}
if (token.type === "list_item_close") {
index++;
continue;
}
if (token.type === "heading_open") {
const headingLevel = Number(token.tag.replace("h", "")) || 1;
const inlineToken = tokens[index + 1];
const runs = parseInline(inlineToken, true, headingLevel);
let pBdr;
if (headingLevel === 1) {
pBdr = { bottom: { style: docx.BorderStyle.SINGLE, size: 6, space: 4, color: "0f766e" } };
} else if (headingLevel === 2) {
pBdr = { bottom: { style: docx.BorderStyle.SINGLE, size: 4, space: 4, color: "115e59" } };
}
children.push(new docx.Paragraph({
heading: headingLevel === 1 ? docx.HeadingLevel.HEADING_1 : headingLevel === 2 ? docx.HeadingLevel.HEADING_2 : docx.HeadingLevel.HEADING_3,
spacing: headingLevel === 1 ? { before: 360, after: 180 } : headingLevel === 2 ? { before: 280, after: 140 } : { before: 200, after: 100 },
border: pBdr,
children: runs
}));
index += 3;
continue;
}
if (token.type === "paragraph_open") {
let isListParagraph = false, isBlockquote = false;
let prefix = "";
if (listStack.length > 0) {
isListParagraph = true;
const currentList = listStack[listStack.length - 1];
if (!currentList.itemHasPrefix) {
if (currentList.type === "bullet") {
prefix = "\u2022   ";
} else {
prefix = `${currentList.count}.  `;
currentList.count++;
}
currentList.itemHasPrefix = true;
}
}
let searchIdx = index - 1;
let quoteOpenCount = 0;
while (searchIdx >= 0) {
if (tokens[searchIdx].type === "blockquote_open") quoteOpenCount++;
if (tokens[searchIdx].type === "blockquote_close") quoteOpenCount--;
searchIdx--;
}
isBlockquote = quoteOpenCount > 0;
const inlineToken = tokens[index + 1];
const runs = parseInline(inlineToken, false, 0, isBlockquote);
if (prefix) {
runs.unshift(new docx.TextRun({ text: prefix, font: defaultFont, color: "0f766e", bold: true }));
}
if (isListParagraph) {
children.push(new docx.Paragraph({
style: "ListParagraph",
spacing: { after: 100 },
ind: { left: 420, hanging: 240 },
children: runs
}));
} else if (isBlockquote) {
children.push(new docx.Paragraph({
spacing: { before: 120, after: 120 },
indent: { left: 720 },
shading: { fill: "f8fafc" },
border: { left: { style: docx.BorderStyle.SINGLE, size: 24, color: "0f766e", space: 12 } },
children: runs
}));
} else {
children.push(new docx.Paragraph({ spacing: paragraphSpacing, children: runs }));
}
index += 3;
continue;
}
if (["blockquote_open", "blockquote_close"].includes(token.type)) {
index++;
continue;
}
if (token.type === "fence") {
const codeLines = token.content.split("\n");
if (codeLines.length > 1 && codeLines[codeLines.length - 1] === "") {
codeLines.pop();
}
const runs = codeLines.map((line, idx) => new docx.TextRun({
text: line + (idx === codeLines.length - 1 ? "" : "\r"),
font: { ascii: "Consolas", eastAsia: "Microsoft YaHei" },
size: 18,
color: "475569"
}));
children.push(new docx.Table({
width: { size: 100, type: docx.WidthType.PERCENTAGE },
borders: {
top: { style: docx.BorderStyle.SINGLE, size: 4, color: "cbd5e1" },
bottom: { style: docx.BorderStyle.SINGLE, size: 4, color: "cbd5e1" },
left: { style: docx.BorderStyle.SINGLE, size: 4, color: "cbd5e1" },
right: { style: docx.BorderStyle.SINGLE, size: 4, color: "cbd5e1" },
insideH: { style: docx.BorderStyle.NONE }, insideV: { style: docx.BorderStyle.NONE }
},
rows: [new docx.TableRow({
children: [new docx.TableCell({
shading: { fill: "f8fafc" },
margins: { top: 144, bottom: 144, left: 144, right: 144 },
children: [new docx.Paragraph({ children: runs })]
})]
})]
}));
children.push(new docx.Paragraph({ spacing: { after: 120 } }));
index++;
continue;
}
if (token.type === "table_open") {
const tableRows = [];
index++;
let searchIdx = index;
let colCount = 0;
while (searchIdx < tokens.length && tokens[searchIdx].type !== "tr_close") {
if (tokens[searchIdx].type === "th_open" || tokens[searchIdx].type === "td_open") {
colCount++;
}
searchIdx++;
}
if (colCount === 0) colCount = 1;
const colPercent = Math.floor(100 / colCount);
const tableTextSize = colCount >= 14 ? 14 : colCount >= 10 ? 16 : 20;
const cellMargin = colCount >= 10 ? 40 : 100;
while (index < tokens.length && tokens[index].type !== "table_close") {
if (tokens[index].type === "tr_open") {
const cells = [];
index++;
while (index < tokens.length && tokens[index].type !== "tr_close") {
const cellToken = tokens[index];
if (cellToken.type === "th_open" || cellToken.type === "td_open") {
const runs = parseInline(tokens[index + 1], cellToken.type === "th_open", 3, false, tableTextSize);
cells.push(new docx.TableCell({
width: { size: colPercent, type: docx.WidthType.PERCENTAGE },
shading: cellToken.type === "th_open" ? { fill: "f1f5f9" } : undefined,
margins: { top: cellMargin, bottom: cellMargin, left: cellMargin, right: cellMargin },
children: [new docx.Paragraph({ spacing: { after: 60 }, children: runs })]
}));
index += 3;
} else {
index++;
}
}
tableRows.push(new docx.TableRow({ children: cells }));
}
index++;
}
children.push(new docx.Table({
width: { size: 100, type: docx.WidthType.PERCENTAGE },
borders: {
top: { style: docx.BorderStyle.SINGLE, size: 4, color: "cbd5e1" },
bottom: { style: docx.BorderStyle.SINGLE, size: 4, color: "cbd5e1" },
left: { style: docx.BorderStyle.SINGLE, size: 4, color: "cbd5e1" },
right: { style: docx.BorderStyle.SINGLE, size: 4, color: "cbd5e1" },
insideH: { style: docx.BorderStyle.SINGLE, size: 4, color: "e2e8f0" },
insideV: { style: docx.BorderStyle.SINGLE, size: 4, color: "e2e8f0" }
},
rows: tableRows
}));
children.push(new docx.Paragraph({ spacing: { after: 120 } }));
index++;
continue;
}
index++;
}
return children;
}
export async function exportMarkdownToDocx(markdown, options = {}) {
  const { markdownit, docx } = await initExportLibraries();
  const md = new markdownit({ html: true, linkify: true, typographer: true });
  const xmlSafeMarkdown = sanitizeXmlText(markdown);
  const imageTokens = await loadMarkdownImages(xmlSafeMarkdown, options);

  const mathTokens = [];
  const dollar = "$";
  const blockRegex = new RegExp("\\" + dollar + "\\" + dollar + "([\\s\\S]+?)\\" + dollar + "\\" + dollar, "g");
  const inlineRegex = new RegExp("\\" + dollar + "([^\\n]+?)\\" + dollar, "g");

  let processedMarkdown = xmlSafeMarkdown.replace(blockRegex, (_, formula) => {
    const cleanFormula = formula.trim();
    const token = `SCHEMA_DOCS_MATH_FORMULA_${mathTokens.length}`;
    mathTokens.push({ formula: cleanFormula, displayMode: true });
    return token;
  });
  processedMarkdown = processedMarkdown.replace(inlineRegex, (_, formula) => {
    const cleanFormula = formula.trim();
    const token = `SCHEMA_DOCS_MATH_FORMULA_${mathTokens.length}`;
    mathTokens.push({ formula: cleanFormula, displayMode: false });
    return token;
  });

  const tokens = md.parse(processedMarkdown, {});
  let widestTable = 0;
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].type !== "table_open") continue;
    let columns = 0;
    for (let cursor = index + 1; cursor < tokens.length && tokens[cursor].type !== "tr_close"; cursor++) {
      if (tokens[cursor].type === "th_open" || tokens[cursor].type === "td_open") columns++;
    }
    widestTable = Math.max(widestTable, columns);
  }
  const children = compileTokensToDocxChildren(tokens, docx, mathTokens, imageTokens);
  const doc = new docx.Document({
    sections: [{
      properties: { page: {
        size: widestTable >= 10 ? { orientation: docx.PageOrientation.LANDSCAPE } : undefined,
        margin: { top: 1440, bottom: 1440, left: widestTable >= 10 ? 720 : 1440, right: widestTable >= 10 ? 720 : 1440 }
      } },
      children: children
    }]
  });
  return docx.Packer.toBuffer(doc);
}

function escapeRegExpPattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collisionFreeTokenPrefix(source, base) {
  let prefix = base;
  while (String(source).includes(prefix)) prefix += "X";
  return prefix;
}

function findClosingBacktickRun(source, start, runLength) {
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

function findBalancedLinkDestinationEnd(source, start) {
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

function findMathDelimiter(source, start, delimiter, stopAtNewline, protectedRanges = []) {
  let rangeIndex = 0;
  for (let cursor = start; cursor < source.length; cursor++) {
    while (rangeIndex < protectedRanges.length && protectedRanges[rangeIndex].end <= cursor) rangeIndex += 1;
    if (rangeIndex < protectedRanges.length && protectedRanges[rangeIndex].start <= cursor) return -1;
    if (source[cursor] === "\\" && cursor + 1 < source.length) {
      cursor += 1;
      continue;
    }
    if (stopAtNewline && (source[cursor] === "\n" || source[cursor] === "\r")) return -1;
    if (source.startsWith(delimiter, cursor)) return cursor;
  }
  return -1;
}

function collectMarkdownLiteralRanges(source, markdownit) {
  const lineOffsets = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") lineOffsets.push(index + 1);
  }
  lineOffsets.push(source.length);
  const ranges = markdownit.parse(source, {})
    .filter((token) => (token.type === "fence" || token.type === "code_block") && Array.isArray(token.map))
    .map((token) => ({
      start: lineOffsets[token.map[0]] ?? source.length,
      end: lineOffsets[token.map[1]] ?? source.length
    }));
  for (const match of markdownit.linkify.match(source) || []) {
    if (Number.isInteger(match.index) && Number.isInteger(match.lastIndex)) {
      ranges.push({ start: match.index, end: match.lastIndex });
    }
  }
  for (const match of source.matchAll(markdownImagePattern)) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  ranges.sort((left, right) => left.start - right.start || left.end - right.end);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else if (range.end > range.start) merged.push({ ...range });
  }
  return merged;
}

function extractMarkdownMath(markdown, markdownit) {
  const source = String(markdown ?? "");
  const tokenPrefix = collisionFreeTokenPrefix(source, "SCHEMADOSMATHTOKEN");
  const protectedRanges = collectMarkdownLiteralRanges(source, markdownit);
  const mathTokens = [];
  let processedMarkdown = "";
  let cursor = 0;
  let atLineStart = true;
  let protectedRangeIndex = 0;

  const appendToken = (formula, displayMode) => {
    const index = mathTokens.length;
    mathTokens.push({ formula: String(formula || "").trim(), displayMode });
    return `${tokenPrefix}${index}XEND`;
  };

  while (cursor < source.length) {
    while (protectedRangeIndex < protectedRanges.length && protectedRanges[protectedRangeIndex].end <= cursor) {
      protectedRangeIndex += 1;
    }
    const protectedRange = protectedRanges[protectedRangeIndex];
    if (protectedRange?.start === cursor) {
      const literal = source.slice(protectedRange.start, protectedRange.end);
      processedMarkdown += literal;
      cursor = protectedRange.end;
      atLineStart = literal.endsWith("\n");
      protectedRangeIndex += 1;
      continue;
    }
    if (atLineStart) {
      const newline = source.indexOf("\n", cursor);
      const lineEnd = newline < 0 ? source.length : newline;
      const line = source.slice(cursor, lineEnd).replace(/\r$/, "");
      const fullLineEnd = newline < 0 ? source.length : newline + 1;
      if (/^ {0,3}\[[^\]\n]+\]:\s*(?:<[^>\n]+>|\S+)/.test(line)) {
        processedMarkdown += source.slice(cursor, fullLineEnd);
        cursor = fullLineEnd;
        atLineStart = newline >= 0;
        continue;
      }
    }

    if (source[cursor] === "`") {
      let runLength = 1;
      while (source[cursor + runLength] === "`") runLength += 1;
      const closing = findClosingBacktickRun(source, cursor + runLength, runLength);
      if (closing >= 0) {
        const end = closing + runLength;
        const codeSpan = source.slice(cursor, end);
        processedMarkdown += codeSpan;
        cursor = end;
        atLineStart = codeSpan.endsWith("\n");
        continue;
      }
    }

    if (source.startsWith("](", cursor)) {
      const destinationEnd = findBalancedLinkDestinationEnd(source, cursor + 2);
      if (destinationEnd >= 0) {
        processedMarkdown += source.slice(cursor, destinationEnd + 1);
        cursor = destinationEnd + 1;
        atLineStart = false;
        continue;
      }
    }

    if (source[cursor] === "<") {
      const autolink = /^<(?:https?:\/\/|mailto:)[^>\n]*>/i.exec(source.slice(cursor));
      if (autolink) {
        processedMarkdown += autolink[0];
        cursor += autolink[0].length;
        atLineStart = false;
        continue;
      }
    }

    if (source[cursor] === "\\" && cursor + 1 < source.length) {
      processedMarkdown += source.slice(cursor, cursor + 2);
      atLineStart = source[cursor + 1] === "\n";
      cursor += 2;
      continue;
    }

    if (source[cursor] === "$") {
      const displayMode = source[cursor + 1] === "$";
      const delimiter = displayMode ? "$$" : "$";
      const formulaStart = cursor + delimiter.length;
      const closing = findMathDelimiter(source, formulaStart, delimiter, !displayMode, protectedRanges);
      if (closing >= formulaStart && source.slice(formulaStart, closing).trim()) {
        processedMarkdown += appendToken(source.slice(formulaStart, closing), displayMode);
        cursor = closing + delimiter.length;
        atLineStart = false;
        continue;
      }
    }

    const character = source[cursor];
    processedMarkdown += character;
    atLineStart = character === "\n";
    cursor += 1;
  }

  return {
    mathTokens,
    processedMarkdown,
    tokenPattern: new RegExp(`${escapeRegExpPattern(tokenPrefix)}(\\d+)XEND`, "g")
  };
}

export async function exportMarkdownToHtml(markdown, options = {}) {
  const { markdownit, katex } = await initExportLibraries();
  const md = new markdownit({ html: false, linkify: true, typographer: true });

  const markdownWithImages = await inlineMarkdownImages(markdown, options);
  const { mathTokens, processedMarkdown, tokenPattern } = extractMarkdownMath(markdownWithImages, md);

  let renderedBody = md.render(processedMarkdown);

  const escapeHtml = (unsafe) => {
    return String(unsafe ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  const restoreMathToken = (_token, rawIndex, plainText = false) => {
    const item = mathTokens[Number(rawIndex)];
    if (!item) return "";
    if (plainText) {
      return escapeHtml(item.displayMode ? `$$${item.formula}$$` : `$${item.formula}$`);
    }
    const className = item.displayMode ? "katex-display-math" : "katex-inline-math";
    let mathHtml;
    try {
      mathHtml = katex.renderToString(item.formula, {
        displayMode: item.displayMode,
        output: "htmlAndMathml",
        throwOnError: false,
        strict: "ignore",
        trust: false
      });
    } catch {
      mathHtml = `<span class="katex-error">${escapeHtml(item.formula)}</span>`;
    }
    return `<span class="${className}" data-math="${escapeHtml(item.formula)}">${mathHtml}</span>`;
  };
  renderedBody = renderedBody.split(/(<[^>]*>)/g).map((segment, index) => {
    tokenPattern.lastIndex = 0;
    return segment.replace(tokenPattern, (token, rawIndex) => restoreMathToken(token, rawIndex, index % 2 === 1));
  }).join("");

  const title = escapeHtml(String(options.title || "Exported Document"));
  const katexCss = await embeddedKatexCss();
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; font-src data:; base-uri 'none'; form-action 'none'"><title>${title}</title>
<style>
${katexCss}
body{font-family:"Segoe UI","Microsoft YaHei",sans-serif;line-height:1.6;color:#1f2937;max-width:800px;margin:40px auto;padding:0 20px}
h1,h2,h3{color:#0f766e;font-weight:600}
h1{font-size:2em;border-bottom:2px solid #0f766e;padding-bottom:8px;margin-top:1.5em}
h2{font-size:1.5em;color:#115e59;margin-top:1.3em}
h3{font-size:1.25em;color:#374151}
p{margin-bottom:1em}
blockquote{margin:1.5em 0;padding-left:1em;border-left:4px solid #0f766e;color:#0f766e;font-style:italic}
pre{background-color:#f8fafc;border:1px solid #cbd5e1;padding:12px;border-radius:4px;overflow-x:auto;font-family:monospace;font-size:0.9em}
code{font-family:monospace;color:#b91c1c;font-size:0.95em}
table{width:100%;border-collapse:collapse;margin:1.5em 0;table-layout:auto}
img{display:block;max-width:100%;width:auto;height:auto;object-fit:contain;margin:1em auto}
td img,th img{max-width:100%;margin:.25em auto}
th,td{border:1px solid #cbd5e1;padding:8px 12px;text-align:left;overflow-wrap:anywhere}
th{background-color:#f1f5f9;color:#0f766e;font-weight:600}
tr:nth-child(even){background-color:#f8fafc}
.katex-display-math{text-align:center;margin:1.5em 0;font-family:"Cambria Math",serif;font-style:italic;color:#0f766e;font-size:1.1em}
.katex-inline-math{font-family:"Cambria Math",serif;font-style:italic;color:#0f766e}
@page{size:A4;margin:16mm 14mm}
@media print{body{margin:0;padding:0;max-width:100%}img{max-width:100%;max-height:240mm;page-break-inside:avoid}pre,blockquote,table,.katex-display-math{page-break-inside:avoid}table{font-size:8pt}th,td{padding:3px 4px}}
</style>
</head>
<body>
${renderedBody}
</body>
</html>`;
}

function delay(milliseconds) {
return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isCompletePdfBuffer(buffer) {
if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") return false;
const tail = buffer.subarray(Math.max(0, buffer.length - 4096)).toString("latin1");
return tail.lastIndexOf("%%EOF") !== -1;
}

export async function waitForStablePdfFile(filePath, options = {}) {
const timeoutMs = Math.max(100, Number(options.timeoutMs || 120000));
const intervalMs = Math.max(10, Number(options.intervalMs || 150));
const stableSamples = Math.max(2, Number(options.stableSamples || 3));
const deadline = Date.now() + timeoutMs;
let previousSize = -1;
let stableCount = 0;
while (Date.now() <= deadline) {
try {
const info = await stat(filePath);
if (info.isFile() && info.size >= 12) {
if (info.size === previousSize) stableCount += 1;
else {
previousSize = info.size;
stableCount = 1;
}
if (stableCount >= stableSamples) {
const buffer = await readFile(filePath);
if (buffer.length === info.size && isCompletePdfBuffer(buffer)) return buffer;
previousSize = -1;
stableCount = 0;
}
}
} catch {
previousSize = -1;
stableCount = 0;
}
await delay(intervalMs);
}
throw new Error(`Browser PDF output did not become complete and stable within ${timeoutMs} ms.`);
}

async function findChromiumPath() {
const isWin = process.platform === "win32";
const paths = isWin ? [
path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
path.join(process.env["ProgramFiles"] || "C:\\Program Files", "Microsoft\\Edge\\Application\\msedge.exe"),
path.join(process.env["ProgramFiles"] || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
path.join(process.env["LOCALAPPDATA"] || "C:\\Users\\Default\\AppData\\Local", "Google\\Chrome\\Application\\chrome.exe")
] : process.platform === "darwin" ? [
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
] : [
"/usr/bin/google-chrome",
"/usr/bin/microsoft-edge",
"/usr/bin/chromium-browser",
"/usr/bin/chromium"
];
for (const p of paths) {
try { if ((await stat(p)).isFile()) return p; } catch {}
}
for (const name of (isWin ? ["msedge.exe", "chrome.exe"] : ["google-chrome", "microsoft-edge", "chromium"])) {
try {
const loc = await new Promise((res, rej) => {
execFile(isWin ? "where" : "which", [name], (err, stdout) => {
if (err) rej(err); else res(stdout.trim().split("\r\n")[0].split("\n")[0].trim());
});
});
if (loc) return loc;
} catch {}
}
return null;
}
export async function exportMarkdownToPdf(markdown, options = {}) {
const imageDeckPdf = await imageDeckMarkdownToPdf(markdown, options);
if (imageDeckPdf) return imageDeckPdf;
if (process.env.NODE_TEST_CONTEXT) {
const { markdownToPdfBuffer } = await import("../adapters/pdfMarkdownConverter.js");
return markdownToPdfBuffer(markdown);
}
let tempDir = "";
try {
const browser = await findChromiumPath();
if (!browser) throw new Error("No supported Microsoft Edge, Google Chrome, or Chromium executable was found.");
const html = await exportMarkdownToHtml(markdown, options);
tempDir = await mkdtemp(path.join(os.tmpdir(), "schema-docs-pdf-"));
const tmpHtml = path.join(tempDir, "document.html");
const tmpPdf = path.join(tempDir, "document.pdf");
const browserProfile = path.join(tempDir, "browser-profile");
await writeFile(tmpHtml, html, "utf8");
const browserResult = await new Promise((resolve) => {
execFile(browser, [
"--headless",
"--disable-gpu",
"--disable-extensions",
"--disable-background-networking",
"--disable-background-mode",
"--no-first-run",
"--no-default-browser-check",
`--user-data-dir=${browserProfile}`,
"--no-pdf-header-footer",
"--print-to-pdf-no-header",
`--print-to-pdf=${tmpPdf}`,
pathToFileURL(tmpHtml).href
], {
windowsHide: true,
timeout: Math.max(10000, Number(options.browserTimeoutMs || 180000)),
maxBuffer: 16 * 1024 * 1024
}, (error, stdout, stderr) => {
resolve({ error, stdout: String(stdout || ""), stderr: String(stderr || "") });
});
});
let pdfBuf;
try {
pdfBuf = await waitForStablePdfFile(tmpPdf, {
timeoutMs: options.pdfOutputTimeoutMs,
intervalMs: options.pdfOutputPollIntervalMs,
stableSamples: options.pdfOutputStableSamples
});
} catch (outputError) {
if (browserResult.error) {
const details = [browserResult.error.message, browserResult.stderr, browserResult.stdout]
.filter(Boolean)
.join("\n")
.slice(0, 8000);
throw new Error(`${outputError.message}\nBrowser process: ${details}`);
}
throw outputError;
}
const base64Md = Buffer.from(markdown).toString("base64");
const payload = Buffer.from(`\n% SCHEMA_DOCS_PAYLOAD:${base64Md}\n`);
return Buffer.concat([pdfBuf, payload]);
} catch (err) {
const prefix = /!\[[^\]]*\]\((?:<[^>]+>|[^\s)]+)\)/.test(String(markdown || ""))
? "Styled PDF export could not preserve local images"
: "Styled PDF export failed";
throw new Error(`${prefix}: ${err.message}`, { cause: err });
} finally {
if (tempDir) {
await rm(tempDir, {
recursive: true,
force: true,
maxRetries: 20,
retryDelay: 250
}).catch(async () => {
await delay(500);
await rm(tempDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {});
});
}
}
}
