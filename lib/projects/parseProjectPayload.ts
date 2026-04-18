import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { EventProjectFile } from "@/types";

const documentTypeSchema = z.enum([
  "tablePlanByTable",
  "tablePlanByPerson",
  "placeCards",
  "menuBooklet",
  "servicePlan"
]);

const guestRecordSchema = z.object({
  id: z.string(),
  tableNumber: z.string(),
  name: z.string(),
  starter: z.string(),
  main: z.string(),
  dessert: z.string(),
  dietaryOriginal: z.string(),
  dietaryNormalized: z.array(z.string())
});

const themeSchema = z.object({
  primaryColor: z.string(),
  accentColor: z.string(),
  textColor: z.string(),
  eventName: z.string(),
  eventDate: z.string().optional(),
  eventSubtitle: z.string().optional(),
  clientName: z.string().optional(),
  clientLogoDataUrl: z.string().optional(),
  venueLogoDataUrl: z.string().optional()
});

const tablePlanSchema = z.object({
  paperSize: z.enum(["A4", "A3"]),
  orientation: z.enum(["portrait", "landscape"]),
  tablesPerSheetMode: z.enum(["auto", "manual"]),
  tablesPerSheet: z.number(),
  minFontSizePt: z.number()
});

const placeCardSchema = z.object({
  stockName: z.string(),
  cardWidthMm: z.number(),
  cardHeightMm: z.number(),
  foldOffsetMm: z.number(),
  textOffsetXmm: z.number(),
  textOffsetYmm: z.number(),
  safeMarginMm: z.number(),
  fontScale: z.number()
});

const menuBookletSchema = z.object({
  headingFontPt: z.number(),
  bodyFontPt: z.number(),
  lineHeight: z.number(),
  preMealText: z.string().optional(),
  postMealText: z.string().optional()
});

const dishOverrideSchema = z.object({
  shortName: z.string(),
  longName: z.string()
});

const duplicateGroupSchema = z.object({
  id: z.string(),
  canonical: z.string(),
  match: z.array(z.string())
});

/** Client omits `id` / `savedAt` / `version` on create; may send existing `id` to overwrite. */
const savePayloadSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  name: z.string().min(1),
  csvText: z.string(),
  headers: z.array(z.string()),
  mapping: z.record(z.string()),
  guests: z.array(guestRecordSchema),
  issues: z.array(z.object({ severity: z.string(), message: z.string() })),
  theme: themeSchema,
  tablePlan: tablePlanSchema,
  tablePlanByPerson: tablePlanSchema,
  placeCard: placeCardSchema,
  menuBooklet: menuBookletSchema,
  dishNameOverrides: z.record(z.string(), dishOverrideSchema),
  dishMenuDuplicateGroups: z.array(duplicateGroupSchema),
  normalizeGuestNamesToTitleCase: z.boolean(),
  selectedDocuments: z.array(documentTypeSchema),
  bundleMode: z.enum(["single", "zip"]),
  profileName: z.string(),
  selectedVenueLogoKey: z.string().nullable()
});

export type ProjectSavePayload = z.infer<typeof savePayloadSchema>;

export function buildEventProjectFileFromSavePayload(payload: unknown): EventProjectFile {
  const parsed = savePayloadSchema.parse(payload);
  const id = parsed.id && parsed.id.length ? parsed.id : randomUUID();
  const savedAt = new Date().toISOString();
  return {
    version: 1,
    id,
    name: parsed.name.trim(),
    savedAt,
    csvText: parsed.csvText,
    headers: parsed.headers,
    mapping: parsed.mapping,
    guests: parsed.guests,
    issues: parsed.issues,
    theme: parsed.theme,
    tablePlan: parsed.tablePlan,
    tablePlanByPerson: parsed.tablePlanByPerson,
    placeCard: parsed.placeCard,
    menuBooklet: parsed.menuBooklet,
    dishNameOverrides: parsed.dishNameOverrides,
    dishMenuDuplicateGroups: parsed.dishMenuDuplicateGroups,
    normalizeGuestNamesToTitleCase: parsed.normalizeGuestNamesToTitleCase,
    selectedDocuments: parsed.selectedDocuments,
    bundleMode: parsed.bundleMode,
    profileName: parsed.profileName,
    selectedVenueLogoKey: parsed.selectedVenueLogoKey
  };
}

const loadedFileSchema = savePayloadSchema.extend({
  version: z.literal(1),
  id: z.string().uuid(),
  name: z.string().min(1),
  savedAt: z.string().min(1)
});

export function parseStoredEventProjectFile(raw: unknown): EventProjectFile {
  const parsed = loadedFileSchema.parse(raw);
  return {
    version: 1,
    id: parsed.id,
    name: parsed.name,
    savedAt: parsed.savedAt,
    csvText: parsed.csvText,
    headers: parsed.headers,
    mapping: parsed.mapping,
    guests: parsed.guests,
    issues: parsed.issues,
    theme: parsed.theme,
    tablePlan: parsed.tablePlan,
    tablePlanByPerson: parsed.tablePlanByPerson,
    placeCard: parsed.placeCard,
    menuBooklet: parsed.menuBooklet,
    dishNameOverrides: parsed.dishNameOverrides,
    dishMenuDuplicateGroups: parsed.dishMenuDuplicateGroups,
    normalizeGuestNamesToTitleCase: parsed.normalizeGuestNamesToTitleCase,
    selectedDocuments: parsed.selectedDocuments,
    bundleMode: parsed.bundleMode,
    profileName: parsed.profileName,
    selectedVenueLogoKey: parsed.selectedVenueLogoKey
  };
}
