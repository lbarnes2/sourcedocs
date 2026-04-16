import type { GuestRecord } from "@/types";

export interface GuestPatch {
  id: string;
  tableNumber?: string;
  name?: string;
  starter?: string;
  main?: string;
  dessert?: string;
  dietaryOriginal?: string;
}

export function applyGuestEdits(guests: GuestRecord[], patches: GuestPatch[]): GuestRecord[] {
  const patchMap = new Map(patches.map((patch) => [patch.id, patch]));
  return guests.map((guest) => {
    const patch = patchMap.get(guest.id);
    if (!patch) return guest;
    return {
      ...guest,
      tableNumber: patch.tableNumber ?? guest.tableNumber,
      name: patch.name ?? guest.name,
      starter: patch.starter ?? guest.starter,
      main: patch.main ?? guest.main,
      dessert: patch.dessert ?? guest.dessert,
      dietaryOriginal: patch.dietaryOriginal ?? guest.dietaryOriginal
    };
  });
}
