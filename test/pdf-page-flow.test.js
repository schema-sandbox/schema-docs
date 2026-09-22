import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { extractPdfWithLayout, detectPdfLayoutExtractor, hasBundledPdfRuntime } from "../src/adapters/pdfLayoutExtractor.js";
import { derivePdfPageQuality, runPdfExtractionPipeline } from "../src/adapters/pdfExtractorPipeline.js";
import { mergeOcrPages, mergeNativeAndOcrText } from "../src/adapters/pdfOcrMerge.js";
import { buildPdfDocumentIr } from "../src/adapters/pdfDocumentIr.js";
import { createReadableMarkdown, reflowPdfParagraphs } from "../src/core/readableMarkdown.js";
import { exportMarkdownToHtml, exportMarkdownToDocx } from "../src/core/markdownExportPipeline.js";
import { readZipEntry } from "../src/core/zip.js";

function columnsPdf() {
  const lines = [];
  for (let i = 0; i < 18; i++) {
    lines.push(`BT /F1 10 Tf 45 ${700 - i * 24} Td (Left column sentence number ${i}.) Tj ET`);
    lines.push(`BT /F1 10 Tf 330 ${691 - i * 24} Td (Right column sentence number ${i}.) Tj ET`);
  }
  const content = lines.join("\n");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}`;
  return pdf + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
}

test("page backend reads staggered columns in source order without duplicated or missing lines", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "page-flow-"));
  try {
    const source = path.join(root, "columns.pdf");
    await writeFile(source, columnsPdf());
    const result = await extractPdfWithLayout(source);
    assert.equal(result.visualMap.pages[0].readingOrder.strategy, "column_major");
    assert.ok(result.markdown.indexOf("Left column sentence number 17") < result.markdown.indexOf("Right column sentence number 0"));
    for (const side of ["Left", "Right"]) for (let n = 0; n < 18; n++) {
      assert.equal(result.markdown.split(`${side} column sentence number ${n}.`).length - 1, 1);
    }
    if (hasBundledPdfRuntime()) {
      const automatic = await runPdfExtractionPipeline(source);
      assert.equal(automatic.extractorName, "pdfplumber");
      assert.equal(automatic.pageLedger.pages.length, 1);
      assert.equal(automatic.markdown, result.markdown);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rendered source regions account for a shifted PDF page origin", async () => {
  const python = await detectPdfLayoutExtractor();
  const script = `from PIL import Image
from pathlib import Path
import tempfile,types
from pdfLayoutExtractor import render_visual_regions
image=Image.new('RGB',(200,200),'white')
for x in range(20,60):
    for y in range(20,60): image.putpixel((x,y),(255,0,0))
rendered=types.SimpleNamespace(original=image,scale=2,bbox=(39,-39,139,61))
page=types.SimpleNamespace(width=100,height=100,to_image=lambda **kwargs:rendered)
with tempfile.TemporaryDirectory() as folder:
    region={'type':'image','bbox':[49,-29,69,-9]}
    render_visual_regions(page,1,[region],Path(folder))
    assert region['assetStatus']=='rendered',region
    crop=Image.open(Path(folder)/region['assetFile'])
    assert crop.size==(40,40),crop.size
    assert crop.getextrema()==((255,255),(0,0),(0,0)),crop.getextrema()
    thin={'type':'image','bbox':[49,-28.82,69,-28.78]}
    render_visual_regions(page,1,[thin],Path(folder))
    assert thin['assetStatus']=='rendered',thin
    assert Image.open(Path(folder)/thin['assetFile']).height>=1
`;
  await promisify(execFile)(python.command, [...python.args, "-c", `import sys; sys.path.insert(0,sys.argv[1]);\n${script}`, path.resolve("src/adapters")], { windowsHide: true });
});

test("image placements retain a translated page bbox origin", async () => {
  const python = await detectPdfLayoutExtractor();
  const script = `from types import SimpleNamespace
