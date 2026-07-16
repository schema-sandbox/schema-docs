import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { AppError } from "./errors.js";
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
function findEndOfCentralDirectory(buffer) {
const minOffset = Math.max(0, buffer.length - 0xffff - 22);
for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
return offset;
}
}
throw new AppError("zip_eocd_not_found", "Could not find ZIP end...");
}
export function listZipEntries(buffer) {
const eocdOffset = findEndOfCentralDirectory(buffer);
const entryCount = buffer.readUInt16LE(eocdOffset + 10);
const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
const entries = [];
let offset = centralDirectoryOffset;
for (let index = 0; index < entryCount; index += 1) {
if (buffer.readUInt32LE(offset) !== CENTRAL_DIR_SIGNATURE) {
throw new AppError("zip_central_directory_invalid", "Invalid ZIP central di...");
}
const compressionMethod = buffer.readUInt16LE(offset + 10);
const compressedSize = buffer.readUInt32LE(offset + 20);
const uncompressedSize = buffer.readUInt32LE(offset + 24);
const fileNameLength = buffer.readUInt16LE(offset + 28);
const extraFieldLength = buffer.readUInt16LE(offset + 30);
const fileCommentLength = buffer.readUInt16LE(offset + 32);
const localHeaderOffset = buffer.readUInt32LE(offset + 42);
const fileName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);
entries.push({
fileName,
compressionMethod,
compressedSize,
uncompressedSize,
localHeaderOffset
});
offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
}
return entries;
}
export function readZipEntry(buffer, entryName) {
const entry = listZipEntries(buffer).find((candidate) => candidate.fileName === entryName);
if (!entry) throw new AppError("zip_entry_not_found", `ZIP entry not found: ${entryName}`, {
entryName
});
const offset = entry.localHeaderOffset;
if (buffer.readUInt32LE(offset) !== LOCAL_FILE_SIGNATURE) {
throw new AppError("zip_local_header_invalid", "Invalid ZIP local file...", {
entryName
});
}
const fileNameLength = buffer.readUInt16LE(offset + 26);
const extraFieldLength = buffer.readUInt16LE(offset + 28);
const dataStart = offset + 30 + fileNameLength + extraFieldLength;
const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
if (entry.compressionMethod === 0) return compressed;
if (entry.compressionMethod === 8) return inflateRawSync(compressed);
throw new AppError("zip_compression_unsupported", `Unsupported ZIP compression method: ${entry.compressionMethod}`, {
entryName,
compressionMethod: entry.compressionMethod
});
}
export async function readZipEntryFromFile(filePath, entryName) {
const buffer = await readFile(filePath);
return readZipEntry(buffer, entryName);
}