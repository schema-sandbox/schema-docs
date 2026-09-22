import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,copyFile,writeFile,rm} from "node:fs/promises";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import os from "node:os";
import path from "node:path";
import {detectPdfLayoutExtractor,extractPdfWithLayout} from "../src/adapters/pdfLayoutExtractor.js";
import {buildPdfDocumentIr} from "../src/adapters/pdfDocumentIr.js";
import {reflowPdfTables} from "../src/processing/tableStructure.js";
import {pdfPageFlowContext} from "../src/processing/pageNoise.js";
import {createReadableMarkdown,reflowPdfParagraphs} from "../src/core/readableMarkdown.js";
import {exportMarkdownToHtml,exportMarkdownToDocx} from "../src/core/markdownExportPipeline.js";
import {readZipEntry} from "../src/core/zip.js";

const fixture = `import sys,ctypes as c
import pypdfium2 as p
import pypdfium2.raw as r
d=p.PdfDocument.new()
def text(page,x,y,value,size=10):
 obj=r.FPDFPageObj_NewTextObj(d,b'Helvetica',size);data=value.encode('utf-16-le')+b'\\0\\0'
 r.FPDFText_SetText(obj,(c.c_ushort*(len(data)//2)).from_buffer_copy(data))
 r.FPDFPageObj_Transform(obj,1,0,0,1,x,y);page.insert_obj(p.PdfObject(obj))
def line(page,x,y,x2,y2):
 obj=r.FPDFPageObj_CreateNewPath(x,y);r.FPDFPath_LineTo(obj,x2,y2)
 r.FPDFPageObj_SetStrokeColor(obj,0,0,0,255);r.FPDFPageObj_SetStrokeWidth(obj,1)
 r.FPDFPath_SetDrawMode(obj,0,True);page.insert_obj(p.PdfObject(obj))
for n in range(1,7):
 page=d.new_page(612,792)
 text(page,45,770,'Quarterly inventory',9);text(page,45,25,'Report page '+str(n),9)
 if n<=3:
  top,bottom,count=[(245,90,5),(700,90,12),(700,550,5)][n-1]
  text(page,45,top+18,'Table 1: Inventory'+(' (continued)' if n>1 else ''))
  xs=[45,230,385,565];ys=[top-(top-bottom)*i/count for i in range(count+1)]
  for y in ys: line(page,45,y,565,y)
  for x in xs:
   if n==2 and x==385:
    line(page,x,ys[0],x,ys[1]);line(page,x,ys[2],x,ys[-1])
   else: line(page,x,top,x,bottom)
  for row in range(count):
   cells=['Region','Items','Total'] if row==0 else ['Area '+str(n)+str(row),str(row*17),str(row*29)]
   if n==2 and row==1: cells=['Area 21','Merged value','']
   for x,value in zip(xs,cells): text(page,x+8,ys[row]-18,value)
  if n==1: text(page,45,700,'A regional inventory follows.')
  if n==3: text(page,45,500,'The inventory is complete.')
 else:
  first=['An introduction establishes the subject of the analysis.',
   'the process continues across the page boundary without losing its meaning.',
   'the remaining evidence supports the same cautious conclusion.'][n-4]
  last=['The long analysis reaches the bottom of this page and explains how',
   'Another independent paragraph reaches the lower page margin and shows how',
   'A separate conclusion finishes the final page.'][n-4]
  text(page,45,700,first);text(page,45,400,'Repeated body line belongs to the report.');text(page,45,90,last)
 page.gen_content();page.close()
d.save(sys.argv[1]);d.close()
`;

