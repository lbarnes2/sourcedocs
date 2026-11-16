import type { AllergenDetailMap, AllergenId } from "@/lib/buffetMenu/allergens";

export type BuffetMenuCategory = {
  id: string;
  title: string;
};

export type BuffetMenuItem = {
  id: string;
  title: string;
  /** `null` = uncategorised */
  categoryId: string | null;
  allergens: Record<AllergenId, boolean>;
  /** Optional cereal / nut names and guest notes for ticked Gluten or Tree nuts; absent on older menus. */
  allergenDetail?: AllergenDetailMap;
  vegetarian: boolean;
  vegan: boolean;
};

export type BuffetMenuState = {
  categories: BuffetMenuCategory[];
  items: BuffetMenuItem[];
};

export type BuffetLabelSize = "a6" | "a7";

export const BUFFET_MENU_JSON_SCHEMA_VERSION = 1 as const;

export type BuffetMenuSavedFile = {
  schemaVersion: typeof BUFFET_MENU_JSON_SCHEMA_VERSION;
  savedAt: string;
  name: string;
  venueLogoKey: string | null;
  /** Display menu background; null or absent = the Settings page default. */
  displayBackgroundKey?: string | null;
  menu: BuffetMenuState;
};

/** Persistent, menu-independent buffet document settings. */
export type BuffetMenuSettings = {
  /** Small print shown at the foot of the allergen matrix. */
  allergenStatement: string;
  showAllergenStatement: boolean;
};
