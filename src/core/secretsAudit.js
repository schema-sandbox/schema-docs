import { readManifest } from "./manifest.js";
import { getTimelineEvents } from "./timeline.js";
import { getInboxItems } from "./inbox.js";
import { getWorkspaceSettings } from "./settings.js";
const tokenPrefixRegex = /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}|(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|xox[abprs]-[A-Za-z0-9-]{20,}/i;
const apiSecretRegex = /(?:sk-[a-zA-Z0-9]{32,48}|key-[a-zA-Z0-9]{24,64}|api[_-]?key|password|token)/i;
const strictSecretValueRegex = /(?:sk-[a-zA-Z0-9]{20,}|key-[a-zA-Z0-9]{20,}|(?:api[_-]?key|password|token|client[_-]?secret)\s*[:=]\s*[^\s"'`]{8,})/i;
const metadataSignalKeys = new Set([
  "sendGateSignals",
  "signals",
  "knownLimitIds",
  "enterpriseHooks",
  "requiredActions",
  "optionalActions"
]);
function stringEntries(value, path = []) {
  if (typeof value === "string") return [{ path, value }];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => stringEntries(item, [...path, String(index)]));
  }
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => stringEntries(item, [...path, key]));
  return [];
}
function containsSecretLikeValue(entry, { strict = false } = {}) {
  const key = entry.path.at(-1) ?? "";
  const parentKey = entry.path.at(-2) ?? "";
  if (metadataSignalKeys.has(key) || metadataSignalKeys.has(parentKey)) {
    return false;
  }
  return tokenPrefixRegex.test(entry.value) || (strict ? strictSecretValueRegex.test(entry.value) : apiSecretRegex.test(entry.value));
}
export async function runSecuritySecretsAudit(workspacePath) {
  const auditResults = {
    ok: true,
    failures: [],
    checkedItemsCount: 0
  };
  const addFailure = (code, message, file, detail) => {
    auditResults.ok = false;
    auditResults.failures.push({ code, message, file, detail });
  };
  try {
    const settings = await getWorkspaceSettings(workspacePath);
    auditResults.checkedItemsCount++;
    for (const [key, value] of Object.entries(settings)) {
      if (typeof value === "string" && containsSecretLikeValue({ path: [key], value })) {
        addFailure("secret_leaked_in_settings", `Credential detected in setting key "${key}"`, "settings", { key });
      }
    }
  } catch (error) {
  }
  try {
    const manifest = await readManifest(workspacePath);
    auditResults.checkedItemsCount++;
    const profiles = manifest.apiProfiles || [];
    for (const profile of profiles) {
      if (
        profile.apiKey ||
        (profile.apiBaseUrl && containsSecretLikeValue({ path: ["apiProfiles", "apiBaseUrl"], value: profile.apiBaseUrl }))
      ) {
        addFailure("secret_leaked_in_profiles", `API Key or sensitive info leaked in API profile: ${profile.name}`, "manifest.json", { profileId: profile.id });
      }
    }
  } catch (error) {
  }
  try {
    const manifest = await readManifest(workspacePath);
    const evidence = manifest.evidenceRecords || [];
    auditResults.checkedItemsCount += evidence.length;
    for (const record of evidence) {
      if (stringEntries(record).some((entry) => containsSecretLikeValue(entry, { strict: true }))) {
        addFailure("secret_leaked_in_evidence", `Sensitive secret found inside evidence record: ${record.id}`, "evidence", { evidenceId: record.id });
      }
    }
  } catch (error) {
  }
  try {
    const timeline = await getTimelineEvents(workspacePath);
    auditResults.checkedItemsCount += timeline.length;
    for (const event of timeline) {
      if (stringEntries(event).some((entry) => containsSecretLikeValue(entry, { strict: true }))) {
        addFailure("secret_leaked_in_timeline", `Credential leaked in timeline event description`, "timeline", { eventId: event.id });
      }
    }
  } catch (error) {
  }
  return auditResults;
}