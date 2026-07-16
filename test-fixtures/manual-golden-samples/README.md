# Manual Golden Samples QA Registry

This directory contains specifications and expected results for the 10 manual golden samples used to perform end-to-end user-experience validation.

## Manual Samples Registry

1. [普通 Word 报告，含标题、列表、表格](./01-normal-word-report/expected.md)
2. [中文 Word 合同，含编号、页眉页脚](./02-chinese-word-contract/expected.md)
3. [PDF 文字版报告](./03-text-pdf-report/expected.md)
4. [扫描/图片型 PDF](./04-scanned-pdf/expected.md)
5. [超大 PDF，几百页以上](./05-huge-pdf-document/expected.md)
6. [Excel 简单表](./06-simple-excel-sheet/expected.md)
7. [Excel 多 sheet 表](./07-multi-sheet-excel/expected.md)
8. [Markdown 长文](./08-long-markdown-article/expected.md)
9. [中英文混排文档](./09-mixed-cjk-english/expected.md)
10. [含手机号、邮箱、API key、身份证号的敏感测试文档](./10-sensitive-pii-document/expected.md)

---

## Evaluation Checklist for each sample
Every golden sample must be evaluated against the following 6 pillars:
- **Import Check**: UI responds instantly with file selection and import status.
- **Progress Check**: Progress steps are visible, keeping users aware of the execution status.
- **Readable MD Check**: Content renders clearly with appropriate formatting and outline structures.
- **AI-ready Check**: Raw metadata noise is trimmed; only clean AI-ready text is staged.
- **Sanitization Check**: PII and secrets are redacted locally with visible indicators.
- **Export Check**: Output files (Word, HTML, PDF) present elegant typography and layout.
