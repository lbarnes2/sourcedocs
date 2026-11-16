import type { DishMenuDuplicateGroup, EventModel, MenuCardLayout, MenuCourseKey, MenuDietaryKey } from "@/types";

export interface MenuBookletData {
  starters: string[];
  mains: string[];
  desserts: string[];
  /** Explanations for the dietary keys used, e.g. "(v) vegetarian"; empty when none are. */
  keyLegend: string[];
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

export const MENU_KEY_LABELS: Record<MenuDietaryKey, string> = {
  v: "vegetarian",
  ve: "vegan",
  gf: "gluten free"
};
const MENU_KEY_ORDER: MenuDietaryKey[] = ["v", "ve", "gf"];

/** Keys as printed after a dish: "(ve) (gf)". Vegan already says vegetarian, so "(v)" is dropped beside it. */
export function menuKeySuffix(keys: MenuDietaryKey[] | undefined): string {
  if (!keys?.length) return "";
  const set = new Set(keys);
  if (set.has("ve")) set.delete("v");
  return MENU_KEY_ORDER.filter((key) => set.has(key))
    .map((key) => `(${key})`)
    .join(" ");
}

/**
 * The dishes of one course as menu lines, before long names: unique, merged by duplicate group, and
 * arranged by the saved order (dishes not in the saved order follow, in guest-list order).
 */
export function menuDishKeysForCourse(
  dishes: string[],
  groups: DishMenuDuplicateGroup[],
  savedOrder: string[] = []
): string[] {
  const unique = uniqueValuesMerged(dishes, groups);
  const position = new Map(savedOrder.map((dish, index) => [dish, index]));
  return unique
    .map((dish, index) => ({ dish, index }))
    .sort((a, b) => {
      const pa = position.get(a.dish);
      const pb = position.get(b.dish);
      if (pa !== undefined && pb !== undefined) return pa - pb;
      if (pa !== undefined) return -1;
      if (pb !== undefined) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.dish);
}

export function buildMenuBookletDocument(
  model: EventModel,
  menuLongNames: Record<string, string> = {},
  duplicateGroups: DishMenuDuplicateGroup[] = [],
  layout?: MenuCardLayout
): MenuBookletData {
  const used = new Set<MenuDietaryKey>();
  const course = (key: MenuCourseKey): string[] => {
    const dishKeys = menuDishKeysForCourse(
      model.guests.map((guest) => guest[key]),
      duplicateGroups,
      layout?.order?.[key]
    );
    const names = applyLongNames(dishKeys, menuLongNames);
    return names.map((name, index) => {
      const keys = layout?.keys?.[dishKeys[index]];
      const suffix = menuKeySuffix(keys);
      if (!suffix) return name;
      keys?.forEach((k) => used.add(k));
      return `${name} ${suffix}`;
    });
  };
  const starters = course("starter");
  const mains = course("main");
  const desserts = course("dessert");
  if (used.has("ve")) used.delete("v");
  // Only explain the keys that actually appear ("(v)" may have been replaced by "(ve)" on every dish).
  const printed = [...starters, ...mains, ...desserts].join(" ");
  const keyLegend = MENU_KEY_ORDER.filter((k) => printed.includes(`(${k})`)).map((k) => `(${k}) ${MENU_KEY_LABELS[k]}`);
  return { starters, mains, desserts, keyLegend };
}
