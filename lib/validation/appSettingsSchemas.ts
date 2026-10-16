import { z } from "zod";

export const appSettingsSchema = z.object({
  contactPhone: z.string().max(100).transform((s) => s.trim()),
  contactWebsites: z.string().max(300).transform((s) => s.trim()),
  defaultDisplayBackgroundKey: z.string().min(1).max(512)
});
