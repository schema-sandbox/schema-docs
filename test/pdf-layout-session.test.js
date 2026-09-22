import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { extractPdfWithLayout, runLayoutProcess } from "../src/adapters/pdfLayoutExtractor.js";
import { markdownToPdfBuffer } from "../src/adapters/pdfMarkdownConverter.js";

const testPython = process.env.SCHEMA_DOCS_PYTHON || path.resolve("runtime/python/python.exe");

test("real parser reuses verified page windows and recomputes damaged or changed source pages", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "layout-resume-"));
  try {
    const source = path.join(root, "source.pdf");
    await writeFile(source, markdownToPdfBuffer(Array.from({ length: 320 }, (_, i) => `Page content line ${i}: ordinary readable text.`).join("\n")));
    const options = { cacheDir: path.join(root, "cache"), assetDir: path.join(root, "assets") };
    const events = [];
    const first = await extractPdfWithLayout(source, { ...options, maxPages: 2, onPageComplete: e => events.push(e) });
    assert.equal(events.length, 2);
    assert.equal(first.visualMap.cache.processedPages, 2);
    const second = await extractPdfWithLayout(source, options);
    assert.equal(second.visualMap.cache.reusedPages, 2);
    assert.ok(second.visualMap.pageCount > 2);
    assert.equal(second.visualMap.pages.length, second.visualMap.pageCount);
    assert.equal(new Set(second.markdown.match(/<!-- pdf-page: \d+ -->/g)).size, second.visualMap.pageCount);
    await writeFile(events[0].artifactPath, '{"damaged":true}');
    const repaired = await extractPdfWithLayout(source, options);
    assert.equal(repaired.visualMap.cache.processedPages, 1);
    assert.equal(repaired.markdown, second.markdown);
    await writeFile(source, Buffer.concat([await readFile(source), Buffer.from("\n% new source identity\n")]));
    const changed = await extractPdfWithLayout(source, { ...options, maxPages: 2 });
    assert.equal(changed.visualMap.cache.reusedPages, 0);
    assert.notEqual(changed.visualMap.cache.identity, first.visualMap.cache.identity);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("layout cancellation kills the running child before the adapter rejects", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "layout-cancel-"));
  try {
    const childScript = path.join(root, "worker.cjs");
    const pulse = path.join(root, "pulse.txt");
    await writeFile(childScript, `require('node:fs').writeFileSync(process.argv[2], String(process.pid)); setInterval(() => {}, 20);`);
    let pid;
    await assert.rejects(runLayoutProcess({ command: process.execPath }, [childScript, pulse], {
      timeout: 5000,
      assertNotCancelled: async () => {
        pid = Number(await readFile(pulse, "utf8").catch(() => 0));
        if (pid) throw Object.assign(new Error("Cancelled"), { code: "job_cancelled" });
      }
    }), { code: "job_cancelled" });
    assert.ok(pid);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unknown glyph fallback preserves neighbours and cached assets must verify", () => {
  const script = `
import sys, tempfile, types, pathlib, json, hashlib
sys.path.insert(0, sys.argv[1])
from pdfLayoutSession import preserve_unknown_glyphs, restore_page, json_bytes, file_hash
from pdfLayoutExtractor import enrich_text_with_math
with tempfile.TemporaryDirectory() as temp:
 root=pathlib.Path(temp)
 chars=[{'text':'hello','x0':0,'top':0,'x1':20,'bottom':10}, {'text':'(cid:1)','fontname':'UnknownSubset','x0':21,'top':0,'x1':25,'bottom':10}]
 page=types.SimpleNamespace(chars=chars)
 regions=preserve_unknown_glyphs(page,1,None,lambda *args:None)
 assert chars[1]['text']=='(cid:1)' and chars[0]['text']=='hello'
 assert '\\uf8f2' in enrich_text_with_math('Before \\uf8f2 after',[],1)
 def render(page, number, regions, assets):
  (root/'glyph.png').write_bytes(b'image')
  regions[0].update(assetFile='glyph.png',assetStatus='rendered')
 regions=preserve_unknown_glyphs(page,1,root,render)
 assert chars[0]['text']=='hello' and 'file=glyph.png' in chars[1]['text']
 payload={'page':{'page':1,'regions':regions},'assets':{'glyph.png':file_hash(root/'glyph.png')}}
 target=root/'page.json'
 target.write_bytes(json_bytes({'identity':'key','payload':payload,'sha256':hashlib.sha256(json_bytes(payload)).hexdigest()}))
 assert restore_page(target,'key',1,root) is not None
 (root/'glyph.png').write_bytes(b'broken')
 assert restore_page(target,'key',1,root) is None
 print('ok')
`;
  const result = spawnSync(testPython, ["-X", "utf8", "-c", script, path.resolve("src/adapters")], {
    encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ok/);
});

