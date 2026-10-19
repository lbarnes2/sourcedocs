import { z } from "zod";
import { PAPER_SIZE_VALUES } from "@/lib/paperSizes";
import * as limits from "@/lib/validation/limits";
import { hexColorStringSchema, profileIdSchema } from "@/lib/validation/layoutSchemas";
import { SIGN_SYMBOL_IDS } from "@/lib/signage/symbols";

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

export const optionalSignageMessageField = z
  .string()
  .max(limits.MAX_SIGNAGE_MESSAGE_CHARS)
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

export const venueSignageSlotSchema = z.object({
  count: z.number().int().min(1).max(500),
  paperSize: z.enum(PAPER_SIZE_VALUES),
  orientation: z.enum(["portrait", "landscape"]),
  arrow: signageArrowSchema,
  message: optionalSignageMessageField
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
  defaultVenueLogoKey: optionalLogoKeySchema,
  defaultClientLogoKey: optionalLogoKeySchema
}).refine(
  (profile) => profile.slots.reduce((sum, slot) => sum + slot.count, 0) <= limits.MAX_SIGNAGE_PAGES_PER_REQUEST,
  {
    message: `A venue pack can contain at most ${limits.MAX_SIGNAGE_PAGES_PER_REQUEST} signs in total.`,
    path: ["slots"]
  }
);

export const generalSignToneSchema = z.enum(["plain", "info", "caution", "prohibition"]);

export const generalSignWifiSchema = z.object({
  network: z.string().trim().min(1, "Enter the Wi-Fi network name.").max(limits.MAX_WIFI_FIELD_CHARS),
  password: z
    .string()
    .max(limits.MAX_WIFI_FIELD_CHARS)
    .optional()
    .transform((s) => (s ? s : undefined)),
  security: z.enum(["WPA", "WEP", "nopass"]),
  showQr: z.boolean()
});

export const generalSignBodyField = z
  .string()
  .max(limits.MAX_GENERAL_SIGN_BODY_CHARS)
  .optional()
  .transform((s) => (s && s.trim() ? s.trim() : undefined));

export const generalSignSymbolsSchema = z.array(z.enum(SIGN_SYMBOL_IDS)).max(limits.MAX_GENERAL_SIGN_SYMBOLS);

/** Like `generalSignWifiSchema`, but a template may leave the network blank to fill in per event. */
const generalSignTemplateWifiSchema = generalSignWifiSchema.extend({
  network: z.string().trim().max(limits.MAX_WIFI_FIELD_CHARS)
});

export const generalSignTemplateSchema = z.object({
  id: profileIdSchema,
  label: z.string().trim().min(1, "Give the template a name.").max(limits.MAX_GENERAL_SIGN_TEMPLATE_LABEL_CHARS),
  tone: generalSignToneSchema,
  symbols: generalSignSymbolsSchema,
  heading: z.string().trim().max(limits.MAX_GENERAL_SIGN_HEADING_CHARS),
  body: generalSignBodyField,
  arrow: signageArrowSchema,
  footer: optionalSignageVenueLabelField,
  wifi: generalSignTemplateWifiSchema.optional(),
  paperSize: z.enum(PAPER_SIZE_VALUES).optional(),
  orientation: z.enum(["portrait", "landscape"]).optional()
});

export const generalSignTemplateListSchema = z
  .array(generalSignTemplateSchema)
  .max(limits.MAX_GENERAL_SIGN_TEMPLATES)
  .refine((list) => new Set(list.map((t) => t.id)).size === list.length, { message: "Template ids must be unique." });
