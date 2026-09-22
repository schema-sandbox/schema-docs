import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from 'node:os';
import {readdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {extractPdfWithLayout} from '../src/adapters/pdfLayoutExtractor.js';
import {markdownToPdfBuffer} from '../src/adapters/pdfMarkdownConverter.js';
import { runLayoutProcess } from '../src/adapters/pdfLayoutExtractor.js';
import { createPdfPageLedgerFromMarkdown } from "../src/adapters/pdfPageBackend.js";
import { validatePdfConversion } from "../src/adapters/pdfConversionValidation.js";

const python = process.env.SCHEMA_DOCS_PYTHON || path.resolve("runtime/python/python.exe");
const run = script => promisify(execFile)(python, ["-B", "-X", "utf8", "-c", script, path.resolve("src/adapters")], { windowsHide: true });

test("OCR metadata markers retain every physical page and failed status", () => {
  const markdown = "# Book\n<!-- pdf-page: 1; extraction: ocr; languages: eng -->\none\n<!-- pdf-page: 2; extraction: ocr_failed; languages: eng; merge: native -->\ntwo";
  const ledger = createPdfPageLedgerFromMarkdown(markdown, 2);
  assert.deepEqual(ledger.pages.map(p => [p.pageNumber, p.status]), [[1,"completed"],[2,"failed"]]);
  assert.equal(validatePdfConversion({ markdown, pageCount: 2, pageLedger: ledger }).passed, true);
  assert.equal(validatePdfConversion({ markdown, pageCount: 2, pageLedger: { pages: [{pageNumber: null}] } }).passed, false);
});

test("rendered but unreferenced images and backend recoveries fail validation", () => {
  const markdown = "<!-- pdf-page: 1 -->\nText";
  const result = { markdown, pageCount: 1, pageLedger: createPdfPageLedgerFromMarkdown(markdown,1),
    visualMap: {pages:[{page:1,regions:[{type:"image",assetFile:"source.png"}],backendFailure:{backend:"parser"}}]} };
  assert.deepEqual(validatePdfConversion(result).issues.map(i=>i.code), ["backend_recovery","image_reference_missing"]);
});

test("OCR candidate ledger rejects missing, dangling, and unprocessed candidates", () => {
  const base = {
    markdown: "<!-- pdf-page: 1 -->\nText",
    pageCount: 1,
    pageLedger: { pages: [{ pageNumber: 1 }] },
    visualMap: {
      summary: { ocrCandidateCount: 1 },
      pages: [{
        page: 1,
        regions: [],
        ocrRegions: [{ id: "ocr-1", candidateId: "candidate-1" }],
        ocr: { regions: [{ id: "ocr-1", status: "completed" }] },
        ocrCandidateLedger: [{ id: "candidate-1", regionId: "ocr-1", disposition: "queued" }]
      }]
    }
  };
  assert.equal(validatePdfConversion(base).passed, true);
  const missing = structuredClone(base);
  delete missing.visualMap.pages[0].ocrCandidateLedger;
  assert.ok(validatePdfConversion(missing).issues.some(issue => issue.code === "ocr_candidate_ledger_coverage"));
  const dangling = structuredClone(base);
  dangling.visualMap.pages[0].ocrCandidateLedger.push({ id: "candidate-2", disposition: "duplicate", duplicateOf: "missing" });
  assert.ok(validatePdfConversion(dangling).issues.some(issue => issue.code === "ocr_candidate_dangling_duplicate"));
  const unprocessed = structuredClone(base);
  unprocessed.visualMap.pages[0].ocrCandidateLedger.push({ id: "candidate-2", disposition: "requested", regionId: "missing" });
  unprocessed.visualMap.summary.ocrCandidateCount = 2;
  assert.ok(validatePdfConversion(unprocessed).issues.some(issue => issue.code === "ocr_candidate_region_missing"));
  const missingResult = structuredClone(base);
  delete missingResult.visualMap.pages[0].ocr;
  assert.ok(validatePdfConversion(missingResult).issues.some(issue => issue.code === "ocr_candidate_result_missing"));
});

test("OCR candidate ledger rejects unknown dispositions", () => {
  const input = {
    markdown: "<!-- pdf-page: 1 -->\nText",
    pageCount: 1,
    pageLedger: { pages: [{ pageNumber: 1 }] },
    visualMap: {
      summary: { ocrCandidateCount: 1 },
      pages: [{ page: 1, regions: [], ocrCandidateLedger: [
        { id: "candidate-1", disposition: "not_a_valid_disposition" }
      ] }]
    }
  };
  const result = validatePdfConversion(input);
  assert.ok(result.issues.some(issue => issue.code === "ocr_candidate_unknown_disposition"));
  assert.equal(result.passed, false);
});

test("deferred parser opens a saved window after a lightweight first page", async () => {
  await run(`import sys,tempfile,shutil
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import pypdfium2 as p
from pdfPageWindow import PdfPageWindow
with tempfile.TemporaryDirectory() as folder:
 source=Path(folder)/'mixed.pdf'
 doc=p.PdfDocument.new()
 for i in range(3): doc.new_page(200,300).close()
 doc.save(source);doc.close()
 with PdfPageWindow(source,4) as window:
  # A preflight-selected complex first page must not require pdfplumber yet.
  shutil.copyfile(source,window.window_path)
  window.window_start,window.window_end=0,3
  window._window_object_counts=[20001,0,20001]
  window._window_raster_counts=[0,0,0]
  for index,expected in [(0,'PdfiumTextImagePage'),(1,'Page'),(2,'PdfiumTextImagePage')]:
   page=window.get_page(index,3)
   assert type(page).__name__==expected
   page.close()
`);
});

test("complex uncaptioned pages retain a full source image and mutable markers", async () => {
  await run(`import sys,tempfile,ctypes
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import pypdfium2 as p
import pypdfium2.raw as r
from pdfPageWindow import PdfiumTextImagePage
from pdfLayoutExtractor import extract_layout_page
with tempfile.TemporaryDirectory() as folder:
 doc=p.PdfDocument.new();raw=doc.new_page(200,300)
 obj=r.FPDFPageObj_NewTextObj(doc,b'Helvetica',12)
 value='Original body text'.encode('utf-16-le')+b'\\0\\0'
 buf=(ctypes.c_ushort*(len(value)//2)).from_buffer_copy(value)
 r.FPDFText_SetText(obj,buf);r.FPDFPageObj_Transform(obj,1,0,0,1,20,200)
 raw.insert_obj(p.PdfObject(obj));raw.gen_content()
 page=PdfiumTextImagePage(raw,1,20001)
 page.chars[0]['text']='X'
 assert 'X' in page.extract_text()
 result=extract_layout_page(page,1,Path(folder))
 region=next(x for x in result['page']['regions'] if x.get('preserveSourceText'))
 assert region['bbox']==[0,0,200,300],region
 assert region['assetFile'] in result['markdown']
 assert 'body text' in result['markdown']
 assert not region.get('inlinePlaceholder')
 page.close();doc.close()
`);
});

test("OCR commits regions before interruption and reuses only matching results", async () => {
  await run(`import sys
sys.path.insert(0,sys.argv[1])
import pdfRegionOcr as r
requested=[{'id':str(i),'bbox':[0,0,10,10]} for i in range(37)]
calls=[];saved={}
def recognize(engine,image,region,*args):
 calls.append(region['id']);return {**region,'status':'completed','text':region['id'],'words':[]}
r.recognize_region=recognize
def commit(region,*args):
 saved[region['id']]=region
 if len(saved)==13: raise KeyboardInterrupt()
config={'pageRegions':{'1':{'regions':requested}},'_onRegion':commit}
try:r.recognize_page(None,None,1,1,config,10,10)
except KeyboardInterrupt:pass
assert len(saved)==13
config['_cachedRegions']=saved;config['_onRegion']=lambda *args:None
result=r.recognize_page(None,None,1,1,config,10,10)
assert len(calls)==37,len(calls)
assert result['regionsProcessed']==37
assert result['text']=='\\n\\n'.join(str(i) for i in range(37))
`);
});

test('failed empty page caches retry and preserve the failed-page count', async () => {
  await run(`import sys,tempfile,json
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import pypdfium2 as p
import pdfOcrWorker as w
import pdfRegionOcr as r
class Dummy:
 def __init__(self,*a,**k):pass
 def close(self):pass
w.OcrEngine=Dummy
calls=[]
def fail(*a,**k):
 calls.append(1);raise RuntimeError('injected failure')
r.recognize_page=fail
with tempfile.TemporaryDirectory() as temp:
 source=Path(temp)/'test.pdf'
 doc=p.PdfDocument.new();doc.new_page(200,300).close();doc.save(source);doc.close()
 config=dict(source=str(source),library='runtime/tesseract/tesseract55.dll',tessdataDir='runtime/tesseract/tessdata',languages='eng',dpi=120,cacheDir=temp)
 for iteration in range(2):
  result=w.run(config)
  assert len(result['failedPages'])==1
  assert result['cache']['reusedPages']==0
 assert len(calls)==2
`);
});

test('explicit worker memory and task deadlines remain classified interruptions', async () => {
  const args=['-B','-c', "import sys,time;sys.path.insert(0,sys.argv[1]);from pdfResources import ResourceMonitor\nwith ResourceMonitor(max_resident_bytes=1): time.sleep(10)",path.resolve('src/adapters')];
  await assert.rejects(runLayoutProcess({command:python},args), {code:'resource_limit'});
  await assert.rejects(runLayoutProcess({command:process.execPath},['-e','setInterval(()=>{},1000)'],{timeout:100}), {code:'TIMEOUT'});
  await assert.rejects(runLayoutProcess({command:process.execPath},['-e','setInterval(()=>{},1000)'],{maxResidentBytes:1}), {code:'resource_limit'});
});

test('lightweight source preservation follows rotated crop coordinates', async () => {
  await run(`import sys,tempfile,ctypes
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import pypdfium2 as p
import pypdfium2.raw as r
from pdfPageWindow import PdfiumTextImagePage
from pdfLayoutExtractor import extract_layout_page
with tempfile.TemporaryDirectory() as folder:
 for rotation in [0,90,180,270]:
  doc=p.PdfDocument.new();raw=doc.new_page(300,400)
  obj=r.FPDFPageObj_NewTextObj(doc,b'Helvetica',12)
  value='Visible text'.encode('utf-16-le')+b'\\0\\0';buf=(ctypes.c_ushort*(len(value)//2)).from_buffer_copy(value)
  r.FPDFText_SetText(obj,buf);r.FPDFPageObj_Transform(obj,1,0,0,1,70,240)
  raw.insert_obj(p.PdfObject(obj));raw.gen_content();raw.set_cropbox(30,40,270,360);raw.set_rotation(rotation)
  page=PdfiumTextImagePage(raw,rotation+1,20001,1)
  assert page.chars
  assert all(0<=c['x0']<=c['x1']<=page.width and 0<=c['top']<=c['bottom']<=page.height for c in page.chars)
  result=extract_layout_page(page,rotation+1,Path(folder))
  full=next(x for x in result['page']['regions'] if x.get('preserveSourceText'))
  assert full['bbox']==[0,0,page.width,page.height]
  assert full['assetFile'] in result['markdown']
  page.close();doc.close()
`);
});

test('interrupted parser scratch includes and removes its window files', async () => {
  const previous = {TEMP:process.env.TEMP,TMP:process.env.TMP,TMPDIR:process.env.TMPDIR};
  const root=await mkdtemp(path.join(os.tmpdir(),'schema-owned-window-'));
  Object.assign(process.env,{TEMP:root,TMP:root,TMPDIR:root});
  const windows=async()=>new Set((await readdir(os.tmpdir())).filter(name=>/^schema-docs-(?:pdf-layout|page-window)-/.test(name)));
  const before=await windows();
  try {
    const source=path.join(root,'source.pdf');await writeFile(source,markdownToPdfBuffer('source text'));
    await assert.rejects(extractPdfWithLayout(source,{onPageComplete:()=>{throw Object.assign(new Error('cancel'),{code:'job_cancelled'});}}),{code:'job_cancelled'});
    assert.deepEqual([...await windows()].filter(name=>!before.has(name)),[]);
  }finally{
    for(const [key,value] of Object.entries(previous)) {if(value===undefined)delete process.env[key];else process.env[key]=value;}
    await rm(root,{recursive:true,force:true});
  }
});

test('region journals survive a discarded page aggregate and resume only unfinished regions', async () => {
  await run(`import sys,tempfile,json
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import pypdfium2 as p
import pdfOcrWorker as w
import pdfRegionOcr as r
requests=[{'id':str(i),'bbox':[0,0,10,10]} for i in range(37)]
completed=[];interrupt=True
def recognize(engine,image,region,*a):
 if interrupt and region['id']=='13':raise KeyboardInterrupt()
 completed.append(region['id']);return {**region,'status':'completed','text':region['id'],'words':[]}
r.recognize_region=recognize
with tempfile.TemporaryDirectory() as tmp:
 cache=Path(tmp);source=cache/'source.pdf'
 d=p.PdfDocument.new();d.new_page(200,300).close();d.save(source);d.close()
 config={'pageRegions':{'1':{'regions':requests}}}
 with p.PdfDocument(source) as document:
  try:w.process_page(document,None,config,cache,'identity',1,1,120,16000000)
  except KeyboardInterrupt:pass
 assert len(list((cache/'page-000001-regions').glob('*.json')))==13
 assert not (cache/'page-000001.json').exists()
 interrupt=False
 with p.PdfDocument(source) as document:
  payload,reused,*_=w.process_page(document,None,config,cache,'identity',1,1,120,16000000)
 assert reused==13 and len(completed)==37
 assert payload['text']=='\\n\\n'.join(str(i) for i in range(37))
 assert [x['id'] for x in payload['regions']]==[str(i) for i in range(37)]
`);
});
