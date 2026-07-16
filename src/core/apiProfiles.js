import { createId, nowIso } from "./ids.js";
import { readManifest, writeManifest } from "./manifest.js";
import { AppError } from "./errors.js";
export function ensureApiProfiles(manifest) {
if (!Array.isArray(manifest.apiProfiles)) {
manifest.apiProfiles = [];
}
return manifest.apiProfiles;
}
export async function listApiProfiles(workspacePath) {
const manifest = await readManifest(workspacePath);
return ensureApiProfiles(manifest);
}
export async function saveApiProfile(workspacePath, input) {
const name = (input.name ?? "").trim();
const apiBaseUrl = (input.apiBaseUrl ?? "").trim();
const model = (input.model ?? "").trim();
if (!name) throw new AppError("api_profile_name_required", "API profile name is re...");
if (!apiBaseUrl) throw new AppError("api_base_url_required", "API base URL is required.");
if (!model) throw new AppError("api_model_required", "API model is required.");
const manifest = await readManifest(workspacePath);
const profiles = ensureApiProfiles(manifest);
const existing = profiles.find((profile) => profile.id === input.id || profile.name === name);
const timestamp = nowIso();
if (existing) {
Object.assign(existing, {
name,
apiBaseUrl,
model,
updatedAt: timestamp
});
await writeManifest(workspacePath, manifest);
return existing;
}
const profile = {
id: createId("api"),
name,
apiBaseUrl,
model,
createdAt: timestamp,
updatedAt: timestamp
};
profiles.push(profile);
await writeManifest(workspacePath, manifest);
return profile;
}
export async function deleteApiProfile(workspacePath, profileId) {
const manifest = await readManifest(workspacePath);
const profiles = ensureApiProfiles(manifest);
const index = profiles.findIndex((profile) => profile.id === profileId);
if (index === -1) throw new AppError("api_profile_not_found", `API profile not found: ${profileId}`, {
profileId
});
const [deleted] = profiles.splice(index, 1);
await writeManifest(workspacePath, manifest);
return deleted;
}