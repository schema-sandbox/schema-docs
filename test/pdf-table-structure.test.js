import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { detectPdfLayoutExtractor, extractPdfWithLayout } from "../src/adapters/pdfLayoutExtractor.js";
import { buildPdfDocumentIr } from "../src/adapters/pdfDocumentIr.js";
import { exportMarkdownToHtml, exportMarkdownToDocx } from "../src/core/markdownExportPipeline.js";
import { readZipEntry } from "../src/core/zip.js";

async function python(script, ...args) {
  const engine = await detectPdfLayoutExtractor();
  return promisify(execFile)(engine.command, [...engine.args, "-c", `import sys; sys.path.insert(0,sys.argv[1]);\n${script}`,
    path.resolve("src/adapters"), ...args], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
}

test("table topology preserves empty rows/cells and rejects malformed spans before matching words", async () => {
  await python(`from pdfTableStructure import table_grid, otsl_table_grid, assign_table_words
g=otsl_table_grid(['ched','lcel','ched','nl','ucel','xcel','ecel','nl','ecel','ecel','ecel','nl'])
assert g['spans']==[[0,0,2,2]],g
assert len(g['rows'])==3 and len(g['cellBoxes'])==6,g
assert all(c=='' for row in g['rows'] for c in row),g
for bad in [['lcel','nl'],['fcel','xcel','nl'],['fcel','nl','ecel','ecel','nl'],['ecel'],['unknown','nl'],['fcel','lcel','nl','ucel','ecel','nl']]:
 assert otsl_table_grid(bad) is None,bad
assert table_grid(2,2,[{'row':0,'column':0,'rowSpan':2,'columnSpan':2},{'row':1,'column':1}]) is None
assert table_grid(1000000,2,[]) is None
g=table_grid(2,2,[{'row':r,'column':c,'bbox':[c*100,r*50,(c+1)*100,(r+1)*50]} for r in range(2) for c in range(2)])
assert assign_table_words(g,[{'text':'A','x0':5,'top':5,'x1':15,'bottom':15},{'text':'B','x0':105,'top':55,'x1':115,'bottom':65}])
assert g['rows']==[['A',''],['','B']],g
assert not assign_table_words(g,[{'text':'straddles','x0':90,'top':5,'x1':110,'bottom':15}])
assert not assign_table_words(g,[{'text':'outside','x0':250,'top':5,'x1':260,'bottom':15}])
# Unordered source words and a tall merged cell must remain assignable while
# moving between rows; a rejected assignment must leave existing text intact.
g=table_grid(3,2,[{'row':0,'column':0,'rowSpan':3,'bbox':[0,0,90,150]}]+[{'row':r,'column':1,'bbox':[100,r*50,190,(r+1)*50]} for r in range(3)])
words=[{'text':str(r),'x0':105,'top':r*50+5,'x1':120,'bottom':r*50+15} for r in [2,0,1]]
words.append({'text':'tall','x0':5,'top':5,'x1':20,'bottom':145})
assert assign_table_words(g,words) and g['rows']==[['tall','0'],['','1'],['','2']],g
assert not assign_table_words(g,words+[{'text':'x'*2001,'x0':130,'top':110,'x1':150,'bottom':120}])
assert g['rows']==[['tall','0'],['','1'],['','2']],g
`);
});

// Different layout, font size, alignments, labels and values from the earlier
// model experiment. These fixtures go through automatic full-page extraction.
const fixture = `import ctypes as c
import pypdfium2 as p
import pypdfium2.raw as raw
doc=p.PdfDocument.new()
def text(page,x,y,value,size=11):
 obj=raw.FPDFPageObj_NewTextObj(doc,b'Helvetica',size)
 data=value.encode('utf-16-le')+b'\\0\\0';buf=(c.c_ushort*(len(data)//2)).from_buffer_copy(data)
 raw.FPDFText_SetText(obj,buf);raw.FPDFPageObj_Transform(obj,1,0,0,1,x,700-y);page.insert_obj(p.PdfObject(obj))
for mode in ['plain','merged','negative','matrix']:
 page=doc.new_page(580,700)
 text(page,40,40,'An independent quarterly report.',13)
 text(page,40,85,'Table 7. Regional results' if mode!='negative' else 'Ordinary paragraph',12)
 if mode in ('plain','merged'):
  if mode=='plain':
   for x,value in [(60,'District'),(187,'Income'),(297,'Cost'),(405,'Profit')]: text(page,x,140,value)
  else:
   text(page,60,154,'District');text(page,235,140,'Forecast');text(page,405,154,'Actual')
   text(page,191,168,'2028');text(page,301,168,'2029')
  start=196 if mode=='merged' else 168
  data=[['West Bay','105.2','48','57.2'],['Old Town','92.5','','54.5'],['Lake City','','45','75'],['Hill View','80','21','59']]
  for r,row in enumerate(data):
   for x,value in zip([60,191,301,411],row):
    if value: text(page,x,start+r*28,value)
 elif mode=='matrix':
  for x,value in [(60,'x'),(191,'y'),(301,'z')]: text(page,x,140,value)
  for r in range(4):
   for x,value in [(60,'a'),(191,str(r+1)),(301,str(r+2))]: text(page,x,168+r*28,value)
 else:
  for r,line in enumerate(['The report describes several towns and their history.',
    'Figures in ordinary prose have no aligned table columns.',
    'A sentence with 25 and 48 keeps its original reading order.',
    'Preserve every sentence exactly once.']):text(page,40,140+r*24,line)
 text(page,40,440,'This concluding paragraph must remain outside the table.',11)
 page.gen_content();page.close()
doc.save(sys.argv[2]);doc.close()
`;

test("automatic borderless extraction retains empty cells, multi-level headers and surrounding prose through exports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "borderless-table-"));
  try {
    const source = path.join(root, "report.pdf");
    await python(fixture, source);
    await python(`import pdfplumber
from pdfTableStructure import borderless_table_regions
with pdfplumber.open(sys.argv[2]) as doc:
 assert not borderless_table_regions(doc.pages[0],1,[[50,100,480,320]])
 assert len(borderless_table_regions(doc.pages[0],1,[[10,10,30,30]]))==1
`, source);
    const result = await extractPdfWithLayout(source);
    const pages = result.visualMap.pages;
    const simple = pages[0].regions.filter(r => r.type === "table");
    assert.equal(simple.length, 1);
    assert.equal(simple[0].detection, "borderless_alignment");
    assert.equal(simple[0].rowCount, 5);
    assert.equal(simple[0].columnCount, 4);
    assert.deepEqual(simple[0].rows[2], ["Old Town", "92.5", "", "54.5"]);
    assert.deepEqual(simple[0].rows[3], ["Lake City", "", "45", "75"]);
    assert.equal(simple[0].cellBoxes.length, 20);
    const merged = pages[1].regions.find(r => r.type === "table");
    assert.ok(merged, result.markdown);
    assert.deepEqual(merged.spans, [[0,0,2,1],[0,1,1,2],[0,3,2,1]]);
    assert.equal(merged.rows[1][1], "2028");
    assert.equal(merged.rows[2][0], "West Bay");
    assert.equal(pages[2].regions.filter(r => r.type === "table").length, 0);
    assert.ok(!pages[3].regions.some(r => r.detection === "borderless_alignment"));
    assert.equal(result.markdown.split("Preserve every sentence exactly once.").length-1, 1);
    assert.equal(result.markdown.split("This concluding paragraph must remain outside the table.").length-1, 4);
    assert.equal(result.markdown.split("West Bay").length-1, 2);
    const ir = buildPdfDocumentIr({ markdown: result.markdown, visualMap: result.visualMap });
    assert.ok(ir.blocks.some(b => b.tableStructure?.spans?.some(([r,c,rs,cs]) => r===0 && c===1 && rs===1 && cs===2)));
    const html = await exportMarkdownToHtml(result.markdown);
    assert.match(html, /colspan="2">Forecast/);
    assert.match(html, /rowspan="2">District/);
    const xml = readZipEntry(await exportMarkdownToDocx(result.markdown), "word/document.xml").toString();
    assert.match(xml, /w:gridSpan w:val="2"/);
    assert.match(xml, /w:vMerge w:val="restart"/);
    assert.equal((xml.match(/>West Bay<\/w:t>/g) || []).length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("filled header fragments never become grid lines and partial rules retain merged headers",async()=>{
  await python(`from PIL import Image,ImageDraw
from pdfTableStructure import scanned_table_grid,visible_table_objects
import pypdfium2 as p,pypdfium2.raw as r,pdfplumber,tempfile,pathlib
im=Image.new('RGB',(1000,1400),'white');draw=ImageDraw.Draw(im)
xs=[80,210,340,470,600,730,860];ys=[200,250,350,430,510,590,670]
for y in [ys[0],*ys[2:]]:draw.line((xs[0],y,xs[-1],y),fill='black',width=3)
draw.line((xs[4],ys[1],xs[-1],ys[1]),fill='black',width=3)
for x in xs:draw.line((x,ys[1] if x==xs[5] else ys[0],x,ys[-1]),fill='black',width=3)
g=scanned_table_grid(im,None)
assert g and (g['rowCount'],g['columnCount'])==(6,6),g
assert g['spans']==[[0,0,2,1],[0,1,2,1],[0,2,2,1],[0,3,2,1],[0,4,1,2]],g
im.close()
d=p.PdfDocument.new();page=d.new_page(600,800)
def rect(x,y,w,h,red,green,blue):
 obj=r.FPDFPageObj_CreateNewRect(x,y,w,h);r.FPDFPageObj_SetFillColor(obj,red,green,blue,255)
 r.FPDFPath_SetDrawMode(obj,2,False);page.insert_obj(p.PdfObject(obj))
for col in range(3):
 rect(40+col*170,650,170,100,140,179,226)
 rect(40+col*170,662,170,24,140,179,226)
 rect(40+col*170,704,170,22,140,179,226)
for x in (40,210,380,550):rect(x,450,1,300,0,0,0)
for y in (450,550,650,750):rect(40,y,510,1,0,0,0)
page.gen_content();page.close()
with tempfile.TemporaryDirectory() as temp:
 file=pathlib.Path(temp)/'fill.pdf';d.save(file)
 with pdfplumber.open(file) as doc:
  tables=visible_table_objects(doc.pages[0])
  assert len(tables)==1 and len(tables[0].rows)==3 and len(tables[0].columns)==3,[(len(t.rows),len(t.columns),t.bbox) for t in tables]
  assert len(doc.pages[0].find_tables()[0].rows)>3
 d.close()
`);
});
