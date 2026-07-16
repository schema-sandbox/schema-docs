import { randomUUID } from "node:crypto";
export function createId(prefix) {
return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}
export function nowIso() {
return new Date().toISOString();
}