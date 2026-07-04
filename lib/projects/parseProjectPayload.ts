import { randomUUID } from "node:crypto";
import { z } from "zod";
import { defaultFloorplanSettings } from "@/lib/defaults";
import type { EventProjectFile } from "@/types";
import { validateDishOverrideShortNameUniqueness } from "@/lib/dish/overrideConflicts";
import {
  floorplanSchema,
  menuBookletSchema,
  placeCardSchema,
  tablePlanSchema,
  themeSchema
} from "@/lib/validation/layoutSchemas";
import * as limits from "@/lib/validation/limits";

const documentTypeSchema = z.enum([
  "tablePlanByTable",
  "tablePlanByPerson",
  "placeCards",
  "menuBooklet",
  "servicePlan",
  "floorplan"
]);

const guestRecordSchema = z.object({
  id: z.string().max(500),
  tableNumber: z.string().max(200),
  name: z.string().max(500),
  starter: z.string().max(2000),
  main: z.string().max(2000),
  dessert: z.string().max(2000),
  dietaryOriginal: z.string().max(4000),
  dietaryNormalized: z.array(z.string().max(500))
});

const dishOverrideSchema = z.object({
  shortName: z.string().max(2000),
  longName: z.string().max(4000)
});

const duplicateGroupSchema = z.object({
  id: z.string().max(200),
  canonical: z.string().max(2000),
  match: z.array(z.string()).min(2)
});

/** Client omits `id` / `savedAt` / `version` on create; may send existing `id` to overwrite. */
const savePayloadBaseSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(500),
  csvText: z.string().max(limits.MAX_CSV_TEXT_CHARS),
  headers: z.array(z.string().max(500)).max(2000),
  mapping: z.record(z.string(), z.string()),
  guests: z.array(guestRecordSchema).max(limits.MAX_PROJECT_GUESTS),
  issues: z.array(z.object({ severity: z.string(), message: z.string() })).max(5000),
  theme: themeSchema,
  tablePlan: tablePlanSchema,
  tablePlanByPerson: tablePlanSchema,
  placeCard: placeCardSchema,
  menuBooklet: menuBookletSchema,
  floorplan: floorplanSchema.optional(),
  dishNameOverrides: z.record(z.string(), dishOverrideSchema),
  dishMenuDuplicateGroups: z.array(duplicateGroupSchema),
  normalizeGuestNamesToTitleCase: z.boolean(),
  selectedDocuments: z.array(documentTypeSchema),
  bundleMode: z.enum(["single", "zip"]),
  profileName: z.string().max(200),
  selectedVenueLogoKey: z.string().max(500).nullable(),
  /** Older saves omit this; treat as null. */
  selectedClientLogoKey: z.string().max(500).nullable().optional()
});

function refineDishOverrideUniqueness(
  data: { dishNameOverrides: Record<string, { shortName: string; longName: string }> },
  ctx: z.RefinementCtx
) {
  const err = validateDishOverrideShortNameUniqueness(data.dishNameOverrides);
  if (err) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: err });
  }
}

const savePayloadSchema = savePayloadBaseSchema.superRefine(refineDishOverrideUniqueness);

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
    floorplan: parsed.floorplan ?? { ...defaultFloorplanSettings },
    dishNameOverrides: parsed.dishNameOverrides,
    dishMenuDuplicateGroups: parsed.dishMenuDuplicateGroups,
    normalizeGuestNamesToTitleCase: parsed.normalizeGuestNamesToTitleCase,
    selectedDocuments: parsed.selectedDocuments,
    bundleMode: parsed.bundleMode,
    profileName: parsed.profileName,
    selectedVenueLogoKey: parsed.selectedVenueLogoKey,
    selectedClientLogoKey: parsed.selectedClientLogoKey ?? null
  };
}

const loadedFileSchema = savePayloadBaseSchema
  .extend({
    version: z.literal(1),
    id: z.string().uuid(),
    name: z.string().min(1).max(500),
    savedAt: z.string().min(1)
  })
  .superRefine(refineDishOverrideUniqueness);

/** Drops legacy menu-merge rows that cannot satisfy `match.length >= 2` so older saves still load. */
function normalizeStoredProjectRaw(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }
  const o = { ...(raw as Record<string, unknown>) };
  const groups = o.dishMenuDuplicateGroups;
  if (Array.isArray(groups)) {
    o.dishMenuDuplicateGroups = groups.filter((g) => {
      if (!g || typeof g !== "object") return false;
      const m = (g as { match?: unknown }).match;
      return Array.isArray(m) && m.length >= 2;
    });
  }
  return o;
}

export function parseStoredEventProjectFile(raw: unknown): EventProjectFile {
  const parsed = loadedFileSchema.parse(normalizeStoredProjectRaw(raw));
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
    floorplan: parsed.floorplan ?? { ...defaultFloorplanSettings },
    dishNameOverrides: parsed.dishNameOverrides,
    dishMenuDuplicateGroups: parsed.dishMenuDuplicateGroups,
    normalizeGuestNamesToTitleCase: parsed.normalizeGuestNamesToTitleCase,
    selectedDocuments: parsed.selectedDocuments,
    bundleMode: parsed.bundleMode,
    profileName: parsed.profileName,
    selectedVenueLogoKey: parsed.selectedVenueLogoKey,
    selectedClientLogoKey: parsed.selectedClientLogoKey ?? null
  };
}
