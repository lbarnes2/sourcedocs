import { replaceVenueLogoKeyInAllBuffetMenus } from "@/lib/buffetMenu/savedR2";
import {
  replaceClientLogoKeyInAllFloorplans,
  replaceVenueLogoKeyInAllFloorplans
} from "@/lib/floorplans/store";
import {
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
