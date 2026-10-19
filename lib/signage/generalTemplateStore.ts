import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_GENERAL_SIGN_TEMPLATES } from "@/lib/signage/generalTemplateDefaults";
import { isR2Configured, r2GetObjectUtf8, r2PutObjectUtf8 } from "@/lib/storage/r2";
import { generalSignTemplateListSchema } from "@/lib/validation/signageSchemas";
import type { GeneralSignTemplate } from "@/types";

/** One ordered list for the whole team, so templates keep the order people arrange them in. */
const R2_KEY = "signage/general-templates.json";
const FS_PATH = path.join(process.cwd(), "data", "general-sign-templates.json");

async function readRaw(): Promise<string | null> {
  if (isR2Configured()) return r2GetObjectUtf8(R2_KEY);
  try {
    return await fs.readFile(FS_PATH, "utf8");
  } catch {
    return null;
  }
}

/** Saved templates, or the built-in set until anything has been saved. */
export async function listGeneralSignTemplates(): Promise<GeneralSignTemplate[]> {
  const raw = await readRaw();
  if (!raw) return structuredClone(DEFAULT_GENERAL_SIGN_TEMPLATES);
  try {
    const parsed = generalSignTemplateListSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through
  }
  // A corrupt file shouldn't hide the tab; the next save overwrites it.
  return structuredClone(DEFAULT_GENERAL_SIGN_TEMPLATES);
}

export async function saveGeneralSignTemplates(templates: GeneralSignTemplate[]): Promise<void> {
  const body = JSON.stringify(templates, null, 2);
  if (isR2Configured()) return r2PutObjectUtf8(R2_KEY, body);
  await fs.mkdir(path.dirname(FS_PATH), { recursive: true });
  await fs.writeFile(FS_PATH, body, "utf8");
}
