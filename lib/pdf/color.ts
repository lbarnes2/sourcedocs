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
