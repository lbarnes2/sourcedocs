import { NextResponse } from "next/server";
import JSZip from "jszip";
import { z } from "zod";
import { parseCsv, normalizeAndValidate } from "@/lib/csv/normalize";
import { augmentMenuLongNamesForDuplicateGroups, validateDishMenuDuplicateGroups } from "@/lib/docs/menuCards";
import { applyDishShortOverridesToGuests } from "@/lib/dish/applyOverrides";
import { resolveMenuLongNames } from "@/lib/dish/overrideConflicts";
import { buildEventModel } from "@/lib/event/model";
import { errorMessage } from "@/lib/http/errorMessage";
import { logoDataUrlFromKey } from "@/lib/logos/logoDataUrl";
import { getAppSettings } from "@/lib/appSettings/store";
import { findUndrawableText, renderDocumentPdf } from "@/lib/pdf/render";
import type { ColumnMapping, DishMenuDuplicateGroup, DocumentType, GuestRecord } from "@/types";
import {
  floorplanSchema,
  menuBookletSchema,
  placeCardSchema,
  tablePlanByPersonSchema,
  tablePlanSchema,
  themeSchema
} from "@/lib/validation/layoutSchemas";
import * as limits from "@/lib/validation/limits";

function toTitleCaseName(name: string): string {
  return name
    .trim()
    .split(/(\s+)/)
    .map((segment) => {
      if (/^\s+$/.test(segment)) return segment;
      return segment
        .split(/([-'])/)
        .map((token) => {
          if (token === "-" || token === "'") return token;
          const lowered = token.toLowerCase();
          return lowered.charAt(0).toUpperCase() + lowered.slice(1);
        })
        .join("");
    })
    .join("");
}

const previewSchema = z.object({
  mode: z.literal("preview"),
  csvText: z.string().min(1).max(limits.MAX_CSV_TEXT_CHARS),
  mapping: z.record(z.string(), z.string()).optional()
});

const guestPayloadSchema = z.object({
  id: z.string().max(500),
  tableNumber: z.string().max(200),
  name: z.string().max(500),
  starter: z.string().max(2000),
  main: z.string().max(2000),
  dessert: z.string().max(2000),
  dietaryOriginal: z.string().max(4000),
  dietaryNormalized: z.array(z.string().max(4000))
});

const generateSchema = z.object({
  mode: z.literal("generate"),
  guests: z.array(guestPayloadSchema).max(limits.MAX_GENERATION_GUESTS),
  request: z.object({
    documents: z
      .array(
        z.enum([
          "tablePlanByTable",
          "tablePlanByPerson",
          "placeCards",
          "menuBooklet",
          "servicePlan",
          "floorplan"
        ])
      )
      .min(1),
    bundleMode: z.enum(["single", "zip"]),
    theme: themeSchema,
    tablePlan: tablePlanSchema,
    tablePlanByPerson: tablePlanByPersonSchema.optional(),
    placeCard: placeCardSchema,
    menuBooklet: menuBookletSchema,
    floorplan: floorplanSchema,
    dishNameOverrides: z
      .record(
        z.string(),
        z.object({
          shortName: z.string().max(2000),
          longName: z.string().max(4000)
        })
      )
      .optional(),
    dishMenuDuplicateGroups: z
      .array(
        z.object({
          canonical: z.string().max(2000),
          match: z.array(z.string()).min(2)
        })
      )
      .optional(),
    normalizeGuestNamesToTitleCase: z.boolean().optional(),
    /** Library logo keys: used server-side when the theme carries no inline data URL (keeps requests small). */
    clientLogoKey: z.string().max(512).nullable().optional(),
    venueLogoKey: z.string().max(512).nullable().optional()
  })
});

function sanitizeFilename(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function contentDisposition(filename: string): string {
  return `attachment; filename="${filename}"`;
}

/** Layout notices travel in a header so the PDF/ZIP body stays a plain download. */
function warningHeaders(warnings: string[]): Record<string, string> {
  if (!warnings.length) return {};
  // Several documents can report the same problem; say it once.
  const unique = Array.from(new Set(warnings));
  return { "X-Generation-Warnings": encodeURIComponent(JSON.stringify(unique.slice(0, 50))) };
}

function documentFilename(doc: DocumentType): string {
  switch (doc) {
    case "tablePlanByTable":
      return "table-plan-by-table.pdf";
    case "tablePlanByPerson":
      return "table-plan-by-person.pdf";
    case "placeCards":
      return "place-cards.pdf";
    case "menuBooklet":
      return "menu-booklet.pdf";
    case "servicePlan":
      return "service-plan.pdf";
    case "floorplan":
      return "floorplan.pdf";
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const mode = payload.mode;

    if (mode === "preview") {
      const parsed = previewSchema.parse(payload);
      const { rows, headers, raggedRows } = parseCsv(parsed.csvText);
      const { guests, validation } = normalizeAndValidate(
        rows,
        (parsed.mapping ?? {}) as ColumnMapping,
        raggedRows
      );
      return NextResponse.json({
        headers,
        rowCount: rows.length,
        guests,
        validation
      });
    }

    const parsed = generateSchema.parse(payload);
    const incomingGuests = (parsed.guests as GuestRecord[]).map((guest) => ({
      ...guest,
      tableNumber: guest.tableNumber.trim(),
      name: guest.name.trim()
    }));
    const dishNameOverrides = parsed.request.dishNameOverrides ?? {};
    const dishMenuDuplicateGroups = (parsed.request.dishMenuDuplicateGroups ?? []) as DishMenuDuplicateGroup[];
    const duplicateGroupError = validateDishMenuDuplicateGroups(dishMenuDuplicateGroups);
    if (duplicateGroupError) {
      return NextResponse.json({ error: duplicateGroupError }, { status: 400 });
    }
    const longNames = resolveMenuLongNames(dishNameOverrides);
    if (longNames.conflict) {
      return NextResponse.json({ error: longNames.conflict }, { status: 400 });
    }
    const guestsAfterDishOverrides = applyDishShortOverridesToGuests(incomingGuests, dishNameOverrides);
    const guests = parsed.request.normalizeGuestNamesToTitleCase
      ? guestsAfterDishOverrides.map((guest) => ({
          ...guest,
          name: toTitleCaseName(guest.name)
        }))
      : guestsAfterDishOverrides;
    const model = buildEventModel(guests);
    const menuLongNames = augmentMenuLongNamesForDuplicateGroups(
      longNames.byShort,
      dishMenuDuplicateGroups,
      dishNameOverrides
    );
    const docs = parsed.request.documents;
    const theme = { ...parsed.request.theme };
    const warnings: string[] = [];
    // A logo that was chosen but can't be loaded (deleted or renamed in the library) must not vanish silently.
    for (const [field, key, label] of [
      ["clientLogoDataUrl", parsed.request.clientLogoKey, "client"],
      ["venueLogoDataUrl", parsed.request.venueLogoKey, "venue"]
    ] as const) {
      if (theme[field]) continue;
      theme[field] = await logoDataUrlFromKey(key);
      if (key?.trim() && !theme[field]) {
        warnings.push(
          `The ${label} logo could not be loaded from the logo library, so these documents were made without it. Re-select it under Logos.`
        );
      }
    }
    warnings.push(...(await findUndrawableText(model)));
    const eventBase = sanitizeFilename(parsed.request.theme.eventName || "") || "event-docs";

    const { contactPhone, contactWebsites } = await getAppSettings();
    const rendered = await Promise.all(
      docs.map(async (docType) => {
        const pdfBytes = await renderDocumentPdf(docType, model, {
          tablePlan: parsed.request.tablePlan,
          tablePlanByPerson: parsed.request.tablePlanByPerson,
          placeCard: parsed.request.placeCard,
          menuBooklet: parsed.request.menuBooklet,
          floorplan: parsed.request.floorplan,
          theme,
          menuLongNames,
          dishMenuDuplicateGroups,
          menuCardContact: { phone: contactPhone, websites: contactWebsites },
          warnings
        });
        return { docType, pdfBytes };
      })
    );

    if (parsed.request.bundleMode === "single" && rendered.length === 1) {
      const single = rendered[0];
      const singleBuffer = new Uint8Array(single.pdfBytes).buffer;
      return new NextResponse(singleBuffer, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": contentDisposition(`${eventBase}-${documentFilename(single.docType)}`),
          ...warningHeaders(warnings)
        }
      });
    }

    const zip = new JSZip();
    rendered.forEach(({ docType, pdfBytes }) => {
      zip.file(`${eventBase}-${documentFilename(docType)}`, Buffer.from(pdfBytes));
    });
    const zipBytes = await zip.generateAsync({ type: "uint8array" });
    const zipBuffer = new Uint8Array(zipBytes).buffer;
    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": contentDisposition(`${eventBase}-documents.zip`),
        ...warningHeaders(warnings)
      }
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error, "Unexpected generation error") }, { status: 400 });
  }
}
