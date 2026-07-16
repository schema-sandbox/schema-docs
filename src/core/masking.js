import fs from "node:fs";
import path from "node:path";
let cachedRules = null;
function loadRules() {
if (cachedRules) return cachedRules;
try {
const rulesPath = path.join(import.meta.dirname, "dlp-rules.json");
if (fs.existsSync(rulesPath)) {
const content = fs.readFileSync(rulesPath, "utf8");
const parsed = JSON.parse(content);
if (parsed && Array.isArray(parsed.rules)) {
cachedRules = parsed.rules.map(r => ({
...r,
regex: new RegExp(r.pattern, r.flags)
}));
return cachedRules;
}
}
} catch (err) {
}
const defaultRules = [
{
name: "secret",
type: "replace",
regex: /(\b(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|secret[_-]?access[_-]?key|client[_-]?secret|secret|password|token)\b|\u5bc6\u7801|\u53e3\u4ee4|\u79d8\u94a5)(\s*[:=\uff1a]\s*)(["']?)([^\s"']{4,})(\3)/gi,
      maskType: "secret",
      replaceGroup: 4
    },
    {
      name: "bearer_token",
      type: "replace",
      regex: /\b(authorization\s*[:=\uff1a]\s*Bearer\s+|Bearer\s+)([a-zA-Z0-9._~+/=-]{12,})/gi,
      maskType: "secret",
      replaceGroup: 2
    },
    {
      name: "api_key_like",
      type: "simple",
      regex: /\b(?:sk|key|rk|pk)-[a-zA-Z0-9][a-zA-Z0-9_-]{5,}\b/g,
      maskType: "secret"
    },
    {
      name: "cloud_access_key",
      type: "simple",
      regex: /\b(?:AKIA|ASIA|LTAI|AIza)[a-zA-Z0-9_-]{12,}\b/g,
      maskType: "secret"
    },
    {
      name: "labeled_uuid_token",
      type: "replace",
      regex: /\b(token|session[_-]?token|auth[_-]?token|credential[_-]?id)\b(\s*[:=\uff1a]\s*)([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\b/gi,
      maskType: "secret",
      replaceGroup: 3
    },
    {
      name: "email",
      type: "simple",
      regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      maskType: "email"
    },
    {
      name: "ip",
      type: "simple",
      regex: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
      maskType: "ip"
    },
    {
      name: "cn_resident_id",
      type: "simple",
      regex: /\b[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g,
      maskType: "id"
    },
    {
      name: "cn_bank_card_labeled",
      type: "replace",
      regex: /(\u94f6\u884c\u5361\u53f7|\u94f6\u884c\u5361|\u5361\u53f7|\bbank\s*card(?:\s*number)?\b|\bcard\s*(?:number|no\.?)\b)(\s*(?:[:=\uff1a]\s*)?)((?:\d[ -]?){12,18}\d)/gi,
      maskType: "bank",
      replaceGroup: 3
    },
    {
      name: "cn_bank_card_luhn",
      type: "bank_card",
      regex: /\b(?:\d{13,19}|(?:\d{4} ){3}\d{4}(?: \d{3})?)\b/g,
      maskType: "bank"
    },
    {
      name: "phone",
      type: "phone",
      regex: /\+?\d[\d\s().-]{6,}\d/g,
      maskType: "phone"
    }
  ];
  cachedRules = defaultRules;
  return cachedRules;
}
export function maskSensitiveData(text) {
  if (typeof text !== "string") return { maskedText: "", mapping: {} };
  const rules = loadRules();
  const mapping = {};
  let maskedText = text;
  const reservedPlaceholders = new Set(text.match(/\[MASK_[A-Z]+_\d+\]/g) ?? []);
  const valuePlaceholders = new Map();
  let secretCounter = 1;
  let emailCounter = 1;
  let ipCounter = 1;
  let phoneCounter = 1;
  const genericCounters = new Map();
  const splitTrailingPunctuation = (val) => {
    const match = /^(.+?)([.,;:!?，。；：！？、)]*)$/.exec(val);
    return {
      value: match?.[1] ?? val,
      trailing: match?.[2] ?? ""
    };
  };
  const getPlaceholder = (type, val) => {
    if (val.startsWith("[MASK_")) {
      return val;
    }
    const valueKey = `${type}\u0000${val}`;
    if (valuePlaceholders.has(valueKey)) {
      return valuePlaceholders.get(valueKey);
    }
    let placeholder;
    if (type === "secret") {
      do placeholder = `[MASK_SECRET_${secretCounter++}]`;
      while (reservedPlaceholders.has(placeholder));
    } else if (type === "email") {
      do placeholder = `[MASK_EMAIL_${emailCounter++}]`;
      while (reservedPlaceholders.has(placeholder));
    } else if (type === "ip") {
      do placeholder = `[MASK_IP_${ipCounter++}]`;
      while (reservedPlaceholders.has(placeholder));
    } else if (type === "phone") {
      do placeholder = `[MASK_PHONE_${phoneCounter++}]`;
      while (reservedPlaceholders.has(placeholder));
    } else if (type === "id" || type === "pii" || type === "bank") {
      const label = type.toUpperCase();
      let next;
      do {
        next = (genericCounters.get(label) ?? 0) + 1;
        genericCounters.set(label, next);
        placeholder = `[MASK_${label}_${next}]`;
      } while (reservedPlaceholders.has(placeholder));
    } else {
      do placeholder = `[MASK_SECRET_${secretCounter++}]`;
      while (reservedPlaceholders.has(placeholder));
    }
    reservedPlaceholders.add(placeholder);
    valuePlaceholders.set(valueKey, placeholder);
    mapping[placeholder] = val;
    return placeholder;
  };
  const isLikelyPhone = (match) => {
    const value = match.trim();
    const digits = value.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) return false;
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(value)) return false;
    if ((value.match(/\./g) ?? []).length >= 2) return false;
    if (value.startsWith("+")) return true;
    if (/^1[3-9]\d{9}$/.test(digits)) return true;
    if (/^0\d{2,3}[-\s]\d{7,8}$/.test(value)) return true;
    if (/^\(?\d{3}\)?[-\s]\d{3}[-\s]\d{4}$/.test(value)) return true;
    return false;
  };
  const isLikelyBankCard = (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    const doubleParity = digits.length % 2;
    for (let index = 0; index < digits.length; index += 1) {
      let digit = Number(digits[index]);
      if (index % 2 === doubleParity) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
    }
    return sum % 10 === 0;
  };
  for (const rule of rules) {
    if (rule.type === "simple") {
      maskedText = maskedText.replace(rule.regex, (match) => {
        if (match.startsWith("[MASK_")) {
          return match;
        }
        return getPlaceholder(rule.maskType || "secret", match);
      });
    } else if (rule.type === "replace") {
      maskedText = maskedText.replace(rule.regex, (match, ...groups) => {
        const groupIdx = (rule.replaceGroup || 1) - 1;
        const secretVal = groups[groupIdx];
        if (secretVal && !secretVal.startsWith("[MASK_")) {
          const { value, trailing } = splitTrailingPunctuation(secretVal);
          const placeholder = getPlaceholder(rule.maskType || "secret", value);
          return match.replace(secretVal, placeholder + trailing);
        }
        return match;
      });
    } else if (rule.type === "phone") {
      maskedText = maskedText.replace(rule.regex, (match, offset, source) => {
        if (match.startsWith("[MASK_")) {
          return match;
        }
        const prefix = source.slice(Math.max(0, offset - 24), offset);
        const labeled = /(?:phone|mobile|tel|telephone|\u624b\u673a|\u624b\u673a\u53f7|\u7535\u8bdd|\u8054\u7cfb\u7535\u8bdd)\s*[:=\uff1a]?\s*$/i.test(prefix);
        if (labeled || isLikelyPhone(match)) return getPlaceholder(rule.maskType || "phone", match);
        return match;
      });
    } else if (rule.type === "bank_card") {
      maskedText = maskedText.replace(rule.regex, (match) => {
        if (match.startsWith("[MASK_")) return match;
        if (isLikelyBankCard(match)) return getPlaceholder(rule.maskType || "bank", match);
        return match;
      });
    }
  }
  return { maskedText, mapping };
}
export function unmaskSensitiveData(text, mapping) {
  if (typeof text !== "string") return "";
  if (!mapping || typeof mapping !== "object") return text;
  let unmaskedText = text;
  const sortedPlaceholders = Object.keys(mapping).sort((a, b) => b.length - a.length);
  for (const placeholder of sortedPlaceholders) {
    unmaskedText = unmaskedText.replaceAll(placeholder, mapping[placeholder]);
  }
  return unmaskedText;
}
export const RELEASE_CHECK_FEATURES = [
  "BEARER_TOKEN_REGEX",
  "CLOUD_ACCESS_KEY_REGEX",
  "LABELED_UUID_TOKEN_REGEX"
];
