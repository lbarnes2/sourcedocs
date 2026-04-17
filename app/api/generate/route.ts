import { NextResponse } from "next/server";
import JSZip from "jszip";
import { z } from "zod";
import { parseCsv, normalizeAndValidate } from "@/lib/csv/normalize";
import { augmentMenuLongNamesForDuplicateGroups, validateDishMenuDuplicateGroups } from "@/lib/docs/menuCards";
import { applyDishShortOverridesToGuests } from "@/lib/dish/applyOverrides";
import { buildEventModel } from "@/lib/event/model";
import { renderDocumentPdf } from "@/lib/pdf/render";
import type { ColumnMapping, DishMenuDuplicateGroup, DocumentType, GuestRecord } from "@/types";

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

function buildMenuLongNameMap(
  dishNameOverrides: Record<string, { shortName: string; longName: string }>
): Record<string, string> {
  const byShort: Record<string, string> = {};
  Object.values(dishNameOverrides).forEach((entry) => {
    const shortName = entry.shortName.trim();
    const longName = entry.longName.trim();
    if (!shortName || !longName) return;
    byShort[shortName] = longName;
  });
  return byShort;
}

const previewSchema = z.object({
  mode: z.literal("preview"),
  csvText: z.string().min(1),
  mapping: z.record(z.string(), z.string()).optional()
});

const generateSchema = z.object({
  mode: z.literal("generate"),
  guests: z.array(
    z.object({
      id: z.string(),
      tableNumber: z.string(),
      name: z.string(),
      starter: z.string(),
      main: z.string(),
      dessert: z.string(),
      dietaryOriginal: z.string(),
      dietaryNormalized: z.array(z.string())
    })
  ),
  request: z.object({
    documents: z.array(
      z.enum([
        "tablePlanByTable",
        "tablePlanByPerson",
        "placeCards",
        "menuBooklet",
        "servicePlan"
      ])
    ),
    bundleMode: z.enum(["single", "zip"]),
    theme: z.object({
      primaryColor: z.string(),
      accentColor: z.string(),
      textColor: z.string(),
      eventName: z.string(),
      eventDate: z.string().optional(),
      eventSubtitle: z.string().optional(),
      clientName: z.string().optional(),
      clientLogoDataUrl: z.string().optional(),
      venueLogoDataUrl: z.string().optional()
    }),
    tablePlan: z.object({
      paperSize: z.enum(["A4", "A3"]),
      orientation: z.enum(["portrait", "landscape"]),
      tablesPerSheetMode: z.enum(["auto", "manual"]),
      tablesPerSheet: z.number(),
      minFontSizePt: z.number()
    }),
    tablePlanByPerson: z
      .object({
        paperSize: z.enum(["A4", "A3"]),
        orientation: z.enum(["portrait", "landscape"]),
        tablesPerSheetMode: z.enum(["auto", "manual"]),
        tablesPerSheet: z.number(),
        minFontSizePt: z.number()
      })
      .optional(),
    placeCard: z.object({
      stockName: z.string(),
      cardWidthMm: z.number(),
      cardHeightMm: z.number(),
      foldOffsetMm: z.number(),
      textOffsetXmm: z.number(),
      textOffsetYmm: z.number(),
      safeMarginMm: z.number(),
      fontScale: z.number()
    }),
    menuBooklet: z.object({
      headingFontPt: z.number(),
      bodyFontPt: z.number(),
      lineHeight: z.number(),
      preMealText: z.string().optional(),
      postMealText: z.string().optional()
    }),
    dishNameOverrides: z
      .record(
        z.string(),
        z.object({
          shortName: z.string(),
          longName: z.string()
        })
      )
      .optional(),
    dishMenuDuplicateGroups: z
      .array(
        z.object({
          canonical: z.string(),
          match: z.array(z.string()).min(2)
        })
      )
      .optional(),
    normalizeGuestNamesToTitleCase: z.boolean().optional()
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
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const mode = payload.mode;

    if (mode === "preview") {
      const parsed = previewSchema.parse(payload);
      const { rows, headers } = parseCsv(parsed.csvText);
      const { guests, validation } = normalizeAndValidate(
        rows,
        (parsed.mapping ?? {}) as ColumnMapping
      );
      return NextResponse.json({
        headers,
        rowCount: rows.length,
        guests,
        validation
      });
    }

    const parsed = generateSchema.parse(payload);
    const incomingGuests = parsed.guests as GuestRecord[];
    const dishNameOverrides = parsed.request.dishNameOverrides ?? {};
    const dishMenuDuplicateGroups = (parsed.request.dishMenuDuplicateGroups ?? []) as DishMenuDuplicateGroup[];
    const duplicateGroupError = validateDishMenuDuplicateGroups(dishMenuDuplicateGroups);
    if (duplicateGroupError) {
      return NextResponse.json({ error: duplicateGroupError }, { status: 400 });
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
      buildMenuLongNameMap(dishNameOverrides),
      dishMenuDuplicateGroups,
      dishNameOverrides
    );
    const docs = parsed.request.documents;
    const eventBase = sanitizeFilename(parsed.request.theme.eventName || "event-docs");

    const rendered = await Promise.all(
      docs.map(async (docType) => {
        const pdfBytes = await renderDocumentPdf(docType, model, {
          tablePlan: parsed.request.tablePlan,
          tablePlanByPerson: parsed.request.tablePlanByPerson,
          placeCard: parsed.request.placeCard,
          menuBooklet: parsed.request.menuBooklet,
          theme: parsed.request.theme,
          menuLongNames,
          dishMenuDuplicateGroups
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
          "Content-Disposition": contentDisposition(`${eventBase}-${documentFilename(single.docType)}`)
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
        "Content-Disposition": contentDisposition(`${eventBase}-documents.zip`)
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected generation error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
