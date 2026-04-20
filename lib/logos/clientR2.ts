import { randomUUID } from "node:crypto";
import { r2DeleteObject, r2GetObjectBytes, r2ListObjectKeys, r2PutObjectBytes } from "@/lib/storage/r2";

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
  const ext = extensionFromMime(options.contentType, options.originalName);
  const key = `${CLIENT_LOGO_PREFIX}${randomUUID()}${ext}`;
  await r2PutObjectBytes(key, buffer, options.contentType || "application/octet-stream");
  return { key };
}

export async function deleteClientLogo(key: string): Promise<void> {
  assertClientLogoKey(key);
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
