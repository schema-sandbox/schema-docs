import assert from "node:assert/strict";
import test from "node:test";
import { buildAiIntakePlan } from "../src/core/aiContext.js";
import { buildStructuredChunks, parseStructuredMarkdown, summarizeStructuredRange } from "../src/core/structuredChunker.js";

test("structured Markdown parser keeps protected blocks and heading paths", () => {
  const markdown = [
    "# Report",
    "",
    "Introductory paragraph.",
    "",
    "## Results",
    "",
    "| Name | Value |",
    "| --- | --- |",
    "| A | 1 |",
    "",
    "$$",
    "E=mc^2",
    "$$",
    "",
    "```js",
    "const value = 1;",
    "```"
  ].join("\n");
  const blocks = parseStructuredMarkdown(markdown);
  assert.deepEqual(blocks.map((block) => block.type), ["heading", "paragraph", "heading", "table", "formula", "code"]);
  assert.deepEqual(blocks[3].headingPath, ["Report", "Results"]);
  assert.equal(blocks[3].protected, true);
  assert.equal(blocks[5].protected, true);
});

test("structured chunks keep normal protected blocks intact", () => {
  const markdown = [
    "# Report",
    "",
    "| Name | Value |",
    "| --- | --- |",
    "| A | 1 |",
    "",
    "```js",
    "const value = 1;",
    "```",
    "",
    "Closing paragraph. ".repeat(20)
  ].join("\n");
  const plan = buildStructuredChunks(markdown, { maxCharacters: 200 });
  assert.ok(plan.chunks.length >= 2);
  const protectedChunks = plan.chunks.filter((chunk) => chunk.blockTypes.some((type) => ["table", "code"].includes(type)));
  assert.ok(protectedChunks.length >= 1);
  assert.ok(protectedChunks.every((chunk) => chunk.split === false));
});

test("AI chunk descriptors expose structure without changing chunk geometry", () => {
  const markdown = [
    "# Report",
    "",
    "## Results",
    "",
    "| Name | Value |",
    "| --- | --- |",
    "| A | 1 |",
    "",
    "x".repeat(14000)
  ].join("\n");
  const intake = buildAiIntakePlan(markdown);
  assert.ok(intake.chunkCount > 1);
  assert.ok(intake.chunks.some((chunk) => chunk.blockTypes.includes("table")));
  assert.ok(intake.chunks.some((chunk) => chunk.headingPath.includes("Results")));
  assert.ok(intake.chunks.every((chunk) => Array.isArray(chunk.sourceRanges)));
  const structure = summarizeStructuredRange(parseStructuredMarkdown(markdown), 0, 100);
  assert.ok(structure.blockTypes.includes("heading"));
});
