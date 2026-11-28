import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/http/errorMessage";
import { saveRoomTemplate } from "@/lib/floorplans/venueStore";
import { floorplanRoomTemplateSchema } from "@/lib/validation/floorplanSchemas";

type Ctx = { params: Promise<{ id: string }> };

/** Add or replace one room template in a venue. Returns the whole venue, with the room's new version. */
export async function PUT(request: Request, context: Ctx) {
  const { id } = await context.params;
  const parsed = floorplanRoomTemplateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: `Invalid room — ${errorMessage(parsed.error, "check the fields")}` }, { status: 400 });
  }
  try {
    return NextResponse.json({ venue: await saveRoomTemplate(id, parsed.data) });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error, "Failed to save the room.") }, { status: 400 });
  }
}