test("source geometry links continued tables and prose across verified page furniture, including resumed pages",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"pdf-page-structure-"));
  try {
    const python=await detectPdfLayoutExtractor(),source=path.join(root,"report.pdf");
    await promisify(execFile)(python.command,[...python.args,"-c",fixture,source],{windowsHide:true});
    const options={cacheDir:path.join(root,"cache")};
    const partial=await extractPdfWithLayout(source,{...options,maxPages:2});
    assert.equal(reflowPdfTables(partial.markdown,partial.visualMap).links.length,0);
    const result=await extractPdfWithLayout(source,options);
    assert.equal(result.visualMap.cache.reusedPages,2);
    const context=pdfPageFlowContext(result.markdown,result.visualMap);
    assert.equal(context.furniture.length,12,JSON.stringify(result.visualMap));
    const tables=reflowPdfTables(result.markdown,result.visualMap);
    assert.equal(tables.links.length,2,tables.markdown);
    assert.equal(tables.markdown.split('| Region | Items | Total |').length-1,1);
    assert.match(tables.markdown,/"spans":\[\[5,1,1,2\]\]/);
    const prose=reflowPdfParagraphs(result.markdown,result.visualMap);
    assert.equal(prose.links.length,2,JSON.stringify(result.visualMap));
    assert.match(prose.markdown,/explains how the process continues across the page boundary/);
    const readable=createReadableMarkdown(result.markdown,{sourceType:"pdf",visualMap:result.visualMap});
    assert.doesNotMatch(readable,/Quarterly inventory|Report page/);
    assert.equal(readable.split('Repeated body line belongs to the report.').length-1,3);
    const html=await exportMarkdownToHtml(readable);
    assert.equal((html.match(/<table>/g)||[]).length,1);
    assert.match(html,/colspan="2"/);
    const docx=await exportMarkdownToDocx(readable),xml=readZipEntry(docx,'word/document.xml').toString();
    assert.equal((xml.match(/<w:tbl>/g)||[]).length,1);
    assert.match(xml,/w:gridSpan w:val="2"/);
    assert.match(xml,/explains how the process continues across the page boundary/);
    for(const word of ['Area 11','Area 24','Area 211','Area 34','Merged value']) assert.ok(xml.includes(word));
    const ir=buildPdfDocumentIr({markdown:result.markdown,visualMap:result.visualMap});
    assert.equal(ir.metadata.tableContinuations.length,2);
    assert.equal(ir.metadata.pageFurniture.length,12);
    assert.equal(ir.metadata.paragraphContinuations.length,2);
    for(const link of ir.metadata.tableContinuations) {
      assert.ok(ir.blocks.find(b=>b.id===link.fromBlock)?.tableStructure);
      assert.ok(ir.blocks.find(b=>b.id===link.toBlock)?.tableStructure);
      assert.deepEqual(link.sourceRefs.map(r=>r.pageNumber),[link.fromPage,link.toPage]);
    }
    assert.equal(result.markdown.split('| Region | Items | Total |').length-1,3);
    assert.match(result.markdown,/Report page 6/);
    const changed=result.markdown.replace('Area 21','User edited row');
    assert.equal(reflowPdfTables(changed,result.visualMap).links.length,0);
    assert.match(createReadableMarkdown(changed,{sourceType:'pdf',visualMap:result.visualMap}),/User edited row/);
    for(const mutate of [
      map=>map.pages[1].regions.find(r=>r.type==='table').cellBoxes[0].bbox[0]+=10,
      map=>map.pages[1].regions.find(r=>r.type==='table').bbox=null,
      map=>map.pages[1].requiresOcr=true,
      map=>map.pages[1].regions.push(structuredClone(map.pages[1].regions.find(r=>r.type==='table')))
    ]) {const map=structuredClone(result.visualMap);mutate(map);assert.equal(reflowPdfTables(result.markdown,map).links.length,0);}
    const editedHeader=result.markdown.replace('Quarterly inventory','New independent heading');
    assert.match(createReadableMarkdown(editedHeader,{sourceType:'pdf',visualMap:result.visualMap}),/New independent heading/);
    const inserted=result.markdown.replace('<!-- pdf-page: 2 -->','<!-- pdf-page: 2 -->\n## Another table');
    assert.equal(reflowPdfTables(inserted,result.visualMap).links.some(l=>l.fromPage===1),false);
    const cut=await extractPdfWithLayout(source,{...options,startPage:3,maxPages:1});
    assert.equal(reflowPdfTables(cut.markdown,cut.visualMap).links.length,0);
    if(process.env.SCHEMA_DOCS_STRUCTURE_EVIDENCE) {
      const folder=path.resolve(process.env.SCHEMA_DOCS_STRUCTURE_EVIDENCE);await mkdir(folder,{recursive:true});
      await copyFile(source,path.join(folder,'report.pdf'));
      await writeFile(path.join(folder,'canonical.md'),result.markdown);
      await writeFile(path.join(folder,'readable.md'),readable);
      await writeFile(path.join(folder,'document.docx'),docx);
      await writeFile(path.join(folder,'map.json'),JSON.stringify(result.visualMap,null,2));
      await writeFile(path.join(folder,'ir.json'),JSON.stringify(ir,null,2));
    }
  } finally {await rm(root,{recursive:true,force:true});}
});

