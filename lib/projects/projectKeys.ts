import type { EventProjectFile, ProjectListItem } from "@/types";

export const PROJECT_PREFIX = "projects/";

/** Sidecar list so the UI can show names without loading every full project JSON. */
export const PROJECT_MANIFEST_KEY = `${PROJECT_PREFIX}__manifest.json`;

const PROJECT_ID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function isValidProjectUuid(id: string): boolean {
  return PROJECT_ID_RE.test(id);
}

export function assertValidProjectId(id: string): void {
  if (!PROJECT_ID_RE.test(id)) {
    throw new Error("Invalid project id.");
  }
}

export function projectObjectKey(id: string): string {
  assertValidProjectId(id);
  return `${PROJECT_PREFIX}${id}.json`;
}

export function isProjectDataKey(key: string): boolean {
  return (
    key.startsWith(PROJECT_PREFIX) &&
    key.endsWith(".json") &&
    key !== PROJECT_MANIFEST_KEY &&
    !key.slice(PROJECT_PREFIX.length).includes("/")
  );
}

export function listItemFromProjectFile(file: EventProjectFile): ProjectListItem {
  return {
    id: file.id,
    name: file.name,
    savedAt: file.savedAt,
    eventName: file.theme?.eventName?.trim() ?? ""
  };
}
