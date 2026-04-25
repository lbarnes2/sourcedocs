import { NextResponse } from "next/server";
import { z } from "zod";
import { PAPER_SIZE_VALUES, paperSizeFileSuffix } from "@/lib/paperSizes";
import { renderSignagePdf, type SignagePageInput } from "@/lib/pdf/signageRender";
import { loadLogoBytesFromKey, parseDataUrlImage } from "@/lib/signage/loadLogoBytes";
import { getVenueSignageProfile } from "@/lib/signageVenues/store";
import { isR2Configured } from "@/lib/storage/r2";
import { profileIdSchema } from "@/lib/validation/layoutSchemas";
import * as limits from "@/lib/validation/limits";
import {
  optionalSignageEventDateField,
  optionalSignageVenueLabelField,
  signageArrowSchema,
  signageThemeSchema
} from "@/lib/validation/signageSchemas";

const optionalKey = z.string().max(512).optional();

const adhocSchema = z.object({
  mode: z.literal("adhoc"),
  eventName: z.string().min(1).max(limits.MAX_EVENT_NAME_CHARS),
  paperSize: z.enum(PAPER_SIZE_VALUES),
  orientation: z.enum(["portrait", "landscape"]),
  arrow: signageArrowSchema,
  theme: signageThemeSchema,
  venueLogoKey: optionalKey,
  clientLogoKey: optionalKey,
  venueLogoDataUrl: z.string().max(limits.MAX_DATA_URL_CHARS).optional(),
  clientLogoDataUrl: z.string().max(limits.MAX_DATA_URL_CHARS).optional(),
  venueLabel: optionalSignageVenueLabelField,
  subVenueLabel: optionalSignageVenueLabelField,
  eventDate: optionalSignageEventDateField
});

const packSchema = z.object({
  mode: z.literal("pack"),
  venueProfileId: profileIdSchema,
  eventName: z.string().min(1).max(limits.MAX_EVENT_NAME_CHARS),
  themeOverride: signageThemeSchema.partial().optional(),
  venueLogoKey: optionalKey,
  clientLogoKey: optionalKey,
  venueLogoDataUrl: z.string().max(limits.MAX_DATA_URL_CHARS).optional(),
  clientLogoDataUrl: z.string().max(limits.MAX_DATA_URL_CHARS).optional(),
  venueLabel: optionalSignageVenueLabelField,
  subVenueLabel: optionalSignageVenueLabelField,
  eventDate: optionalSignageEventDateField
});

const generateSchema = z.discriminatedUnion("mode", [adhocSchema, packSchema]);

async function resolveVenueLogo(
  explicitKey: string | undefined,
  dataUrl: string | undefined,
  defaultKey: string | undefined
): Promise<{ bytes: Uint8Array; contentType?: string } | null> {
  if (dataUrl?.trim()) {
    const parsed = parseDataUrlImage(dataUrl);
    if (parsed) return parsed;
  }
  const key = explicitKey ?? defaultKey;
  if (key?.trim() && isR2Configured()) {
    return loadLogoBytesFromKey(key.trim());
  }
  return null;
}

async function resolveClientLogo(
  explicitKey: string | undefined,
  dataUrl: string | undefined,
  defaultKey: string | undefined
): Promise<{ bytes: Uint8Array; contentType?: string } | null> {
  if (dataUrl?.trim()) {
    const parsed = parseDataUrlImage(dataUrl);
    if (parsed) return parsed;
  }
  const key = explicitKey ?? defaultKey;
  if (key?.trim() && isR2Configured()) {
    return loadLogoBytesFromKey(key.trim());
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const body = generateSchema.parse(json);

    let pages: SignagePageInput[];
    let venueBytes: Awaited<ReturnType<typeof resolveVenueLogo>>;
    let clientBytes: Awaited<ReturnType<typeof resolveClientLogo>>;

    if (body.mode === "adhoc") {
      pages = [
        {
          paperSize: body.paperSize,
          orientation: body.orientation,
          arrow: body.arrow,
          eventName: body.eventName,
          venueLine: body.venueLabel ?? "",
          subVenueLine: body.subVenueLabel ?? "",
          dateLine: body.eventDate ?? "",
          theme: body.theme
        }
      ];
      venueBytes = await resolveVenueLogo(body.venueLogoKey, body.venueLogoDataUrl, undefined);
      clientBytes = await resolveClientLogo(body.clientLogoKey, body.clientLogoDataUrl, undefined);
    } else {
      const profile = await getVenueSignageProfile(body.venueProfileId);
      if (!profile) {
        return NextResponse.json({ error: "Venue profile not found." }, { status: 404 });
      }
      const theme = {
        primaryColor: body.themeOverride?.primaryColor ?? profile.theme.primaryColor,
        accentColor: body.themeOverride?.accentColor ?? profile.theme.accentColor,
        textColor: body.themeOverride?.textColor ?? profile.theme.textColor
      };
      const venueLine = body.venueLabel ?? profile.defaultVenueLabel ?? "";
      const subVenueLine = body.subVenueLabel ?? profile.defaultSubVenueLabel ?? "";
      const dateLine = body.eventDate ?? "";
      pages = [];
      for (const slot of profile.slots) {
        for (let i = 0; i < slot.count; i++) {
          pages.push({
            paperSize: slot.paperSize,
            orientation: slot.orientation,
            arrow: slot.arrow,
            eventName: body.eventName,
            venueLine,
            subVenueLine,
            dateLine,
            theme
          });
        }
      }
      if (pages.length === 0) {
        return NextResponse.json({ error: "Venue profile has no sign slots." }, { status: 400 });
      }
      venueBytes = await resolveVenueLogo(
        body.venueLogoKey,
        body.venueLogoDataUrl,
        profile.defaultVenueLogoKey
      );
      clientBytes = await resolveClientLogo(
        body.clientLogoKey,
        body.clientLogoDataUrl,
        profile.defaultClientLogoKey
      );

      const logoOpts = { venueBytes, clientBytes };
      const pdfs = await Promise.all(
        PAPER_SIZE_VALUES.map(async (paperSize) => {
          const sizePages = pages.filter((p) => p.paperSize === paperSize);
          if (!sizePages.length) return null;
          const pdf = await renderSignagePdf(sizePages, logoOpts);
          return {
            paperSize,
            fileSuffix: paperSizeFileSuffix(paperSize),
            base64: Buffer.from(pdf).toString("base64")
          };
        })
      );

      const filenameBase = sanitizeFilename(body.eventName);
      return NextResponse.json({
        split: true as const,
        filenameBase,
        pdfs: pdfs.filter((pdf): pdf is NonNullable<typeof pdf> => pdf !== null)
      });
    }

    const pdf = await renderSignagePdf(pages, { venueBytes, clientBytes });
    const filename = `signage-${sanitizeFilename(body.eventName)}.pdf`;
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "event";
}
