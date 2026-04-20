import { getClientLogoBytes } from "@/lib/logos/clientR2";
import { getVenueLogoBytes } from "@/lib/logos/venueR2";

export function parseDataUrlImage(dataUrl: string): { bytes: Uint8Array; contentType: string } | null {
  const trimmed = dataUrl.trim();
  const m = /^data:(image\/[^;]+);base64,(.+)$/s.exec(trimmed);
  if (!m) return null;
  try {
    const bytes = Buffer.from(m[2], "base64");
    return { bytes: new Uint8Array(bytes), contentType: m[1] };
  } catch {
    return null;
  }
}

/** Load PNG/JPEG bytes from R2 key (venue or client prefix). */
export async function loadLogoBytesFromKey(key: string): Promise<{ bytes: Uint8Array; contentType?: string } | null> {
  if (key.startsWith("logos/venue/")) {
    const got = await getVenueLogoBytes(key);
    if (!got) return null;
    return { bytes: new Uint8Array(got.body), contentType: got.contentType };
  }
  if (key.startsWith("logos/client/")) {
    const got = await getClientLogoBytes(key);
    if (!got) return null;
    return { bytes: new Uint8Array(got.body), contentType: got.contentType };
  }
  return null;
}
