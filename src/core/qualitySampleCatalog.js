import path from "node:path";
import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { AppError } from "./errors.js";

export const QUALITY_SAMPLE_CATALOG_SCHEMA = "schema-docs.quality-sample-catalog";
export const QUALITY_SAMPLE_CATALOG_VERSION = 1;

export function createQualitySampleCatalog(samples = [], options = {}) {
  return {
    schema: QUALITY_SAMPLE_CATALOG_SCHEMA,
    version: QUALITY_SAMPLE_CATALOG_VERSION,
    updatedAt: options.updatedAt || new Date().toISOString(),
    samples: (Array.isArray(samples) ? samples : []).map((sample, index) => ({
      id: String(sample?.id || `sample-${index + 1}`),
      category: String(sample?.category || "general"),
      sourceType: String(sample?.sourceType || "unknown"),
      path: String(sample?.path || ""),
      expectedFeatures: Array.isArray(sample?.expectedFeatures) ? sample.expectedFeatures.map(String) : [],
      protected: Boolean(sample?.protected),
      fixtureOnly: Boolean(sample?.fixtureOnly),
      notes: String(sample?.notes || "")
    }))
  };
}

export async function validateQualitySampleCatalog(catalog, options = {}) {
  const errors = [];
  if (!catalog || catalog.schema !== QUALITY_SAMPLE_CATALOG_SCHEMA) errors.push("catalog schema is unsupported");
  if (catalog?.version !== QUALITY_SAMPLE_CATALOG_VERSION) errors.push("catalog version is unsupported");
  if (!Array.isArray(catalog?.samples)) errors.push("samples must be an array");
  const seen = new Set();
  for (const [index, sample] of (Array.isArray(catalog?.samples) ? catalog.samples : []).entries()) {
    const prefix = `samples[${index}]`;
    if (!sample || typeof sample !== "object") {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (!sample.id || seen.has(sample.id)) errors.push(`${prefix}.id must be unique and non-empty`);
    seen.add(sample.id);
    if (path.isAbsolute(String(sample.path || "")) || String(sample.path || "").split(/[\\/]/).includes("..")) {
      errors.push(`${prefix}.path must stay relative to the workspace`);
    }
    if (!Array.isArray(sample.expectedFeatures)) errors.push(`${prefix}.expectedFeatures must be an array`);
    if (options.requireFiles && sample.path) {
      try {
        await access(path.resolve(options.workspacePath || process.cwd(), sample.path));
      } catch {
        errors.push(`${prefix}.path does not exist: ${sample.path}`);
      }
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    sampleCount: Array.isArray(catalog?.samples) ? catalog.samples.length : 0,
    protectedCount: Array.isArray(catalog?.samples) ? catalog.samples.filter(sample => sample?.protected).length : 0
  };
}

export async function readQualitySampleCatalog(workspacePath, relativePath = "docs/quality-samples.json", options = {}) {
  const filePath = path.resolve(workspacePath, relativePath);
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    const validation = await validateQualitySampleCatalog(parsed, { ...options, workspacePath });
    if (options.strict && !validation.valid) {
      throw new AppError("quality_sample_catalog_invalid", "Quality sample catalog is invalid.", validation);
    }
    if (!validation.valid) return createQualitySampleCatalog();
    return createQualitySampleCatalog(parsed.samples, { updatedAt: parsed.updatedAt });
  } catch (error) {
    if (options.strict && error?.code === "quality_sample_catalog_invalid") throw error;
    if (options.strict) throw new AppError("quality_sample_catalog_unreadable", "Quality sample catalog could not be read.", { cause: error.message });
    return createQualitySampleCatalog();
  }
}
