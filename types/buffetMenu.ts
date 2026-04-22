import type { AllergenId } from "@/lib/buffetMenu/allergens";

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
  vegetarian: boolean;
  vegan: boolean;
};

export type BuffetMenuState = {
  categories: BuffetMenuCategory[];
  items: BuffetMenuItem[];
};

export const BUFFET_MENU_JSON_SCHEMA_VERSION = 1 as const;

export type BuffetMenuSavedFile = {
  schemaVersion: typeof BUFFET_MENU_JSON_SCHEMA_VERSION;
  savedAt: string;
  name: string;
  venueLogoKey: string | null;
  menu: BuffetMenuState;
};
