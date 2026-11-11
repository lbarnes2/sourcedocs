import type { GuestRecord, SetMenu } from "@/types";

export const emptySetMenu: SetMenu = { starter: "", main: "", dessert: "" };

export function hasSetMenu(setMenu: SetMenu | undefined): boolean {
  return Boolean(setMenu && (setMenu.starter.trim() || setMenu.main.trim() || setMenu.dessert.trim()));
}

/**
 * Fills each guest's blank courses from the set menu (e.g. a 1-1-1 dinner where the guest list has
 * no menu columns). A choice already on the guest list always wins.
 */
export function applySetMenu(guests: GuestRecord[], setMenu: SetMenu | undefined): GuestRecord[] {
  if (!setMenu || !hasSetMenu(setMenu)) return guests;
  const starter = setMenu.starter.trim();
  const main = setMenu.main.trim();
  const dessert = setMenu.dessert.trim();
  return guests.map((guest) => ({
    ...guest,
    starter: guest.starter.trim() || starter,
    main: guest.main.trim() || main,
    dessert: guest.dessert.trim() || dessert
  }));
}
