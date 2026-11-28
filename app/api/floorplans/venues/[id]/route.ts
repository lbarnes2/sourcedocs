import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/http/errorMessage";
import { deleteVenue, getVenue } from "@/lib/floorplans/venueStore";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Ctx) {
  try {
    const { id } = await context.params;
    const venue = await getVenue(id);
    if (!venue) return NextResponse.json({ error: "Venue not found." }, { status: 404 });
    return NextResponse.json({ venue });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error, "Failed to load the venue.") }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: Ctx) {
  try {
    const { id } = await context.params;
    await deleteVenue(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error, "Failed to delete the venue.") }, { status: 400 });
  }
}