test("multi-level table continuation keeps spans and shifted origins, rejecting stale or incompatible structure",()=>{
  const table=(page)=>{
    const rows=[['Region','Quarter',''],['','Count','Cost'],['East','25','80'],['West','30','95']];
    const spans=[[0,0,2,1],[0,1,1,2]],xs=[79,249,404,604],top=page===1?511:31;
    const cellBoxes=[];
    for(let r=0;r<4;r++) for(let c=0;c<3;c++) {
      if((r===0 && c===2)||(r===1 && c===0)) continue;
      const rs=r===0&&c===0?2:1,cs=r===0&&c===1?2:1;
      cellBoxes.push({row:r,column:c,rowSpan:rs,columnSpan:cs,bbox:[xs[c],top+r*42,xs[c+cs],top+(r+rs)*42]});
    }
    return {type:'table',inlinePlaceholder:true,rows,spans,headerRowCount:2,cellBoxes,bbox:[xs[0],top,xs[3],top+168]};
  };
  const map={pages:[1,2].map(page=>({page,width:612,height:792,coordinateOrigin:[39,-39],regions:[table(page)]}))};
  const md=map.pages.map(p=>`<!-- pdf-page: ${p.page} -->\n<!-- schema-table: ${JSON.stringify({v:1,rows:4,cols:3,spans:p.regions[0].spans})} -->\n| Region | Quarter |  |\n| --- | --- | --- |\n|  | Count | Cost |\n| East | 25 | 80 |\n| West | 30 | 95 |`).join('\n\n');
  const ambiguous=reflowPdfTables(md,map);
  assert.equal(ambiguous.links.length,0);
  assert.equal(ambiguous.decisions[0].reason,'table_identity_unproven');
  const identified=md.replace('<!-- pdf-page: 1 -->','<!-- pdf-page: 1 -->\nTable 7: Regional data')
    .replace('<!-- pdf-page: 2 -->','<!-- pdf-page: 2 -->\nTable 7 (continued)');
  const result=reflowPdfTables(identified,map);
  assert.equal(result.links.length,1);
  assert.equal(result.links[0].headerRows,2);
  assert.equal(result.markdown.split('| East | 25 | 80 |').length-1,2);
  assert.equal(result.markdown.split('|  | Count | Cost |').length-1,1);
  assert.match(result.markdown,/"rows":6,"cols":3,"spans":\[\[0,0,2,1\],\[0,1,1,2\]\]/);
  for(const mutate of [
    m=>delete m.pages[1].regions[0].headerRowCount,
    m=>m.pages[1].regions[0].rows[0][1]='Different header',
    m=>m.pages[1].coordinateOrigin[0]=NaN,
    m=>m.pages[1].regions[0].cellBoxes.pop(),
    m=>m.pages[1].regions[0].bbox[1]=300,
    m=>m.pages[1].regions[0].needsVisualFallback=true
  ]) {const invalid=structuredClone(map);mutate(invalid);assert.equal(reflowPdfTables(identified,invalid).links.length,0);}
  assert.equal(reflowPdfTables('```markdown\n'+identified+'\n```',map).links.length,0);
  assert.equal(reflowPdfTables(identified+'\n'+identified,map).links.length,0);
});

