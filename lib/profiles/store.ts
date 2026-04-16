import { promises as fs } from "node:fs";
import path from "node:path";
import type { ProfileSettings } from "@/types";

const PROFILE_DIR = path.join(process.cwd(), "data", "profiles");

async function ensureProfileDir() {
  await fs.mkdir(PROFILE_DIR, { recursive: true });
}

function profilePath(id: string): string {
  return path.join(PROFILE_DIR, `${id}.json`);
}

export async function listProfiles(): Promise<ProfileSettings[]> {
  await ensureProfileDir();
  const files = await fs.readdir(PROFILE_DIR);
  const profiles = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => {
        const content = await fs.readFile(path.join(PROFILE_DIR, file), "utf8");
        return JSON.parse(content) as ProfileSettings;
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
