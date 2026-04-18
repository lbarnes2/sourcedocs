import type { DishNameOverride } from "@/types";

/**
 * Multiple override rows must not map the same trimmed short name to different long names.
 */
export function validateDishOverrideShortNameUniqueness(
  dishNameOverrides: Record<string, DishNameOverride>
): string | null {
  const byShort = new Map<string, string>();
  for (const entry of Object.values(dishNameOverrides)) {
    const shortName = entry.shortName.trim();
    const longName = entry.longName.trim();
    if (!shortName || !longName) continue;
    const existing = byShort.get(shortName);
    if (existing !== undefined && existing !== longName) {
      return `Conflicting long names for short dish name “${shortName}”.`;
    }
    byShort.set(shortName, longName);
  }
  return null;
}
