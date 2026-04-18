import { defaultFloorplanSettings } from "@/lib/defaults";
import type { ProfileSettings } from "@/types";

/** Ensures newer fields exist when loading older saved profiles. */
export function normalizeProfileSettings(raw: unknown): ProfileSettings {
  const p = raw as ProfileSettings;
  return {
    ...p,
    floorplan: p.floorplan ?? { ...defaultFloorplanSettings }
  };
}
