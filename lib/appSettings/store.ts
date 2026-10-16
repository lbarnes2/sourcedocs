import { promises as fs } from "node:fs";
import path from "node:path";
import { BUILTIN_DISPLAY_BACKGROUND_KEY } from "@/lib/displayBackgrounds/store";
import { isR2Configured, r2GetObjectUtf8, r2PutObjectUtf8 } from "@/lib/storage/r2";
import { appSettingsSchema } from "@/lib/validation/appSettingsSchemas";
import type { AppSettings } from "@/types/appSettings";

const R2_KEY = "app-settings/settings.json";
const FS_PATH = path.join(process.cwd(), "data", "app-settings.json");

export const DEFAULT_APP_SETTINGS: AppSettings = {
  contactPhone: "0117 428 4000",
  contactWebsites: "bristol.ac.uk/venues | bristol.ac.uk/catering",
  defaultDisplayBackgroundKey: BUILTIN_DISPLAY_BACKGROUND_KEY
};

function parse(raw: string | null): AppSettings {
  if (!raw) return { ...DEFAULT_APP_SETTINGS };
  try {
    /* Merge over the defaults so settings saved before a field existed pick up its default. */
    const parsed = appSettingsSchema.safeParse({ ...DEFAULT_APP_SETTINGS, ...JSON.parse(raw) });
    return parsed.success ? parsed.data : { ...DEFAULT_APP_SETTINGS };
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

export async function getAppSettings(): Promise<AppSettings> {
  if (isR2Configured()) return parse(await r2GetObjectUtf8(R2_KEY));
  try {
    return parse(await fs.readFile(FS_PATH, "utf8"));
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  const body = JSON.stringify(settings, null, 2);
  if (isR2Configured()) return r2PutObjectUtf8(R2_KEY, body);
  await fs.mkdir(path.dirname(FS_PATH), { recursive: true });
  await fs.writeFile(FS_PATH, body, "utf8");
}
