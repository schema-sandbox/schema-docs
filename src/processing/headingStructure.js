function headingLevel(block) {
  const explicit = Number(block?.qualitySignals?.headingLevel);
  if (Number.isInteger(explicit) && explicit >= 1 && explicit <= 6) return explicit;
  if (block?.type === "title") return 1;
  if (block?.type === "heading") return 2;
  return null;
}

/** Attach stable heading ancestry without changing block text or order. */
export function annotateHeadingHierarchy(documentIr) {
  const blocks = Array.isArray(documentIr?.blocks) ? documentIr.blocks : [];
  const stack = [];
  const paths = [];
  for (const block of blocks) {
    const level = headingLevel(block);
    if (level !== null) {
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      block.parentId = stack.length ? stack[stack.length - 1].id : "";
      stack.push({ level, id: block.id, text: block.text });
      paths.push({ block, path: stack.map(item => item.text).filter(Boolean) });
    } else {
      const headingPath = stack.map(item => item.text).filter(Boolean);
      if (headingPath.length) paths.push({ block, path: headingPath });
    }
  }
  for (const { block, path } of paths) {
    block.qualitySignals = {
      ...(block.qualitySignals || {}),
      ...(headingLevel(block) !== null ? { headingLevel: headingLevel(block) } : {}),
      headingPath: path
    };
  }
  return { headingCount: blocks.filter(block => headingLevel(block) !== null).length };
}

