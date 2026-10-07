import type { PDFDocument, PDFImage } from "pdf-lib";

export type RasterFormat = "png" | "jpeg";

/** Detects PNG / JPEG from file signature — the only raster formats pdf-lib can embed. */
export function sniffRasterFormat(bytes: Uint8Array): RasterFormat | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  return null;
}

/** Embeds PNG/JPEG bytes using the real file signature (ignores possibly-wrong declared types). */
export async function embedRasterBytes(doc: PDFDocument, bytes: Uint8Array): Promise<PDFImage | null> {
  const format = sniffRasterFormat(bytes);
  try {
    if (format === "png") return await doc.embedPng(bytes);
    if (format === "jpeg") return await doc.embedJpg(bytes);
  } catch {
    return null;
  }
  return null;
}

/** Decodes a `data:image/...;base64,` URL and embeds it; returns null for anything unusable. */
export async function embedRasterDataUrl(doc: PDFDocument, dataUrl: string | undefined): Promise<PDFImage | null> {
  if (!dataUrl) return null;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const bytes = Uint8Array.from(Buffer.from(dataUrl.slice(comma + 1), "base64"));
  return embedRasterBytes(doc, bytes);
}
