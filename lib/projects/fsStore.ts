import { promises as fs } from "node:fs";
import path from "node:path";
import type { EventProjectFile, ProjectListItem } from "@/types";
import {
  assertValidProjectId,
  isValidProjectUuid,
  listItemFromProjectFile
} from "@/lib/projects/projectKeys";

const PROJECT_DIR = path.join(process.cwd(), "data", "projects");

function manifestFsPath(): string {
  return path.join(PROJECT_DIR, "__manifest.json");
}

function projectFsPath(id: string): string {
  return path.join(PROJECT_DIR, `${id}.json`);
}

async function ensureProjectDir(): Promise<void> {
  await fs.mkdir(PROJECT_DIR, { recursive: true });
}

async function readManifestFromDisk(): Promise<ProjectListItem[] | null> {
  try {
    const raw = await fs.readFile(manifestFsPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed as ProjectListItem[];
  } catch {
    return null;
  }
}

async function writeManifestToDisk(entries: ProjectListItem[]): Promise<void> {
  await ensureProjectDir();
  await fs.writeFile(manifestFsPath(), JSON.stringify(entries, null, 2), "utf8");
}

async function diskProjectIds(): Promise<Set<string>> {
  await ensureProjectDir();
  const files = await fs.readdir(PROJECT_DIR);
  const ids = new Set<string>();
  for (const file of files) {
    if (!file.endsWith(".json") || file === "__manifest.json") continue;
    const id = file.slice(0, -".json".length);
    if (isValidProjectUuid(id)) ids.add(id);
  }
  return ids;
}

function manifestMatchesDisk(manifest: ProjectListItem[], diskIds: Set<string>): boolean {
  if (manifest.length !== diskIds.size) return false;
  const seen = new Set<string>();
  for (const entry of manifest) {
    if (!diskIds.has(entry.id)) return false;
    seen.add(entry.id);
  }
  return seen.size === diskIds.size;
}

async function rebuildManifestFromFiles(): Promise<ProjectListItem[]> {
  await ensureProjectDir();
  const files = await fs.readdir(PROJECT_DIR);
  const entries: ProjectListItem[] = [];
  for (const file of files) {
    if (!file.endsWith(".json") || file === "__manifest.json") continue;
    try {
      const raw = await fs.readFile(path.join(PROJECT_DIR, file), "utf8");
      const data = JSON.parse(raw) as EventProjectFile;
      if (data?.id && data?.name && data?.savedAt) {
        entries.push(listItemFromProjectFile(data));
      }
    } catch {
      // skip corrupt
    }
  }
  entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  await writeManifestToDisk(entries);
  return entries;
}

export async function listProjectsFs(): Promise<ProjectListItem[]> {
  let manifest = await readManifestFromDisk();
  if (!manifest || manifest.length === 0) {
    manifest = await rebuildManifestFromFiles();
  } else {
    const diskIds = await diskProjectIds();
    if (!manifestMatchesDisk(manifest, diskIds)) {
      manifest = await rebuildManifestFromFiles();
    }
  }
  return manifest;
}

export async function getProjectFs(id: string): Promise<EventProjectFile | null> {
  assertValidProjectId(id);
  try {
    const raw = await fs.readFile(projectFsPath(id), "utf8");
    return JSON.parse(raw) as EventProjectFile;
  } catch {
    return null;
  }
}

export async function saveProjectFs(file: EventProjectFile): Promise<void> {
  assertValidProjectId(file.id);
  await ensureProjectDir();
  await fs.writeFile(projectFsPath(file.id), JSON.stringify(file, null, 2), "utf8");
  const manifest = (await readManifestFromDisk()) ?? [];
  const next = manifest.filter((e) => e.id !== file.id);
  next.push(listItemFromProjectFile(file));
  next.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  await writeManifestToDisk(next);
}

export async function deleteProjectFs(id: string): Promise<void> {
  assertValidProjectId(id);
  await fs.rm(projectFsPath(id), { force: true });
  const manifest = (await readManifestFromDisk()) ?? [];
  const next = manifest.filter((e) => e.id !== id);
  await writeManifestToDisk(next);
}

export async function replaceVenueLogoKeyInAllProjectsFs(oldKey: string, newKey: string): Promise<void> {
  await ensureProjectDir();
  const files = await fs.readdir(PROJECT_DIR);
  for (const file of files) {
    if (!file.endsWith(".json") || file === "__manifest.json") continue;
    const id = file.slice(0, -".json".length);
    if (!isValidProjectUuid(id)) continue;
    let data: EventProjectFile;
    try {
      const raw = await fs.readFile(path.join(PROJECT_DIR, file), "utf8");
      data = JSON.parse(raw) as EventProjectFile;
    } catch {
      continue;
    }
    if (data.selectedVenueLogoKey === oldKey) {
      data.selectedVenueLogoKey = newKey;
      await fs.writeFile(path.join(PROJECT_DIR, file), JSON.stringify(data, null, 2), "utf8");
    }
  }
}

export async function replaceClientLogoKeyInAllProjectsFs(oldKey: string, newKey: string): Promise<void> {
  await ensureProjectDir();
  const files = await fs.readdir(PROJECT_DIR);
  for (const file of files) {
    if (!file.endsWith(".json") || file === "__manifest.json") continue;
    const id = file.slice(0, -".json".length);
    if (!isValidProjectUuid(id)) continue;
    let data: EventProjectFile;
    try {
      const raw = await fs.readFile(path.join(PROJECT_DIR, file), "utf8");
      data = JSON.parse(raw) as EventProjectFile;
    } catch {
      continue;
    }
    if (data.selectedClientLogoKey === oldKey) {
      data.selectedClientLogoKey = newKey;
      await fs.writeFile(path.join(PROJECT_DIR, file), JSON.stringify(data, null, 2), "utf8");
    }
  }
}
