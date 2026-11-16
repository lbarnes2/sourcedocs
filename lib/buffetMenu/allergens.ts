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

/* ---------------------------------------------------------------------------
   Allergen detail: the specific cereal or nut behind a Gluten / Tree nuts tick.
   The law names the allergen as "cereals containing gluten, namely wheat (such as spelt and khorasan), rye,
   barley, oats" and lists the tree nuts individually, so the matrix can print which one it is.
   --------------------------------------------------------------------------- */

export const DETAILED_ALLERGEN_IDS = ["gluten", "nuts"] as const;
export type DetailedAllergenId = (typeof DETAILED_ALLERGEN_IDS)[number];

export const GLUTEN_CEREAL_IDS = ["wheat", "spelt", "khorasan", "rye", "barley", "oats"] as const;
export const TREE_NUT_IDS = [
  "almond",
  "hazelnut",
  "walnut",
  "cashew",
  "pecan",
  "brazil",
  "pistachio",
  "macadamia"
] as const;

export type AllergenSubtypeDef = {
  id: string;
  label: string;
  /** Short form for a matrix cell too narrow for `label`; explained in a key at the foot of the page. */
  abbr?: string;
  /** Wording for that key, e.g. "khorasan wheat". */
  keyName?: string;
};

/** Sub-types offered under each detailed allergen, in print order. */
export const ALLERGEN_SUBTYPES: Record<DetailedAllergenId, AllergenSubtypeDef[]> = {
  gluten: [
    { id: "wheat", label: "Wheat" },
    { id: "spelt", label: "Spelt" },
    { id: "khorasan", label: "Khorasan", abbr: "Khor.", keyName: "khorasan wheat" },
    { id: "rye", label: "Rye" },
    { id: "barley", label: "Barley" },
    { id: "oats", label: "Oats" }
  ],
  nuts: [
    { id: "almond", label: "Almond" },
    { id: "hazelnut", label: "Hazelnut", abbr: "Hazel.", keyName: "hazelnut" },
    { id: "walnut", label: "Walnut" },
    { id: "cashew", label: "Cashew" },
    { id: "pecan", label: "Pecan" },
    { id: "brazil", label: "Brazil" },
    { id: "pistachio", label: "Pistachio", abbr: "Pist.", keyName: "pistachio" },
    { id: "macadamia", label: "Macadamia", abbr: "Mac.", keyName: "macadamia" }
  ]
};

export type AllergenDetail = {
  /** Sub-type ids from `ALLERGEN_SUBTYPES`, in that list's order. */
  types: string[];
  /** Gluten only: the oats are certified gluten-free (still declared as oats). */
  glutenFreeOats?: boolean;
  /** Short note for guests, printed under the dish name on the matrix. */
  note?: string;
};

export type AllergenDetailMap = Partial<Record<DetailedAllergenId, AllergenDetail>>;

/** Printed key for gluten-free oats, used in the cell and explained once at the foot of the matrix. */
export const GLUTEN_FREE_OATS_LABEL = "Oats (GF)";
export const GLUTEN_FREE_OATS_KEY =
  "Oats (GF): certified gluten-free oats. Most people with coeliac disease can eat these, but a few react to oats. Please ask a member of staff.";

export function isDetailedAllergen(id: AllergenId): id is DetailedAllergenId {
  return (DETAILED_ALLERGEN_IDS as readonly string[]).includes(id);
}

/**
 * Tidies a dish's detail: drops it for allergens that aren't ticked, puts sub-types in print order, clears the
 * gluten-free-oats flag unless oats are picked, and removes anything left empty.
 */
export function normalizeAllergenDetail(
  allergens: Record<AllergenId, boolean>,
  detail: AllergenDetailMap | undefined
): AllergenDetailMap | undefined {
  if (!detail) return undefined;
  const out: AllergenDetailMap = {};
  for (const id of DETAILED_ALLERGEN_IDS) {
    const d = detail[id];
    if (!d || !allergens[id]) continue;
    const picked = new Set(d.types);
    const types = ALLERGEN_SUBTYPES[id].map((s) => s.id).filter((s) => picked.has(s));
    const glutenFreeOats = id === "gluten" && types.includes("oats") && Boolean(d.glutenFreeOats);
    const note = d.note?.replace(/\s+/g, " ").trim() ?? "";
    if (!types.length && !note) continue;
    out[id] = { types, ...(glutenFreeOats ? { glutenFreeOats } : {}), ...(note ? { note } : {}) };
  }
  return Object.keys(out).length ? out : undefined;
}

export type SubtypeCellLabel = { label: string; abbr?: string; keyName?: string };

/** Sub-types to print in the allergen's matrix cell, e.g. Wheat + Barley, or Oats (GF). */
export function subtypeCellLabels(id: DetailedAllergenId, d: AllergenDetail | undefined): SubtypeCellLabel[] {
  if (!d) return [];
  const defs = new Map(ALLERGEN_SUBTYPES[id].map((s) => [s.id, s]));
  return d.types.map((t) => {
    if (id === "gluten" && t === "oats" && d.glutenFreeOats) return { label: GLUTEN_FREE_OATS_LABEL };
    const def = defs.get(t);
    return def ? { label: def.label, abbr: def.abbr, keyName: def.keyName } : { label: t };
  });
}
