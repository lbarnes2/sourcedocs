import type { FloorplanDocument, FloorplanListItem } from "@/types";
import { isR2Configured } from "@/lib/storage/r2";
import * as fsStore from "@/lib/floorplans/fsStore";
import * as r2Store from "@/lib/floorplans/r2Store";

export async function listFloorplans(): Promise<FloorplanListItem[]> {
  if (isR2Configured()) return r2Store.listFloorplansR2();
  return fsStore.listFloorplansFs();
}

export async function getFloorplan(id: string): Promise<FloorplanDocument | null> {
  if (isR2Configured()) return r2Store.getFloorplanR2(id);
  return fsStore.getFloorplanFs(id);
}

export async function saveFloorplan(doc: FloorplanDocument): Promise<void> {
  if (isR2Configured()) return r2Store.saveFloorplanR2(doc);
  return fsStore.saveFloorplanFs(doc);
}

export async function deleteFloorplan(id: string): Promise<void> {
  if (isR2Configured()) return r2Store.deleteFloorplanR2(id);
  return fsStore.deleteFloorplanFs(id);
}

export async function replaceVenueLogoKeyInAllFloorplans(oldKey: string, newKey: string): Promise<void> {
  if (isR2Configured()) return r2Store.replaceVenueLogoKeyInAllFloorplansR2(oldKey, newKey);
  return fsStore.replaceVenueLogoKeyInAllFloorplansFs(oldKey, newKey);
}

export async function replaceClientLogoKeyInAllFloorplans(oldKey: string, newKey: string): Promise<void> {
  if (isR2Configured()) return r2Store.replaceClientLogoKeyInAllFloorplansR2(oldKey, newKey);
  return fsStore.replaceClientLogoKeyInAllFloorplansFs(oldKey, newKey);
}

