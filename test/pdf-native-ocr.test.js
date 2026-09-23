import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectPdfOcrAdapter, extractPdfWithOcr } from "../src/adapters/pdfOcrExtractor.js";

// These cases drive the bundled interpreter directly, so a checkout without the
// private runtime (CI, a bare clone) can only skip them, not pass them.
const bundledRuntimeSkip = !existsSync(process.env.SCHEMA_DOCS_PYTHON || path.join(process.cwd(), "runtime", "python", "python.exe"))
  && "The private bundled PDF runtime is required for this integration test.";

test("native OCR region scheduling processes every region in bounded batches", { skip: bundledRuntimeSkip }, async () => {
  const python = process.env.SCHEMA_DOCS_PYTHON || path.join(process.cwd(), "runtime", "python", "python.exe");
  const script = `import json,sys
sys.path.insert(0, sys.argv[1])
import pdfRegionOcr
regions=[{"id":f"r-{i}","bbox":[0,0,10,10]} for i in range(37)]
def fake(engine,image,region,number,scale,origin):
    return {**region,"status":"completed","text":"ok","words":[]}
pdfRegionOcr.recognize_region=fake
result=pdfRegionOcr.recognize_page(object(), object(), 1, 1, {"pageRegions":{"1":{"regions":regions}},"regionBatchSize":8}, 10, 10)
print(json.dumps({"requested":result["regionsRequested"],"processed":result["regionsProcessed"],"batches":result["regionBatches"],"unresolved":sum(x["status"]=="unresolved" for x in result["regions"])}))
`;
  const run = await promisify(execFile)(python, ["-B", "-c", script, path.join(process.cwd(), "src", "adapters")], { windowsHide: true });
  const result = JSON.parse(run.stdout.trim());
  assert.deepEqual(result, { requested: 37, processed: 37, batches: 5, unresolved: 0 });
});

test("native OCR does not discard text from a weak histogram signal", { skip: bundledRuntimeSkip }, async () => {
  const python = process.env.SCHEMA_DOCS_PYTHON || path.join(process.cwd(), "runtime", "python", "python.exe");
  const script = `from PIL import Image, ImageDraw
import sys
sys.path.insert(0, sys.argv[1])
import pdfRegionOcr
import pdfTableStructure
image = Image.new("RGB", (240, 120), (30, 60, 65))
ImageDraw.Draw(image).rectangle((12, 12, 220, 105), fill=(80, 110, 115))
pdfRegionOcr.text_likelihood = lambda source: False
pdfRegionOcr.deskew_angle = lambda source: 0
pdfTableStructure.scanned_table_grid = lambda *args, **kwargs: None
pdfTableStructure.borderless_table_regions = lambda *args, **kwargs: []
class Engine:
    def recognize(self, image, dpi, page, scale):
        return "Source label", [
            {"text": "Source", "bbox": [10, 20, 90, 45], "confidence": .95, "line": [1, 1, 1]},
            {"text": "label", "bbox": [95, 20, 160, 45], "confidence": .95, "line": [1, 1, 1]},
        ]
result = pdfRegionOcr.recognize_region(Engine(), image, {"id": "art", "bbox": [0, 0, 240, 120]}, 1, 1, [0, 0])
assert result["status"] == "completed", result
assert "Source label" in result["text"], result
assert result["attempts"], result
`;
  await promisify(execFile)(python, ["-B", "-c", script, path.join(process.cwd(), "src", "adapters")], { windowsHide: true });
});

test("native OCR records unresolved text inside a preserved visual fallback as visual-only", { skip: bundledRuntimeSkip }, async () => {
  const python = process.env.SCHEMA_DOCS_PYTHON || path.join(process.cwd(), "runtime", "python", "python.exe");
  const script = `from PIL import Image, ImageDraw
import sys
sys.path.insert(0, sys.argv[1])
import pdfRegionOcr
import pdfTableStructure
image = Image.new("RGB", (240, 120), (80, 80, 80))
ImageDraw.Draw(image).rectangle((12, 12, 220, 105), fill=(100, 100, 100))
pdfRegionOcr.text_likelihood = lambda source: False
pdfRegionOcr.deskew_angle = lambda source: 0
pdfTableStructure.scanned_table_grid = lambda *args, **kwargs: None
pdfTableStructure.borderless_table_regions = lambda *args, **kwargs: []
class Engine:
    def recognize(self, image, dpi, page, scale):
        return "", []
result = pdfRegionOcr.recognize_region(Engine(), image, {"id": "fallback", "bbox": [0, 0, 240, 120], "visualFallbackCoverage": True}, 1, 1, [0, 0])
assert result["status"] == "visual_only", result
assert result["reason"] == "visual_fallback_unresolved", result
`;
  await promisify(execFile)(python, ["-B", "-c", script, path.join(process.cwd(), "src", "adapters")], { windowsHide: true });
});

test("layout excludes raster fragments already covered by a complete figure fallback", { skip: bundledRuntimeSkip }, async () => {
  const python = process.env.SCHEMA_DOCS_PYTHON || path.join(process.cwd(), "runtime", "python", "python.exe");
  const script = `import sys
sys.path.insert(0, sys.argv[1])
from pdfLayoutExtractor import exclude_ocr_regions_covered_by_visual_fallback
regions = [
    {"id": "inside", "bbox": [10, 10, 20, 20], "provenNonText": True},
    {"id": "insideReadable", "bbox": [30, 10, 40, 20]},
    {"id": "outside", "bbox": [110, 10, 120, 20]},
]
images = [{"type": "image", "subtype": "figure", "needsVisualFallback": True, "bbox": [0, 0, 100, 100]}]
kept, excluded = exclude_ocr_regions_covered_by_visual_fallback(regions, images)
assert [item["id"] for item in kept] == ["insideReadable", "outside"], (kept, excluded)
assert excluded[0]["status"] == "non_text", excluded
assert excluded[0]["reason"] == "visual_fallback", excluded
`;
  await promisify(execFile)(python, ["-B", "-c", script, path.join(process.cwd(), "src", "adapters")], { windowsHide: true });
});

