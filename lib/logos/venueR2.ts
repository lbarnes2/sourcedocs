import { replaceVenueLogoKeyAfterRename } from "@/lib/logos/replaceLogoKeyRefs";
import { renameLogoObject } from "@/lib/logos/renameLogoInR2";
import { r2DeleteObject, r2GetObjectBytes, r2ListObjectKeys, r2PutObjectBytes } from "@/lib/storage/r2";
import { buildLogoObjectKey } from "@/lib/logos/logoObjectKey";

export const VENUE_LOGO_PREFIX = "logos/venue/";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export function assertVenueLogoKey(key: string): void {
  if (!key.startsWith(VENUE_LOGO_PREFIX)) throw new Error("Invalid venue logo key.");
  if (key.includes("..") || key.includes("//")) throw new Error("Invalid venue logo key.");
}

export interface VenueLogoListItem {
  key: string;
  /** Short label for UI (filename portion). */
  label: string;
  size?: number;
  lastModified?: string;
}

export async function listVenueLogos(): Promise<VenueLogoListItem[]> {
  const keys = (await r2ListObjectKeys(VENUE_LOGO_PREFIX)).filter((k) => k.length > VENUE_LOGO_PREFIX.length);
  return keys
    .map((key) => ({
      key,
      label: key.slice(VENUE_LOGO_PREFIX.length)
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function getVenueLogoBytes(
  key: string
): Promise<{ body: Buffer; contentType: string | undefined } | null> {
  assertVenueLogoKey(key);
  return r2GetObjectBytes(key);
}

export async function saveVenueLogoUpload(
  buffer: Buffer,
  options: { contentType: string; originalName?: string }
): Promise<{ key: string }> {
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error(`Logo must be at most ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`);
  }
  const key = buildLogoObjectKey(VENUE_LOGO_PREFIX, options);
  await r2PutObjectBytes(key, buffer, options.contentType || "application/octet-stream");
  return { key };
}

export async function deleteVenueLogo(key: string): Promise<void> {
  assertVenueLogoKey(key);
  await r2DeleteObject(key);
}

export async function renameVenueLogo(oldKey: string, newDisplayName: string): Promise<{ key: string }> {
  return renameLogoObject(VENUE_LOGO_PREFIX, assertVenueLogoKey, oldKey, newDisplayName, replaceVenueLogoKeyAfterRename);
}
