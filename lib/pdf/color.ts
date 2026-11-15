import { rgb } from "pdf-lib";

function parseHexToRgbComponents(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(cleaned)) return null;
  const full =
    cleaned.length === 3 ? cleaned.split("").map((c) => c + c).join("") : cleaned;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value)) return null;
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

/**
 * Converts #RGB / #RRGGBB to pdf-lib `rgb`, never returning NaN components.
 */
export function hexToRgb(input: string | undefined, fallbackHex: string): ReturnType<typeof rgb> {
  const primary = parseHexToRgbComponents((input ?? "").trim());
  const fallback = parseHexToRgbComponents(fallbackHex);
  const emergency = parseHexToRgbComponents("#012f43")!;
  const chosen = primary ?? fallback ?? emergency;
  return rgb(chosen.r / 255, chosen.g / 255, chosen.b / 255);
}

/** WCAG relative luminance (0 = black, 1 = white) of a hex colour. */
export function hexLuminance(input: string | undefined, fallbackHex: string): number {
  const c = parseHexToRgbComponents((input ?? "").trim()) ?? parseHexToRgbComponents(fallbackHex) ?? { r: 1, g: 47, b: 67 };
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

const DARK_INK = rgb(0.07, 0.1, 0.14);

/** White or dark text, whichever reads better on a fill of the given colour. */
export function textOnColor(input: string | undefined, fallbackHex: string): ReturnType<typeof rgb> {
  // Contrast with white is (1.05 / (L + 0.05)); below ~3:1 switch to dark ink.
  return hexLuminance(input, fallbackHex) > 0.3 ? DARK_INK : rgb(1, 1, 1);
}

/** The colour itself when it is dark enough to read as text on white paper, otherwise dark ink. */
export function inkOnWhite(input: string | undefined, fallbackHex: string): ReturnType<typeof rgb> {
  return hexLuminance(input, fallbackHex) > 0.4 ? DARK_INK : hexToRgb(input, fallbackHex);
}
