const CRC_TABLE = new Uint32Array(256).map((_, index) => {
let value = index;
for (let bit = 0; bit < 8; bit += 1) {
value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
}
return value >>> 0;
});
function crc32(buffer) {
let crc = 0xffffffff;
for (const byte of buffer) {
crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
}
return (crc ^ 0xffffffff) >>> 0;
}
function dosDateTime(date = new Date()) {
const year = Math.max(1980, date.getFullYear());
const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
return { dosDate, dosTime };
}
function localHeader(entry, offset) {
const header = Buffer.alloc(30 + entry.name.length);
header.writeUInt32LE(0x04034b50, 0);
header.writeUInt16LE(20, 4);
header.writeUInt16LE(0, 6);
header.writeUInt16LE(0, 8);
header.writeUInt16LE(entry.dosTime, 10);
header.writeUInt16LE(entry.dosDate, 12);
header.writeUInt32LE(entry.crc, 14);
header.writeUInt32LE(entry.content.length, 18);
header.writeUInt32LE(entry.content.length, 22);
header.writeUInt16LE(entry.name.length, 26);
header.writeUInt16LE(0, 28);
entry.name.copy(header, 30);
entry.offset = offset;
return header;
}
function centralHeader(entry) {
const header = Buffer.alloc(46 + entry.name.length);
header.writeUInt32LE(0x02014b50, 0);
header.writeUInt16LE(20, 4);
header.writeUInt16LE(20, 6);
header.writeUInt16LE(0, 8);
header.writeUInt16LE(0, 10);
header.writeUInt16LE(entry.dosTime, 12);
header.writeUInt16LE(entry.dosDate, 14);
header.writeUInt32LE(entry.crc, 16);
header.writeUInt32LE(entry.content.length, 20);
header.writeUInt32LE(entry.content.length, 24);
header.writeUInt16LE(entry.name.length, 28);
header.writeUInt16LE(0, 30);
header.writeUInt16LE(0, 32);
header.writeUInt16LE(0, 34);
header.writeUInt16LE(0, 36);
header.writeUInt32LE(0, 38);
header.writeUInt32LE(entry.offset, 42);
entry.name.copy(header, 46);
return header;
}
export function createZip(entries) {
const timestamp = dosDateTime();
const normalized = entries.map((entry) => {
const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, "utf8");
return {
name: Buffer.from(entry.name.replace(/\\/g, "/"), "utf8"),
content,
crc: crc32(content),
...timestamp
};
});
const fileParts = [];
let offset = 0;
for (const entry of normalized) {
const header = localHeader(entry, offset);
fileParts.push(header, entry.content);
offset += header.length + entry.content.length;
}
const centralParts = normalized.map(centralHeader);
const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(normalized.length, 8);
end.writeUInt16LE(normalized.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);
end.writeUInt16LE(0, 20);
return Buffer.concat([...fileParts, ...centralParts, end]);
}