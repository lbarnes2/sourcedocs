import type { DishNameOverride } from "@/types";

export interface MenuLongNameResolution {
  /** Short name → the long name printed on the menu card. */
  byShort: Record<string, string>;
  /** Set when two dishes share a short name but were each given a different, hand-edited long name. */
  conflict: string | null;
}

/**
 * Works out the menu wording for each short name.
 *
 * Several guest-list spellings can share one short name ("Beef" and "beef" → "Beef"). Their long
 * names start out as the original spellings, so they differ without anyone having chosen that. Only
 * long names somebody actually edited can conflict; otherwise the edited one wins, then a long name
 * that matches the short name, then the first spelling.
 */
export function resolveMenuLongNames(dishNameOverrides: Record<string, DishNameOverride>): MenuLongNameResolution {
  const groups = new Map<string, Array<{ longName: string; edited: boolean }>>();
  for (const [original, entry] of Object.entries(dishNameOverrides)) {
    const shortName = entry.shortName.trim();
    const longName = entry.longName.trim();
    if (!shortName || !longName) continue;
    const list = groups.get(shortName) ?? [];
    list.push({ longName, edited: longName !== original.trim() });
    groups.set(shortName, list);
  }

  const byShort: Record<string, string> = {};
  let conflict: string | null = null;
  groups.forEach((entries, shortName) => {
    const edited = Array.from(new Set(entries.filter((entry) => entry.edited).map((entry) => entry.longName)));
    if (edited.length > 1 && !conflict) {
      conflict = `“${shortName}” is the short name for more than one dish, and they have different long names (${edited
        .slice(0, 2)
        .map((name) => `“${name}”`)
        .join(" and ")}). Give them the same long name under Dish names.`;
    }
    byShort[shortName] =
      edited[0] ?? entries.find((entry) => entry.longName === shortName)?.longName ?? entries[0].longName;
  });
  return { byShort, conflict };
}

/** Null when every short name resolves to one menu wording. */
export function validateDishOverrideShortNameUniqueness(
  dishNameOverrides: Record<string, DishNameOverride>
): string | null {
  return resolveMenuLongNames(dishNameOverrides).conflict;
}
