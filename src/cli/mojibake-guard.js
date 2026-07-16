export const knownMojibakeFragments = [
  "\u951f", "\u951f\ufffd", "\u934f", "\u95ab", "\u6769", "\u5997", "\u7ec0", "\u7035",
  "\u8930", "\u93c8", "\u5bb8", "\u93c2", "\u6d5c", "\u705e", "\u923f", "\u93c4",
  "\u9359", "\u9422", "\u5be4", "\u93ad", "\u4e04", "\u68f0", "\u935e", "\u95bf",
  "\u6d63", "\u9983", "\u6d93", "\ue15f", "\u6783", "\u9423", "\u5c84", "\u6f70",
  "\ufffd", "\u{1F6E1}", "\u2705", "\u274c", "\u26a0", "\u{1F4CA}", "\u{1F4C1}"
];

export function hasKnownMojibake(value) {
  return knownMojibakeFragments.some((fragment) => String(value).includes(fragment));
}

export function findKnownMojibake(value) {
  return knownMojibakeFragments.filter((fragment) => String(value).includes(fragment));
}
