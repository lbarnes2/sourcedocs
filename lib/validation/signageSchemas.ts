import { z } from "zod";
import * as limits from "@/lib/validation/limits";
import { hexColorStringSchema, profileIdSchema } from "@/lib/validation/layoutSchemas";

export const signageArrowSchema = z.enum([
  "none",
  "up",
  "down",
  "left",
  "right",
  "upLeft",
  "upRight",
  "downLeft",
  "downRight"
]);

export const venueSignageSlotSchema = z.object({
  count: z.number().int().min(1).max(500),
  paperSize: z.enum(["A3", "A4"]),
  orientation: z.enum(["portrait", "landscape"]),
  arrow: signageArrowSchema
});

export const signageThemeSchema = z.object({
  primaryColor: hexColorStringSchema,
  accentColor: hexColorStringSchema,
  textColor: hexColorStringSchema
});

/** R2 object key fragment — allow empty to clear */
const optionalLogoKeySchema = z
  .string()
  .max(512)
  .optional()
  .transform((s) => (s && s.trim() ? s.trim() : undefined));

export const venueSignageProfileSchema = z.object({
  id: profileIdSchema,
  name: z.string().min(1).max(200),
  slots: z.array(venueSignageSlotSchema).min(1).max(200),
  theme: signageThemeSchema,
  defaultVenueLogoKey: optionalLogoKeySchema,
  defaultClientLogoKey: optionalLogoKeySchema
});
