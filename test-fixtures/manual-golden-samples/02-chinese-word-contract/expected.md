# Expected Results: 中文 Word 合同，含编号、页眉页脚

## Description
专门测试中文合同文档中的排版兼容性。核心测试中文标点符号、段落缩进、页眉页脚等非结构性噪声的过滤情况。

## Manual Golden QA Checkpoints
Check the following 6 behaviors during manual execution:

### 1. 导入是否明确 (Import Check)
- **Action**: Click Choose File, select the sample, and click Import.
- **Expectation**: The import status bar pops up, showing the target absolute folder copy.

### 2. 转换是否有进度 (Progress Check)
- **Action**: Click Convert.
- **Expectation**: Progress steps display sequentially.

### 3. MD 是否人能读 (Readable MD Check)
- **Action**: Inspect the Markdown reader tab.
- **Expectation**: Title headers, bullet points, tables, and spacing are legible.

### 4. AI-ready 是否干净 (AI-ready Check)
- **Action**: Check the "AI Will See" panel.
- **Expectation**: Irrelevant headers/footers and noise are absent.

### 5. 脱敏是否可靠 (Sanitization Check)
- **Action**: Toggle masking and inspect.
- **Expectation**: PII, emails, secrets are redacted correctly.

### 6. 导出 Word/PDF 是否像正式文件 (Export Check)
- **Action**: Export to DOCX and HTML.
- **Expectation**: Layout is elegant, fonts are unified, formulas do not compile to corrupt text.

## Verification Checklist
- [ ] 成功过滤掉页眉页脚，保留纯净正文
- [ ] 合同编号（一、 1.1 (1)）层级正常还原
- [ ] 中文标点（“”、。？！）无乱码
- [ ] 导出为 Word 后，中文字体优先使用微软雅黑/宋体，无字形崩坏
- [ ] 脱敏处理能正确遮盖合同甲乙方企业名称、统一社会信用代码
