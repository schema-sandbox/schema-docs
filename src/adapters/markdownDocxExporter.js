import { createZip } from "../core/zipWriter.js";
function escapeXml(value) {
return String(value)
.replace(/&/g, "&amp;")
.replace(/</g, "&lt;")
.replace(/>/g, "&gt;")
.replace(/"/g, "&quot;");
}
function parseInlineToRuns(text) {
  const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/);
  return parts.map((part) => {
    if (!part) return "";
    if (part.startsWith("**") && part.endsWith("**")) {
      const content = part.slice(2, -2);
      return `<w:r><w:rPr><w:b/><w:rFonts w:hint="eastAsia"/></w:rPr><w:t xml:space="preserve">${escapeXml(content)}</w:t></w:r>`;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      const content = part.slice(1, -1);
      return `<w:r><w:rPr><w:i/><w:rFonts w:hint="eastAsia"/></w:rPr><w:t xml:space="preserve">${escapeXml(content)}</w:t></w:r>`;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      const content = part.slice(1, -1);
      return `<w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:hint="eastAsia"/><w:color w:val="b91c1c"/></w:rPr><w:t xml:space="preserve">${escapeXml(content)}</w:t></w:r>`;
    }
    return `<w:r><w:rPr><w:rFonts w:hint="eastAsia"/></w:rPr><w:t xml:space="preserve">${escapeXml(part)}</w:t></w:r>`;
  }).join("");
}
function createStyleRuns(runsXml, fontSize = 22, color = "1f2937", isBold = false, isItalic = false) {
  const boldXml = isBold ? "<w:b/>" : "";
  const italicXml = isItalic ? "<w:i/>" : "";
  const colorXml = color ? `<w:color w:val="${color}"/>` : "";
  const fontXml = `<w:rPr><w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI" w:eastAsia="Microsoft YaHei"/>${boldXml}${italicXml}${colorXml}<w:sz w:val="${fontSize}"/></w:rPr>`;
  return runsXml.replace(/<w:r>/g, `<w:r>${fontXml}`);
}
function markdownLineToWordXml(line) {
  const trimmed = line.trim();
  if (line.startsWith("# ")) {
    const text = line.slice(2).trim();
    const runs = parseInlineToRuns(text);
    const styledRuns = createStyleRuns(runs, 40, "0f766e", false);
    return `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="0f766e"/></w:pBdr><w:spacing w:before="360" w:after="180"/></w:pPr>${styledRuns}</w:p>`;
  }
  if (line.startsWith("## ")) {
    const text = line.slice(3).trim();
    const runs = parseInlineToRuns(text);
    const styledRuns = createStyleRuns(runs, 32, "115e59", false);
    return `<w:p><w:pPr><w:pStyle w:val="Heading2"/><w:spacing w:before="280" w:after="140"/></w:pPr>${styledRuns}</w:p>`;
  }
  if (line.startsWith("### ")) {
    const text = line.slice(4).trim();
    const runs = parseInlineToRuns(text);
    const styledRuns = createStyleRuns(runs, 28, "1f2937", false);
    return `<w:p><w:pPr><w:pStyle w:val="Heading3"/><w:spacing w:before="200" w:after="100"/></w:pPr>${styledRuns}</w:p>`;
  }
  if (/^[-*]\s+/.test(line)) {
    const listText = line.replace(/^[-*]\s+/, "").trim();
    const runs = parseInlineToRuns(listText);
    const styledRuns = createStyleRuns(runs, 22, "1f2937", false);
    return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:ind w:left="420" w:hanging="240"/><w:spacing w:after="100"/></w:pPr>${styledRuns}</w:p>`;
  }
  if (!trimmed) return `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr></w:p>`;
  const runs = parseInlineToRuns(line);
  const styledRuns = createStyleRuns(runs, 22, "1f2937", false);
  return `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>${styledRuns}</w:p>`;
}
function tableCell(text) {
  const runs = parseInlineToRuns(text);
  const styledRuns = createStyleRuns(runs, 20, "1f2937", false);
  const cellParagraph = `<w:p><w:pPr><w:spacing w:after="60"/></w:pPr>${styledRuns}</w:p>`;
  return `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${cellParagraph}</w:tc>`;
}
function tableRow(cells) {
  return `<w:tr>${cells.map(tableCell).join("")}</w:tr>`;
}
function table(rows) {
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="cbd5e1"/><w:left w:val="single" w:sz="4" w:color="cbd5e1"/><w:bottom w:val="single" w:sz="4" w:color="cbd5e1"/><w:right w:val="single" w:sz="4" w:color="cbd5e1"/><w:insideH w:val="single" w:sz="4" w:color="e2e8f0"/><w:insideV w:val="single" w:sz="4" w:color="e2e8f0"/></w:tblBorders></w:tblPr>${rows.map(tableRow).join("")}</w:tbl>`;
}
function splitMarkdownTableRow(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  let escaped = false;
  for (const char of trimmed) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}
function isMarkdownTableSeparator(line) {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}
function mathParagraphToWordXml(formula) {
  let cleanFormula = String(formula || "")
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/\\text\{([^{}]+)\}/g, "$1")
    .replace(/\\cdot/g, " · ").replace(/\\approx/g, " ≈ ").replace(/\\pm/g, " ± ")
    .replace(/\\lambda/g, "λ").replace(/\\beta/g, "β").replace(/\\tau/g, "τ").replace(/\\int/g, "∫")
    .replace(/\\left/g, "").replace(/\\right/g, "").replace(/\\_/g, "_").replace(/\\infty/g, "∞")
    .replace(/\\partial/g, "∂").replace(/\\sum/g, "∑").replace(/\\delta/g, "δ").replace(/\\Delta/g, "Δ")
    .replace(/[\{\}]/g, "").trim();
  return `<w:p><w:pPr><w:jc w:val="center"/><w:ind w:left="720" w:right="720"/><w:spacing w:before="180" w:after="180"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math" w:cs="Cambria Math"/><w:i/><w:sz w:val="24"/><w:color w:val="0f766e"/></w:rPr><w:t xml:space="preserve">    ${escapeXml(cleanFormula)}</w:t></w:r></w:p>`;
}
export function markdownToDocxBuffer(markdown) {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let inMathBlock = false;
  let mathLines = [];
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("$$")) {
      if (inMathBlock) {
        inMathBlock = false;
        const formula = mathLines.join(" ").trim();
        if (formula) {
          blocks.push(mathParagraphToWordXml(formula));
        }
        mathLines = [];
      } else {
        const remaining = trimmed.slice(2);
        if (remaining.endsWith("$$") && remaining.length > 2) {
          const formula = remaining.slice(0, -2).trim();
          blocks.push(mathParagraphToWordXml(formula));
        } else {
          inMathBlock = true;
          if (remaining.trim()) {
            mathLines.push(remaining.trim());
          }
        }
      }
      continue;
    }
    if (inMathBlock) {
      mathLines.push(trimmed);
      continue;
    }
    if (rawLine.includes("|") && isMarkdownTableSeparator(lines[index + 1] ?? "")) {
      const rows = [splitMarkdownTableRow(rawLine)];
      index += 2;
      while (index < lines.length && (lines[index] ?? "").includes("|")) {
        rows.push(splitMarkdownTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      blocks.push(table(rows));
      continue;
    }
    if (trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length > 4) {
      const formula = trimmed.slice(2, -2).trim();
      blocks.push(mathParagraphToWordXml(formula));
      continue;
    }
    blocks.push(markdownLineToWordXml(rawLine));
  }
  const body = blocks.join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;
  return createZip([
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
    },
    {
      name: "word/document.xml",
      content: documentXml
    }
  ]);
}