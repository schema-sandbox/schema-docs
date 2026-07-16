import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const SCENARIO_MAPPINGS = {
  "RS-001": {
    scenarioName: "Academic PDF multi-column reading order",
    problem: "AI can read across columns in multi-column academic PDFs, mixing paragraphs and breaking formula context.",
    handlingStrategy: "Schema Docs simplifies the layout into a single Markdown flow, marks the extraction as medium confidence, and asks the user to review reading order before sending.",
    userAction: "Inspect affected paragraphs or tables in the Markdown working copy before sending the content through Send Gate."
  },
  "RS-002": {
    scenarioName: "Financial report table extraction",
    problem: "Nested or page-spanning Word tables can lose boundaries when reduced to plain text, making AI analysis unreliable.",
    handlingStrategy: "The DOCX XML parser converts table cells into GitHub Flavored Markdown tables and keeps headings aligned where possible.",
    userAction: "Use the extracted Markdown table as AI context or create an exchange package after a quick visual review."
  },
  "RS-003": {
    scenarioName: "Digital legal agreement parsing",
    problem: "Legal PDFs often contain dense clauses where missing a disclaimer, amount, or date can create business risk.",
    handlingStrategy: "Text-layer PDFs are extracted into Markdown with evidence hashes so reviewers can trace the source before AI analysis.",
    userAction: "Run AI review rules only after confirming the AI Will See preview matches the source scope."
  },
  "RS-004": {
    scenarioName: "Scanned survey or receipt upload",
    problem: "Image-only scanned PDFs can produce empty or unreadable text, causing AI to hallucinate from bad input.",
    handlingStrategy: "Send Gate blocks low-confidence scanned input and reports that OCR is required before AI exchange.",
    userAction: "Run OCR externally or provide a digital source file, then import the refreshed result."
  },
  "RS-005": {
    scenarioName: "CJK employee list encoding compatibility",
    problem: "CSV files with mixed encodings can turn names into mojibake, causing entity extraction mistakes.",
    handlingStrategy: "The importer validates CJK text handling and type inference, then reports high confidence when names remain readable.",
    userAction: "Check the preview for unreadable characters before sending the table to AI."
  },
  "RS-006": {
    scenarioName: "Multi-sheet inventory data selection",
    problem: "Sending an entire workbook wastes tokens and can distract AI with irrelevant sheets.",
    handlingStrategy: "Schema Docs extracts a bounded sheet preview and records structured metadata so users can filter before AI context assembly.",
    userAction: "Filter to the relevant inventory rows or sheet before loading table context into Send Gate."
  },
  "RS-007": {
    scenarioName: "Formula-heavy spreadsheet risk",
    problem: "AI is not a spreadsheet calculation engine, and stale formula caches can lead to wrong financial answers.",
    handlingStrategy: "Schema Docs extracts cached values only, warns that formulas are not executed, and blocks low-confidence direct sends.",
    userAction: "Recalculate and save the spreadsheet in Excel or WPS before refreshing the import."
  },
  "RS-008": {
    scenarioName: "Ultra-large CSV token overflow",
    problem: "Sending hundreds of thousands of log rows directly to AI can exceed model context limits.",
    handlingStrategy: "The system uses bounded previews, row-count metadata, and local query/filtering before any AI context is staged.",
    userAction: "Use local query or export a narrowed table context instead of sending raw logs."
  },
  "RS-009": {
    scenarioName: "Round-trip working copy consistency",
    problem: "Users may edit both the original Word file and the Markdown working copy, creating version ambiguity.",
    handlingStrategy: "Schema Docs compares source hashes and Markdown edit state, writes refreshed extraction separately when needed, and keeps version history.",
    userAction: "Use Refresh Source, inspect the risk preview, and choose whether to keep local Markdown edits or accept the refreshed extraction."
  },
  "RS-010": {
    scenarioName: "CIDFont PDF mojibake detection",
    problem: "Some PDFs render correctly in a reader but expose broken CID font mappings during text extraction.",
    handlingStrategy: "Schema Docs detects unreadable replacement characters, lowers confidence, and blocks unsafe Send Gate handoff.",
    userAction: "Convert the PDF through Word/WPS or another trusted tool, then re-import a cleaner DOCX or text-layer PDF."
  },
  "RS-011": {
    scenarioName: "Scanned medical receipt extraction",
    problem: "Scanned receipts or medical printouts are low-contrast and have no text layer, so text extraction cannot produce trusted AI context.",
    handlingStrategy: "The system detects the lack of a text layer, lowers confidence, warns that OCR is missing, and blocks direct AI intake.",
    userAction: "Provide a high-fidelity digital text version or run OCR conversion externally before staging."
  },
  "RS-012": {
    scenarioName: "Merged cells in invoice spreadsheet",
    problem: "Spreadsheets with merged header or data cells can break column alignment, causing AI to misinterpret key-value associations.",
    handlingStrategy: "The system identifies merged cell structures and flattens them into clean, sequential header-column representations.",
    userAction: "Review column layout in Send Gate preview to ensure aligned variables map correctly."
  },
  "RS-013": {
    scenarioName: "Simple Word user guide",
    problem: "Standard text manuals with clean headings, list items, and simple paragraphs need straightforward markdown conversion.",
    handlingStrategy: "Direct DOCX XML parser maps structural tags to readable H2/H3 and list structures in Markdown for AI review.",
    userAction: "Proceed directly to Send Gate preview and stage context."
  },
  "RS-014": {
    scenarioName: "API spec document bookmarks",
    problem: "API specifications contain interactive hyperlinks and bookmarks that are irrelevant for LLM textual understanding.",
    handlingStrategy: "The parser extracts text layers and code blocks while dropping interactive styling and bookmark nodes.",
    userAction: "Review generated endpoint text layout before staging."
  },
  "RS-015": {
    scenarioName: "Large product catalog workbook",
    problem: "Spreadsheets with massive multi-sheet inventories can easily overflow token limits and waste model context.",
    handlingStrategy: "Allows multi-sheet previewing and registers worksheet structures, guiding the user to select specific tabs and query rows.",
    userAction: "Choose the target worksheet tab and apply local SQL filters before loading data to AI."
  },
  "RS-016": {
    scenarioName: "Marketing deck embedded vector diagrams",
    problem: "Presentation slides converted to PDF often contain rich shapes, flowcharts, and background layouts that cannot be represented in plain text.",
    handlingStrategy: "Text extraction pulls textual layers only, lowering confidence for complex layouts and warning that diagrams are omitted.",
    userAction: "Add manual summaries of critical diagrams into the Markdown working copy before sending."
  },
  "RS-017": {
    scenarioName: "Complex payroll spreadsheet pivot table",
    problem: "Pivot tables and nested matrix headers are highly structural and do not translate well to raw CSV.",
    handlingStrategy: "Processes raw spreadsheet grids, flattens sub-headers into sequential fields, and flags a layout known limit.",
    userAction: "Use local SQL query engine to filter down nested metrics or rows before staging."
  },
  "RS-018": {
    scenarioName: "Handwritten survey form scanned PDF",
    problem: "Handwritten text or ink marks do not have digital fonts, producing empty files under regular text extraction.",
    handlingStrategy: "Detects empty character length, classifies the document as low confidence, and blocks sending to AI.",
    userAction: "Run external OCR conversion or re-type critical feedback into the Markdown editor."
  },
  "RS-019": {
    scenarioName: "Technical spec embedded raster illustrations",
    problem: "Technical DOCX files contain embedded schematics or raster images that are skipped by text parsing.",
    handlingStrategy: "The parser converts text and tables into Markdown, tags a layout known limit, and alerts that images are omitted.",
    userAction: "Ensure that text descriptions are sufficient for AI understanding, or attach text explanations."
  },
  "RS-020": {
    scenarioName: "Credential or API key leak prevention",
    problem: "Accidentally staging plain-text AWS/OpenAI keys or DB passwords poses a severe security risk.",
    handlingStrategy: "Send Gate security audit runs local CJK-aware patterns, detects credential strings, and blocks transmission.",
    userAction: "Verify masked entities, clear leaked credentials from the source, and re-stage before sending."
  }
};

