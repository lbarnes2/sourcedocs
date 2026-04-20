import type { VenueSignageProfile } from "@/types";
import { isR2Configured } from "@/lib/storage/r2";
import * as fsStore from "@/lib/signageVenues/fsStore";
import * as r2Store from "@/lib/signageVenues/r2Store";

export async function getVenueSignageProfile(id: string) {
  if (isR2Configured()) return r2Store.getVenueSignageProfile(id);
  return fsStore.getVenueSignageProfile(id);
}

export async function listVenueSignageProfiles(): Promise<VenueSignageProfile[]> {
  if (isR2Configured()) return r2Store.listVenueSignageProfiles();
  return fsStore.listVenueSignageProfiles();
}

export async function saveVenueSignageProfile(profile: VenueSignageProfile): Promise<void> {
  if (isR2Configured()) return r2Store.saveVenueSignageProfile(profile);
  return fsStore.saveVenueSignageProfile(profile);
}

export async function deleteVenueSignageProfile(id: string): Promise<void> {
  if (isR2Configured()) return r2Store.deleteVenueSignageProfile(id);
  return fsStore.deleteVenueSignageProfile(id);
}
