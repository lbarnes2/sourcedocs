import { z } from "zod";
import * as limits from "@/lib/validation/limits";

/** #RGB or #RRGGBB */
export const hexColorStringSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/, "Theme color must be a #RGB or #RRGGBB hex string.");

export const tablePlanSchema = z.object({
  paperSize: z.enum(["A4", "A3"]),
  orientation: z.enum(["portrait", "landscape"]),
  tablesPerSheetMode: z.enum(["auto", "manual"]),
  tablesPerSheet: z.number().int().min(1).max(24),
  minFontSizePt: z.number().min(4).max(72)
});

export const placeCardSchema = z.object({
  stockName: z.string().max(limits.MAX_STOCK_NAME_CHARS),
  cardWidthMm: z.number().min(0.1).max(1000),
  cardHeightMm: z.number().min(0.1).max(1000),
  foldOffsetMm: z.number().min(-500).max(500),
  textOffsetXmm: z.number().min(-500).max(500),
  textOffsetYmm: z.number().min(-500).max(500),
  safeMarginMm: z.number().min(0).max(100),
  fontScale: z.number().min(0.05).max(10)
});

export const menuBookletSchema = z.object({
  headingFontPt: z.number().min(4).max(96),
  bodyFontPt: z.number().min(4).max(96),
  lineHeight: z.number().min(6).max(120),
  preMealText: z.string().max(20_000).optional(),
  postMealText: z.string().max(20_000).optional()
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
