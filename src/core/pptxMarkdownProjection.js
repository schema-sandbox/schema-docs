const slideHeadingPattern = /^##\s+Slide\s+(\d+)(?:\s*[:\uFF1A].*)?\s*$/i;
const markdownImagePattern = /^!\[([^\]]*)\]\((?:<([^>\n]+)>|([^\s)\n]+))(?:\s+["'][^"']*["'])?\)\s*$/i;

function isPptxSlidePreview(line, slideNumber) {
  const match = String(line || "").trim().match(markdownImagePattern);
  if (!match) return false;
  const alt = String(match[1] || "");
  const source = String(match[2] || match[3] || "");
  const escapedNumber = String(slideNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const altMatches = new RegExp(`^Slide\\s+${escapedNumber}\\s+(?:preview|image)$`, "i").test(alt);
  const sourceMatches = new RegExp(`\\.pptx[\\\\/]slide-${escapedNumber}(?:-(?:preview|image))?\\.(?:png|jpe?g|webp)$`, "i").test(source);
  return altMatches || sourceMatches;
}

function documentTitleFromPrefix(lines) {
  return lines.find((line) => /^#\s+\S/.test(line.trim()) && !/^##\s/.test(line.trim()))?.trim() || "";
}

export function isPptxSlideMarkdown(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index++) {
    const heading = lines[index].trim().match(slideHeadingPattern);
    if (!heading) continue;
    for (let cursor = index + 1; cursor < lines.length && !slideHeadingPattern.test(lines[cursor].trim()); cursor++) {
      if (isPptxSlidePreview(lines[cursor], heading[1])) return true;
    }
  }
  return false;
}

export function projectPptxSlidesForExport(markdown) {
  const source = String(markdown || "").replace(/\r\n?/g, "\n");
  const lines = source.split("\n");
  const slideStarts = [];
  for (let index = 0; index < lines.length; index++) {
    const heading = lines[index].trim().match(slideHeadingPattern);
    if (heading) slideStarts.push({ index, slideNumber: heading[1] });
  }
  if (!slideStarts.length || !isPptxSlideMarkdown(source)) return source;

  const output = [];
  const title = documentTitleFromPrefix(lines.slice(0, slideStarts[0].index));
  if (title) output.push(title, "");

  slideStarts.forEach((slide, slideIndex) => {
    const end = slideStarts[slideIndex + 1]?.index ?? lines.length;
    const block = lines.slice(slide.index, end);
    const preview = block.find((line) => isPptxSlidePreview(line, slide.slideNumber));
    if (preview) {
      output.push(block[0].trim(), "", preview.trim(), "");
      return;
    }
    while (block.length && !block[block.length - 1].trim()) block.pop();
    output.push(...block, "");
  });

  return `${output.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}
