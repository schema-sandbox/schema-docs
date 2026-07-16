export function decodeXmlEntities(value) {
return value
.replaceAll("&lt;", "<")
.replaceAll("&gt;", ">")
.replaceAll("&quot;", "\"")
.replaceAll("&apos;", "'")
.replaceAll("&amp;", "&");
}
export function stripXmlTags(value) {
return decodeXmlEntities(value.replace(/<[^>]*>/g, ""));
}
export function getXmlBlocks(xml, tagName) {
const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tagName}>`, "g");
return xml.match(pattern) ?? [];
}
export function getXmlTextValues(xml, tagName) {
const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "g");
const values = [];
let match;
while ((match = pattern.exec(xml)) !== null) {
values.push(decodeXmlEntities(match[1]));
}
return values;
}
export function hasTag(xml, tagName) {
return new RegExp(`<${tagName}(?:\\s|\\/|>)`).test(xml);
}
export function getAttribute(xml, attributeName) {
const pattern = new RegExp(`${attributeName}="([^"]*)"`);
return pattern.exec(xml)?.[1];
}