test("page furniture requires current edge coordinates and multiple pages; similar body text stays intact",()=>{
  const map={pages:[1,2,3,4].map(page=>({page,width:600,height:800,paragraphEdges:{margins:[
    {text:`Report page ${page}`,fontSize:9,bbox:[40,760,110,770],position:'bottom'}
  ]}}))};
  const md=map.pages.map(p=>`<!-- pdf-page: ${p.page} -->\nRepeated ordinary paragraph number ${p.page}.\n\nReport page ${p.page}`).join('\n');
  const context=pdfPageFlowContext(md,map);
  assert.equal(context.furniture.length,4);
  const readable=createReadableMarkdown(md,{sourceType:'pdf',visualMap:map});
  assert.doesNotMatch(readable,/Report page/);
  assert.equal(readable.split('Repeated ordinary paragraph').length-1,4);
  const changed=structuredClone(map);changed.pages.forEach(p=>p.paragraphEdges.margins[0].bbox=[40,400,110,410]);
  assert.equal(pdfPageFlowContext(md,changed).furniture.length,0);
  assert.equal(pdfPageFlowContext(md.replaceAll('Report page','Edited footer'),map).furniture.length,0);
  assert.equal(pdfPageFlowContext(md.split('<!-- pdf-page: 3 -->')[0],map).furniture.length,0);
  const duplicate=md.replace('Report page 1','Report page 1\nReport page 1');
  assert.equal(pdfPageFlowContext(duplicate,map).furniture.some(f=>f.sourceRefs[0].pageNumber===1),false);
});

test("only explicit page numbers vary inside removable page furniture",()=>{
  for(const [label,removed] of [
    [n=>`Invoice ${1000+n}`,false],[n=>`Contract AB-${1000+n}`,false],
    [n=>`2026-09-${20+n}`,false],[n=>`Amount due: ${n*100} USD`,false],
    [n=>`Report page ${n+12} of 80`,true],[n=>`第 ${n} 页，共 4 页`,true],
    [n=>String(n+52),true],[n=>`Page ${n*2}`,false],[n=>String(n*100),false],
    [()=>"Annual report 2026",true]
  ]) {
    const map={pages:[1,2,3,4].map(page=>({page,width:600,height:800,paragraphEdges:{margins:[
      {text:label(page),fontSize:9,bbox:[40,760,180,770],position:'bottom'}
    ]}}))};
    const md=map.pages.map(p=>`<!-- pdf-page: ${p.page} -->\nBody ${p.page}.\n\n${label(p.page)}`).join('\n');
    assert.equal(pdfPageFlowContext(md,map).furniture.length,removed?4:0,label(1));
    const readable=createReadableMarkdown(md,{sourceType:'pdf',visualMap:map});
    if(!removed) for(const p of map.pages) assert.ok(readable.includes(label(p.page)),label(p.page));
  }
  for(const prefix of ['Invoice','Contract','Amount due:']) {
    const lines=[1,2,3,4].map(n=>`${prefix} ${1000+n}`);
    const readable=createReadableMarkdown(lines.join('\n\n'),{sourceType:'pdf'});
    for(const line of lines) assert.ok(readable.includes(line));
  }
});

