/** UK Food Information Regulations — 14 allergens (stable ids and labels). */

export const ALLERGEN_IDS = [
  "celery",
  "gluten",
  "crustaceans",
  "eggs",
  "fish",
  "lupin",
  "milk",
  "molluscs",
  "mustard",
  "nuts",
  "peanuts",
  "sesame",
  "soya",
  "sulphites"
] as const;

export type AllergenId = (typeof ALLERGEN_IDS)[number];

export type AllergenDef = {
  id: AllergenId;
  /** Matrix column header */
  shortLabel: string;
  /** Full wording for labels / accessibility */
  fullLabel: string;
};

export const ALLERGENS: AllergenDef[] = [
  { id: "celery", shortLabel: "Celery", fullLabel: "Celery" },
  { id: "gluten", shortLabel: "Gluten", fullLabel: "Cereals containing gluten" },
  { id: "crustaceans", shortLabel: "Crustacean", fullLabel: "Crustacean" },
  { id: "eggs", shortLabel: "Eggs", fullLabel: "Eggs" },
  { id: "fish", shortLabel: "Fish", fullLabel: "Fish" },
  { id: "lupin", shortLabel: "Lupin", fullLabel: "Lupin" },
  { id: "milk", shortLabel: "Milk", fullLabel: "Milk" },
  { id: "molluscs", shortLabel: "Molluscs", fullLabel: "Molluscs" },
  { id: "mustard", shortLabel: "Mustard", fullLabel: "Mustard" },
  { id: "nuts", shortLabel: "Tree nuts", fullLabel: "Tree nuts" },
  { id: "peanuts", shortLabel: "Peanuts", fullLabel: "Peanuts" },
  { id: "sesame", shortLabel: "Sesame", fullLabel: "Sesame" },
  { id: "soya", shortLabel: "Soya", fullLabel: "Soya" },
  { id: "sulphites", shortLabel: "Sulphites", fullLabel: "Sulphur dioxide and sulphites" }
];

export const ALLERGENS_BY_ID: Record<AllergenId, AllergenDef> = Object.fromEntries(
  ALLERGENS.map((a) => [a.id, a])
) as Record<AllergenId, AllergenDef>;

export function emptyAllergenMap(): Record<AllergenId, boolean> {
  const o = {} as Record<AllergenId, boolean>;
  for (const id of ALLERGEN_IDS) o[id] = false;
  return o;
}
