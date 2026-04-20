import { NextResponse } from "next/server";
import { assertSafeProfileId } from "@/lib/profiles/profileId";
import {
  deleteVenueSignageProfile,
  listVenueSignageProfiles,
  saveVenueSignageProfile
} from "@/lib/signageVenues/store";
import { venueSignageProfileSchema } from "@/lib/validation/signageSchemas";

export async function GET() {
  const profiles = await listVenueSignageProfiles();
  return NextResponse.json({ profiles });
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = venueSignageProfileSchema.parse(payload);
    await saveVenueSignageProfile(parsed);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save venue profile";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id query param required" }, { status: 400 });
  }
  try {
    assertSafeProfileId(id);
    await deleteVenueSignageProfile(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete venue profile.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
