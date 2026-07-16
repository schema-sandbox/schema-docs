# Expected Results: 普通 Word 报告，含标题、列表、表格

## Description
验证标准的 Word 报告提取和排版输出。主要测试标题层级、项目列表、多列复杂表格的结构提取与导出还原。

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
- [ ] 导入与转换无报错，多级标题正确提取为 H1/H2/H3
- [ ] 列表嵌套深度正确，符号正常显示
- [ ] 表格字段未错位，提取出的 Markdown 格式良好
- [ ] 导出为 DOCX 后，标题具有一致的 Teal 主题样式且带下边框
- [ ] 导出为 HTML 后，表格宽度自适应，阅读体验舒适
