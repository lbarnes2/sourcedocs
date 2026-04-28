import type { FloorplanDocument, FloorplanListItem } from "@/types";
import {
  FLOORPLAN_MANIFEST_KEY,
  FLOORPLAN_PREFIX,
  assertValidFloorplanId,
  floorplanObjectKey,
  isFloorplanDataKey,
  isValidFloorplanUuid,
  listItemFromFloorplan
} from "@/lib/floorplans/floorplanKeys";
import {
  r2DeleteObject,
  r2GetObjectUtf8,
  r2ListObjectKeys,
  r2PutObjectUtf8
} from "@/lib/storage/r2";

async function readManifest(): Promise<FloorplanListItem[] | null> {
  const raw = await r2GetObjectUtf8(FLOORPLAN_MANIFEST_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed as FloorplanListItem[];
  } catch {
    return null;
  }
}

async function writeManifest(entries: FloorplanListItem[]): Promise<void> {
  await r2PutObjectUtf8(FLOORPLAN_MANIFEST_KEY, JSON.stringify(entries, null, 2));
}

async function listedFloorplanIds(): Promise<Set<string>> {
  const keys = (await r2ListObjectKeys(FLOORPLAN_PREFIX)).filter(isFloorplanDataKey);
  const ids = new Set<string>();
  for (const key of keys) {
    const id = key.slice(FLOORPLAN_PREFIX.length, -".json".length);
    if (isValidFloorplanUuid(id)) ids.add(id);
  }
  return ids;
}

function manifestMatchesObjectIds(manifest: FloorplanListItem[], objectIds: Set<string>): boolean {
  if (manifest.length !== objectIds.size) return false;
  const seen = new Set<string>();
  for (const entry of manifest) {
    if (!objectIds.has(entry.id)) return false;
    seen.add(entry.id);
  }
  return seen.size === objectIds.size;
}

async function rebuildManifestFromObjects(): Promise<FloorplanListItem[]> {
  const keys = (await r2ListObjectKeys(FLOORPLAN_PREFIX)).filter(isFloorplanDataKey);
  const entries: FloorplanListItem[] = [];
  for (const key of keys) {
    const raw = await r2GetObjectUtf8(key);
    if (!raw) continue;
    try {
      const data = JSON.parse(raw) as FloorplanDocument;
      if (data?.id && data?.name && data?.savedAt) {
        entries.push(listItemFromFloorplan(data));
      }
    } catch {
      // skip
    }
  }
  entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  await writeManifest(entries);
  return entries;
}

export async function listFloorplansR2(): Promise<FloorplanListItem[]> {
  let manifest = await readManifest();
  if (!manifest || manifest.length === 0) {
    manifest = await rebuildManifestFromObjects();
  } else {
    const objectIds = await listedFloorplanIds();
    if (!manifestMatchesObjectIds(manifest, objectIds)) {
      manifest = await rebuildManifestFromObjects();
    }
  }
  return manifest;
}

export async function getFloorplanR2(id: string): Promise<FloorplanDocument | null> {
  assertValidFloorplanId(id);
  const raw = await r2GetObjectUtf8(floorplanObjectKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FloorplanDocument;
  } catch {
    return null;
  }
}

export async function saveFloorplanR2(doc: FloorplanDocument): Promise<void> {
  assertValidFloorplanId(doc.id);
  await r2PutObjectUtf8(floorplanObjectKey(doc.id), JSON.stringify(doc, null, 2));
  const manifest = (await readManifest()) ?? [];
  const next = manifest.filter((e) => e.id !== doc.id);
  next.push(listItemFromFloorplan(doc));
  next.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  await writeManifest(next);
}

export async function deleteFloorplanR2(id: string): Promise<void> {
  assertValidFloorplanId(id);
  await r2DeleteObject(floorplanObjectKey(id));
  const manifest = (await readManifest()) ?? [];
  const next = manifest.filter((e) => e.id !== id);
  await writeManifest(next);
}

