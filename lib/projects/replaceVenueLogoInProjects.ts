import { isR2Configured } from "@/lib/storage/r2";
import * as fsStore from "@/lib/projects/fsStore";
import * as r2Store from "@/lib/projects/r2Store";

/** Rewrites `selectedVenueLogoKey` in every stored project when a venue library logo is renamed. */
export async function replaceVenueLogoKeyInAllProjects(oldKey: string, newKey: string): Promise<void> {
  if (isR2Configured()) return r2Store.replaceVenueLogoKeyInAllProjectsR2(oldKey, newKey);
  return fsStore.replaceVenueLogoKeyInAllProjectsFs(oldKey, newKey);
}
