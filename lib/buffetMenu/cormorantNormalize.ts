/** Breaks common Latin ligatures so pdf-lib + Cormorant avoid a known `fl`/`fi` rendering glitch (stray stroke after the ligature). */
function breakProblematicLatinLigatures(text: string): string {
  if (!text) return text;
  const z = "\u200c"; /* ZWNJ — zero width; blocks ligation */
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

/** Cormorant Garamond PDF text: decompose, remap chars, and disable Latin ligatures that mis-render in pdf-lib. */
export function normalizeForCormorant(text: string): string {
  if (!text) return "";
  const remapped = Array.from(text)
    .map((char) => CORMORANT_CHAR_REPLACEMENTS[char] ?? char)
    .join("");
  const n = remapped.normalize("NFKD").replace(/\p{M}+/gu, "");
  return breakProblematicLatinLigatures(n);
}
