import { replaceVenueLogoKeyInAllProjects } from "@/lib/projects/replaceVenueLogoInProjects";
import { listVenueSignageProfiles, saveVenueSignageProfile } from "@/lib/signageVenues/store";

export async function replaceVenueLogoKeyAfterRename(oldKey: string, newKey: string): Promise<void> {
  const profiles = await listVenueSignageProfiles();
  for (const p of profiles) {
    if (p.defaultVenueLogoKey === oldKey) {
      await saveVenueSignageProfile({ ...p, defaultVenueLogoKey: newKey });
    }
  }
  await replaceVenueLogoKeyInAllProjects(oldKey, newKey);
}

export async function replaceClientLogoKeyAfterRename(oldKey: string, newKey: string): Promise<void> {
  const profiles = await listVenueSignageProfiles();
  for (const p of profiles) {
    if (p.defaultClientLogoKey === oldKey) {
      await saveVenueSignageProfile({ ...p, defaultClientLogoKey: newKey });
    }
  }
}
