import { z } from "zod";
import { PAPER_SIZE_VALUES } from "@/lib/paperSizes";
import * as limits from "@/lib/validation/limits";

/** #RGB or #RRGGBB */
export const hexColorStringSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/, "Theme color must be a #RGB or #RRGGBB hex string.");

export const tablePlanSchema = z.object({
  paperSize: z.enum(PAPER_SIZE_VALUES),
  orientation: z.enum(["portrait", "landscape"]),
  tablesPerSheetMode: z.enum(["auto", "manual"]),
  tablesPerSheet: z.number().int().min(1).max(24),
  minFontSizePt: z.number().min(4).max(72)
});

/** By-person list: `tablesPerSheet` means rows per page there, so it needs a much higher ceiling. */
export const tablePlanByPersonSchema = tablePlanSchema.extend({
  tablesPerSheet: z.number().int().min(1).max(500),
  sortBy: z.enum(["firstName", "surname"]).optional()
});

export const tableCardSchema = z.object({
  showGuests: z.boolean(),
  showEventName: z.boolean()
});

const menuOrderList = z.array(z.string().max(2000)).max(500);
export const menuCardLayoutSchema = z.object({
  order: z.object({ starter: menuOrderList, main: menuOrderList, dessert: menuOrderList }),
  keys: z.record(z.string().max(2000), z.array(z.enum(["v", "ve", "gf"])).max(3))
});

/** Every banqueting document the generator can make. */
export const documentTypeSchema = z.enum([
  "tablePlanByTable",
  "tablePlanByPerson",
  "placeCards",
  "menuBooklet",
  "servicePlan",
  "tableCards",
  "kitchenSummary",
  "floorplan"
]);

/** One guest as sent to the generator or stored in a project. */
export const guestRecordSchema = z.object({
  id: z.string().max(500),
  tableNumber: z.string().max(200),
  name: z.string().max(500),
  lastName: z.string().max(500).optional(),
  starter: z.string().max(2000),
  main: z.string().max(2000),
  dessert: z.string().max(2000),
  dietaryOriginal: z.string().max(4000),
  dietaryNormalized: z.array(z.string().max(4000))
});

export const placeCardSchema = z.object({
  stockName: z.string().max(limits.MAX_STOCK_NAME_CHARS),
  // Reference-only fields: never block an export over them.
  cardWidthMm: z.number().min(0).max(1000),
  cardHeightMm: z.number().min(0).max(1000),
  foldOffsetMm: z.number().min(-500).max(500),
  textOffsetXmm: z.number().min(-500).max(500),
  textOffsetYmm: z.number().min(-500).max(500),
  safeMarginMm: z.number().min(0).max(100),
  fontScale: z.number().min(0.05).max(10),
  showTable: z.boolean().optional(),
  showMenu: z.boolean().optional(),
  showDietary: z.boolean().optional()
});

export const menuBookletSchema = z.object({
  headingFontPt: z.number().min(4).max(96),
  bodyFontPt: z.number().min(4).max(96),
  lineHeight: z.number().min(6).max(120),
  preMealText: z.string().max(20_000).optional(),
  postMealText: z.string().max(20_000).optional()
});

export const floorplanSchema = z.object({
  paperSize: z.enum(PAPER_SIZE_VALUES),
  orientation: z.enum(["portrait", "landscape"]),
  rows: z.number().int().min(1).max(limits.MAX_FLOORPLAN_GRID),
  columns: z.number().int().min(1).max(limits.MAX_FLOORPLAN_GRID),
  tableLayout: z.enum(["aligned", "staggered"]),
  numbering: z.enum(["straight", "snaked"]),
  startCorner: z.enum(["topLeft", "topRight", "bottomLeft", "bottomRight"])
});

export const themeSchema = z.object({
  primaryColor: hexColorStringSchema,
  accentColor: hexColorStringSchema,
  textColor: hexColorStringSchema,
  eventName: z.string().max(limits.MAX_EVENT_NAME_CHARS),
  eventDate: z.string().max(500).optional(),
  eventSubtitle: z.string().max(2000).optional(),
  clientName: z.string().max(500).optional(),
  clientLogoDataUrl: z.string().max(limits.MAX_DATA_URL_CHARS).optional(),
  venueLogoDataUrl: z.string().max(limits.MAX_DATA_URL_CHARS).optional()
});

export const profileIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,128}$/, "Invalid profile id.");
