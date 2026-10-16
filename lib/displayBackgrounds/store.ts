import { promises as fs } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { buildLogoObjectKey } from "@/lib/logos/logoObjectKey";
import { embedRasterBytes, sniffRasterFormat } from "@/lib/pdf/imageFormat";
import {
  isR2Configured,
  r2DeleteObject,
  r2GetObjectBytes,
  r2ListObjectKeys,
  r2PutObjectBytes
} from "@/lib/storage/r2";

/**
 * Full-page backgrounds ("Empty Belly posters") for the A4 buffet display menu.
 * Uploads live in R2 when configured, otherwise under `data/` for local use; the original water design ships
 * with the app as a built-in that can't be deleted.
 */
export const BUILTIN_DISPLAY_BACKGROUND_KEY = "builtin:water";
const BUILTIN_PATH = path.join(process.cwd(), "lib", "assets", "buffet", "water-menu-bg.png");
const BUILTIN_LABEL = "Water (built-in)";

export const DISPLAY_BACKGROUND_PREFIX = "backgrounds/display-menu/";
const FS_DIR = path.join(process.cwd(), "data", "backgrounds", "display-menu");

/** Kept under typical serverless request limits (Vercel caps uploads at 4.5 MB). */
export const MAX_DISPLAY_BACKGROUND_BYTES = 4 * 1024 * 1024;
/** A4 portrait height ÷ width. */
const A4_RATIO = 297 / 210;
/** Within this the stretch to A4 is invisible; beyond it, warn that the artwork will look squashed. */
const RATIO_TOLERANCE = 0.05;

export type DisplayBackgroundItem = { key: string; label: string; assetUrl: string; builtin: boolean };

export function displayBackgroundAssetUrl(key: string): string {
  return `/api/settings/backgrounds/asset?key=${encodeURIComponent(key)}`;
}

function assertUploadKey(key: string): void {
  const name = key.slice(DISPLAY_BACKGROUND_PREFIX.length);
  if (!key.startsWith(DISPLAY_BACKGROUND_PREFIX) || !/^[a-z0-9-]+\.(png|jpg)$/.test(name)) {
    throw new Error("Invalid background key.");
  }
}

function labelFromKey(key: string): string {
  /* Keys are `{slug}-{8 hex}.{ext}`; show the slug as words. */
  const slug = key.slice(DISPLAY_BACKGROUND_PREFIX.length).replace(/-[0-9a-f]{8}\.(png|jpg)$/, "");
  const words = slug.replace(/-/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Background";
}

export async function listDisplayBackgrounds(): Promise<DisplayBackgroundItem[]> {
  let keys: string[];
  if (isR2Configured()) {
    keys = await r2ListObjectKeys(DISPLAY_BACKGROUND_PREFIX);
  } else {
    const names = await fs.readdir(FS_DIR).catch(() => [] as string[]);
    keys = names.map((n) => `${DISPLAY_BACKGROUND_PREFIX}${n}`);
  }
  const uploads = keys
    .filter((key) => {
      try {
        assertUploadKey(key);
        return true;
      } catch {
        return false;
      }
    })
    .map((key) => ({ key, label: labelFromKey(key), assetUrl: displayBackgroundAssetUrl(key), builtin: false }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [
    {
      key: BUILTIN_DISPLAY_BACKGROUND_KEY,
      label: BUILTIN_LABEL,
      assetUrl: displayBackgroundAssetUrl(BUILTIN_DISPLAY_BACKGROUND_KEY),
      builtin: true
    },
    ...uploads
  ];
}

/** Image bytes for a background key, or null when it no longer exists. */
export async function getDisplayBackgroundBytes(
  key: string
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (key === BUILTIN_DISPLAY_BACKGROUND_KEY) {
    return { bytes: new Uint8Array(await fs.readFile(BUILTIN_PATH)), contentType: "image/jpeg" };
  }
  assertUploadKey(key);
  const contentType = key.endsWith(".png") ? "image/png" : "image/jpeg";
  if (isR2Configured()) {
    const got = await r2GetObjectBytes(key);
    return got ? { bytes: new Uint8Array(got.body), contentType } : null;
  }
  try {
    const bytes = await fs.readFile(path.join(FS_DIR, key.slice(DISPLAY_BACKGROUND_PREFIX.length)));
    return { bytes: new Uint8Array(bytes), contentType };
  } catch {
    return null;
  }
}

/** Bytes for the first of `keys` that still exists (e.g. menu choice, then house default), else the built-in. */
export async function resolveDisplayBackgroundBytes(keys: Array<string | null | undefined>): Promise<Uint8Array> {
  for (const key of keys) {
    if (!key) continue;
    try {
      const got = await getDisplayBackgroundBytes(key);
      if (got) return got.bytes;
    } catch {
      /* invalid or deleted key: fall through to the next choice */
    }
  }
  return (await getDisplayBackgroundBytes(BUILTIN_DISPLAY_BACKGROUND_KEY))!.bytes;
}

export async function saveDisplayBackgroundUpload(
  buffer: Buffer,
  originalName: string | undefined
): Promise<{ key: string; warning?: string }> {
  if (buffer.length > MAX_DISPLAY_BACKGROUND_BYTES) {
    throw new Error(
      `Backgrounds must be at most ${MAX_DISPLAY_BACKGROUND_BYTES / (1024 * 1024)} MB — export as JPEG to make the file smaller.`
    );
  }
  const format = sniffRasterFormat(new Uint8Array(buffer));
  if (!format) throw new Error("Backgrounds must be JPEG or PNG images. Export the poster again as a JPEG.");
  const contentType = format === "png" ? "image/png" : "image/jpeg";
  const image = await embedRasterBytes(await PDFDocument.create(), new Uint8Array(buffer));
  if (!image) throw new Error("This image couldn't be read. Export it again as a JPEG or PNG.");
  const ratio = image.height / image.width;
  const warning =
    Math.abs(ratio / A4_RATIO - 1) > RATIO_TOLERANCE
      ? `This image is ${image.width} × ${image.height} px, which isn't A4 portrait proportions, so it will be stretched to fit the page.`
      : undefined;

  /* Name the key by the real format, whatever extension the file arrived with. */
  const baseName = (originalName?.trim() || "background").replace(/\.[^.]+$/u, "");
  const key = buildLogoObjectKey(DISPLAY_BACKGROUND_PREFIX, {
    contentType,
    originalName: `${baseName}${contentType === "image/png" ? ".png" : ".jpg"}`
  });
  if (isR2Configured()) {
    await r2PutObjectBytes(key, buffer, contentType);
  } else {
    await fs.mkdir(FS_DIR, { recursive: true });
    await fs.writeFile(path.join(FS_DIR, key.slice(DISPLAY_BACKGROUND_PREFIX.length)), buffer);
  }
  return { key, warning };
}

export async function deleteDisplayBackground(key: string): Promise<void> {
  if (key === BUILTIN_DISPLAY_BACKGROUND_KEY) throw new Error("The built-in background can't be deleted.");
  assertUploadKey(key);
  if (isR2Configured()) {
    await r2DeleteObject(key);
  } else {
    await fs.rm(path.join(FS_DIR, key.slice(DISPLAY_BACKGROUND_PREFIX.length)), { force: true });
  }
}
