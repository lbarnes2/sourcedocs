import { NextResponse } from "next/server";
import { deleteFloorplan, getFloorplan } from "@/lib/floorplans/store";
import { assertValidFloorplanId } from "@/lib/floorplans/floorplanKeys";
import { floorplanDocumentSchema } from "@/lib/validation/floorplanSchemas";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Ctx) {
  try {
    const { id } = await context.params;
    assertValidFloorplanId(id);
    const doc = await getFloorplan(id);
    if (!doc) return NextResponse.json({ error: "Floorplan not found." }, { status: 404 });
    const parsed = floorplanDocumentSchema.parse(doc);
    return NextResponse.json({ floorplan: parsed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load floorplan.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: Ctx) {
  try {
    const { id } = await context.params;
    assertValidFloorplanId(id);
    await deleteFloorplan(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete floorplan.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

