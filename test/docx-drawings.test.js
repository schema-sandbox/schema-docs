import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { preserveDocxDrawings } from "../src/adapters/docxXmlStructure.js";
import { detectPdfLayoutExtractor } from "../src/adapters/pdfLayoutExtractor.js";
import { docxMarkdownConverter, docxDocumentXmlToMarkdown } from "../src/adapters/docxMarkdownConverter.js";
import { convertDocumentToMarkdownAsJob } from "../src/core/documents.js";
import { openOrCreateWorkspace, readManifest } from "../src/core/manifest.js";
import { importFileToWorkspace } from "../src/core/records.js";
import { exportMarkdownToDocx, exportMarkdownToHtml } from "../src/core/markdownExportPipeline.js";
import { listZipEntries } from "../src/core/zip.js";
import { buildZip } from "./helpers/zipBuilder.js";

function drawingXml(preset = "rect") {
  return `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
 xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
 <w:body><w:p><w:r><w:t>Before drawing.</w:t></w:r><w:r><w:drawing><wp:inline>
 <wp:extent cx="914400" cy="457200"/><a:graphic><a:graphicData><wpg:wgp><wpg:grpSpPr>
 <a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/>
 <a:chOff x="12700" y="25400"/><a:chExt cx="914400" cy="457200"/></a:xfrm>
 </wpg:grpSpPr><wps:wsp><wps:spPr><a:xfrm rot="5400000"><a:off x="139700" y="101600"/>
 <a:ext cx="254000" cy="127000"/></a:xfrm><a:prstGeom prst="${preset}"/>
 <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:ln><a:noFill/></a:ln>
 </wps:spPr></wps:wsp></wpg:wgp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>
 <w:r><w:t>After drawing.</w:t></w:r></w:p></w:body></w:document>`;
}

