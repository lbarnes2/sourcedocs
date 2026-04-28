import { promises as fs } from "node:fs";
import path from "node:path";
import type { FloorplanDocument, FloorplanListItem } from "@/types";
import {
  assertValidFloorplanId,
  isValidFloorplanUuid,
  listItemFromFloorplan
} from "@/lib/floorplans/floorplanKeys";

const FLOORPLAN_DIR = path.join(process.cwd(), "data", "floorplans");

function manifestFsPath(): string {
  return path.join(FLOORPLAN_DIR, "__manifest.json");
}

function floorplanFsPath(id: string): string {
  return path.join(FLOORPLAN_DIR, `${id}.json`);
}

async function ensureFloorplanDir(): Promise<void> {
  await fs.mkdir(FLOORPLAN_DIR, { recursive: true });
}

async function readManifestFromDisk(): Promise<FloorplanListItem[] | null> {
  try {
    const raw = await fs.readFile(manifestFsPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed as FloorplanListItem[];
  } catch {
    return null;
  }
}

async function writeManifestToDisk(entries: FloorplanListItem[]): Promise<void> {
  await ensureFloorplanDir();
  await fs.writeFile(manifestFsPath(), JSON.stringify(entries, null, 2), "utf8");
}

async function diskFloorplanIds(): Promise<Set<string>> {
  await ensureFloorplanDir();
  const files = await fs.readdir(FLOORPLAN_DIR);
  const ids = new Set<string>();
  for (const file of files) {
    if (!file.endsWith(".json") || file === "__manifest.json") continue;
    const id = file.slice(0, -".json".length);
    if (isValidFloorplanUuid(id)) ids.add(id);
  }
  return ids;
}

function manifestMatchesDisk(manifest: FloorplanListItem[], diskIds: Set<string>): boolean {
  if (manifest.length !== diskIds.size) return false;
  const seen = new Set<string>();
  for (const entry of manifest) {
    if (!diskIds.has(entry.id)) return false;
    seen.add(entry.id);
  }
  return seen.size === diskIds.size;
}

async function rebuildManifestFromFiles(): Promise<FloorplanListItem[]> {
  await ensureFloorplanDir();
  const files = await fs.readdir(FLOORPLAN_DIR);
  const entries: FloorplanListItem[] = [];
  for (const file of files) {
    if (!file.endsWith(".json") || file === "__manifest.json") continue;
    try {
      const raw = await fs.readFile(path.join(FLOORPLAN_DIR, file), "utf8");
      const data = JSON.parse(raw) as FloorplanDocument;
      if (data?.id && data?.name && data?.savedAt) {
        entries.push(listItemFromFloorplan(data));
      }
    } catch {
      // skip corrupt
    }
  }
  entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  await writeManifestToDisk(entries);
  return entries;
}

export async function listFloorplansFs(): Promise<FloorplanListItem[]> {
  let manifest = await readManifestFromDisk();
  if (!manifest || manifest.length === 0) {
    manifest = await rebuildManifestFromFiles();
  } else {
    const diskIds = await diskFloorplanIds();
    if (!manifestMatchesDisk(manifest, diskIds)) {
      manifest = await rebuildManifestFromFiles();
    }
  }
  return manifest;
}

export async function getFloorplanFs(id: string): Promise<FloorplanDocument | null> {
  assertValidFloorplanId(id);
  try {
    const raw = await fs.readFile(floorplanFsPath(id), "utf8");
    return JSON.parse(raw) as FloorplanDocument;
  } catch {
    return null;
  }
}

export async function saveFloorplanFs(doc: FloorplanDocument): Promise<void> {
  assertValidFloorplanId(doc.id);
  await ensureFloorplanDir();
  await fs.writeFile(floorplanFsPath(doc.id), JSON.stringify(doc, null, 2), "utf8");
  const manifest = (await readManifestFromDisk()) ?? [];
  const next = manifest.filter((e) => e.id !== doc.id);
  next.push(listItemFromFloorplan(doc));
  next.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  await writeManifestToDisk(next);
}

export async function deleteFloorplanFs(id: string): Promise<void> {
  assertValidFloorplanId(id);
  await fs.rm(floorplanFsPath(id), { force: true });
  const manifest = (await readManifestFromDisk()) ?? [];
  const next = manifest.filter((e) => e.id !== id);
  await writeManifestToDisk(next);
}

