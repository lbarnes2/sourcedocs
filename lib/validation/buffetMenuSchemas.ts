import { z } from "zod";
import { ALLERGEN_IDS, type AllergenId } from "@/lib/buffetMenu/allergens";
import { BUFFET_MENU_JSON_SCHEMA_VERSION } from "@/types/buffetMenu";
import * as limits from "@/lib/validation/limits";

const optionalKey = z.string().max(512).optional().nullable();

const allergenMapSchema: z.ZodType<Record<AllergenId, boolean>> = z
  .object(
    Object.fromEntries(ALLERGEN_IDS.map((id) => [id, z.boolean()])) as Record<AllergenId, z.ZodBoolean>
  )
  .strict() as z.ZodType<Record<AllergenId, boolean>>;

export const buffetCategorySchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(0).max(limits.MAX_BUFFET_CATEGORY_TITLE_CHARS)
});

export const buffetItemSchema = z
  .object({
    id: z.string().min(1).max(200),
    title: z.string().min(0).max(limits.MAX_BUFFET_ITEM_TITLE_CHARS),
    categoryId: z.string().min(1).max(200).nullable(),
    allergens: allergenMapSchema,
    vegetarian: z.boolean(),
    vegan: z.boolean()
  })
  .transform((row) => {
    const vegan = row.vegan;
    return {
      ...row,
      vegetarian: vegan ? true : row.vegetarian
    };
  });

export const buffetMenuStateSchema = z
  .object({
    categories: z.array(buffetCategorySchema).max(limits.MAX_BUFFET_CATEGORIES),
    items: z.array(buffetItemSchema).max(limits.MAX_BUFFET_MENU_ITEMS)
  })
  .superRefine((val, ctx) => {
    const catIds = new Set(val.categories.map((c) => c.id));
    for (const [i, it] of val.items.entries()) {
      if (it.categoryId && !catIds.has(it.categoryId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", i, "categoryId"],
          message: "categoryId must reference an existing category or be null"
        });
      }
    }
  });

const buffetExportModeSchema = z.enum(["zip", "display", "matrix", "labels"]);

export const buffetMenuGenerateBodySchema = z.object({
  menu: buffetMenuStateSchema,
  venueLogoKey: optionalKey,
  venueLogoDataUrl: z.string().max(limits.MAX_DATA_URL_CHARS).optional(),
  /** Omitted or `"zip"`: return a ZIP of all three PDFs; otherwise a single PDF. */
  export: buffetExportModeSchema.optional().default("zip")
});

export const buffetMenuSavedFileSchema = z.object({
  schemaVersion: z.literal(BUFFET_MENU_JSON_SCHEMA_VERSION),
  savedAt: z.string().min(1).max(80),
  name: z.string().min(1).max(limits.MAX_BUFFET_SAVED_NAME_CHARS),
  venueLogoKey: z.string().min(1).max(512).nullable(),
  menu: buffetMenuStateSchema
});

export const buffetMenuSavePutBodySchema = z.object({
  id: z.string().min(1).max(200).optional(),
  name: z.string().min(1).max(limits.MAX_BUFFET_SAVED_NAME_CHARS),
  venueLogoKey: z.union([z.string().min(1).max(512), z.null()]).optional(),
  menu: buffetMenuStateSchema
});