from pdfLayoutExtractor import image_regions
images=[
 {'x0':49,'x1':69,'top':-29,'bottom':-9,'name':'inside'},
 {'x0':0,'x1':20,'top':0,'bottom':20,'name':'outside'},
]
page=SimpleNamespace(width=100,height=100,bbox=(39,-39,139,61),images=images)
regions=image_regions(page,1)
assert len(regions)==1, regions
assert regions[0]['bbox']==[49,-29,69,-9], regions[0]
`;
  await promisify(execFile)(python.command, [...python.args, "-c", `import sys; sys.path.insert(0,sys.argv[1]);\n${script}`, path.resolve("src/adapters")], { windowsHide: true });
});

test("dense image fragments collapse and out-of-page placements are ignored", async () => {
  const python = await detectPdfLayoutExtractor();
  const script = `from types import SimpleNamespace
from pdfLayoutExtractor import image_regions
images=[]
for index in range(195):
    x=40+(index % 13)
    top=10+(index % 15)
    images.append({'x0':x,'x1':x+10,'top':top,'bottom':top+20,'name':f'frag-{index}'})
images.append({'x0':200,'x1':210,'top':20,'bottom':40,'name':'outside'})
page=SimpleNamespace(width=100,height=100,images=images)
regions=image_regions(page,1)
assert len(regions)==1, len(regions)
assert regions[0]['sourcePlacementCount']==195, regions[0]
assert regions[0]['reductionReason']=='dense_small_image_fragments', regions[0]
assert regions[0]['preserveSourceText'] is True, regions[0]
assert regions[0]['doNotExcludeTables'] is True, regions[0]
`;
  await promisify(execFile)(python.command, [...python.args, "-c", `import sys; sys.path.insert(0,sys.argv[1]);\n${script}`, path.resolve("src/adapters")], { windowsHide: true });
});

test("dense fragments coexist with native formula and table candidates", async () => {
  const python = await detectPdfLayoutExtractor();
  const script = `from types import SimpleNamespace
import pdfLayoutExtractor as layout
import pdfTableStructure
images=[{'x0':40+(index%13),'x1':50+(index%13),'top':10+(index%15),'bottom':30+(index%15),'name':f'frag-{index}'} for index in range(195)]
chars=[]
for index, text in enumerate('x=a+b'):
    chars.append({'text':text,'x0':20+index*8,'x1':26+index*8,'top':60,'bottom':72,'fontname':'CMMI10' if text.isalpha() else 'Helvetica'})
page=SimpleNamespace(width=100,height=100,bbox=(0,0,100,100),images=images,chars=chars,lines=[],rects=[],curves=[],extract_text=lambda **kwargs:'Table 1')
image_candidates=layout.image_regions(page,1)
formula_candidates=layout.formula_regions(page,1)
assert len(image_candidates)==1 and image_candidates[0]['sourcePlacementCount']==195, image_candidates
assert formula_candidates and any('x=a+b' == item['text'] for item in formula_candidates), formula_candidates
original_visible=pdfTableStructure.visible_table_objects
original_borderless=pdfTableStructure.borderless_table_regions
original_region=layout.table_region_from_object
class FakeTable:
    bbox=(10,70,90,95)
    def extract(self): return [['A','B'],['1','2']]
pdfTableStructure.visible_table_objects=lambda _page:[FakeTable()]
pdfTableStructure.borderless_table_regions=lambda *_args:[]
layout.table_region_from_object=lambda _table,page_number,detection='ruled': {'type':'table','page':page_number,'bbox':[10,70,90,95],'rows':[['A','B'],['1','2']],'spans':[],'cellBoxes':[],'rowCount':2,'columnCount':2,'detection':detection,'needsVisualFallback':False}
try:
    table_candidates=layout.table_regions(page,1,image_candidates,formula_candidates)
    assert len(table_candidates)==1 and table_candidates[0]['rows'][1][1]=='2', table_candidates
