import { promises as fs } from "node:fs";
import path from "node:path";
import { assertSafeProfileId, isSafeProfileId } from "@/lib/profiles/profileId";
import { normalizeVenueSignageProfile } from "@/lib/signageVenues/normalizeVenueSignageProfile";
import type { VenueSignageProfile } from "@/types";

const VENUE_DIR = path.join(process.cwd(), "data", "signage-venues");

async function ensureDir() {
  await fs.mkdir(VENUE_DIR, { recursive: true });
}

function venuePath(id: string): string {
  assertSafeProfileId(id);
  return path.join(VENUE_DIR, `${id}.json`);
}

export async function getVenueSignageProfile(id: string): Promise<VenueSignageProfile | null> {
  await ensureDir();
  try {
    const content = await fs.readFile(venuePath(id), "utf8");
    return normalizeVenueSignageProfile(JSON.parse(content));
  } catch {
    return null;
  }
}

export async function listVenueSignageProfiles(): Promise<VenueSignageProfile[]> {
  await ensureDir();
  let files: string[];
  try {
    files = await fs.readdir(VENUE_DIR);
  } catch {
    return [];
  }
  const profiles = await Promise.all(
    files
      .filter((file) => {
        if (!file.endsWith(".json")) return false;
        const id = file.slice(0, -".json".length);
        return isSafeProfileId(id);
      })
      .map(async (file) => {
        const content = await fs.readFile(path.join(VENUE_DIR, file), "utf8");
        return normalizeVenueSignageProfile(JSON.parse(content));
      })
  );
  return profiles.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveVenueSignageProfile(profile: VenueSignageProfile): Promise<void> {
  await ensureDir();
  await fs.writeFile(venuePath(profile.id), JSON.stringify(profile, null, 2), "utf8");
}

export async function deleteVenueSignageProfile(id: string): Promise<void> {
  await ensureDir();
  await fs.rm(venuePath(id), { force: true });
}
