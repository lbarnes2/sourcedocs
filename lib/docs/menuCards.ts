import type { DishMenuDuplicateGroup, EventModel } from "@/types";

export interface MenuBookletData {
  starters: string[];
  mains: string[];
  desserts: string[];
}

function trimNorm(value: string): string {
  return value.trim();
}

export function dishCanonicalForMenu(dish: string, groups: DishMenuDuplicateGroup[]): string {
  const t = trimNorm(dish);
  if (!t) return dish;
  for (const group of groups) {
    const canonical = trimNorm(group.canonical) || t;
    for (const member of group.match) {
      if (trimNorm(member) === t) return canonical;
    }
  }
  return t;
}

function uniqueValuesMerged(values: string[], groups: DishMenuDuplicateGroup[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => trimNorm(value))
        .filter(Boolean)
        .map((value) => dishCanonicalForMenu(value, groups))
    )
  );
}

function applyLongNames(values: string[], longNames: Record<string, string>): string[] {
  return values.map((value) => {
    const replacement = longNames[value];
    if (!replacement) return value;
    const trimmed = replacement.trim();
    return trimmed || value;
  });
}

/** If a duplicate group collapses to `canonical`, copy long text from any member override. */
export function augmentMenuLongNamesForDuplicateGroups(
  menuLongNames: Record<string, string>,
  groups: DishMenuDuplicateGroup[],
  dishNameOverrides: Record<string, { shortName: string; longName: string }>
): Record<string, string> {
  const out = { ...menuLongNames };
  for (const group of groups) {
    const canonical = trimNorm(group.canonical);
    if (!canonical || out[canonical]) continue;
    for (const member of group.match) {
      const key = trimNorm(member);
      const override = dishNameOverrides[key];
      const longDirect = override?.longName ? trimNorm(override.longName) : "";
      if (longDirect) {
        out[canonical] = longDirect;
        break;
      }
      const shortKey = override?.shortName ? trimNorm(override.shortName) : key;
      if (shortKey && out[shortKey]) {
        out[canonical] = out[shortKey];
        break;
      }
    }
  }
  return out;
}

export function validateDishMenuDuplicateGroups(
  groups: DishMenuDuplicateGroup[]
): string | null {
  const claimed = new Map<string, string>();
  for (const group of groups) {
    const canonical = trimNorm(group.canonical);
    for (const member of group.match) {
      const t = trimNorm(member);
      if (!t) continue;
      const existing = claimed.get(t);
      if (existing && existing !== canonical) {
        return `Dish “${t}” is listed in more than one menu merge group. Remove the overlap and try again.`;
      }
      claimed.set(t, canonical);
    }
  }
  return null;
}

export function buildMenuBookletDocument(
  model: EventModel,
  menuLongNames: Record<string, string> = {},
  duplicateGroups: DishMenuDuplicateGroup[] = []
): MenuBookletData {
  const starters = uniqueValuesMerged(
    model.guests.map((guest) => guest.starter),
    duplicateGroups
  );
  const mains = uniqueValuesMerged(
    model.guests.map((guest) => guest.main),
    duplicateGroups
  );
  const desserts = uniqueValuesMerged(
    model.guests.map((guest) => guest.dessert),
    duplicateGroups
  );
  return {
    starters: applyLongNames(starters, menuLongNames),
    mains: applyLongNames(mains, menuLongNames),
    desserts: applyLongNames(desserts, menuLongNames)
  };
}