test("detached decoded math symbols use a visual fallback instead of corrupting prose", () => {
  const script = `
import sys, types
sys.path.insert(0, sys.argv[1])
from pdfLayoutSession import preserve_unknown_glyphs
chars=[
 {'text':'lo','fontname':'LMRoman10-Regular','x0':0,'top':0,'x1':8,'bottom':10},
 {'text':'√','fontname':'CMSY10','x0':8,'top':0,'x1':13,'bottom':10},
 {'text':'wer','fontname':'LMRoman10-Regular','x0':13,'top':0,'x1':28,'bottom':10},
]
page=types.SimpleNamespace(chars=chars)
def render(page, number, regions, assets):
 regions[0].update(assetFile='symbol.png',assetStatus='rendered')
regions=preserve_unknown_glyphs(page,1,None,render)
assert 'file=symbol.png' in chars[1]['text'], chars
assert chars[0]['text']=='lo' and chars[2]['text']=='wer', chars
print('ok')
`;
  const result = spawnSync(testPython, ["-X", "utf8", "-c", script, path.resolve("src/adapters")], {
    encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ok/);
});

test("duplicate detached symbols share one visual fallback asset", () => {
  const script = `
import sys, types
sys.path.insert(0, sys.argv[1])
from pdfLayoutSession import preserve_unknown_glyphs
chars=[
 {'text':'before','fontname':'LMRoman10-Regular','x0':0,'top':0,'x1':30,'bottom':10},
 {'text':'≥','fontname':'CMSY10','x0':40,'top':20,'x1':48,'bottom':32},
 {'text':'≥','fontname':'CMSY10','x0':40.2,'top':20.1,'x1':48.1,'bottom':32.1},
 {'text':'after','fontname':'LMRoman10-Regular','x0':50,'top':20,'x1':75,'bottom':32},
]
page=types.SimpleNamespace(chars=chars)
def render(page, number, regions, assets):
 assert len(regions)==1, regions
 regions[0].update(assetFile='symbol.png',assetStatus='rendered')
regions=preserve_unknown_glyphs(page,1,None,render)
assert len(regions)==1, regions
assert regions[0]['sourceDuplicateCount']==2, regions
assert 'file=symbol.png' in chars[1]['text']
assert chars[2]['text']=='' and chars[2]['fontname']=='SchemaDocsDuplicateGlyph'
assert chars[0]['text']=='before' and chars[3]['text']=='after'
print('ok')
`;
  const result = spawnSync(testPython, ["-X", "utf8", "-c", script, path.resolve("src/adapters")], {
    encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ok/);
});

test("mixed PDF windows reopen the requested ordinary page after a single-page isolation", () => {
  const script = `
import pathlib, sys, tempfile, types
sys.path.insert(0, sys.argv[1])
import pdfPageWindow as module

class RawPage:
    def __init__(self, object_count): self.object_count = object_count
    def get_objects(self):
        item = type('Obj', (), {'type': -1})()
        return [item] * self.object_count
    def close(self): pass

class Window:
    def __init__(self): self.indices = []
    def import_pages(self, source, indices): self.indices = list(indices)
    def __getitem__(self, index): return RawPage([1, 1, 5001][self.indices[index]])
    def save(self, path): FakePdfDocument.last_indices = self.indices
    def close(self): pass

class FakePdfDocument:
    last_indices = []
    @classmethod
    def new(cls): return Window()

class ParsedPage:
    def __init__(self, source_index): self.source_index = source_index
    def close(self): pass

class ParsedDocument:
    @property
    def pages(self): return [ParsedPage(index) for index in FakePdfDocument.last_indices]
    def close(self): pass

module.pdfium.PdfDocument = FakePdfDocument
module.pdfplumber.open = lambda path: ParsedDocument()
window = object.__new__(module.PdfPageWindow)
window.source = object()
window.window_size = 3
window.window_path = pathlib.Path(tempfile.gettempdir()) / 'schema-docs-window-test.pdf'
window.document = None
window._pathological_page = None
window.window_start = window.window_end = -1
window._window_has_heavy_pages = False
window._single_page_window = False
first = window.get_page(0, 3)
assert first.source_index == 0
first.close()
second = window.get_page(1, 3)
assert second.source_index == 1, second.source_index
print('ok')
`;
  const result = spawnSync(testPython, ["-X", "utf8", "-c", script, path.resolve("src/adapters")], {
    encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ok/);
});