finally:
    pdfTableStructure.visible_table_objects=original_visible
    pdfTableStructure.borderless_table_regions=original_borderless
    layout.table_region_from_object=original_region
assert len(image_candidates)==1 and formula_candidates and table_candidates
`;
  await promisify(execFile)(python.command, [...python.args, "-c", `import sys; sys.path.insert(0,sys.argv[1]);\n${script}`, path.resolve("src/adapters")], { windowsHide: true });
});

test("real ruled PDF cells retain horizontal and vertical spans from physical boundaries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pdf-table-grid-"));
  try {
    const source = path.join(root, "merged.pdf");
    const python = await detectPdfLayoutExtractor();
    const script = `import pypdfium2 as p
import pypdfium2.raw as r
import sys
doc=p.PdfDocument.new(); page=doc.new_page(400,400)
for x0,y0,x1,y1 in [(50,300,350,300),(50,150,350,150),(50,150,50,300),(350,150,350,300),
 (250,150,250,300),(150,150,150,200),(50,200,350,200),(250,250,350,250)]:
 obj=r.FPDFPageObj_CreateNewPath(x0,y0);r.FPDFPath_LineTo(obj,x1,y1)
 r.FPDFPageObj_SetStrokeColor(obj,0,0,0,255);r.FPDFPageObj_SetStrokeWidth(obj,1)
 r.FPDFPath_SetDrawMode(obj,0,True);page.insert_obj(p.PdfObject(obj))
