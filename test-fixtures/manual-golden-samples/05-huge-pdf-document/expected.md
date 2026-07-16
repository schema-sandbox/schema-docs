# Expected Results: 超大 PDF，几百页以上

## Description
测试大文档的提取性能、长时间 Loading 指示以及分块加载（Chunked Editor）的触发。

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
- [ ] 大文档提取过程中，进度条保持活跃，提示'Large files can take a while'
- [ ] 成功触发 Chunked Editor 限制，不在前端一次性渲染巨量 Markdown 造成假死
- [ ] 分块清单文件及 AI Will See 台账能正常加载并可分批阅览
