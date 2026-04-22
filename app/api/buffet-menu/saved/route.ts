import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { listSavedBuffetMenus, putSavedBuffetMenu } from "@/lib/buffetMenu/savedR2";
import { isR2Configured } from "@/lib/storage/r2";
import { BUFFET_MENU_JSON_SCHEMA_VERSION, type BuffetMenuSavedFile } from "@/types/buffetMenu";
import { buffetMenuSavePutBodySchema } from "@/lib/validation/buffetMenuSchemas";

export async function GET() {
  if (!isR2Configured()) {
    return NextResponse.json({ configured: false, items: [] as { id: string; name: string; savedAt: string }[] });
  }
  try {
    const items = await listSavedBuffetMenus();
    return NextResponse.json({ configured: true, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "List failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (!isR2Configured()) {
    return NextResponse.json({ error: "R2 is not configured." }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = buffetMenuSavePutBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { id: bodyId, name, menu, venueLogoKey } = parsed.data;
  const id = bodyId?.trim() || randomUUID();
  const savedAt = new Date().toISOString();
  const doc: BuffetMenuSavedFile = {
    schemaVersion: BUFFET_MENU_JSON_SCHEMA_VERSION,
    savedAt,
    name: name.trim(),
    venueLogoKey: venueLogoKey !== undefined && venueLogoKey !== null ? venueLogoKey : null,
    menu
  };
  try {
    const { key, id: storedId } = await putSavedBuffetMenu(id, doc);
    return NextResponse.json({ ok: true, id: storedId, key });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Save failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
