/** For banqueting/signage Cormorant PDFs only — blocks `ff`/`fi`/`fl` ligation; can add a visible gap in “flat”-style words. */
export function normalizeForCormorantLigatureSafe(text: string): string {
  if (!text) return text;
  const z = "\u200c"; /* ZWNJ — blocks ligation; Noto for buffet display does not use this */
  return text
    .replace(/ffi/g, `f${z}f${z}i`)
    .replace(/ffl/g, `f${z}f${z}l`)
    .replace(/ff/g, `f${z}f`)
    .replace(/fi/g, `f${z}i`)
    .replace(/fl/g, `f${z}l`);
}

const CORMORANT_CHAR_REPLACEMENTS: Record<string, string> = {
  "’": "'",
  "‘": "'",
  "“": "\"",
  "”": "\"",
  "–": "-",
  "—": "-",
  "…": "...",
  "ß": "ss",
  "Æ": "AE",
  "æ": "ae",
  "Œ": "OE",
  "œ": "oe",
  "Ø": "O",
  "ø": "o",
  "Đ": "D",
  "đ": "d",
  "Ł": "L",
  "ł": "l",
  "Þ": "Th",
  "þ": "th"
};

/**
 * Cormorant: decompose and remap. Does **not** insert ZWNJ, so “flat” keeps normal letter spacing. Use for Cormorant text only.
 * For long Cormorant runs where `fl` mis-renders, use {@link normalizeForCormorantLigatureSafe}.
 */
export function normalizeForCormorant(text: string): string {
  if (!text) return "";
  const remapped = Array.from(text)
    .map((char) => CORMORANT_CHAR_REPLACEMENTS[char] ?? char)
    .join("");
  return remapped.normalize("NFKD").replace(/\p{M}+/gu, "");
}
