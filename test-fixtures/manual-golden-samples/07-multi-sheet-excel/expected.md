# Expected Results: Excel 多 sheet 表

## Description
测试包含多个工作表的 Excel 文件的提取与整合预览。

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
- [ ] 提取的 Markdown 中，多张 Sheet 转换为多节 Markdown 内容并附带清晰页签大标题
- [ ] 多 Sheet 数据在后台建立对应的多个数据集文件
