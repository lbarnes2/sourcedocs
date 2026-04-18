import type { EventProjectFile, ProjectListItem } from "@/types";
import {
  PROJECT_MANIFEST_KEY,
  assertValidProjectId,
  isProjectDataKey,
  listItemFromProjectFile,
  projectObjectKey
} from "@/lib/projects/projectKeys";
import {
  r2DeleteObject,
  r2GetObjectUtf8,
  r2ListObjectKeys,
  r2PutObjectUtf8
} from "@/lib/storage/r2";

async function readManifest(): Promise<ProjectListItem[] | null> {
  const raw = await r2GetObjectUtf8(PROJECT_MANIFEST_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed as ProjectListItem[];
  } catch {
    return null;
  }
}

async function writeManifest(entries: ProjectListItem[]): Promise<void> {
  await r2PutObjectUtf8(PROJECT_MANIFEST_KEY, JSON.stringify(entries, null, 2));
}

async function rebuildManifestFromObjects(): Promise<ProjectListItem[]> {
  const keys = (await r2ListObjectKeys("projects/")).filter(isProjectDataKey);
  const entries: ProjectListItem[] = [];
  for (const key of keys) {
    const raw = await r2GetObjectUtf8(key);
    if (!raw) continue;
    try {
      const data = JSON.parse(raw) as EventProjectFile;
      if (data?.id && data?.name && data?.savedAt) {
        entries.push(listItemFromProjectFile(data));
      }
    } catch {
      // skip
    }
  }
  entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  await writeManifest(entries);
  return entries;
}

export async function listProjectsR2(): Promise<ProjectListItem[]> {
  let manifest = await readManifest();
  if (!manifest || manifest.length === 0) {
    manifest = await rebuildManifestFromObjects();
  }
  return manifest;
}

export async function getProjectR2(id: string): Promise<EventProjectFile | null> {
  assertValidProjectId(id);
  const raw = await r2GetObjectUtf8(projectObjectKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EventProjectFile;
  } catch {
    return null;
  }
}

export async function saveProjectR2(file: EventProjectFile): Promise<void> {
  assertValidProjectId(file.id);
  await r2PutObjectUtf8(projectObjectKey(file.id), JSON.stringify(file, null, 2));
  const manifest = (await readManifest()) ?? [];
  const next = manifest.filter((e) => e.id !== file.id);
  next.push(listItemFromProjectFile(file));
  next.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  await writeManifest(next);
}

export async function deleteProjectR2(id: string): Promise<void> {
  assertValidProjectId(id);
  await r2DeleteObject(projectObjectKey(id));
  const manifest = (await readManifest()) ?? [];
  const next = manifest.filter((e) => e.id !== id);
  await writeManifest(next);
}