test("DrawingML retains group coordinates, rotation and fill in real pixels and export assets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "word-drawing-"));
  try {
    const media = new Map();
    const result = await preserveDocxDrawings(drawingXml(), { assetDir: root, assetRelativeBase: "assets" }, media);
    assert.equal(result.rendered, 1, JSON.stringify(result));
    assert.equal(result.failed, 0);
    const asset = path.join(root, result.details[0].file);
    const python = await detectPdfLayoutExtractor();
    await promisify(execFile)(python.command, [...python.args, "-c", `from PIL import Image
import sys
im=Image.open(sys.argv[1]).convert('RGB')
assert im.size==(228,120),im.size
assert im.getpixel((66,39))==(255,0,0),im.getpixel((66,39))
assert im.getpixel((39,39))==(255,255,255),im.getpixel((39,39))
assert im.getpixel((66,9))==(255,0,0),im.getpixel((66,9))
assert im.getpixel((66,78))==(255,255,255),im.getpixel((66,78))`, asset], { windowsHide: true });
    const markdown = `![Preserved drawing](<${path.basename(asset)}>)`;
    const exported = await exportMarkdownToDocx(markdown, { baseDir: root });
    assert.ok(listZipEntries(exported).some(entry => /^word\/media\/.+\.png$/.test(entry.fileName)));
    assert.match(await exportMarkdownToHtml(markdown, { baseDir: root }), /src="data:image\/png;base64,/);
    assert.match(result.xml, /Before drawing\./);
    assert.match(result.xml, /After drawing\./);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unsupported drawing geometry keeps the original XML and is not counted as rendered", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "word-drawing-failed-"));
  try {
    const xml = drawingXml("unsupported-shape"), media = new Map();
    const result = await preserveDocxDrawings(xml, { assetDir: root }, media);
    assert.equal(result.rendered, 0);
    assert.equal(result.failed, 1);
    assert.equal(result.xml, xml);
    assert.equal(media.size, 0);
    assert.match(result.details[0].reason, /drawing_preset_not_supported/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("document jobs persist Word visual preservation and block automatic AI readiness", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "word-drawing-job-"));
  try {
    await openOrCreateWorkspace(root);
    const source = path.join(root, "drawing.docx");
    await writeFile(source, buildZip([{ name: "word/document.xml", content: drawingXml() }]));
    const record = await importFileToWorkspace(root, source);
    const job = await convertDocumentToMarkdownAsJob(root, record.id, docxMarkdownConverter);
    assert.equal(job.status, "succeeded", JSON.stringify(job));
    const document = (await readManifest(root)).documents.find(item => item.id === record.id);
    assert.equal(document.extractionQuality.visualFallbackRegions, 1);
    const body = await readFile(document.outputMarkdownPath, "utf8");
    assert.match(body, /drawing-[a-f0-9]+\.png/);
    assert.doesNotMatch(body, /Drawing not converted/);
    assert.equal(document.extractionQuality.qualityState, "review_required");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("vertical Western text preserves its 90/270 degree geometry and Chinese text selects its East Asian font", async t => {
  if (process.platform !== "win32") return t.skip("Windows system font integration");
  const root = await mkdtemp(path.join(os.tmpdir(), "word-text-directions-"));
  const xml = (text, direction, fonts = 'w:ascii="Times New Roman"') => drawingXml()
    .replace('cy="457200"', 'cy="914400"')
    .replace(/<wpg:grpSpPr>[\s\S]*?<\/wpg:grpSpPr>/, `<wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/><a:chOff x="0" y="0"/><a:chExt cx="914400" cy="914400"/></a:xfrm></wpg:grpSpPr>`)
    .replace(/<wps:wsp>[\s\S]*?<\/wps:wsp>/, `<wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr>
     <wps:txbx><w:txbxContent><w:p><w:r><w:rPr><w:rFonts ${fonts}/><w:sz w:val="32"/></w:rPr><w:t>${text}</w:t></w:r></w:p></w:txbxContent></wps:txbx>
     <wps:bodyPr vert="${direction}" lIns="0" rIns="0" tIns="0" bIns="0"/></wps:wsp>`);
  try {
    const images = [];
    for (const direction of ["horz", "eaVert", "vert270"]) {
      const result = await preserveDocxDrawings(xml("ABC", direction), { assetDir: root }, new Map());
      assert.equal(result.rendered, 1, JSON.stringify(result));
      images.push(path.join(root, result.details[0].file));
    }
    const python = await detectPdfLayoutExtractor();
    await promisify(execFile)(python.command, [...python.args, "-c", `from PIL import Image,ImageChops
import sys
boxes=[]
for file in sys.argv[1:]:
 im=Image.open(file).convert('RGB');boxes.append(ImageChops.difference(im,Image.new('RGB',im.size,'white')).getbbox())
assert all(boxes),boxes
a,b,c=boxes
expected=[228-a[3],a[0],228-a[1],a[2]]
assert all(abs(x-y)<=1 for x,y in zip(b,expected)),(boxes,expected)
expected=[a[1],228-a[2],a[3],228-a[0]]
assert all(abs(x-y)<=1 for x,y in zip(c,expected)),(boxes,expected)
`, ...images], { windowsHide: true });
    const chinese = await preserveDocxDrawings(xml("中文", "horz", 'w:ascii="Unavailable Latin Font" w:eastAsia="SimSun"'), { assetDir: root }, new Map());
    assert.equal(chinese.rendered, 1, JSON.stringify(chinese));
    const unsupported = await preserveDocxDrawings(xml("中文", "eaVert", 'w:eastAsia="SimSun"'), { assetDir: root }, new Map());
    assert.equal(unsupported.rendered, 0);
    assert.match(unsupported.details[0].reason, /vertical_glyph_layout/);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("orphan Word list levels retain images as content and contiguous children keep nesting",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'word-list-images-'));
  try {
    const media=new Map(),drawing=await preserveDocxDrawings(drawingXml(),{assetDir:root},media);
    const file=drawing.details[0].file;
    const paragraph=(level,text)=>`<w:p>${level===null?'':`<w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="4"/></w:numPr></w:pPr>`}<w:r>${text==='image'?'<w:object><v:imagedata r:id="rId9"/></w:object>':`<w:t>${text}</w:t>`}</w:r></w:p>`;
    const xml=`<w:document><w:body>${paragraph(null,'Intro')}${paragraph(2,'image')}${paragraph(3,'Child')}${paragraph(null,'Separate prose')}${paragraph(3,'image')}</w:body></w:document>`;
    const numberingXml='<w:numbering><w:abstractNum w:abstractNumId="1">'+[2,3].map(level=>`<w:lvl w:ilvl="${level}"><w:numFmt w:val="decimal"/><w:start w:val="1"/></w:lvl>`).join('')+'</w:abstractNum><w:num w:numId="4"><w:abstractNumId w:val="1"/></w:num></w:numbering>';
    const markdown=docxDocumentXmlToMarkdown(xml,'list.docx','',{}, {numberingXml,mediaTargets:new Map([['rId9',file]])});
    assert.match(markdown,/\n1\. !\[Word image\]/);assert.match(markdown,/\n   1\. Child/);
    const buffer=await exportMarkdownToDocx(markdown,{baseDir:root});
    const {readZipEntry}=await import('../src/core/zip.js');
    assert.equal([...readZipEntry(buffer,'word/document.xml').toString().matchAll(/r:embed="/g)].length,2);
  } finally {await rm(root,{recursive:true,force:true});}
});
