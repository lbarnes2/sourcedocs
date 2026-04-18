import { promises as fs } from "node:fs";
import path from "node:path";
import { assertSafeProfileId, isSafeProfileId } from "@/lib/profiles/profileId";
import { normalizeProfileSettings } from "@/lib/profiles/normalizeProfile";
import type { ProfileSettings } from "@/types";

const PROFILE_DIR = path.join(process.cwd(), "data", "profiles");

async function ensureProfileDir() {
  await fs.mkdir(PROFILE_DIR, { recursive: true });
}

function profilePath(id: string): string {
  assertSafeProfileId(id);
  return path.join(PROFILE_DIR, `${id}.json`);
}

export async function listProfiles(): Promise<ProfileSettings[]> {
  await ensureProfileDir();
  const files = await fs.readdir(PROFILE_DIR);
  const profiles = await Promise.all(
    files
      .filter((file) => {
        if (!file.endsWith(".json")) return false;
        const id = file.slice(0, -".json".length);
        return isSafeProfileId(id);
      })
      .map(async (file) => {
        const content = await fs.readFile(path.join(PROFILE_DIR, file), "utf8");
        return normalizeProfileSettings(JSON.parse(content));
      })
  );

  return profiles.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveProfile(profile: ProfileSettings): Promise<void> {
  await ensureProfileDir();
  await fs.writeFile(profilePath(profile.id), JSON.stringify(profile, null, 2), "utf8");
}

export async function deleteProfile(id: string): Promise<void> {
  await ensureProfileDir();
  await fs.rm(profilePath(id), { force: true });
}
