/**
 * Schema Docs Core SDK
 * Standalone entry point for embedding local-first document intake,
 * reversible PII masking, and SDXP exchange package verification.
 */

export { createAppService } from "./src/core/appService.js";
export { createSchemaDocsLocalClient, SchemaDocsApiError } from "./src/sdk/localApiClient.js";
export { maskSensitiveData, unmaskSensitiveData } from "./src/core/masking.js";
export { openOrCreateWorkspace, readManifest } from "./src/core/manifest.js";
export {
  createExchangeMarkdown,
  readExchangePackage,
  writeExchangePackage,
  verifyExchangePackage,
  generateTrustReport,
  writeExchangePackageReceiverReport
} from "./src/core/exchangePackage.js";
export { detectAdapterCapabilities } from "./src/core/adapterCapabilities.js";
export { getDocumentExchangeCapability, listDocumentExchangeCapabilities } from "./src/core/documentExchangeMatrix.js";
export { AppError, toErrorRecord } from "./src/core/errors.js";