for x,y,text in [(60,280,'Merged'),(260,280,'Top'),(260,230,'Second'),(60,180,'A'),(160,180,'B'),(260,180,'C')]:
 obj=r.FPDFPageObj_NewTextObj(doc,b'Helvetica',12)
 import ctypes as c
 data=text.encode('utf-16-le')+b'\\0\\0';buf=(c.c_ushort*(len(data)//2)).from_buffer_copy(data)
 r.FPDFText_SetText(obj,buf);r.FPDFPageObj_Transform(obj,1,0,0,1,x,y);page.insert_obj(p.PdfObject(obj))
page.gen_content();doc.save(sys.argv[1]);page.close();doc.close()
`;
    await promisify(execFile)(python.command, [...python.args, "-c", script, source], { windowsHide: true });
    const result = await extractPdfWithLayout(source);
    const table = result.visualMap.pages[0].regions.find(region => region.type === "table");
    assert.deepEqual(table.spans, [[0,0,2,2]]);
    assert.equal(table.rows[0][0], "Merged");
    assert.equal(table.rows[1][2], "Second");
    assert.deepEqual(table.cellBoxes[0].bbox, [50,100,250,200]);
    assert.match(result.markdown, /"spans":\[\[0,0,2,2\]\]/);
    const ir = buildPdfDocumentIr({ markdown: result.markdown, visualMap: result.visualMap });
    assert.ok(ir.blocks.some(block => block.tableStructure?.spans?.[0]?.[2] === 2));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("mixed-page OCR replaces only requested pages and retains source images and word provenance", () => {
  const layout = { markdown: "# Mixed\n<!-- pdf-page: 1 -->\nNative text\n<!-- pdf-page: 2 -->\n<!-- pdf-image: page=2 index=1 file=scan.png -->\n",
    visualMap: { pageCount: 2, summary: {}, pages: [{ page: 1, regions: [] }, { page: 2, requiresOcr: true, regions: [] }] } };
  mergeOcrPages(layout, { languages: "eng", pages: [{ page: 2, status: "completed", text: "Scanned content",
    words: [{ text: "Scanned", bbox: [10, 20, 50, 30], line: [1, 1, 1], confidence: .95 },
      { text: "content", bbox: [55, 20, 95, 30], line: [1, 1, 1], confidence: .93 }] }] });
  assert.match(layout.markdown, /Native text/);
  assert.equal(layout.markdown.split("Scanned content").length - 1, 1);
  assert.match(layout.markdown, /file=scan.png/);
  assert.equal(layout.visualMap.summary.pendingOcrPages, 0);
  const ir = buildPdfDocumentIr({ markdown: layout.markdown, visualMap: layout.visualMap });
  const block = ir.blocks.find(b => b.text === "Scanned content");
  assert.deepEqual(block.bbox, [10, 20, 95, 30]);
  assert.equal(block.qualitySignals.extractionMethod, "ocr");
});

test("partial OCR and failed visuals remain visible quality gaps", () => {
  const partial = derivePdfPageQuality({
    requiresOcr: true,
    ocr: { status: "partial", text: "some text", regions: [{ status: "unresolved" }] },
    regions: [{ type: "image", assetStatus: "failed" }]
  });
  assert.equal(partial.qualityStatus, "ocr_required");
  assert.ok(partial.issues.includes("ocr_required"));
  assert.ok(partial.issues.includes("visual_render_failed"));
  const complete = derivePdfPageQuality({
    requiresOcr: true,
    ocr: { status: "completed", text: "recognized", regions: [{ status: "completed" }] }
  });
  assert.equal(complete.qualityStatus, "ocr_completed");
  const visualOnly = derivePdfPageQuality({
    requiresOcr: false,
    ocr: { status: "completed", text: "", regions: [{ id: "ocr-1", status: "visual_only" }] },
    regions: [{ type: "image", assetStatus: "rendered", needsVisualFallback: true }]
  });
  assert.equal(visualOnly.qualityStatus, "ocr_review_required");
  assert.equal(visualOnly.ocrReviewRequired, true);
});

test("mixed page OCR preserves native text and appends only new OCR lines", () => {
  const merged = mergeNativeAndOcrText("Native heading\nShared line", "Shared line\nScanned label");
  assert.equal(merged.mode, "native_plus_ocr");
  assert.equal(merged.text, "Native heading\nShared line\nScanned label");
  assert.equal(merged.addedLines, 1);
  const layout = {
    markdown: "<!-- pdf-page: 1 -->\nNative heading\nShared line\n<!-- pdf-image: page=1 index=1 file=scan.png -->\n",
    visualMap: { pageCount: 1, summary: {}, pages: [{ page: 1, requiresOcr: true, regions: [], coordinateOrigin: [3, -2] }] }
  };
  mergeOcrPages(layout, { languages: "eng", pages: [{ page: 1, status: "completed", text: "Shared line\nScanned label",
    words: [{ text: "Scanned", bbox: [10, 20, 50, 30], line: [1, 1, 1], confidence: .95 }] }] });
  assert.equal(layout.markdown.split("Shared line").length - 1, 1);
  assert.match(layout.markdown, /Native heading/);
  assert.match(layout.markdown, /Scanned label/);
  assert.match(layout.markdown, /merge: native_plus_ocr/);
  assert.equal(layout.visualMap.pages[0].ocr.mergeMode, "native_plus_ocr");
  assert.deepEqual(layout.visualMap.pages[0].ocr.words[0].bbox, [13, 18, 53, 28]);
});

function mixedFlowPdf(kind) {
  const lines = [];
  const text = (x,y,t) => lines.push(`BT /F1 10 Tf ${x} ${y} Td (${t}) Tj ET`);
  for (const [section,y] of [["Upper",700],["Lower",390]]) for (let i=0;i<8;i++) {
    text(45,y-i*18,`${section} left paragraph sentence ${i}.`);
    text(330,y-i*18-5,`${section} right paragraph sentence ${i}.`);
  }
  text(45,540,"A full width section heading separates the upper columns from the following material.");
  if (kind === "image") lines.push("q 510 0 0 60 45 440 cm /Im1 Do Q");
  else {
    for (const y of [440,470,500]) lines.push(`45 ${y} m 555 ${y} l S`);
    for (const x of [45,215,385,555]) lines.push(`${x} 440 m ${x} 500 l S`);
    for (const [x,t] of [[55,"District"],[225,"Value"],[395,"Total"]]) text(x,480,t);
    for (const [x,t] of [[55,"East"],[225,"125"],[395,"150"]]) text(x,450,t);
  }
  text(45,422,"The preceding illustration or table belongs between these two sections.");
  text(45,220,"A final full width section changes the remaining page to a single column of text.");
  for (let i=0;i<5;i++) text(45,190-i*18,`Final single column paragraph ${i} continues across the page without a gutter or parallel column.`);
  const content=lines.join("\n");
  const objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 385 >>\nstream\n"+"dd5533".repeat(64)+">\nendstream"];
  let pdf="%PDF-1.4\n";const offsets=[0];
  objects.forEach((object,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;});
  const start=pdf.length;
  return pdf+`xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
}

test("mixed page bands keep columns, spanning images/tables and final single-column prose in source order", async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),"mixed-flow-"));
  try {
    for (const kind of ["image","table"]) {
      const source=path.join(root,`${kind}.pdf`), pdf=mixedFlowPdf(kind);
      await writeFile(source,pdf);
      const options={assetDir:path.join(root,kind),cacheDir:path.join(root,"cache")};
      const result=await extractPdfWithLayout(source,options);
      const md=result.markdown;
      const expected=["Upper left paragraph sentence 7.","Upper right paragraph sentence 0.","Upper right paragraph sentence 7.",
        "A full width section heading",kind==="image"?"<!-- pdf-image:":"| District | Value | Total |",
        "The preceding illustration", "Lower left paragraph sentence 7.","Lower right paragraph sentence 0.",
        "Lower right paragraph sentence 7.","A final full width section", "Final single column paragraph 0", "Final single column paragraph 4"];
      assert.equal(result.visualMap.pages[0].readingOrder.strategy,"segmented_columns",md);
      for(let i=0;i<expected.length;i++) {
        assert.ok(md.includes(expected[i]),md);
        if(i) assert.ok(md.indexOf(expected[i-1])<md.indexOf(expected[i]),md);
      }
      for(const section of ["Upper","Lower"]) for(const side of ["left","right"]) for(let n=0;n<8;n++) {
        assert.equal(md.split(`${section} ${side} paragraph sentence ${n}.`).length-1,1);
      }
      const readable=createReadableMarkdown(md,{sourceType:"pdf",visualMap:result.visualMap});
      const xml=readZipEntry(await exportMarkdownToDocx(readable),"word/document.xml").toString();
      assert.ok(xml.includes("Upper left paragraph sentence 7."));
      assert.ok(xml.indexOf("Upper left paragraph sentence 7.")<xml.indexOf("Upper right paragraph sentence 0."));
      const repeated=Array.from({length:4},(_,i)=>`<!-- pdf-page: ${i+1} -->\nReport header Page ${i+1}\n${md.split("<!-- pdf-page: 1 -->")[1]}`).join("\n");
      const cleaned=createReadableMarkdown(repeated,{sourceType:"pdf"});
      assert.doesNotMatch(cleaned,/Report header Page/);
      assert.equal(cleaned.split("Upper left paragraph sentence 7.").length-1,4);
      if(kind==="image") for(const markdown of [md,md.replace(/<!-- pdf-image:[^>]*file=([^\s]+) -->/g,"![Figure](assets/$1)")]) {
        const ir=buildPdfDocumentIr({markdown,visualMap:result.visualMap});
        const blocks=ir.pages[0].blocks.map(id=>ir.blocks.find(b=>b.id===id));
        const imageIndex=blocks.findIndex(b=>b.assetId);
        assert.ok(imageIndex>blocks.findIndex(b=>b.text.startsWith("A full width section heading")));
        assert.ok(imageIndex<blocks.findIndex(b=>b.text.startsWith("Lower left paragraph sentence 0")));
        assert.equal(blocks.filter(b=>b.type==="image").length,1);
      }
      const resumed=await extractPdfWithLayout(source,options);
      assert.equal(resumed.visualMap.cache.reusedPages,1);
      assert.equal(resumed.markdown,md);
      if(process.env.SCHEMA_DOCS_FLOW_EVIDENCE) {
        const folder=path.resolve(process.env.SCHEMA_DOCS_FLOW_EVIDENCE);await mkdir(folder,{recursive:true});
        await writeFile(path.join(folder,`${kind}.pdf`),pdf);
        await writeFile(path.join(folder,`${kind}.md`),md);
        await writeFile(path.join(folder,`${kind}.json`),JSON.stringify(result.visualMap,null,2));
      }
    }
  } finally {await rm(root,{recursive:true,force:true});}
});

