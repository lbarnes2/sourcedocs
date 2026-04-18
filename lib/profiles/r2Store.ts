import type { ProfileSettings } from "@/types";
import { assertSafeProfileId, isSafeProfileId } from "@/lib/profiles/profileId";
import { r2DeleteObject, r2GetObjectUtf8, r2ListObjectKeys, r2PutObjectUtf8 } from "@/lib/storage/r2";

const PREFIX = "profiles/";

function profileKey(id: string): string {
  assertSafeProfileId(id);
  return `${PREFIX}${id}.json`;
}

export async function listProfiles(): Promise<ProfileSettings[]> {
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
        return JSON.parse(raw) as ProfileSettings;
      } catch {
        return null;
      }
    })
  );
  return profiles
    .filter((p): p is ProfileSettings => p !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveProfile(profile: ProfileSettings): Promise<void> {
  const key = profileKey(profile.id);
  await r2PutObjectUtf8(key, JSON.stringify(profile, null, 2));
}

export async function deleteProfile(id: string): Promise<void> {
  await r2DeleteObject(profileKey(id));
}