function statusBadge(sample) {
  if (sample.status === "pass") {
    return "AI-READY AFTER REVIEW";
  } else if (sample.status === "blocked") {
    return "BLOCKED BEFORE AI SEND";
  }
  return "DOWNGRADED BEFORE AI SEND (KNOWN LIMIT)";
}

function qualityBadge(sample) {
  return sample.quality.toUpperCase();
}

function compactCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

async function generate() {
  const rootDir = path.resolve(".");
  const resultsPath = path.join(rootDir, "samples", "real-sample-results.json");
  const outputPath = path.join(rootDir, "docs", "sample-scenarios.md");

  console.log(`Reading test results from ${resultsPath}...`);
  const data = JSON.parse(await readFile(resultsPath, "utf8"));

  let markdown = `# Schema Docs Real Sample Scenario Map

> This file is generated by \`npm run sample-scenarios\` from the real sample result set. It maps known limits and edge-case files to the expected Schema Docs response: warning, confidence downgrade, Send Gate block, or safe handoff.

---

## Execution Summary

- **Total samples**: ${data.samples.length}
- **AI-ready samples**: ${data.samples.filter((sample) => sample.status === "pass").length}
- **Downgraded / blocked samples**: ${data.samples.filter((sample) => sample.status !== "pass").length}
- **Warning correctness**: ${data.samples.every((sample) => sample.warningsCorrect) ? "all reviewed warning checks passed" : "needs review"}
- **AI-ready status**: ${data.samples.filter((sample) => sample.aiReady).length} / ${data.samples.length}

---

## Product Capability Classifications

Each sample is assessed against one or more core pipeline capabilities:
* **\`ai_intake\`**: Offline text extraction and layout flattening.
* **\`safety_gate\`**: Local-first PII masking and egress credential scanning.
* **\`format_exchange\`**: Bidirectional conversion and exchange packaging.
* **\`table_filter\`**: Local database queries to trim context.
* **\`long_input\`**: Context chunking and staged feeding plans.
* **\`external_refresh\`**: Out-of-band updates and version diffing.

---

## Scenario Matrix

| Sample | Fixture | Status | Quality | Send Gate | Capabilities | User Pain | System Handling | Next Action |
|---|---|---|---|---|---|---|---|---|
`;

  for (const sample of data.samples) {
    const mapping = SCENARIO_MAPPINGS[sample.id] || {
      scenarioName: `Undefined scenario (${sample.name})`,
      problem: "No business description is available.",
      handlingStrategy: "No handling strategy is available.",
      userAction: "No recommended user action is available."
    };

    const capabilities = sample.capabilities.map((c) => `\`${c}\``).join(", ");
    markdown += `| ${sample.id}: ${compactCell(mapping.scenarioName)} | \`${sample.name}\` (${sample.type.toUpperCase()}) | ${statusBadge(sample)} | ${qualityBadge(sample)} | ${sample.aiReady ? "allowed after review" : "blocked for manual review"} | ${capabilities} | ${compactCell(mapping.problem)} | ${compactCell(mapping.handlingStrategy)} | ${compactCell(mapping.userAction)} |\n`;
  }

  markdown += `\n## Closing Note

Schema Docs is local-first and safety-boundary oriented. It does not promise perfect reproduction of every layout. Instead, it turns document intake into a controlled AI handoff: extract what can be trusted, downgrade confidence when needed, block unsafe sends, and preserve evidence for review.`;

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, markdown, "utf8");
  console.log(`Sample scenarios markdown generated successfully at: ${outputPath}`);
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});
