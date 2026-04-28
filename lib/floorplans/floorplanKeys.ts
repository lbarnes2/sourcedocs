import type { FloorplanDocument, FloorplanListItem } from "@/types";

export const FLOORPLAN_PREFIX = "floorplans/";
export const FLOORPLAN_MANIFEST_KEY = `${FLOORPLAN_PREFIX}__manifest.json`;

const FLOORPLAN_ID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function isValidFloorplanUuid(id: string): boolean {
  return FLOORPLAN_ID_RE.test(id);
}

export function assertValidFloorplanId(id: string): void {
  if (!FLOORPLAN_ID_RE.test(id)) {
    throw new Error("Invalid floorplan id.");
  }
}

export function floorplanObjectKey(id: string): string {
  assertValidFloorplanId(id);
  return `${FLOORPLAN_PREFIX}${id}.json`;
}

export function isFloorplanDataKey(key: string): boolean {
  return (
    key.startsWith(FLOORPLAN_PREFIX) &&
    key.endsWith(".json") &&
    key !== FLOORPLAN_MANIFEST_KEY &&
    !key.slice(FLOORPLAN_PREFIX.length).includes("/")
  );
}

export function listItemFromFloorplan(doc: FloorplanDocument): FloorplanListItem {
  return {
    id: doc.id,
    name: doc.name,
    savedAt: doc.savedAt,
    title: doc.metadata?.title?.trim() ?? ""
  };
}