test("OCR candidate filtering keeps a source disposition ledger", { skip: bundledRuntimeSkip }, async () => {
  const python = process.env.SCHEMA_DOCS_PYTHON || path.join(process.cwd(), "runtime", "python", "python.exe");
  const script = `import sys
sys.path.insert(0, sys.argv[1])
from pdfRegionOcr import select_regions
class Page:
    bbox=(0,0,100,100); width=100; height=100
    images=[
      {'x0':1,'top':1,'x1':6,'bottom':6},
      {'x0':10,'top':10,'x1':60,'bottom':30},
      {'x0':10,'top':40,'x1':70,'bottom':70},
      {'x0':10,'top':40,'x1':70,'bottom':70},
      {'x0':70,'top':40,'x1':100,'bottom':70},
    ]
    def extract_words(self, **kwargs):
        return [{'x0':10,'x1':30,'top':10,'bottom':20,'text':'native text '*4}]
page=Page(); regions=select_regions(page)
ledger=page._schema_docs_ocr_candidate_ledger
assert len(ledger)==5, ledger
assert {item['disposition'] for item in ledger} == {'filtered','native_covered','duplicate','requested'}, ledger
assert len(regions)==2, regions
assert all(item.get('regionId') for item in ledger if item['disposition']=='requested')
duplicate=[item for item in ledger if item['disposition']=='duplicate'][0]
assert duplicate['duplicateOf']=='candidate-3', duplicate
assert duplicate['duplicateOfRegionId']=='ocr-1', duplicate
print('ok')
`;
  await promisify(execFile)(python, ["-B", "-c", script, path.join(process.cwd(), "src", "adapters")], { windowsHide: true });
});

test("native OCR reads Chinese and English with source boxes and resumes verified pages", async t => {
  const detection = await detectPdfOcrAdapter();
  if (!detection.native || !detection.tesseract.languages.includes("chi_sim") || process.platform !== "win32") {
    t.skip("The private Windows OCR runtime with Chinese data is required for this integration test.");
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "native-ocr-test-"));
  try {
    const source = path.join(root, "scan.pdf");
    const script = `from PIL import Image, ImageDraw, ImageFont
import sys
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 48)
pages = []
for number in (1, 2):
    page = Image.new('RGB', (1800, 1000), 'white')
    draw = ImageDraw.Draw(page)
    for index, line in enumerate(['中文文档转换测试', '这是一个完整的扫描页面。', f'Page {number}: accurate document conversion.', 'Total amount: 12345']):
        draw.text((110, 100 + index * 150), line, font=font, fill='black')
    pages.append(page)
pages[0].save(sys.argv[1], 'PDF', save_all=True, append_images=pages[1:], resolution=220)
pages[0].save(sys.argv[1] + '.png')
`;
    await promisify(execFile)(detection.native.python.command, ["-B", ...detection.native.python.args, "-c", script, source], { windowsHide: true });
    const png = await promisify(execFile)(detection.tesseract.command,
      [source + ".png", "stdout", "--tessdata-dir", detection.tesseract.tessdataDir, "-l", "chi_sim+eng", "--psm", "6"],
      { windowsHide: true, timeout: 30000 });
    assert.match(png.stdout.replaceAll(" ", ""), /中文文档转换测试/);
    assert.match(png.stdout, /accurate document conversion/);
    const options = { detection, cacheDir: path.join(root, "cache"), pageSegmentationMode: 6 };
    const first = await extractPdfWithOcr(source, { ...options, maxPages: 1 });
    assert.equal(first.pagesProcessed, 1);
    assert.equal(first.failedPages.length, 0, JSON.stringify(first.failedPages));
    assert.match(first.markdown.replaceAll(" ", ""), /中文文档转换测试/);
    assert.match(first.markdown, /accurate document conversion/);
    assert.ok(first.pages[0].words.some(word => word.text === "12345" && word.confidence > .8), JSON.stringify(first.pages[0]));
    assert.ok(first.pages[0].words.every(word => word.bbox.length === 4 && word.bbox[0] >= 0 && word.bbox[2] <= first.pages[0].width));
    const resumed = await extractPdfWithOcr(source, options);
    assert.equal(resumed.cache.reusedPages, 1);
    assert.equal(resumed.pagesProcessed, 2);
    assert.equal(resumed.failedPages.length, 0);
    const pageCache = path.join(options.cacheDir, resumed.cache.identity, "page-000001.json");
    await writeFile(pageCache, '{"damaged":true}');
    // The independent region journal now survives a damaged page aggregate.
    // Corrupt both representations to require actual OCR recomputation.
    const regionCache = path.join(options.cacheDir, resumed.cache.identity, "page-000001-regions");
    for (const name of await readdir(regionCache)) await writeFile(path.join(regionCache, name), '{"damaged":true}');
    const repaired = await extractPdfWithOcr(source, options);
    assert.equal(repaired.cache.reusedPages, 1);
    assert.equal(repaired.markdown, resumed.markdown);
    await assert.rejects(extractPdfWithOcr(source, { ...options, languages: "not_installed" }), { code: "OCR_LANGUAGE_UNAVAILABLE" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
