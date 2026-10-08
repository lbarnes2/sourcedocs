import { promises as fs } from "node:fs";
import path from "node:path";
import { isR2Configured, r2GetObjectUtf8, r2PutObjectUtf8 } from "@/lib/storage/r2";
import { buffetMenuSettingsSchema } from "@/lib/validation/buffetMenuSchemas";
import type { BuffetMenuSettings } from "@/types/buffetMenu";

/** Kept outside `buffet-menus/` so it is never listed as a saved menu. */
const R2_KEY = "buffet-settings/settings.json";
const FS_PATH = path.join(process.cwd(), "data", "buffet-settings.json");

export const DEFAULT_BUFFET_MENU_SETTINGS: BuffetMenuSettings = {
  allergenStatement: "",
  showAllergenStatement: false
};

function parse(raw: string | null): BuffetMenuSettings {
  if (!raw) return { ...DEFAULT_BUFFET_MENU_SETTINGS };
  try {
    const parsed = buffetMenuSettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : { ...DEFAULT_BUFFET_MENU_SETTINGS };
  } catch {
    return { ...DEFAULT_BUFFET_MENU_SETTINGS };
  }
}

export async function getBuffetMenuSettings(): Promise<BuffetMenuSettings> {
  if (isR2Configured()) return parse(await r2GetObjectUtf8(R2_KEY));
  try {
    return parse(await fs.readFile(FS_PATH, "utf8"));
  } catch {
    return { ...DEFAULT_BUFFET_MENU_SETTINGS };
  }
}

export async function saveBuffetMenuSettings(settings: BuffetMenuSettings): Promise<void> {
  const body = JSON.stringify(settings, null, 2);
  if (isR2Configured()) return r2PutObjectUtf8(R2_KEY, body);
  await fs.mkdir(path.dirname(FS_PATH), { recursive: true });
  await fs.writeFile(FS_PATH, body, "utf8");
}
