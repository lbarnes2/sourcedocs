import { NextResponse } from "next/server";
import { BUFFET_MENU_PREFIX, deleteSavedBuffetMenu, getSavedBuffetMenu } from "@/lib/buffetMenu/savedR2";
import { isR2Configured } from "@/lib/storage/r2";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Ctx) {
  if (!isR2Configured()) {
    return NextResponse.json({ error: "R2 is not configured." }, { status: 503 });
  }
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }
  const doc = await getSavedBuffetMenu(id);
  if (!doc) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json(doc);
}

export async function DELETE(_request: Request, context: Ctx) {
  if (!isR2Configured()) {
    return NextResponse.json({ error: "R2 is not configured." }, { status: 503 });
  }
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }
  try {
    const key = `${BUFFET_MENU_PREFIX}${id.replace(/\.json$/i, "")}.json`;
    await deleteSavedBuffetMenu(key);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delete failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
