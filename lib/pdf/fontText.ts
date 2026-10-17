import type { PDFFont } from "pdf-lib";

/** Fallbacks for characters a font may lack (e.g. Sora has no Greek/Cyrillic and only core Latin Extended). */
const CHAR_FALLBACKS: Record<string, string> = {
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

const characterSets = new WeakMap<PDFFont, Set<number>>();

function characterSetOf(font: PDFFont): Set<number> {
  let set = characterSets.get(font);
  if (!set) {
    set = new Set(font.getCharacterSet());
    characterSets.set(font, set);
  }
  return set;
}

/**
 * Keeps every character `font` can draw; anything else falls back to a plain-ASCII equivalent or its
 * unaccented form, so a title never prints a missing-glyph box when a close substitute exists.
 */
export function fitTextToFont(text: string, font: PDFFont): string {
  if (!text) return text;
  const has = characterSetOf(font);
  const canDraw = (s: string) => Array.from(s).every((c) => has.has(c.codePointAt(0)!));
  return Array.from(text)
    .map((char) => {
      if (canDraw(char)) return char;
      const mapped = CHAR_FALLBACKS[char];
      if (mapped && canDraw(mapped)) return mapped;
      const stripped = char.normalize("NFKD").replace(/\p{M}+/gu, "");
      return stripped && canDraw(stripped) ? stripped : char;
    })
    .join("");
}

/** True when `font` can draw every character of `text` once {@link fitTextToFont} fallbacks are applied. */
export function fontCanDraw(text: string, font: PDFFont): boolean {
  const has = characterSetOf(font);
  return Array.from(fitTextToFont(text, font)).every((c) => has.has(c.codePointAt(0)!));
}

/**
 * The title font when it can draw all of `texts`, otherwise `fallback` — e.g. Open Sans Bold for Greek or
 * Cyrillic event names, which Sora has no glyphs for. Measure and draw the texts with the returned font.
 */
export function titleFontFor(texts: string[], title: PDFFont, fallback: PDFFont): PDFFont {
  return texts.every((t) => fontCanDraw(t, title)) ? title : fallback;
}