test("cross-page prose reflows only with current source evidence and recomputes after partial cache resume", async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),"page-continuation-"));
  const tail="The long analysis reaches the bottom of this page and explains how";
  const head="the process continues across a physical page boundary without losing its meaning.";
  try {
    const source=path.join(root,"continued.pdf"),python=await detectPdfLayoutExtractor();
    await promisify(execFile)(python.command,[...python.args,"-c",`import sys,ctypes as c
import pypdfium2 as p
import pypdfium2.raw as r
d=p.PdfDocument.new()
for lines in [('An introduction establishes the subject of the report.',sys.argv[2]),(sys.argv[3],'A separate conclusion finishes the second page.')]:
 page=d.new_page(612,792)
 for y,text in zip([730,100],lines):
  obj=r.FPDFPageObj_NewTextObj(d,b'Helvetica',10);data=text.encode('utf-16-le')+b'\\0\\0'
  r.FPDFText_SetText(obj,(c.c_ushort*(len(data)//2)).from_buffer_copy(data))
  r.FPDFPageObj_Transform(obj,1,0,0,1,45,y);page.insert_obj(p.PdfObject(obj))
 page.gen_content();page.close()
d.save(sys.argv[1]);d.close()
`,source,tail,head],{windowsHide:true});
    const options={cacheDir:path.join(root,"cache")};
    const partial=await extractPdfWithLayout(source,{...options,maxPages:1});
    assert.equal(reflowPdfParagraphs(partial.markdown,partial.visualMap).links.length,0);
    const result=await extractPdfWithLayout(source,options);
    assert.equal(result.visualMap.cache.reusedPages,1);
    const reflow=reflowPdfParagraphs(result.markdown,result.visualMap);
    assert.equal(reflow.links.length,1,JSON.stringify(result.visualMap));
    assert.ok(reflow.markdown.includes(tail+" "+head));
    assert.ok(result.markdown.includes("<!-- pdf-page: 2 -->"));
    assert.ok(!result.markdown.includes(tail+" "+head));
    const readable=createReadableMarkdown(result.markdown,{sourceType:"pdf",visualMap:result.visualMap});
    assert.ok((await exportMarkdownToHtml(readable)).includes(tail+" "+head));
    assert.ok(readZipEntry(await exportMarkdownToDocx(readable),"word/document.xml").toString().includes(tail+" "+head));
    const ir=buildPdfDocumentIr({markdown:result.markdown,visualMap:result.visualMap});
    const link=ir.metadata.paragraphContinuations[0];
    assert.ok(ir.blocks.some(b=>b.id===link.fromBlock && b.text===tail));
    assert.ok(ir.blocks.some(b=>b.id===link.toBlock && b.text===head));
    assert.deepEqual(link.sourceRefs.map(r=>r.pageNumber),[1,2]);
    assert.equal(reflowPdfParagraphs(result.markdown.replace(head,"An edited independent paragraph."),result.visualMap).links.length,0);
    const listMap=structuredClone(result.visualMap);listMap.pages[0].paragraphEdges.last.text="- "+tail;
    assert.equal(reflowPdfParagraphs(result.markdown.replace(tail,"- "+tail),listMap).links.length,0);
    for(const change of [p=>p[1].paragraphEdges.first.fontSize=20,p=>p[1].paragraphEdges.first.bbox[1]=400,
      p=>p[0].paragraphEdges.last.bbox=null,p=>p[1].requiresOcr=true]) {
      const map=structuredClone(result.visualMap);change(map.pages);
      assert.equal(reflowPdfParagraphs(result.markdown,map).links.length,0);
    }
    const last=await extractPdfWithLayout(source,{...options,startPage:2,maxPages:1});
    assert.equal(last.visualMap.cache.reusedPages,1);
    assert.equal(reflowPdfParagraphs(last.markdown,last.visualMap).links.length,0);
    if(process.env.SCHEMA_DOCS_FLOW_EVIDENCE) {
      const folder=path.resolve(process.env.SCHEMA_DOCS_FLOW_EVIDENCE);await mkdir(folder,{recursive:true});
      await copyFile(source,path.join(folder,"continued.pdf"));
    }
  } finally {await rm(root,{recursive:true,force:true});}
});

