# Security Boundaries

This product handles local documents and user-provided API credentials. The default rule is narrow access, explicit confirmation, and auditable exchange.

## Local Workspace

- All generated state lives under `.ai-doc-exchange/` inside the selected workspace.
- Writes must go through the workspace path guard.
- Relative paths are normalized before use.
- Symlinks that resolve outside the workspace must be rejected.
- Imported external files may be referenced or copied later, but generated outputs stay inside the workspace.

## Markdown Exchange

- Markdown is the durable exchange artifact.
- Exchange packages may include body text, query result summaries, API result text, and audit summaries.
- Exchange packages must not include API keys.
- Exchange package verification scans the package directory for undeclared raw sensitive files such as `.env`, key, secret, token, or credential files; these files block verification even when they are not listed in the manifest.
- Exchange package trust reports also scan manifest string values for credential-like API URLs, bearer tokens, cloud access keys, and labeled secrets before declaring a package externally shareable.
- Audit summaries should store content hashes and lengths instead of full prompts unless the user explicitly saves the body as Markdown.

## API Calls

- Preview is always dry-run.
- Send requires explicit confirmation.
- Preview includes a lightweight Send Gate summary: estimated token count, basic sensitive-content signals, local-only markers, model, endpoint, and API key source status.
- Local masking covers common credential forms before AI preview/send, including labeled API keys/secrets/passwords/tokens, standalone `sk-`/`key-` style keys, Bearer tokens, common cloud access key ids, and UUID-like values when a credential label such as `token` or `session_token` is present.
- Confirmed send is blocked when Send Gate returns `review_required`, including credential-like text or local-only markers.
- API keys are never stored in API profiles.
- API profiles store only name, base URL, and model.
- Confirmed sends should record an audit summary with operation, source reference, endpoint, model, content length, content hash, sent flag, and timestamp.
- Send Gate blocked send attempts also record local-only evidence and audit summaries (`ai_send_blocked` / `api_send_blocked`) with content hash, decision, signals, token estimate, and `aiSent: false`; they do not store API keys or raw prompt text.
- Local AI context selection is also auditable before any send. Chunk/range selection records `ai_context_chunk_selected` / `ai_context_range_selected` with `aiSent: false`, content hash, token estimate, selection range, continuation metadata, and timeline linkage, without storing selected Markdown text. Filtered table context records `ai_query_context_selected` with `aiSent: false`, context hash, truncation signal, and timeline linkage, without storing raw SQL result rows.
- The secrets audit treats Send Gate signal labels such as `bearer_token_like` or `uuid_token_like` as metadata, not leaked credentials, while still flagging real credential values if they appear in evidence, timeline, settings, or profile records.
- Evidence and audit summaries record Send Gate decision, signals, and estimated tokens, without storing the raw prompt or API key.

## Local HTTP Server

- The local API requires an in-process token.
- The token is intended for the local UI, not for remote access.
- `/app-config.js` distributes the local session token only to trusted local contexts and rejects browser requests marked as cross-site.
- Do not expose the server on a public interface by default.
- Future desktop shells should wrap the app service directly when possible.

## Adapter Boundary

Third-party libraries must stay behind internal interfaces:

- `DocumentConverter`
- `DatasetImporter`
- `QueryEngine`
- `AiClient`
- `SecretStore`

Business flows should not call third-party APIs directly. This keeps the core auditable and lets heavy dependencies remain optional or replaceable.
If optional system adapters (such as LibreOffice, Pandoc, or Tesseract) are missing, conversion logic degrades gracefully:
- It returns structured warning messages and updates quality indicators instead of silent failures.
- No network connections are initiated to obtain third-party binaries or perform cloud-based conversions.
- Security masking and local verification remain active for all core conversions.

## Dependency Admission

Before adding a dependency, record:

- Why it is required.
- Whether it is optional, lazy-loaded, or part of the main path.
- Package size and native binding risk.
- Data it can read.
- Network access, if any.
- Replacement plan.

No dependency should expand file, network, or credential access without an explicit interface and test coverage.
