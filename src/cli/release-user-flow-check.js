import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import { createAppService, sanitizeFolderForAi } from '../core/appService.js';
import { readManifest, openOrCreateWorkspace } from '../core/manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

const zipBuilderPath = path.join(projectRoot, 'test/helpers/zipBuilder.js');
const { buildZip } = await import(pathToFileURL(zipBuilderPath));

// 1. 初始化临时工作区
const tempWorkspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-check-workspace-'));
console.log(`[INFO] Created temp workspace at: ${tempWorkspaceDir}`);

try {
  // 初始化工作区
  await openOrCreateWorkspace(tempWorkspaceDir);
  const service = createAppService(tempWorkspaceDir);

  // 2. 创建并导入不同类型的文件
  // 2.1 导入 .md
  const mdContent = `# Test Title\n\nThis is a normal paragraph.\n\n- List item 1\n- List item 2`;
  const mdPath = path.join(tempWorkspaceDir, 'test_doc.md');
  fs.writeFileSync(mdPath, mdContent);
  console.log(`[INFO] Created test md file.`);

  // 2.2 导入 .txt
  const txtContent = `Plain text title\n\nThis is a text paragraph.`;
  const txtPath = path.join(tempWorkspaceDir, 'test_doc.txt');
  fs.writeFileSync(txtPath, txtContent);
  console.log(`[INFO] Created test txt file.`);

  // 2.3 导入 .docx
  // 通过 zip 拼装一个极简 of docx
  const docxZip = buildZip([
    { name: 'word/document.xml', content: '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Docx Content Paragraph</w:t></w:r></w:p></w:body></w:document>' }
  ]);
  const docxPath = path.join(tempWorkspaceDir, 'test_doc.docx');
  fs.writeFileSync(docxPath, docxZip);
  console.log(`[INFO] Created test docx file.`);

  // 2.4 导入 .pdf
  const pdfContent = `%PDF-1.4\nstream\n(\\376\\377\\000A\\000B\\000C\\000D) Tj\nendstream\n%%EOF\n`;
  const pdfPath = path.join(tempWorkspaceDir, 'test_doc.pdf');
  fs.writeFileSync(pdfPath, pdfContent, 'latin1');
  console.log(`[INFO] Created test pdf file.`);

  // 2.5 导入 .xlsx
  const xlsxZip = buildZip([
    {
      name: 'xl/sharedStrings.xml',
      content: '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>HeaderA</t></si><si><t>HeaderB</t></si></sst>'
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      content: '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row></sheetData></worksheet>'
    },
    {
      name: 'xl/workbook.xml',
      content: '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'
    }
  ]);
  const xlsxPath = path.join(tempWorkspaceDir, 'test_doc.xlsx');
  fs.writeFileSync(xlsxPath, xlsxZip);
  console.log(`[INFO] Created test xlsx file.`);

  // 批量导入
  console.log(`[INFO] Importing documents...`);
  const mdRecord = await service.importFile(mdPath);
  const txtRecord = await service.importFile(txtPath);
  const docxRecord = await service.importFile(docxPath);
  const pdfRecord = await service.importFile(pdfPath);
  const xlsxRecord = await service.importFile(xlsxPath);

  // 3. 转 readable Markdown
  console.log(`[INFO] Converting imported files to readable Markdown...`);
  await service.convertDocumentToFormat(mdRecord.id, 'outputs/test_doc_md.md', 'md');
  await service.convertDocumentToFormat(txtRecord.id, 'outputs/test_doc_txt.md', 'md');
  await service.convertDocumentToFormat(docxRecord.id, 'outputs/test_doc_docx.md', 'md');
  await service.convertDocumentToFormat(pdfRecord.id, 'outputs/test_doc_pdf.md', 'md');

  // 4. 大 Markdown 分段验证
  console.log(`[INFO] Verifying large Markdown split...`);
  let largeBody = '';
  for (let i = 0; i < 3000; i++) {
    largeBody += `\n\n## Chapter ${i + 1}\n\n`;
    for (let j = 0; j < 25; j++) {
      largeBody += `This is paragraph index ${j} for chapter index ${i} to guarantee unique text stream is processed correctly by core splitting algorithms. `;
    }
  }
  const largeMdContent = `# Long Doc\n\n${largeBody}`;
  const largeMdPath = path.join(tempWorkspaceDir, 'large_doc.txt');
  fs.writeFileSync(largeMdPath, largeMdContent);
  const largeRecord = await service.importFile(largeMdPath);

  await service.convertDocumentToFormat(largeRecord.id, 'outputs/large_doc.md', 'md');
  const manifest = await readManifest(tempWorkspaceDir);
  const largeDocMeta = manifest.documents.find(d => d.id === largeRecord.id);
  const readableFullPath = path.isAbsolute(largeDocMeta.readableMarkdownPath)
    ? largeDocMeta.readableMarkdownPath
    : path.join(tempWorkspaceDir, largeDocMeta.readableMarkdownPath);
  if (!largeDocMeta.readableMarkdownPath || !fs.existsSync(readableFullPath)) {
    throw new Error(`Large markdown split failed, path missing.`);
  }
  console.log(`[SUCCESS] Large Markdown split verified.`);

  // 5. 脱敏扫描验证
  console.log(`[INFO] Verifying masking scan...`);
  const rawSensitive = `My phone is 13800138000 and email is test@domain.com. API key is AIzaSyD-dummy-key.`;
  const maskResult = service.maskSensitiveData(rawSensitive);
  if (maskResult.maskedText.includes('13800138000') || maskResult.maskedText.includes('AIzaSyD-dummy-key')) {
    throw new Error(`PII or Secret masking failed to redact sensitive content.`);
  }
  console.log(`[SUCCESS] PII and Secret masking verified.`);

  // 文件夹脱敏检查
  console.log(`[INFO] Running folder PII scan...`);
  const folderSanitizeResult = await sanitizeFolderForAi(path.join(tempWorkspaceDir, 'imports'));
  if (!folderSanitizeResult || typeof folderSanitizeResult.processedCount !== 'number' || !Array.isArray(folderSanitizeResult.items)) {
    throw new Error(`Folder PII scan failed.`);
  }
  console.log(`[SUCCESS] Folder PII scan verified.`);

  // 6. AI Will See (prepare-ai)
  console.log(`[INFO] Verifying AI Will See preview...`);
  const docAiPreview = await service.compileAiContextPreview(mdRecord.id);
  if (!docAiPreview) {
    throw new Error(`AI context preview failed.`);
  }
  console.log(`[SUCCESS] AI Will See verified.`);

  // 7. 导出 DOCX / PDF 验证
  console.log(`[INFO] Verifying exports to DOCX and PDF...`);
  await service.convertDocumentToFormat(mdRecord.id, 'exports/output_doc.docx', 'docx');
  await service.convertDocumentToFormat(mdRecord.id, 'exports/output_doc.pdf', 'pdf');
  if (!fs.existsSync(path.join(tempWorkspaceDir, 'exports/output_doc.docx'))) {
    throw new Error(`DOCX export file not written.`);
  }
  if (!fs.existsSync(path.join(tempWorkspaceDir, 'exports/output_doc.pdf'))) {
    throw new Error(`PDF export file not written.`);
  }
  console.log(`[SUCCESS] DOCX and PDF exports verified.`);

  // 8. 中文 UI key 检查
  console.log(`[INFO] Verifying Chinese UI keys...`);
  const i18nPanelContent = fs.readFileSync(path.join(projectRoot, 'public/i18nPanel.js'), 'utf8');
  if (!i18nPanelContent.includes('zh-CN') || !i18nPanelContent.includes('确定') || !i18nPanelContent.includes('预览')) {
    throw new Error(`i18nPanel.js does not contain proper Chinese dictionary properties.`);
  }
  console.log(`[SUCCESS] Chinese UI keys verified.`);

  // 9. 运行 release-check
  console.log(`[INFO] Executing release-check...`);
  execSync(`node "${path.join(projectRoot, 'src/cli/release-check.js')}"`, { stdio: 'inherit' });
  console.log(`[SUCCESS] release-check verified.`);

  console.log(`\n======================================================`);
  console.log(`[SUCCESS] ALL RELEASE USER FLOW CHECKS PASSED SUCCESSFULLY!`);
  console.log(`======================================================`);
} finally {
  try {
    fs.rmSync(tempWorkspaceDir, { recursive: true, force: true });
  } catch {}
}
