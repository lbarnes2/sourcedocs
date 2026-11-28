import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/http/errorMessage";
import { listVenues, saveVenue } from "@/lib/floorplans/venueStore";
import { floorplanVenueSchema } from "@/lib/validation/floorplanSchemas";

export async function GET() {
  try {
    return NextResponse.json({ venues: await listVenues() });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error, "Failed to list venues.") }, { status: 500 });
  }
}

/** Create or update a venue (name, logo, the list of rooms). */
export async function POST(request: Request) {
  const parsed = floorplanVenueSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: `Invalid venue — ${errorMessage(parsed.error, "check the fields")}` }, { status: 400 });
  }
  try {
    return NextResponse.json({ venue: await saveVenue(parsed.data) });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error, "Failed to save the venue.") }, { status: 500 });
  }
}
