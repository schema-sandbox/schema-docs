# Expected Results: 中英文混排文档

## Description
主要测试中英文混排、中英文间距和公式防乱码机制。

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
- [ ] 复杂的 LaTeX 公式（带 frac, sqrt 等）保持原始 $$ 块级或 $ 行内格式不乱码
- [ ] 简单的公式符号（如 Delta）转换成 Δ，字符无乱码
- [ ] 导出为 DOCX 后，英文字体 Segoe UI 与中文字体微软雅黑混排比例和谐
