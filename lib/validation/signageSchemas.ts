import { z } from "zod";
import { PAPER_SIZE_VALUES } from "@/lib/paperSizes";
import * as limits from "@/lib/validation/limits";
import { hexColorStringSchema, profileIdSchema } from "@/lib/validation/layoutSchemas";

export const optionalSignageVenueLabelField = z
  .string()
  .max(limits.MAX_SIGNAGE_VENUE_LABEL_CHARS)
  .optional()
  .transform((s) => (s && s.trim() ? s.trim() : undefined));

export const optionalSignageEventDateField = z
  .string()
  .max(limits.MAX_SIGNAGE_EVENT_DATE_CHARS)
  .optional()
  .transform((s) => (s && s.trim() ? s.trim() : undefined));

export const signageArrowSchema = z.enum([
  "none",
  "up",
  "down",
  "left",
  "right",
  "upLeft",
  "upRight",
  "downLeft",
  "downRight",
  "cornerUpLeft",
  "cornerUpRight",
  "cornerRightUp",
  "cornerRightDown",
  "cornerDownRight",
  "cornerDownLeft",
  "cornerLeftDown",
  "cornerLeftUp",
  "turnAround"
]);

/** Two-event layout when `secondaryArrow` is set; defaults to side-by-side in PDF when omitted. */
export const signageDualEventArrangementSchema = z.enum(["sideBySide", "stacked"]);

const optionalSecondaryEventName = z
  .string()
  .max(limits.MAX_EVENT_NAME_CHARS)
  .optional()
  .transform((s) => (s && s.trim() ? s.trim() : undefined));

export const venueSignageSlotSchema = z.object({
  count: z.number().int().min(1).max(500),
  paperSize: z.enum(PAPER_SIZE_VALUES),
  orientation: z.enum(["portrait", "landscape"]),
  arrow: signageArrowSchema,
  secondaryEventName: optionalSecondaryEventName,
  /** When omitted or `"none"`, sign is single-column (existing behaviour). */
  secondaryArrow: signageArrowSchema.optional(),
  dualEventArrangement: signageDualEventArrangementSchema.optional(),
  secondaryVenueLabel: optionalSignageVenueLabelField,
  secondarySubVenueLabel: optionalSignageVenueLabelField,
  secondaryEventDate: optionalSignageEventDateField
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
  defaultVenueLabel: optionalSignageVenueLabelField,
  defaultSubVenueLabel: optionalSignageVenueLabelField,
  defaultSecondaryVenueLabel: optionalSignageVenueLabelField,
  defaultSecondarySubVenueLabel: optionalSignageVenueLabelField,
  defaultSecondaryEventDate: optionalSignageEventDateField,
  defaultVenueLogoKey: optionalLogoKeySchema,
  defaultClientLogoKey: optionalLogoKeySchema
});
