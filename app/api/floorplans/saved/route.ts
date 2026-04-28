import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { defaultThemeSettings } from "@/lib/defaults";
import { listFloorplans, saveFloorplan } from "@/lib/floorplans/store";
import { floorplanSavePayloadSchema, withFloorplanSaveDefaults } from "@/lib/validation/floorplanSchemas";
import { isR2Configured } from "@/lib/storage/r2";
import type { FloorplanDocument } from "@/types";

export async function GET() {
  try {
    const items = await listFloorplans();
    return NextResponse.json({ storage: isR2Configured() ? "r2" : "local", items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list floorplans.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = floorplanSavePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  try {
    const data = withFloorplanSaveDefaults(parsed.data);
    const id = data.id?.trim() || randomUUID();
    const savedAt = new Date().toISOString();
    const doc: FloorplanDocument = {
      version: 1,
      id,
      name: data.name.trim(),
      savedAt,
      metadata: data.metadata,
      canvas: data.canvas,
      objects: data.objects,
      autoLayout: data.autoLayout,
      themeSnapshot: {
        ...defaultThemeSettings,
        ...(data.themeSnapshot ?? {}),
        eventName: data.metadata.title || data.themeSnapshot?.eventName || defaultThemeSettings.eventName,
        eventSubtitle:
          data.metadata.subtitle || data.themeSnapshot?.eventSubtitle || defaultThemeSettings.eventSubtitle
      },
      selectedClientLogoKey: data.selectedClientLogoKey ?? null,
      selectedVenueLogoKey: data.selectedVenueLogoKey ?? null
    };
    await saveFloorplan(doc);
    return NextResponse.json({ ok: true, id: doc.id, savedAt: doc.savedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Save failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

