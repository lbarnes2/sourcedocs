import { NextResponse } from "next/server";
import { z } from "zod";
import { listProfiles, saveProfile, deleteProfile } from "@/lib/profiles/store";
import { defaultProfile } from "@/lib/defaults";

const profileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
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
  })
});

export async function GET() {
  const profiles = await listProfiles();
  if (!profiles.length) {
    return NextResponse.json({ profiles: [defaultProfile()] });
  }
  return NextResponse.json({ profiles });
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = profileSchema.parse(payload);
    await saveProfile(parsed);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save profile";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id query param required" }, { status: 400 });
  }
  await deleteProfile(id);
  return NextResponse.json({ ok: true });
}
