import { openOrCreateWorkspace } from "../core/manifest.js";
import { createAppService } from "../core/appService.js";

const recordManagementCommands = new Set([
  "profile-list",
  "profile-save",
  "profile-delete",
  "audit-list",
  "audit-delete",
  "conversion-list",
  "conversion-delete",
  "evidence-list",
  "evidence-get",
  "evidence-delete"
]);

export async function handleRecordManagementCommand({ command, workspace, rest, printJson }) {
  if (!recordManagementCommands.has(command)) {
    return false;
  }

  const service = createAppService(workspace);

  if (command === "profile-list") {
    printJson(await service.listApiProfiles());
    return true;
  }

  if (command === "profile-save") {
    const [name, apiBaseUrl, model] = rest;
    if (!name || !apiBaseUrl || !model) {
      throw new Error("profile-save requires <name> <api-base-url> <model>.");
    }
    await openOrCreateWorkspace(workspace);
    printJson(await service.saveApiProfile({ name, apiBaseUrl, model }));
    return true;
  }

  if (command === "profile-delete") {
    const [profileId] = rest;
    if (!profileId) {
      throw new Error("profile-delete requires <profile-id>.");
    }
    printJson(await service.deleteApiProfile(profileId));
    return true;
  }

  if (command === "audit-list") {
    printJson(await service.listExchangeAudits());
    return true;
  }

  if (command === "audit-delete") {
    const [auditId] = rest;
    if (!auditId) {
      throw new Error("audit-delete requires <audit-id>.");
    }
    printJson(await service.deleteExchangeAudit(auditId));
    return true;
  }

  if (command === "conversion-list") {
    printJson(await service.listConversionAudits());
    return true;
  }

  if (command === "conversion-delete") {
    const [auditId] = rest;
    if (!auditId) {
      throw new Error("conversion-delete requires <conversion-audit-id>.");
    }
    printJson(await service.deleteConversionAudit(auditId));
    return true;
  }

  if (command === "evidence-list") {
    printJson(await service.listEvidenceRecords());
    return true;
  }

  if (command === "evidence-get") {
    const [evidenceId] = rest;
    if (!evidenceId) {
      throw new Error("evidence-get requires <evidence-id>.");
    }
    printJson(await service.getEvidenceRecord(evidenceId));
    return true;
  }

  if (command === "evidence-delete") {
    const [evidenceId] = rest;
    if (!evidenceId) {
      throw new Error("evidence-delete requires <evidence-id>.");
    }
    printJson(await service.deleteEvidenceRecord(evidenceId));
    return true;
  }

  return false;
}
