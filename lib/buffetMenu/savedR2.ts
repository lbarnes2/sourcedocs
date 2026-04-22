import { r2DeleteObject, r2GetObjectUtf8, r2ListObjectKeys, r2PutObjectUtf8 } from "@/lib/storage/r2";
import { buffetMenuSavedFileSchema } from "@/lib/validation/buffetMenuSchemas";
import type { BuffetMenuSavedFile } from "@/types/buffetMenu";

export const BUFFET_MENU_PREFIX = "buffet-menus/";

export function assertBuffetMenuKey(key: string): void {
  if (!key.startsWith(BUFFET_MENU_PREFIX)) throw new Error("Invalid buffet menu key.");
  if (key.includes("..") || key.includes("//")) throw new Error("Invalid buffet menu key.");
  if (!key.endsWith(".json")) throw new Error("Invalid buffet menu key.");
}

function idFromKey(key: string): string {
  assertBuffetMenuKey(key);
  return key.slice(BUFFET_MENU_PREFIX.length, -".json".length);
}

export interface BuffetMenuListItem {
  id: string;
  key: string;
  name: string;
  savedAt: string;
}

export async function listSavedBuffetMenus(): Promise<BuffetMenuListItem[]> {
  const keys = (await r2ListObjectKeys(BUFFET_MENU_PREFIX)).filter((k) => k.endsWith(".json"));
  const out: BuffetMenuListItem[] = [];
  for (const key of keys.sort()) {
    const raw = await r2GetObjectUtf8(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const doc = buffetMenuSavedFileSchema.safeParse(parsed);
      if (!doc.success) continue;
      out.push({
        id: idFromKey(key),
        key,
        name: doc.data.name,
        savedAt: doc.data.savedAt
      });
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function getSavedBuffetMenu(keyOrId: string): Promise<BuffetMenuSavedFile | null> {
  const key = keyOrId.startsWith(BUFFET_MENU_PREFIX)
    ? keyOrId
    : `${BUFFET_MENU_PREFIX}${keyOrId.replace(/\.json$/i, "")}.json`;
  assertBuffetMenuKey(key);
  const raw = await r2GetObjectUtf8(key);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as unknown;
  const doc = buffetMenuSavedFileSchema.safeParse(parsed);
  if (!doc.success) return null;
  return doc.data;
}

export async function putSavedBuffetMenu(
  id: string,
  doc: BuffetMenuSavedFile
): Promise<{ key: string; id: string }> {
  const safeId =
    id.replace(/[^a-zA-Z0-9_-]/g, "").replace(/-+/g, "-").slice(0, 200) || "menu";
  const key = `${BUFFET_MENU_PREFIX}${safeId}.json`;
  assertBuffetMenuKey(key);
  const body = JSON.stringify(doc);
  await r2PutObjectUtf8(key, body);
  return { key, id: safeId };
}

export async function deleteSavedBuffetMenu(keyOrId: string): Promise<void> {
  const key = keyOrId.startsWith(BUFFET_MENU_PREFIX)
    ? keyOrId
    : `${BUFFET_MENU_PREFIX}${keyOrId.replace(/\.json$/i, "")}.json`;
  assertBuffetMenuKey(key);
  await r2DeleteObject(key);
}
