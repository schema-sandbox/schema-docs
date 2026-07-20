import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { AppError } from "./errors.js";
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP64_UINT16 = 0xffff;
const ZIP64_UINT32 = 0xffffffff;
const MIN_RATIO_CHECK_BYTES = 1024 * 1024;
export const ZIP_SECURITY_LIMITS = Object.freeze({
maxEntries: 10000,
maxEntryUncompressedBytes: 128 * 1024 * 1024,
maxTotalUncompressedBytes: 512 * 1024 * 1024,
maxCompressionRatio: 500
});
function zipError(code, message, details = {}) {
return new AppError(code, message, details);
}
function assertRange(buffer, offset, length, code, details = {}) {
if (!Buffer.isBuffer(buffer) || offset < 0 || length < 0 || offset + length > buffer.length) {
throw zipError(code, "ZIP structure points outside the archive.", {
offset,
length,
archiveSize: buffer?.length ?? 0,
...details
});
}
}
function findEndOfCentralDirectory(buffer) {
if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
throw zipError("zip_eocd_not_found", "Could not find ZIP end of central directory.");
}
const minOffset = Math.max(0, buffer.length - 0xffff - 22);
for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
}
throw zipError("zip_eocd_not_found", "Could not find ZIP end of central directory.");
}
function normalizeLimits(overrides = {}) {
return { ...ZIP_SECURITY_LIMITS, ...overrides };
}
function assertEntryLimits(entry, limits, totalUncompressedBytes) {
if (entry.uncompressedSize > limits.maxEntryUncompressedBytes) {
throw zipError("zip_entry_too_large", `ZIP entry is too large after decompression: ${entry.fileName}`, {
entryName: entry.fileName,
uncompressedSize: entry.uncompressedSize,
limit: limits.maxEntryUncompressedBytes
});
}
if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
throw zipError("zip_total_too_large", "ZIP archive expands beyond the allowed total size.", {
totalUncompressedBytes,
limit: limits.maxTotalUncompressedBytes
});
}
if (entry.uncompressedSize >= MIN_RATIO_CHECK_BYTES) {
const ratio = entry.compressedSize === 0 ? Number.POSITIVE_INFINITY : entry.uncompressedSize / entry.compressedSize;
if (ratio > limits.maxCompressionRatio) {
throw zipError("zip_compression_ratio_exceeded", `ZIP entry has a suspicious compression ratio: ${entry.fileName}`, {
entryName: entry.fileName,
compressedSize: entry.compressedSize,
uncompressedSize: entry.uncompressedSize,
ratio,
limit: limits.maxCompressionRatio
});
}
}
}
export function listZipEntries(buffer, limitOverrides = {}) {
const limits = normalizeLimits(limitOverrides);
const eocdOffset = findEndOfCentralDirectory(buffer);
assertRange(buffer, eocdOffset, 22, "zip_eocd_invalid");
const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
const centralDisk = buffer.readUInt16LE(eocdOffset + 6);
const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
const entryCount = buffer.readUInt16LE(eocdOffset + 10);
const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
if ([entriesOnDisk, entryCount].includes(ZIP64_UINT16) || [centralDirectorySize, centralDirectoryOffset].includes(ZIP64_UINT32)) {
throw zipError("zip64_unsupported", "ZIP64 archives are not accepted by the local safety parser.");
}
if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
throw zipError("zip_multidisk_unsupported", "Multi-disk ZIP archives are not supported.");
}
if (entryCount > limits.maxEntries) {
throw zipError("zip_too_many_entries", `ZIP archive contains too many entries: ${entryCount}`, {
entryCount,
limit: limits.maxEntries
});
}
assertRange(buffer, centralDirectoryOffset, centralDirectorySize, "zip_central_directory_invalid");
if (centralDirectoryOffset + centralDirectorySize > eocdOffset) {
throw zipError("zip_central_directory_invalid", "ZIP central directory overlaps the end record.");
}
const entries = [];
let offset = centralDirectoryOffset;
let totalUncompressedBytes = 0;
for (let index = 0; index < entryCount; index += 1) {
assertRange(buffer, offset, 46, "zip_central_directory_invalid", { index });
if (buffer.readUInt32LE(offset) !== CENTRAL_DIR_SIGNATURE) {
throw zipError("zip_central_directory_invalid", "Invalid ZIP central directory signature.", { index, offset });
}
const flags = buffer.readUInt16LE(offset + 8);
const compressionMethod = buffer.readUInt16LE(offset + 10);
const compressedSize = buffer.readUInt32LE(offset + 20);
const uncompressedSize = buffer.readUInt32LE(offset + 24);
const fileNameLength = buffer.readUInt16LE(offset + 28);
const extraFieldLength = buffer.readUInt16LE(offset + 30);
const fileCommentLength = buffer.readUInt16LE(offset + 32);
const localHeaderOffset = buffer.readUInt32LE(offset + 42);
const recordLength = 46 + fileNameLength + extraFieldLength + fileCommentLength;
assertRange(buffer, offset, recordLength, "zip_central_directory_invalid", { index });
if ([compressedSize, uncompressedSize, localHeaderOffset].includes(ZIP64_UINT32)) {
throw zipError("zip64_unsupported", "ZIP64 entries are not accepted by the local safety parser.", { index });
}
if ((flags & 0x1) !== 0) {
throw zipError("zip_encryption_unsupported", "Encrypted ZIP entries are not supported.", { index });
}
const fileName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);
const entry = { fileName, flags, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset };
totalUncompressedBytes += uncompressedSize;
if (!Number.isSafeInteger(totalUncompressedBytes)) {
throw zipError("zip_total_too_large", "ZIP uncompressed size overflowed the safe integer range.");
}
assertEntryLimits(entry, limits, totalUncompressedBytes);
assertRange(buffer, localHeaderOffset, 30, "zip_local_header_invalid", { entryName: fileName });
entries.push(entry);
offset += recordLength;
}
if (offset !== centralDirectoryOffset + centralDirectorySize) {
throw zipError("zip_central_directory_invalid", "ZIP central directory size does not match parsed entries.", {
expectedEnd: centralDirectoryOffset + centralDirectorySize,
actualEnd: offset
});
}
return entries;
}
export function readZipEntry(buffer, entryName, limitOverrides = {}) {
const entry = listZipEntries(buffer, limitOverrides).find((candidate) => candidate.fileName === entryName);
if (!entry) throw zipError("zip_entry_not_found", `ZIP entry not found: ${entryName}`, { entryName });
const offset = entry.localHeaderOffset;
assertRange(buffer, offset, 30, "zip_local_header_invalid", { entryName });
if (buffer.readUInt32LE(offset) !== LOCAL_FILE_SIGNATURE) {
throw zipError("zip_local_header_invalid", "Invalid ZIP local file header.", { entryName });
}
const localFlags = buffer.readUInt16LE(offset + 6);
const localMethod = buffer.readUInt16LE(offset + 8);
const fileNameLength = buffer.readUInt16LE(offset + 26);
const extraFieldLength = buffer.readUInt16LE(offset + 28);
if ((localFlags & 0x1) !== 0 || localMethod !== entry.compressionMethod) {
throw zipError("zip_local_header_invalid", "ZIP local header does not match the central directory.", { entryName });
}
const dataStart = offset + 30 + fileNameLength + extraFieldLength;
assertRange(buffer, dataStart, entry.compressedSize, "zip_entry_truncated", { entryName });
const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
let output;
if (entry.compressionMethod === 0) {
output = compressed;
} else if (entry.compressionMethod === 8) {
try {
output = inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize + 1 });
} catch (error) {
throw zipError("zip_decompression_failed", `Failed to safely decompress ZIP entry: ${entryName}`, {
entryName,
originalError: error.message
});
}
} else {
throw zipError("zip_compression_unsupported", `Unsupported ZIP compression method: ${entry.compressionMethod}`, {
entryName,
compressionMethod: entry.compressionMethod
});
}
if (output.length !== entry.uncompressedSize) {
throw zipError("zip_size_mismatch", `ZIP entry size does not match its central-directory metadata: ${entryName}`, {
entryName,
expected: entry.uncompressedSize,
actual: output.length
});
}
return output;
}
export async function readZipEntryFromFile(filePath, entryName, limitOverrides = {}) {
const buffer = await readFile(filePath);
return readZipEntry(buffer, entryName, limitOverrides);
}
