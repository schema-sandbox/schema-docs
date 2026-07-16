# Expected Results: 含手机号、邮箱、API key、身份证号的敏感测试文档

## Description
测试核心的数据脱敏安全网关，评估 PII 和密钥的安全审计遮盖率。

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
- [ ] 系统能精准侦测并遮盖身份证号、手机号、邮箱和 API 密钥
- [ ] 生成脱敏包后，生成的 sanitization-report 完整统计遮盖计数
- [ ] 保存干净副本时强制经过 /api/mask 进行脱敏并回显脱敏总计数
