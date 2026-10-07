import { listBuffetMenusUsingLogoKey, replaceVenueLogoKeyInAllBuffetMenus } from "@/lib/buffetMenu/savedR2";
import {
  listFloorplanLogoUsage,
  replaceClientLogoKeyInAllFloorplans,
  replaceVenueLogoKeyInAllFloorplans
} from "@/lib/floorplans/store";
import {
  listProjectLogoUsage,
  replaceClientLogoKeyInAllProjects,
  replaceVenueLogoKeyInAllProjects
} from "@/lib/projects/replaceVenueLogoInProjects";
import { listVenueSignageProfiles, saveVenueSignageProfile } from "@/lib/signageVenues/store";
import { isR2Configured } from "@/lib/storage/r2";

export async function replaceVenueLogoKeyAfterRename(oldKey: string, newKey: string): Promise<void> {
  const profiles = await listVenueSignageProfiles();
  for (const p of profiles) {
    if (p.defaultVenueLogoKey === oldKey) {
      await saveVenueSignageProfile({ ...p, defaultVenueLogoKey: newKey });
    }
  }
  await replaceVenueLogoKeyInAllProjects(oldKey, newKey);
  await replaceVenueLogoKeyInAllFloorplans(oldKey, newKey);
  if (isR2Configured()) {
    await replaceVenueLogoKeyInAllBuffetMenus(oldKey, newKey);
  }
}

export async function replaceClientLogoKeyAfterRename(oldKey: string, newKey: string): Promise<void> {
  const profiles = await listVenueSignageProfiles();
  for (const p of profiles) {
    if (p.defaultClientLogoKey === oldKey) {
      await saveVenueSignageProfile({ ...p, defaultClientLogoKey: newKey });
    }
  }
  await replaceClientLogoKeyInAllProjects(oldKey, newKey);
  await replaceClientLogoKeyInAllFloorplans(oldKey, newKey);
}

/** Human-readable list of saved items that still point at a library logo key. */
export async function findLogoKeyReferences(key: string): Promise<string[]> {
  const refs: string[] = [];
  for (const p of await listVenueSignageProfiles()) {
    if (p.defaultVenueLogoKey === key || p.defaultClientLogoKey === key) refs.push(`Signage venue profile “${p.name}”`);
  }
  for (const item of await listProjectLogoUsage()) {
    if (item.venueKey === key || item.clientKey === key) refs.push(`Banqueting project “${item.name}”`);
  }
  for (const item of await listFloorplanLogoUsage()) {
    if (item.venueKey === key || item.clientKey === key) refs.push(`Floorplan “${item.name}”`);
  }
  if (isR2Configured()) {
    for (const name of await listBuffetMenusUsingLogoKey(key)) refs.push(`Buffet menu “${name}”`);
  }
  return refs;
}
