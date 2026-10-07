import { sniffRasterFormat } from "@/lib/pdf/imageFormat";
import { loadLogoBytesFromKey } from "@/lib/signage/loadLogoBytes";
import { isR2Configured } from "@/lib/storage/r2";

/** Loads a library logo by key and returns it as a data URL, or undefined if missing/unusable. */
export async function logoDataUrlFromKey(key: string | null | undefined): Promise<string | undefined> {
  const trimmed = key?.trim();
  if (!trimmed || !isR2Configured()) return undefined;
  const got = await loadLogoBytesFromKey(trimmed);
  if (!got) return undefined;
  const format = sniffRasterFormat(got.bytes);
  if (!format) return undefined;
  return `data:image/${format};base64,${Buffer.from(got.bytes).toString("base64")}`;
}