test("cross-page Chinese prose joins without an inserted space and hyphenated Latin words join only with lexical evidence", () => {
  const chineseTail = "这是一段中文正文，它在页面底部结束时没有句号并且语义仍然完整";
  const chineseHead = "继续说明跨页后的处理步骤以及结果，不能把它误判成新的段落";
  const latinTail = "The international analysis reaches the page edge and inter-";
  const latinHead = "national results remain valid after the page break and retain meaning.";
  const page = (number, first, last) => ({
    page: number, width: 600, height: 800, coordinateOrigin: [0, 0],
    paragraphEdges: {
      first: { text: first, bbox: [40, 60, 540, 110], fontSize: 11 },
      last: { text: last, bbox: [40, 720, 540, 780], fontSize: 11 }
    }
  });
  const markdown = [
    "<!-- pdf-page: 1 -->", chineseTail, "<!-- pdf-page: 2 -->", chineseHead,
    "<!-- pdf-page: 3 -->", latinTail, "<!-- pdf-page: 4 -->", latinHead
  ].join("\n");
  const map = { pages: [
    page(1, chineseTail, chineseTail), page(2, chineseHead, chineseHead),
    page(3, latinTail, latinTail), page(4, latinHead, latinHead)
  ] };
  const result = reflowPdfParagraphs(markdown, map);
  assert.equal(result.links.length, 2);
  assert.equal(result.links[0].joinKind, "cjk_continuation");
  assert.equal(result.links[1].joinKind, "hyphenated_word");
  assert.ok(result.markdown.includes(`${chineseTail}${chineseHead}`));
  assert.ok(result.markdown.includes("international analysis reaches the page edge and international results"));
  assert.doesNotMatch(result.markdown, /inter- national/);
});

