import { randomUUID } from "node:crypto";
import { r2DeleteObject, r2GetObjectBytes, r2ListObjectKeys, r2PutObjectBytes } from "@/lib/storage/r2";

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
  const ext = extensionFromMime(options.contentType, options.originalName);
  const key = `${VENUE_LOGO_PREFIX}${randomUUID()}${ext}`;
  await r2PutObjectBytes(key, buffer, options.contentType || "application/octet-stream");
  return { key };
}

export async function deleteVenueLogo(key: string): Promise<void> {
  assertVenueLogoKey(key);
  await r2DeleteObject(key);
}

function extensionFromMime(contentType: string, originalName?: string): string {
  const fromName = originalName?.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
  if (fromName === "png" || fromName === "jpg" || fromName === "jpeg" || fromName === "webp" || fromName === "gif") {
    return fromName === "jpeg" ? ".jpg" : `.${fromName}`;
  }
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("gif")) return ".gif";
  return ".bin";
}
