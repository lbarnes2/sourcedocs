import { randomBytes } from "node:crypto";

/** Safe, readable segment for R2 object keys (S3-compatible). */
function slugFromOriginalFilename(originalName: string | undefined): string {
  if (!originalName?.trim()) return "";
  const nameOnly = originalName.trim().split(/[/\\]/).pop() ?? originalName;
  const base = nameOnly.replace(/\.[^.]+$/u, "");
  const slug = base
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return slug.slice(0, 80);
}

export function extensionFromMime(contentType: string, originalName?: string): string {
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

/**
 * Human-readable object key: `{prefix}{slug}-{8 hex}{ext}`.
 * Slug comes from the original filename; short suffix avoids collisions.
 */
export function buildLogoObjectKey(
  prefix: string,
  options: { contentType: string; originalName?: string }
): string {
  const ext = extensionFromMime(options.contentType, options.originalName);
  const slug = slugFromOriginalFilename(options.originalName);
  const shortId = randomBytes(4).toString("hex");
  const base = slug.length > 0 ? slug : "logo";
  return `${prefix}${base}-${shortId}${ext}`;
}
