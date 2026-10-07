import { sniffRasterFormat } from "@/lib/pdf/imageFormat";

export const LOGO_UPLOAD_ACCEPT = "image/png,image/jpeg";

/**
 * pdf-lib can only embed PNG and JPEG, so anything else would silently vanish from PDFs.
 * Checks the real file signature rather than the browser-declared type.
 */
export function logoContentTypeFromBytes(bytes: Uint8Array): "image/png" | "image/jpeg" {
  const format = sniffRasterFormat(bytes);
  if (!format) {
    throw new Error("Only PNG or JPEG images can be used in printed documents. Convert the logo and upload it again.");
  }
  return format === "png" ? "image/png" : "image/jpeg";
}

/** Older libraries may still hold WebP/GIF uploads, which cannot be printed. */
export function isPrintableLogoKey(key: string): boolean {
  return /\.(png|jpe?g)$/i.test(key);
}
