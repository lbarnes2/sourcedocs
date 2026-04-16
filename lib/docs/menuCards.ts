import type { EventModel } from "@/types";

export interface MenuBookletData {
  starters: string[];
  mains: string[];
  desserts: string[];
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function applyLongNames(values: string[], longNames: Record<string, string>): string[] {
  return values.map((value) => {
    const replacement = longNames[value];
    if (!replacement) return value;
    const trimmed = replacement.trim();
    return trimmed || value;
  });
}

export function buildMenuBookletDocument(
  model: EventModel,
  menuLongNames: Record<string, string> = {}
): MenuBookletData {
  const starters = uniqueValues(model.guests.map((guest) => guest.starter));
  const mains = uniqueValues(model.guests.map((guest) => guest.main));
  const desserts = uniqueValues(model.guests.map((guest) => guest.dessert));
  return {
    starters: applyLongNames(starters, menuLongNames),
    mains: applyLongNames(mains, menuLongNames),
    desserts: applyLongNames(desserts, menuLongNames)
  };
}
