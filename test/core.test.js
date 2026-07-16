import * as indexExports from "../index.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, symlink, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openOrCreateWorkspace, readManifest } from "../src/core/manifest.js";
import { importFileToWorkspace } from "../src/core/records.js";
import { assertInsideRoot } from "../src/core/pathGuard.js";
import { inspectDataset, inspectDatasetAsJob } from "../src/core/datasets.js";
import { csvImporter, parseCsvLine, parseCsvPreview } from "../src/adapters/csvImporter.js";
import { enqueueJob, listJobs, runJob } from "../src/core/jobs.js";
import { pdfBufferToMarkdown } from "../src/adapters/pdfMarkdownConverter.js";
import { worksheetXmlToPreview, xlsxImporter } from "../src/adapters/xlsxImporter.js";
import { pptxMarkdownConverter } from "../src/adapters/pptxMarkdownConverter.js";
import { previewAiPayload, detectSendGateSignals, sendGateDecision } from "../src/core/ai.js";
import { queryResultToExport, rowsToCsv, rowsToMarkdownTable } from "../src/core/exporters.js";
import { createAppService } from "../src/core/appService.js";
import { createExchangeMarkdown, frontMatter, readExchangePackage } from "../src/core/exchangePackage.js";
import { listMarkdownVersions } from "../src/core/versions.js";
import { deleteApiProfile, listApiProfiles, saveApiProfile } from "../src/core/apiProfiles.js";
import { appendEvidenceRecord } from "../src/core/evidence.js";
import { createQualityReport } from "../src/core/qualityReport.js";
import { exportRealSampleReportMd, getRealSampleSummary, writeRealSampleReportMd, writeRealSampleResults } from "../src/core/realSamples.js";
import { readZipEntry } from "../src/core/zip.js";
import { buildZip } from "./helpers/zipBuilder.js";
import { AppError, toErrorRecord } from "../src/core/errors.js";
async function tempDir(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}
test("parses csv lines with quoted commas", () => {
  assert.deepEqual(parseCsvLine("alpha,\"bravo,charlie\",\"doubled \"\"quote\"\"\""), [
    "alpha",
    "bravo,charlie",
    "doubled \"quote\""
  ]);
});
test("builds csv preview with normalized columns and inferred types", () => {
  const preview = parseCsvPreview("name,value,value\nalpha,1,2026-06-30\nbeta,2,2026-07-01\n");
  assert.deepEqual(preview.columns.map((column) => column.name), ["name", "value", "value_2"]);
  assert.equal(preview.columns[0].inferredType, "string");
  assert.equal(preview.columns[1].inferredType, "number");
  assert.equal(preview.columns[2].inferredType, "date");
  assert.equal(preview.previewRows.length, 2);
});
test("inspects imported csv dataset through adapter boundary", async () => {
  const workspace = await tempDir("lft-csv-");
  await openOrCreateWorkspace(workspace);
  const csvPath = path.join(workspace, "input.csv");
  await writeFile(csvPath, "name,value\nalpha,1\nbeta,2\n", "utf8");
  const record = await importFileToWorkspace(workspace, csvPath);
  const dataset = await inspectDataset(workspace, record.id, csvImporter);
  assert.equal(dataset.status, "ready");
  assert.equal(dataset.sheets[0].columns[1].name, "value");
  assert.equal(dataset.sheets[0].columns[1].inferredType, "number");
});
test("tracks queued jobs in the workspace manifest", async () => {
  const workspace = await tempDir("lft-jobs-");
  await openOrCreateWorkspace(workspace);
  const job = await enqueueJob(workspace, "parse_csv", { datasetId: "dataset_test" });
  const jobs = await listJobs(workspace);
  assert.equal(job.status, "queued");
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].type, "parse_csv");
});
test("runs successful jobs with output", async () => {
  const workspace = await tempDir("lft-run-job-");
  await openOrCreateWorkspace(workspace);
  const job = await runJob(workspace, "local_sql_query", { sql: "select 1" }, async ({ update }) => {
    await update({ progress: 50, message: "Halfway" });
    return { rows: [{ value: 1 }] };
  });
  assert.equal(job.status, "succeeded");
  assert.equal(job.progress, 100);
  assert.deepEqual(job.output.rows, [{ value: 1 }]);
});
test("runs failed jobs with error record", async () => {
  const workspace = await tempDir("lft-failed-job-");
  await openOrCreateWorkspace(workspace);
  const job = await runJob(workspace, "local_sql_query", { sql: "bad" }, async () => {
    throw new Error("bad query");
  });
  assert.equal(job.status, "failed");
  assert.equal(job.error.code, "unknown_error");
  assert.equal(job.error.message, "bad query");
});
test("user-visible error records include recovery guidance", () => {
  const sendGate = toErrorRecord(new AppError("ai_send_gate_review_required", "Blocked by Send Gate."));
  const query = toErrorRecord(new AppError("query_unsupported", "Unsupported SQL."));
  const missingColumn = toErrorRecord(new AppError("query_column_not_found", "Unknown column."));
  const apiFailure = toErrorRecord(new AppError("api_request_failed", "Provider failed."));
  const nonJsonApi = toErrorRecord(new AppError("api_response_non_json", "Provider returned HTML."));
  const emptyHandoff = toErrorRecord(new AppError("ai_handoff_context_empty", "No context."));
  const hash = toErrorRecord(new AppError("exchange_package_hash_mismatch", "Hash mismatch."));
  const manifest = toErrorRecord(new AppError("manifest_not_found", "Missing manifest."));
  const refresh = toErrorRecord(new AppError("refresh_failed", "Cannot refresh."));
  const packageSchema = toErrorRecord(new AppError("exchange_package_schema_invalid", "Bad package."));
  const outputPath = toErrorRecord(new AppError("write_outside_workspace", "Bad output."));
  const unknown = toErrorRecord(new Error("plain failure"));
  assert.match(sendGate.guidance, /mask credentials/i);
  assert.match(query.guidance, /SELECT/);
  assert.match(missingColumn.guidance, /available column/i);
  assert.match(apiFailure.guidance, /base URL/i);
  assert.match(nonJsonApi.guidance, /JSON endpoint/i);
  assert.match(emptyHandoff.guidance, /handoff bundle/i);
  assert.match(hash.guidance, /fresh exchange package/i);
  assert.match(manifest.guidance, /workspace/i);
  assert.match(refresh.guidance, /original file/i);
  assert.match(packageSchema.guidance, /exchange package/i);
  assert.match(outputPath.guidance, /inside the current workspace/i);
  assert.equal(unknown.guidance, undefined);
});
test("inspects csv dataset through job flow", async () => {
  const workspace = await tempDir("lft-csv-job-");
  await openOrCreateWorkspace(workspace);
  const csvPath = path.join(workspace, "input.csv");
  await writeFile(csvPath, "name,value\nalpha,1\n", "utf8");
  const record = await importFileToWorkspace(workspace, csvPath);
  const job = await inspectDatasetAsJob(workspace, record.id, csvImporter);
  const jobs = await listJobs(workspace);
  assert.equal(job.status, "succeeded");
  assert.equal(job.output.datasetId, record.id);
  assert.equal(jobs.length, 1);
});
test("converts worksheet xml to preview", () => {
  const sheetXml = `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1">
          <c r="A1" t="s"><v>0</v></c>
          <c r="B1" t="s"><v>1</v></c>
        </row>
        <row r="2">
          <c r="A2" t="s"><v>2</v></c>
          <c r="B2"><v>10</v></c>
        </row>
      </sheetData>
    </worksheet>`;
  const preview = worksheetXmlToPreview(sheetXml, ["Name", "Value", "Alpha"]);
  assert.deepEqual(preview.columns.map((column) => `${column.name}:${column.inferredType}`), [
    "Name:string",
    "Value:number"
  ]);
  assert.deepEqual(preview.previewRows, [{ Name: "Alpha", Value: "10" }]);
});
test("detects a multi-column table below spreadsheet title and description rows", () => {
  const sheetXml = `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1"><c r="A1" t="inlineStr"><is><t>COOPERATION</t></is></c></row>
        <row r="3"><c r="A3" t="inlineStr"><is><t>Table description</t></is></c></row>
        <row r="8"><c r="A8" t="inlineStr"><is><t>Q</t></is></c><c r="B8" t="inlineStr"><is><t>P</t></is></c><c r="C8" t="inlineStr"><is><t>Π</t></is></c></row>
        <row r="10"><c r="A10"><v>0</v></c><c r="B10"><v>45</v></c><c r="C10"><v>0</v></c></row>
        <row r="11"><c r="A11"><v>5</v></c><c r="B11"><v>44</v></c><c r="C11"><v>195</v></c></row>
      </sheetData>
    </worksheet>`;
  const preview = worksheetXmlToPreview(sheetXml);
  assert.deepEqual(preview.columns.map((column) => column.name), ["Q", "P", "Π"]);
  assert.deepEqual(preview.previewRows, [
    { Q: "0", P: "45", Π: "0" },
    { Q: "5", P: "44", Π: "195" }
  ]);
  assert.deepEqual(preview.preambleRows, [["COOPERATION"], ["Table description"]]);
  assert.equal(preview.totalRowsEstimate, 2);
});
test("preserves populated summary columns to the right of the main table header", () => {
  const sheetXml = `<worksheet><sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Q</t></is></c><c r="B1" t="inlineStr"><is><t>P</t></is></c></row>
    <row r="2"><c r="A2"><v>0</v></c><c r="B2"><v>45</v></c><c r="E2"><v>498</v></c></row>
  </sheetData></worksheet>`;
  const preview = worksheetXmlToPreview(sheetXml);
  assert.deepEqual(preview.columns.map((column) => column.name), ["Q", "P", "column_3", "column_4", "column_5"]);
  assert.equal(preview.previewRows[0].column_5, "498");
});
test("promotes a merged vertical dimension label into a matrix column header", () => {
  const sheetXml = `<worksheet><sheetData>
    <row r="1"><c r="B1" t="inlineStr"><is><t>0</t></is></c><c r="C1" t="inlineStr"><is><t>10</t></is></c><c r="D1" t="inlineStr"><is><t>Summary</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>QA</t></is></c><c r="B2"><v>0</v></c><c r="C2"><v>0</v></c><c r="D2"><v>100</v></c></row>
    <row r="3"><c r="A3"><v>10</v></c><c r="B3"><v>280</v></c><c r="C3"><v>520</v></c><c r="D3"><v>90</v></c></row>
  </sheetData></worksheet>`;
  const preview = worksheetXmlToPreview(sheetXml);
  assert.deepEqual(preview.columns.map((column) => column.name), ["QA", "0", "10", "Summary"]);
  assert.deepEqual(preview.previewRows[1], { QA: "10", "0": "280", "10": "520", Summary: "90" });
});
test("decodes legacy Symbol-font spreadsheet headers using cell styles", () => {
  const sheetXml = `<worksheet><sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Q</t></is></c><c r="B1" t="inlineStr"><is><t>P</t></is></c><c r="C1" s="1" t="inlineStr"><is><t>P</t></is></c></row>
    <row r="2"><c r="A2"><v>0</v></c><c r="B2"><v>45</v></c><c r="C2"><v>0</v></c></row>
  </sheetData></worksheet>`;
  const preview = worksheetXmlToPreview(sheetXml, [], 500, {}, ["Arial", "Symbol"]);
  assert.deepEqual(preview.columns.map((column) => column.name), ["Q", "P", "Π"]);
});
test("formats cached shared-formula values using the cell number format", () => {
  const sheetXml = `<worksheet><sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Value</t></is></c></row>
    <row r="2"><c r="A2" s="1"><f t="shared" ref="A2:A3" si="0">100/3</f><v>33.333333333333336</v></c></row>
    <row r="3"><c r="A3" s="1"><f t="shared" si="0"/><v>33.333333333333336</v></c></row>
  </sheetData></worksheet>`;
  const preview = worksheetXmlToPreview(sheetXml, [], 500, {}, [
    { fontName: "Arial", numFmtId: 0, formatCode: "" },
    { fontName: "Arial", numFmtId: 2, formatCode: "" }
  ]);
  assert.deepEqual(preview.previewRows, [{ Value: "33.33" }, { Value: "33.33" }]);
});
test("formats General numeric cells without binary floating-point tails", () => {
  const sheetXml = `<worksheet><sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Value</t></is></c></row>
    <row r="2"><c r="A2"><v>33.333333333333336</v></c></row>
  </sheetData></worksheet>`;
  const preview = worksheetXmlToPreview(sheetXml);
  assert.deepEqual(preview.previewRows, [{ Value: "33.3333" }]);
});
test("keeps self-closing blank cells separate from following shared-string cells", () => {
  const sharedStrings = ["", "", "", "", {
    rich: true,
    runs: [{ text: "Q", font: "" }, { text: "B", font: "Arial" }]
  }];
  const sheetXml = `<worksheet><sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Label</t></is></c><c r="B1" t="inlineStr"><is><t>Text</t></is></c></row>
    <row r="2"><c r="A2"/><c r="B2" t="s"><v>4</v></c></row>
    <row r="3"><c r="A3"><v>1</v></c><c r="B3"><v>2</v></c></row>
  </sheetData></worksheet>`;
  const preview = worksheetXmlToPreview(sheetXml, sharedStrings);
  assert.deepEqual(preview.previewRows[0], { Label: "", Text: "QB" });
});
test("reads every self-closing worksheet relationship in workbook order", async () => {
  const workspace = await tempDir("lft-multi-sheet-xlsx-");
  const xlsxPath = path.join(workspace, "multi-sheet.xlsx");
  const workbookXml = `<workbook><sheets>
    <sheet name="Cooperation" sheetId="2" r:id="rId1"/>
    <sheet name="First-Mover" sheetId="4" r:id="rId4"/>
  </sheets></workbook>`;
  const relsXml = `<Relationships>
    <Relationship Id="rId4" Target="worksheets/sheet4.xml"/>
    <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
  </Relationships>`;
  const makeSheet = (heading, value) => `<worksheet><sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>${heading}</t></is></c><c r="B1" t="inlineStr"><is><t>Value</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>row</t></is></c><c r="B2"><v>${value}</v></c></row>
  </sheetData></worksheet>`;
  await writeFile(xlsxPath, buildZip([
    { name: "xl/workbook.xml", content: workbookXml },
    { name: "xl/_rels/workbook.xml.rels", content: relsXml },
    { name: "xl/worksheets/sheet1.xml", content: makeSheet("Q", 1) },
    { name: "xl/worksheets/sheet4.xml", content: makeSheet("Matrix", 4) }
  ]));
  const imported = await xlsxImporter.import({ sourcePath: xlsxPath });
  assert.deepEqual(imported.sheets.map((sheet) => sheet.name), ["Cooperation", "First-Mover"]);
  assert.deepEqual(imported.sheets.map((sheet) => sheet.previewRows[0].Value), ["1", "4"]);
});
test("inspects generated xlsx through dataset job flow", async () => {
  const workspace = await tempDir("lft-xlsx-");
  await openOrCreateWorkspace(workspace);
  const xlsxPath = path.join(workspace, "book.xlsx");
  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8"?>
    <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <si><t>Name</t></si>
      <si><t>Value</t></si>
      <si><t>Alpha</t></si>
      <si><t>Beta</t></si>
    </sst>`;
  const sheetXml = `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
        <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1</v></c></row>
        <row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>2</v></c></row>
      </sheetData>
    </worksheet>`;
  await writeFile(xlsxPath, buildZip([
    { name: "xl/sharedStrings.xml", content: sharedStringsXml },
    { name: "xl/worksheets/sheet1.xml", content: sheetXml }
  ]));
  const record = await importFileToWorkspace(workspace, xlsxPath);
  const job = await inspectDatasetAsJob(workspace, record.id, xlsxImporter);
  const manifest = await readManifest(workspace);
  const dataset = manifest.datasets.find((candidate) => candidate.id === record.id);
  assert.equal(job.status, "succeeded");
  assert.equal(dataset.status, "ready");
  assert.equal(dataset.sheets[0].columns[1].inferredType, "number");
  assert.equal(dataset.sheets[0].previewRows.length, 2);
});
test("rejects xlsx workbooks whose worksheets contain no cell data", async () => {
  const workspace = await tempDir("lft-empty-xlsx-");
  const xlsxPath = path.join(workspace, "empty.xlsx");
  const workbookXml = `<?xml version="1.0" encoding="UTF-8"?>
    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
    </workbook>`;
  const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
    </Relationships>`;
  const sheetXml = `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <dimension ref="A1"/><sheetData></sheetData>
    </worksheet>`;
  await writeFile(xlsxPath, buildZip([
    { name: "xl/workbook.xml", content: workbookXml },
    { name: "xl/_rels/workbook.xml.rels", content: relsXml },
    { name: "xl/worksheets/sheet1.xml", content: sheetXml }
  ]));
  await assert.rejects(
    xlsxImporter.import({ sourcePath: xlsxPath }),
    /contains no cell data/i
  );
});
test("converts PPTX slides, tables, images, and speaker notes to Markdown", async () => {
  const workspace = await tempDir("lft-pptx-");
  const sourcePath = path.join(workspace, "deck.pptx");
  const assetDir = path.join(workspace, "assets");
  const presentation = `<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`;
  const presentationRels = `<Relationships><Relationship Id="rId1" Type="slide" Target="slides/slide1.xml"/></Relationships>`;
  const slide = `<p:sld><p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Quarterly Review</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:txBody><a:p><a:r><a:t>Revenue increased</a:t></a:r></a:p></p:txBody></p:sp>
    <p:pic><p:blipFill><a:blip r:embed="rIdImage"/></p:blipFill></p:pic>
    <p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Metric</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Value</a:t></a:r></a:p></a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Sales</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>42</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>
  </p:spTree></p:cSld></p:sld>`;
  const slideRels = `<Relationships><Relationship Id="rIdImage" Type="image" Target="../media/image1.png"/><Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`;
  const notes = `<p:notes><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Discuss customer retention.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;
  await writeFile(sourcePath, buildZip([
    { name: "ppt/presentation.xml", content: presentation },
    { name: "ppt/_rels/presentation.xml.rels", content: presentationRels },
    { name: "ppt/slides/slide1.xml", content: slide },
    { name: "ppt/slides/_rels/slide1.xml.rels", content: slideRels },
    { name: "ppt/notesSlides/notesSlide1.xml", content: notes },
    { name: "ppt/media/image1.png", content: Buffer.from([137, 80, 78, 71]) }
  ]));
  const result = await pptxMarkdownConverter.convert({ sourcePath, sourceName: "deck.pptx", assetDir, assetRelativeBase: "assets/deck.pptx", renderSlides: false });
  assert.match(result.markdown, /^# deck/m);
  assert.match(result.markdown, /## Slide 1: Quarterly Review/);
  assert.match(result.markdown, /Revenue increased/);
  assert.match(result.markdown, /\| Metric \| Value \|/);
  assert.match(result.markdown, /!\[Slide 1 image\]\(<assets\/deck\.pptx\/slide-1-image1\.png>\)/);
  assert.match(result.markdown, /> Discuss customer retention\./);
  assert.equal((await readFile(path.join(assetDir, "slide-1-image1.png"))).length, 4);
});
test("filters repeated PPTX decorations, page-number notes, and infers a visual title", async () => {
  const workspace = await tempDir("lft-pptx-structure-");
  const sourcePath = path.join(workspace, "structured.pptx");
  const assetDir = path.join(workspace, "assets");
  const presentation = `<p:presentation><p:sldSz cx="1000" cy="600"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`;
  const presentationRels = `<Relationships><Relationship Id="rId1" Type="slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="slide" Target="slides/slide2.xml"/></Relationships>`;
  const visualTitle = `<p:sp><p:spPr><a:xfrm><a:off x="20" y="20"/><a:ext cx="800" cy="80"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr sz="3600"/><a:t>Visual title</a:t></a:r></a:p></p:txBody></p:sp>`;
  const body = `<p:sp><p:spPr><a:xfrm><a:off x="20" y="150"/><a:ext cx="800" cy="200"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr sz="1800"/><a:t>Body copy</a:t></a:r></a:p></p:txBody></p:sp>`;
  const repeatedPicture = `<p:pic><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000" cy="600"/></a:xfrm></p:spPr><p:blipFill><a:blip r:embed="rIdBackground"/></p:blipFill></p:pic>`;
  const contentPicture = `<p:pic><p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="500" cy="250"/></a:xfrm></p:spPr><p:blipFill><a:blip r:embed="rIdContent"/></p:blipFill></p:pic>`;
  const slide1 = `<p:sld><p:cSld><p:spTree>${visualTitle}${body}${repeatedPicture}${contentPicture}</p:spTree></p:cSld></p:sld>`;
  const slide2 = `<p:sld><p:cSld><p:spTree>${repeatedPicture}</p:spTree></p:cSld></p:sld>`;
  const rels1 = `<Relationships><Relationship Id="rIdBackground" Type="image" Target="../media/background.png"/><Relationship Id="rIdContent" Type="image" Target="../media/content.png"/><Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`;
  const rels2 = `<Relationships><Relationship Id="rIdBackground" Type="image" Target="../media/background.png"/></Relationships>`;
  const notes = `<p:notes><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>1</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;
  await writeFile(sourcePath, buildZip([
    { name: "ppt/presentation.xml", content: presentation },
    { name: "ppt/_rels/presentation.xml.rels", content: presentationRels },
    { name: "ppt/slides/slide1.xml", content: slide1 },
    { name: "ppt/slides/slide2.xml", content: slide2 },
    { name: "ppt/slides/_rels/slide1.xml.rels", content: rels1 },
    { name: "ppt/slides/_rels/slide2.xml.rels", content: rels2 },
    { name: "ppt/notesSlides/notesSlide1.xml", content: notes },
    { name: "ppt/media/background.png", content: Buffer.from([1, 2, 3]) },
    { name: "ppt/media/content.png", content: Buffer.from([4, 5, 6]) }
  ]));
  const result = await pptxMarkdownConverter.convert({
    sourcePath,
    sourceName: "structured.pptx",
    assetDir,
    assetRelativeBase: "assets/structured.pptx",
    renderSlides: async (_sourcePath, { outputDir }) => {
      await writeFile(path.join(outputDir, "slide-1-preview.png"), Buffer.from([7, 8, 9]));
      await writeFile(path.join(outputDir, "slide-2-preview.png"), Buffer.from([10, 11, 12]));
      return {
        adapter: "test-renderer",
        slides: [
          { index: 1, fileName: "slide-1-preview.png" },
          { index: 2, fileName: "slide-2-preview.png" }
        ]
      };
    }
  });
  assert.match(result.markdown, /## Slide 1: Visual title/);
  assert.equal((result.markdown.match(/Visual title/g) || []).length, 1);
  assert.match(result.markdown, /slide-1-preview\.png/);
  assert.match(result.markdown, /slide-2-preview\.png/);
  assert.doesNotMatch(result.markdown, /slide-1-content\.png/);
  assert.doesNotMatch(result.markdown, /slide-1-background\.png/);
  assert.doesNotMatch(result.markdown, /Speaker notes/);
  assert.match(result.warnings.join("\n"), /Preserved 2 complete slide preview/);
});
test("exports rows as markdown and csv", () => {
  const columns = ["name", "note"];
  const rows = [
    { name: "alpha", note: "a|b" },
    { name: "beta", note: "line\nbreak" }
  ];
  assert.equal(rowsToMarkdownTable(columns, rows), [
    "| name | note |",
    "| --- | --- |",
    "| alpha | a\\|b |",
    "| beta | line<br>break |"
  ].join("\n"));
  assert.equal(rowsToCsv(columns, rows), [
    "name,note",
    "alpha,a|b",
    "beta,\"line\nbreak\""
  ].join("\n"));
  assert.match(queryResultToExport({ columns, rows }, "markdown"), /^\| name \| note \|/);
  assert.match(queryResultToExport({ columns, rows }, "csv"), /^name,note/);
});
test("app service runs the core workflow through a single facade", async () => {
  const workspace = await tempDir("lft-service-");
  const service = createAppService(workspace);
  await service.openWorkspace();
  await service.saveMarkdown(path.join("notes", "hello.md"), "# Hello\n");
  assert.equal(await service.readMarkdown(path.join("notes", "hello.md")), "# Hello\n");
  const csvPath = path.join(workspace, "input.csv");
  await writeFile(csvPath, "name,value\nalpha,1\n", "utf8");
  const record = await service.importFile(csvPath);
  const inspectJob = await service.inspectDataset(record.id);
  const tables = await service.listTables();
  const queryJob = await service.runQuery(`select * from ${tables[0].tableName} limit 1`);
  const aiJob = await service.previewAiPayload({
    operation: "summarize",
    content: "hello",
    sourceRef: "service-test"
  });
  const exchange = await service.createExchangeMarkdown({
    title: "Service Exchange",
    body: "hello",
    auditId: aiJob.output.auditId
  });
  assert.equal(inspectJob.status, "succeeded");
  assert.equal(queryJob.status, "succeeded");
  assert.equal(aiJob.status, "succeeded");
  assert.match(exchange, /Exchange Audit/);
  assert.match(exchange, /## Evidence/);
  assert.match(exchange, /api_preview/);
  assert.match(exchange, /preview_only/);
});
test("app service exports CSV dataset records to readable Markdown tables", async () => {
  const workspace = await tempDir("lft-dataset-md-");
  const service = createAppService(workspace);
  await service.openWorkspace();
  const csvPath = path.join(workspace, "sales.csv");
  const rows = Array.from({ length: 520 }, (_, index) => {
    const rowNumber = index + 1;
    return `item-${rowNumber},${rowNumber},ready-${rowNumber}`;
  });
  await writeFile(csvPath, ["name,value,note", ...rows].join("\n"), "utf8");
  const record = await service.importFile(csvPath);
  const exported = await service.exportRecordToMarkdown(record.id, "exports/sales.md");
  const markdown = await readFile(exported.outputPath, "utf8");
  assert.equal(exported.format, "md");
  assert.match(markdown, /^# sales/m);
  assert.match(markdown, /## CSV/);
  assert.match(markdown, /\| name \| value \| note \|/);
  assert.match(markdown, /\| item-1 \| 1 \| ready-1 \|/);
  assert.match(markdown, /\| item-520 \| 520 \| ready-520 \|/);
  assert.ok(exported.warnings.some((warning) => warning.includes("all available rows")));
});
test("app service exports full XLSX dataset records to Markdown tables", async () => {
  const workspace = await tempDir("lft-xlsx-md-");
  const service = createAppService(workspace);
  await service.openWorkspace();
  const rowXml = Array.from({ length: 510 }, (_, index) => {
    const rowNumber = index + 2;
    const itemNumber = index + 1;
    return [
      `<row r="${rowNumber}">`,
      `<c r="A${rowNumber}" t="inlineStr"><is><t>item-${itemNumber}</t></is></c>`,
      `<c r="B${rowNumber}"><v>${itemNumber}</v></c>`,
      `<c r="C${rowNumber}" t="inlineStr"><is><t>ready-${itemNumber}</t></is></c>`,
      "</row>"
    ].join("");
  }).join("");
  const sheetXml = `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1">
          <c r="A1" t="inlineStr"><is><t>name</t></is></c>
          <c r="B1" t="inlineStr"><is><t>value</t></is></c>
          <c r="C1" t="inlineStr"><is><t>note</t></is></c>
        </row>
        ${rowXml}
      </sheetData>
    </worksheet>`;
  const xlsxPath = path.join(workspace, "inventory.xlsx");
  await writeFile(xlsxPath, buildZip([
    { name: "xl/worksheets/sheet1.xml", content: sheetXml }
  ]));
  const record = await service.importFile(xlsxPath);
  const exported = await service.exportRecordToMarkdown(record.id, "exports/inventory.md");
  const markdown = await readFile(exported.outputPath, "utf8");
  assert.equal(exported.format, "md");
  assert.match(markdown, /^# inventory/m);
  assert.match(markdown, /## Sheet1/);
  assert.match(markdown, /\| name \| value \| note \|/);
  assert.match(markdown, /\| item-510 \| 510 \| ready-510 \|/);
  assert.ok(exported.warnings.some((warning) => warning.includes("all available rows")));
});
test("stores API profiles without API keys", async () => {
  const workspace = await tempDir("lft-api-profile-");
  await openOrCreateWorkspace(workspace);
  const profile = await saveApiProfile(workspace, {
    name: "default",
    apiBaseUrl: "https://api.example.test/v1",
    model: "model-a",
    apiKey: "should-not-persist"
  });
  const profiles = await listApiProfiles(workspace);
  assert.equal(profile.name, "default");
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].apiKey, undefined);
  const deleted = await deleteApiProfile(workspace, profile.id);
  assert.equal(deleted.id, profile.id);
  assert.equal((await listApiProfiles(workspace)).length, 0);
});
test("refuses to read a symlink that points outside workspace", async (t) => {
  if (process.platform === "win32") {
    t.skip("Symlink creation needs platform-specific privileges on some Windows setups.");
    return;
  }
  const workspace = await tempDir("lft-symlink-");
  const outside = await tempDir("lft-symlink-outside-");
  await openOrCreateWorkspace(workspace);
  const outsideFile = path.join(outside, "outside.md");
  const linkPath = path.join(workspace, "notes", "linked.md");
  await writeFile(outsideFile, "outside", "utf8");
  await symlink(outsideFile, linkPath);
  await assert.rejects(() => assertInsideRoot(linkPath, workspace), {
    code: "path_outside_workspace"
  });
});
test("imports directory and batch converts documents", async () => {
  const workspace = await tempDir("lft-batch-");
  await openOrCreateWorkspace(workspace);
  const batchDir = path.join(workspace, "batch-source");
  await mkdir(batchDir, { recursive: true });
  await writeFile(path.join(batchDir, "doc1.txt"), "Doc 1 text content", "utf8");
  await writeFile(path.join(batchDir, "doc2.md"), "# Doc 2 title\nDoc 2 markdown content", "utf8");
  await writeFile(path.join(batchDir, "ignored.png"), "image data", "utf8");
  const service = createAppService(workspace);
  await service.openWorkspace();
  const imported = await service.importFile(batchDir);
  assert.equal(imported.length, 2);
  assert.equal(imported[0].title, "doc1");
  assert.equal(imported[1].title, "doc2");
  const manifestAfterImport = await readManifest(workspace);
  assert.equal(manifestAfterImport.documents.length, 2);
  assert.equal(manifestAfterImport.documents[0].status, "imported");
  assert.equal(manifestAfterImport.documents[1].status, "imported");
  const jobs = await service.convertAllDocuments();
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].status, "succeeded");
  assert.equal(jobs[1].status, "succeeded");
  const manifestAfterConvert = await readManifest(workspace);
  assert.equal(manifestAfterConvert.documents[0].status, "ready");
  assert.equal(manifestAfterConvert.documents[1].status, "ready");
});
test("searches workspace markdown notes for keywords", async () => {
  const workspace = await tempDir("lft-search-");
  const service = createAppService(workspace);
  await service.openWorkspace();
  await service.saveMarkdown("notes/alpha.md", "# Alpha Title\nThis is the content of note alpha with some unique_keyword.");
  await service.saveMarkdown("notes/beta.md", "# Beta Title\nThis is note beta content.");
  const results = await service.searchWorkspace("unique_keyword");
  assert.equal(results.length, 1);
  assert.equal(results[0].fileName, "alpha.md");
  assert.equal(results[0].matchesCount, 1);
  assert.equal(results[0].hits[0].lineContent, "This is the content of note alpha with some unique_keyword.");
  const noResults = await service.searchWorkspace("nonexistent_keyword");
  assert.equal(noResults.length, 0);
});
test("safe Markdown backup, refreshImportSource, detectSourceChanges and quality hints", async () => {
  const fs = await import("node:fs/promises");
  const workspace = await tempDir("lft-refresh-quality-");
  const service = createAppService(workspace);
  await service.openWorkspace();
  const txtPath = path.join(workspace, "doc.txt");
  await writeFile(txtPath, "Hello world, this is a plain text file.", "utf8");
  const record = await service.importFile(txtPath);
  assert.ok(record.id);
  assert.equal(record.status, "imported");
  assert.equal(record.originalSourcePath, path.resolve(txtPath));
  assert.ok(record.sourceSize > 0);
  assert.ok(record.sourceHash);
  const job = await service.convertDocument(record.id);
  assert.equal(job.status, "succeeded");
  const manifest = await service.getManifest();
  const updatedDoc = manifest.documents.find(d => d.id === record.id);
  assert.equal(updatedDoc.status, "ready");
  assert.ok(updatedDoc.outputMarkdownPath);
  assert.ok(updatedDoc.extractionQuality);
  assert.equal(updatedDoc.extractionQuality.textLayerDetected, true);
  const mdPath = updatedDoc.outputMarkdownPath;
  const relativeMdPath = path.relative(workspace, mdPath).split(path.sep).join("/");
  const initialVersions = await listMarkdownVersions(workspace, relativeMdPath);
  assert.equal(initialVersions.length, 1);
  assert.equal(initialVersions[0].path, relativeMdPath);
  await writeFile(mdPath, "# Edited Content\nUser manually changed this note.", "utf8");
  const reconvertJob = await service.convertDocument(record.id);
  assert.equal(reconvertJob.status, "succeeded");
  assert.ok(reconvertJob.output.warnings.some(w => w.includes("Local Markdown edits were detected")));
  const files = await fs.readdir(path.join(workspace, "outputs"));
  assert.ok(files.some(f => f.includes(".refreshed.md")));
  await writeFile(txtPath, "Hello world, updated contents.", "utf8");
  const updates = await service.detectSourceChanges();
  const updatedUpdate = updates.find(u => u.id === record.id);
  assert.ok(updatedUpdate.changed);
  const refreshJob = await service.refreshImportSource(record.id);
  assert.ok(refreshJob.record);
  assert.equal(refreshJob.record.status, "imported");
  await fs.unlink(txtPath);
  const updates2 = await service.detectSourceChanges();
  const updatedUpdate2 = updates2.find(u => u.id === record.id);
  assert.ok(updatedUpdate2.missing);
  await assert.rejects(() => service.refreshImportSource(record.id), {
    code: "refresh_failed"
  });
});
test("external refresh registers previous Markdown under the primary version history", async () => {
  const workspace = await tempDir("lft-refresh-version-history-");
  const service = createAppService(workspace);
  await service.openWorkspace();
  const txtPath = path.join(workspace, "external-report.txt");
  await writeFile(txtPath, "Initial external report.", "utf8");
  const record = await service.importFile(txtPath);
  const initialJob = await service.convertDocument(record.id);
  assert.equal(initialJob.status, "succeeded");
  const manifest = await service.getManifest();
  const doc = manifest.documents.find((candidate) => candidate.id === record.id);
  const relativeMdPath = path.relative(workspace, doc.outputMarkdownPath).split(path.sep).join("/");
  const initialVersions = await listMarkdownVersions(workspace, relativeMdPath);
  assert.equal(initialVersions.length, 1);
  assert.equal(initialVersions[0].reason, "initial_extract");
  await writeFile(txtPath, "Updated external report with new content.", "utf8");
  const refreshResult = await service.refreshImportSource(record.id);
  assert.equal(refreshResult.kind, "document");
  const refreshedVersions = await listMarkdownVersions(workspace, relativeMdPath);
  assert.ok(refreshedVersions.length >= 3);
  assert.ok(refreshedVersions.some((version) => version.reason === "pre_refresh_backup" && version.path === relativeMdPath));
  assert.ok(refreshedVersions.every((version) => version.path === relativeMdPath));
});
test("real sample summary tracks product capability coverage", async () => {
  const workspace = await tempDir("lft-real-samples-");
  const defaultSummary = await getRealSampleSummary(workspace);
  assert.equal(defaultSummary.total, 20);
  assert.ok(defaultSummary.capabilityCoverage.ai_intake >= 7);
  assert.ok(defaultSummary.capabilityCoverage.safety_gate >= 5);
  assert.ok(defaultSummary.capabilityCoverage.format_exchange >= 8);
  assert.deepEqual(defaultSummary.missingCapabilitySamples, []);
  await writeRealSampleResults(workspace, {
    samples: [
      {
        id: "RS-MISSING",
        name: "missing-capability.pdf",
        type: "pdf",
        quality: "low",
        status: "known_limit",
        warningsCorrect: true,
        aiReady: false,
        knownLimitCategory: "ocr",
        notes: "Capability tags intentionally omitted."
      }
    ]
  });
  const missingSummary = await getRealSampleSummary(workspace);
  assert.deepEqual(missingSummary.missingCapabilitySamples, ["RS-MISSING"]);
  const report = await exportRealSampleReportMd(workspace);
  assert.match(report, /Capabilities/);
  assert.match(report, /RS-MISSING/);
  const written = await writeRealSampleReportMd(workspace);
  assert.equal(written.relativePath, path.join("docs", "real-sample-report.md"));
  assert.ok(written.bytes > 0);
  assert.match(await readFile(written.reportPath, "utf8"), /RS-MISSING/);
});
test("standalone sdk entry point exports core module interfaces", () => {
  assert.equal(typeof indexExports.createAppService, "function", "createAppService should be exported");
  assert.equal(typeof indexExports.maskSensitiveData, "function", "maskSensitiveData should be exported");
  assert.equal(typeof indexExports.unmaskSensitiveData, "function", "unmaskSensitiveData should be exported");
  assert.equal(typeof indexExports.createSchemaDocsLocalClient, "function", "createSchemaDocsLocalClient should be exported");
  assert.equal(typeof indexExports.openOrCreateWorkspace, "function", "openOrCreateWorkspace should be exported");
  assert.equal(typeof indexExports.readExchangePackage, "function", "readExchangePackage should be exported");
  assert.equal(typeof indexExports.verifyExchangePackage, "function", "verifyExchangePackage should be exported");
  assert.equal(typeof indexExports.detectAdapterCapabilities, "function", "detectAdapterCapabilities should be exported");
});
test("standalone masking works directly through sdk imports", () => {
  const original = "Connect to API with key sk-proj-1234567890abcdef and contact user@domain.com";
  const { maskedText, mapping } = indexExports.maskSensitiveData(original);
  assert.match(maskedText, /\[MASK_SECRET_1\]/);
  assert.match(maskedText, /\[MASK_EMAIL_1\]/);
  const restored = indexExports.unmaskSensitiveData(maskedText, mapping);
  assert.equal(restored, original);
});
