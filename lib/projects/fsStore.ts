import { promises as fs } from "node:fs";
import path from "node:path";
import type { EventProjectFile, ProjectListItem } from "@/types";
import { assertValidProjectId, listItemFromProjectFile } from "@/lib/projects/projectKeys";

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
