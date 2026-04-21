import { buildLogoObjectKey } from "@/lib/logos/logoObjectKey";
import { r2CopyObject, r2DeleteObject, r2GetObjectBytes, r2ObjectExists } from "@/lib/storage/r2";

const MAX_NAME_LEN = 120;

export async function renameLogoObject(
  prefix: string,
  assertKey: (key: string) => void,
  oldKey: string,
  newDisplayName: string,
  afterReplace: (oldKey: string, newKey: string) => Promise<void>
): Promise<{ key: string }> {
  assertKey(oldKey);
  const trimmed = newDisplayName.trim();
  if (!trimmed) throw new Error("Name is required.");
  if (trimmed.length > MAX_NAME_LEN) throw new Error(`Name must be at most ${MAX_NAME_LEN} characters.`);

  const got = await r2GetObjectBytes(oldKey);
  if (!got) throw new Error("Logo not found.");

  const contentType = got.contentType || "application/octet-stream";
  const extMatch = oldKey.match(/(\.[a-zA-Z0-9]+)$/);
  const ext = extMatch?.[1] ?? ".png";

  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = buildLogoObjectKey(prefix, {
      contentType,
      originalName: `${trimmed}${ext}`
    });
    if (candidate === oldKey) {
      return { key: oldKey };
    }
    const taken = await r2ObjectExists(candidate);
    if (!taken) {
      await r2CopyObject(oldKey, candidate);
      await afterReplace(oldKey, candidate);
      await r2DeleteObject(oldKey);
      return { key: candidate };
    }
  }
  throw new Error("Could not assign a unique name. Try again.");
}
