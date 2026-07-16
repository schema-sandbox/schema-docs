# Security Policy

## Supported Versions

Currently, active development and security updates are provided for the following versions:

| Version | Supported |
|---------|-----------|
| v0.1.x  | Yes       |
| < v0.1  | No        |

## Reporting a Vulnerability

If you discover a potential security vulnerability, do not include exploit details, private documents, API keys, or personal data in a public issue. Use the repository's **Security** tab and choose **Report a vulnerability** to open a private GitHub Security Advisory. If private reporting is not enabled, contact the repository owner through the private contact method on their GitHub profile.

Please include the affected version, operating system, reproduction steps, impact, and the smallest safe test fixture that demonstrates the issue. Maintainers will acknowledge the report, assess severity, and coordinate disclosure after a fix is available. Response times are best-effort while the project is maintained by a small open-source team.

## Security Boundaries & Guarantees

Schema Docs is designed as a local-first intake gateway before sending documents to AI models. These are design boundaries, not a guarantee that the software is free of vulnerabilities:

- **Local Document Conversion:** All office document conversions (DOCX, PDF, XLSX, CSV, PPTX) run entirely on the local machine. No document bytes are uploaded to any cloud service for parsing or preprocessing.
- **Privacy Masking Isolation:** PII and credential masking run locally. Masking is pattern-based and may miss sensitive data, so users must review the preview before sending.
- **AI Send Gate:** Built-in AI requests use the review gate. Users remain responsible for the configured endpoint and for verifying the exact content shown before sending.
- **Evidence Chain:** Supported workflow events can be written to a local SHA-256-linked evidence log. This is an audit aid, not a substitute for access controls or an external compliance system.
- **API Key Handling:** Your AI provider API keys (OpenAI, Claude, etc.) are used solely to authenticate requests at the moment of a confirmed, approved send. They are never persisted in profiles or stored on disk.
- **Exchange Package Digests:** Exported exchange bundles contain SHA-256 digests and a receiver trust report so accidental or unauthorized changes can be detected. These digests do not establish publisher identity.
