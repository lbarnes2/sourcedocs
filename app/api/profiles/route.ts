import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSafeProfileId } from "@/lib/profiles/profileId";
import { listProfiles, saveProfile, deleteProfile } from "@/lib/profiles/store";
import { defaultProfile } from "@/lib/defaults";
import {
  menuBookletSchema,
  placeCardSchema,
  profileIdSchema,
  tablePlanSchema,
  themeSchema
} from "@/lib/validation/layoutSchemas";

const profileSchema = z.object({
  id: profileIdSchema,
  name: z.string().min(1).max(200),
  theme: themeSchema,
  tablePlan: tablePlanSchema,
  tablePlanByPerson: tablePlanSchema.optional(),
  placeCard: placeCardSchema,
  menuBooklet: menuBookletSchema
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
  try {
    assertSafeProfileId(id);
    await deleteProfile(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete profile.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
