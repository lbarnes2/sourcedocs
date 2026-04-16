import type { ProfileSettings } from "@/types";
import { isR2Configured } from "@/lib/storage/r2";
import * as fsStore from "@/lib/profiles/fsStore";
import * as r2Store from "@/lib/profiles/r2Store";

export async function listProfiles(): Promise<ProfileSettings[]> {
  if (isR2Configured()) return r2Store.listProfiles();
  return fsStore.listProfiles();
}

export async function saveProfile(profile: ProfileSettings): Promise<void> {
  if (isR2Configured()) return r2Store.saveProfile(profile);
  return fsStore.saveProfile(profile);
}

export async function deleteProfile(id: string): Promise<void> {
  if (isR2Configured()) return r2Store.deleteProfile(id);
  return fsStore.deleteProfile(id);
}