test("closing summaries stop table continuation without blocking a final continued table",()=>{
  const make=(endings,merged=false,identified=false)=>{
    const pages=endings.map((label,i)=>{
      const rows=[['Item','Quantity','Total'],['Detail','1','10'],[label,'2','20']],top=i?70:550;
      const spans=merged?[[2,0,1,2]]:[];
      if(merged) rows[2][1]='';
      const cellBoxes=[];
      for(let r=0;r<3;r++) for(let c=0;c<3;c++) {
        if(merged && r===2 && c===1) continue;
        const width=merged && r===2 && c===0?2:1;
        cellBoxes.push({row:r,column:c,rowSpan:1,columnSpan:width,bbox:[40+c*170,top+r*60,40+(c+width)*170,top+(r+1)*60]});
      }
      return {page:i+1,width:600,height:800,regions:[{type:'table',inlinePlaceholder:true,rows,spans,cellBoxes,bbox:[40,top,550,top+180]}]};
    });
    const md=pages.map(p=>{
      const t=p.regions[0],rows=t.rows.map(r=>`| ${r.join(' | ')} |`);
      rows.splice(1,0,'| --- | --- | --- |');
      return `<!-- pdf-page: ${p.page} -->\n`+(identified?`Table 2${p.page===2?' (continued)':': Items'}\n`:'')+(merged?`<!-- schema-table: ${JSON.stringify({v:1,rows:3,cols:3,spans:t.spans})} -->\n`:'')+rows.join('\n');
    }).join('\n\n');
    return reflowPdfTables(md,{pages});
  };
  for(const label of ['Total','Grand total','Subtotal','Total (USD)','合计','总计：','本页小计','總計']) {
    for(const merged of [false,true]) {
      const result=make([label,label],merged);
      assert.equal(result.links.length,0,label);
      assert.equal(result.markdown.split('| Item | Quantity | Total |').length-1,2,label);
    }
  }
  assert.equal(make(['Detail 2','Total']).links.length,0);
  assert.equal(make(['Detail 2','Detail 3']).links.length,0);
  assert.equal(make(['Detail 2','Total'],false,true).links.length,1);
  assert.equal(make(['Detail 2','Detail 3'],false,true).links.length,1);
});

test("PDF business identifiers and complete independent tables survive reading and Word export",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'pdf-content-boundaries-'));
  try {
    const python=await detectPdfLayoutExtractor();
    for(const kind of ['identifiers','tables']) {
      const source=path.join(root,kind+'.pdf');
      const script=fixture.slice(0,fixture.indexOf('for n in range'))+`
for n in range(1,4):
 page=d.new_page(612,792)
 if sys.argv[2]=='identifiers':
  text(page,45,760,'Invoice '+str(1000+n))
  text(page,45,650,'Customer: '+['Alpha','Beta','Gamma'][n-1])
  text(page,45,620,'Amount due: '+str(n*100)+' USD')
 else:
  text(page,45,760,'Sales summary')
  xs=[45,230,385,565];ys=[700-610*i/14 for i in range(15)]
  for y in ys: line(page,45,y,565,y)
  for x in xs: line(page,x,700,x,90)
  for row in range(14):
   cells=['Item','Quantity','Amount'] if row==0 else (['Total','12','780'] if row==13 else ['Batch '+str(n)+' item '+str(row),'1',str(row*10)])
   for x,value in zip(xs,cells): text(page,x+8,ys[row]-18,value)
 page.gen_content();page.close()
d.save(sys.argv[1]);d.close()
`;
      await promisify(execFile)(python.command,[...python.args,'-c',script,source,kind],{windowsHide:true});
      const result=await extractPdfWithLayout(source);
      const readable=createReadableMarkdown(result.markdown,{sourceType:'pdf',visualMap:result.visualMap});
      const ir=buildPdfDocumentIr({markdown:result.markdown,visualMap:result.visualMap});
      const html=await exportMarkdownToHtml(readable),docx=await exportMarkdownToDocx(readable);
      const xml=readZipEntry(docx,'word/document.xml').toString();
      if(kind==='identifiers') {
        assert.equal(ir.metadata.pageFurniture.length,0);
        for(const n of [1001,1002,1003]) for(const text of [result.markdown,readable,html,xml]) assert.ok(text.includes(`Invoice ${n}`));
      } else {
        assert.equal(result.visualMap.pages.flatMap(p=>p.regions.filter(r=>r.type==='table')).length,3);
        assert.equal(ir.metadata.tableContinuations.length,0);
        assert.equal((html.match(/<table>/g)||[]).length,3);
        assert.equal((xml.match(/<w:tbl>/g)||[]).length,3);
        for(const page of [1,2,3]) for(const row of Array.from({length:12},(_,i)=>i+1)) assert.ok(xml.includes(`Batch ${page} item ${row}`));
      }
    }
  } finally {await rm(root,{recursive:true,force:true});}
});
