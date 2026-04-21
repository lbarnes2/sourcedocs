import { replaceClientLogoKeyAfterRename } from "@/lib/logos/replaceLogoKeyRefs";
import { renameLogoObject } from "@/lib/logos/renameLogoInR2";
import { r2DeleteObject, r2GetObjectBytes, r2ListObjectKeys, r2PutObjectBytes } from "@/lib/storage/r2";
import { buildLogoObjectKey } from "@/lib/logos/logoObjectKey";

export const CLIENT_LOGO_PREFIX = "logos/client/";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export function assertClientLogoKey(key: string): void {
  if (!key.startsWith(CLIENT_LOGO_PREFIX)) throw new Error("Invalid client logo key.");
  if (key.includes("..") || key.includes("//")) throw new Error("Invalid client logo key.");
}

export interface ClientLogoListItem {
  key: string;
  label: string;
  size?: number;
  lastModified?: string;
}

export async function listClientLogos(): Promise<ClientLogoListItem[]> {
  const keys = (await r2ListObjectKeys(CLIENT_LOGO_PREFIX)).filter((k) => k.length > CLIENT_LOGO_PREFIX.length);
  return keys
    .map((key) => ({
      key,
      label: key.slice(CLIENT_LOGO_PREFIX.length)
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function getClientLogoBytes(
  key: string
): Promise<{ body: Buffer; contentType: string | undefined } | null> {
  assertClientLogoKey(key);
  return r2GetObjectBytes(key);
}

export async function saveClientLogoUpload(
  buffer: Buffer,
  options: { contentType: string; originalName?: string }
): Promise<{ key: string }> {
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error(`Logo must be at most ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`);
  }
  const key = buildLogoObjectKey(CLIENT_LOGO_PREFIX, options);
  await r2PutObjectBytes(key, buffer, options.contentType || "application/octet-stream");
  return { key };
}

export async function deleteClientLogo(key: string): Promise<void> {
  assertClientLogoKey(key);
  await r2DeleteObject(key);
}

export async function renameClientLogo(oldKey: string, newDisplayName: string): Promise<{ key: string }> {
  return renameLogoObject(CLIENT_LOGO_PREFIX, assertClientLogoKey, oldKey, newDisplayName, replaceClientLogoKeyAfterRename);
}
