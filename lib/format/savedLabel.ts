import type { SavedBy } from "@/types/auth";

/** "19 Oct 2026, 14:02 by Jane Smith", or just the time for saves made before accounts existed. */
export function savedLabel(savedAt: string, savedBy?: SavedBy): string {
  const when = new Date(savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return savedBy ? `${when} by ${savedBy.name}` : when;
}
