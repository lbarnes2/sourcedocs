import type { EventProjectFile, ProjectListItem } from "@/types";
import { isR2Configured } from "@/lib/storage/r2";
import * as fsStore from "@/lib/projects/fsStore";
import * as r2Store from "@/lib/projects/r2Store";

export async function listProjects(): Promise<ProjectListItem[]> {
  if (isR2Configured()) return r2Store.listProjectsR2();
  return fsStore.listProjectsFs();
}

export async function getProject(id: string): Promise<EventProjectFile | null> {
  if (isR2Configured()) return r2Store.getProjectR2(id);
  return fsStore.getProjectFs(id);
}

export async function saveProject(file: EventProjectFile): Promise<void> {
  if (isR2Configured()) return r2Store.saveProjectR2(file);
  return fsStore.saveProjectFs(file);
}

export async function deleteProject(id: string): Promise<void> {
  if (isR2Configured()) return r2Store.deleteProjectR2(id);
  return fsStore.deleteProjectFs(id);
}
