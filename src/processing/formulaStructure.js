const COMMAND_PATTERN = /\\(?:frac|sqrt|sum|int|prod|lim|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|omega|begin|end)\b/;
const MATH_SYMBOL_PATTERN = /[=<>±×÷∑∫√∞≤≥]|(?:\^|_)/;

function stripMathDelimiters(text) {
  return String(text || "")
    .trim()
    .replace(/^\$\$([\s\S]*)\$\$$/, "$1")
    .replace(/^\\\[([\s\S]*)\\\]$/, "$1")
    .replace(/^\\\(([\s\S]*)\\\)$/, "$1")
    .replace(/^\$([^$]+)\$$/, "$1")
    .trim();
}

export function classifyFormulaText(text) {
  const raw = String(text || "").trim();
  const normalized = stripMathDelimiters(raw);
  const isBlock = /^\$\$|^\\\[/.test(raw) || raw.includes("\n");
  const hasMathEvidence = Boolean(normalized) && (COMMAND_PATTERN.test(normalized) || MATH_SYMBOL_PATTERN.test(normalized));
  if (!normalized) {
    return { status: "unresolved", kind: "unknown", mode: isBlock ? "block" : "inline", normalized: "", confidence: "none" };
  }
  if (hasMathEvidence) {
    return {
      status: "editable_candidate",
      kind: COMMAND_PATTERN.test(normalized) ? "latex_candidate" : "math_candidate",
      mode: isBlock ? "block" : "inline",
      normalized,
      confidence: COMMAND_PATTERN.test(normalized) ? "medium" : "low"
    };
  }
  return { status: "unresolved", kind: "text_candidate", mode: isBlock ? "block" : "inline", normalized, confidence: "low" };
}

export function annotateFormulaBlocks(blocks) {
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (block?.type !== "formula") continue;
    const existingStatus = String(block.status || "");
    const classified = classifyFormulaText(block.text);
    const status = existingStatus === "visual_preserved"
      ? "visual_preserved"
      : classified.status;
    block.formulaStructure = {
      ...classified,
      status,
      sourceStatus: existingStatus || "extracted"
    };
    block.qualitySignals = {
      ...(block.qualitySignals || {}),
      formulaStructure: {
        status,
        confidence: classified.confidence,
        mode: classified.mode
      }
    };
  }
  return blocks;
}