test("one physical page keeps real prose, a display formula and a ruled table separate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "combined-page-"));
  try {
    const source = path.join(root, "combined.pdf");
    const python = await detectPdfLayoutExtractor();
    const script = `import sys, ctypes as c
import pypdfium2 as p
import pypdfium2.raw as r
doc = p.PdfDocument.new(); page = doc.new_page(500, 620)
def text(font, size, x, y, value):
    obj = r.FPDFPageObj_NewTextObj(doc, font, size)
    data = value.encode('utf-16-le') + b'\\0\\0'
    r.FPDFText_SetText(obj, (c.c_ushort * (len(data) // 2)).from_buffer_copy(data))
    r.FPDFPageObj_Transform(obj, 1, 0, 0, 1, x, y); page.insert_obj(p.PdfObject(obj))
def rule(x0, y0, x1, y1):
    obj = r.FPDFPageObj_CreateNewPath(x0, y0); r.FPDFPath_LineTo(obj, x1, y1)
    r.FPDFPageObj_SetStrokeColor(obj, 0, 0, 0, 255); r.FPDFPageObj_SetStrokeWidth(obj, 1)
    r.FPDFPath_SetDrawMode(obj, 0, True); page.insert_obj(p.PdfObject(obj))
for y, line in [(580, 'The combined acceptance page opens with an ordinary prose sentence.'),
                (562, 'A display formula follows the prose and precedes a ruled table.'),
                (544, 'Reading order keeps all three regions separate and in source order.')]:
    text(b'Helvetica', 11, 40, y, line)
text(b'Symbol', 12, 180, 505, 'x=y+z')
for y in (160, 210, 260, 310): rule(60, y, 400, y)
for x in (60, 230, 400): rule(x, 160, x, 310)
for x, y, value in [(70, 280, 'Region'), (240, 280, 'Count'), (70, 230, 'North'),
                    (240, 230, '17'), (70, 180, 'South'), (240, 180, '23')]:
    text(b'Helvetica', 10, x, y, value)
page.gen_content(); doc.save(sys.argv[1]); page.close(); doc.close()
`;
    await promisify(execFile)(python.command, [...python.args, "-c", script, source], { windowsHide: true });
    const result = await extractPdfWithLayout(source, {
      assetDir: path.join(root, "assets"), cacheDir: path.join(root, "cache")
    });
    const page = result.visualMap.pages[0], md = result.markdown;
    const prose = ["The combined acceptance page opens with an ordinary prose sentence.",
      "A display formula follows the prose and precedes a ruled table.",
      "Reading order keeps all three regions separate and in source order."];
    for (let i = 0; i < prose.length; i++) {
      assert.equal(md.split(prose[i]).length - 1, 1, md);
      if (i) assert.ok(md.indexOf(prose[i - 1]) < md.indexOf(prose[i]), md);
    }
    assert.ok(!page.requiresOcr, JSON.stringify(page.requiresOcr));
    const tables = page.regions.filter(region => region.type === "table");
    assert.equal(tables.length, 1, JSON.stringify(page.regions));
    const table = tables[0];
    assert.deepEqual([table.rowCount, table.columnCount], [3, 2], JSON.stringify(table));
    assert.deepEqual(table.rows, [["Region", "Count"], ["North", "17"], ["South", "23"]], JSON.stringify(table.rows));
    const formulas = page.regions.filter(region => region.type === "formula");
    assert.ok(formulas.length >= 1, JSON.stringify(page.regions));
    for (const formula of formulas) {
      assert.ok(!prose.some(line => String(formula.text || "").includes(line)), JSON.stringify(formula));
      assert.ok(formula.bbox[3] <= table.bbox[1], JSON.stringify({ formula: formula.bbox, table: table.bbox }));
    }
    const ir = buildPdfDocumentIr({ markdown: md, visualMap: result.visualMap });
    assert.ok(ir.blocks.some(block => block.text === prose[0]), JSON.stringify(ir.blocks.map(block => block.type)));
    const tableBlocks = ir.blocks.filter(block => block.tableStructure);
    const tableRows = tableBlocks.filter(block => block.tableStructure.rowIndex !== null)
      .sort((a, b) => a.tableStructure.rowIndex - b.tableStructure.rowIndex);
    assert.deepEqual(tableRows.map(block => block.tableStructure.cells),
      [["Region", "Count"], ["North", "17"], ["South", "23"]],
      JSON.stringify(tableBlocks.map(block => block.tableStructure)));
    assert.deepEqual(tableRows.map(block => block.tableStructure.rowRole), ["header", "row", "row"]);
    assert.deepEqual(tableRows.map(block => block.tableStructure.status), ["structured", "structured", "structured"]);
    assert.equal(new Set(tableBlocks.map(block => block.tableStructure.tableId)).size, 1);
    assert.equal(tableBlocks.filter(block => block.tableStructure.rowRole === "separator").length, 1);
    if (hasBundledPdfRuntime()) {
      const automatic = await runPdfExtractionPipeline(source);
      assert.equal(automatic.extractorName, "pdfplumber");
      assert.equal(automatic.pageLedger.pages.length, 1);
      assert.equal(automatic.markdown, md);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
