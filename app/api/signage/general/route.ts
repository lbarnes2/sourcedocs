import { NextResponse } from "next/server";
import { z } from "zod";
import { errorMessage } from "@/lib/http/errorMessage";
import { PAPER_SIZE_VALUES } from "@/lib/paperSizes";
import { renderGeneralSignPdf } from "@/lib/pdf/generalSignRender";
import { loadLogoBytesFromKey, parseDataUrlImage } from "@/lib/signage/loadLogoBytes";
import { isR2Configured } from "@/lib/storage/r2";
import * as limits from "@/lib/validation/limits";
import {
  generalSignBodyField,
  generalSignSymbolsSchema,
  generalSignToneSchema,
  generalSignWifiSchema,
  optionalSignageVenueLabelField,
  signageArrowSchema,
  signageThemeSchema
} from "@/lib/validation/signageSchemas";

const generalSignSchema = z
  .object({
    paperSize: z.enum(PAPER_SIZE_VALUES),
    orientation: z.enum(["portrait", "landscape"]),
    tone: generalSignToneSchema,
    symbols: generalSignSymbolsSchema,
    heading: z.string().trim().max(limits.MAX_GENERAL_SIGN_HEADING_CHARS),
    body: generalSignBodyField,
    arrow: signageArrowSchema,
    footer: optionalSignageVenueLabelField,
    wifi: generalSignWifiSchema.optional(),
    theme: signageThemeSchema,
    venueLogoKey: z.string().min(1).max(512).optional(),
    clientLogoKey: z.string().min(1).max(512).optional(),
    venueLogoDataUrl: z.string().max(limits.MAX_DATA_URL_CHARS).optional(),
    clientLogoDataUrl: z.string().max(limits.MAX_DATA_URL_CHARS).optional()
  })
  .refine((b) => b.heading || b.body || b.symbols.length || b.wifi || b.arrow !== "none", {
    message: "Add a heading, a symbol or some text to the sign."
  });

async function resolveLogo(key: string | undefined, dataUrl: string | undefined) {
  if (dataUrl?.trim()) {
    const parsed = parseDataUrlImage(dataUrl);
    if (parsed) return parsed;
  }
  if (key?.trim() && isR2Configured()) return loadLogoBytesFromKey(key.trim());
  return null;
}

export async function POST(request: Request) {
  try {
    const body = generalSignSchema.parse(await request.json());
    const [venueBytes, clientBytes] = await Promise.all([
      resolveLogo(body.venueLogoKey, body.venueLogoDataUrl),
      resolveLogo(body.clientLogoKey, body.clientLogoDataUrl)
    ]);
    const pdf = await renderGeneralSignPdf(
      [
        {
          paperSize: body.paperSize,
          orientation: body.orientation,
          tone: body.tone,
          symbols: body.symbols,
          heading: body.heading,
          body: body.body,
          arrow: body.arrow,
          footer: body.footer,
          wifi: body.wifi,
          theme: body.theme
        }
      ],
      { venueBytes, clientBytes }
    );
    const filename = `sign-${sanitizeFilename(body.heading || body.wifi?.network || "general")}.pdf`;
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`
      }
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error, "Generation failed.") }, { status: 400 });
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "general";
}
