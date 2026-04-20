import { normalizeVenueSignageProfile } from "@/lib/signageVenues/normalizeVenueSignageProfile";
import type { VenueSignageProfile } from "@/types";
import { assertSafeProfileId, isSafeProfileId } from "@/lib/profiles/profileId";
import { r2DeleteObject, r2GetObjectUtf8, r2ListObjectKeys, r2PutObjectUtf8 } from "@/lib/storage/r2";

const PREFIX = "signage/venues/";

function venueKey(id: string): string {
  assertSafeProfileId(id);
  return `${PREFIX}${id}.json`;
}

export async function getVenueSignageProfile(id: string): Promise<VenueSignageProfile | null> {
  const raw = await r2GetObjectUtf8(venueKey(id));
  if (!raw) return null;
  try {
    return normalizeVenueSignageProfile(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function listVenueSignageProfiles(): Promise<VenueSignageProfile[]> {
  const keys = (await r2ListObjectKeys(PREFIX)).filter((key) => {
    if (!key.startsWith(PREFIX) || !key.endsWith(".json")) return false;
    const id = key.slice(PREFIX.length, -".json".length);
    return isSafeProfileId(id);
  });
  const profiles = await Promise.all(
    keys.map(async (key) => {
      const raw = await r2GetObjectUtf8(key);
      if (!raw) return null;
      try {
        return normalizeVenueSignageProfile(JSON.parse(raw));
      } catch {
        return null;
      }
    })
  );
  return profiles
    .filter((p): p is VenueSignageProfile => p !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveVenueSignageProfile(profile: VenueSignageProfile): Promise<void> {
  const key = venueKey(profile.id);
  await r2PutObjectUtf8(key, JSON.stringify(profile, null, 2));
}

export async function deleteVenueSignageProfile(id: string): Promise<void> {
  await r2DeleteObject(venueKey(id));
}
