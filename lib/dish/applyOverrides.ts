import type { DishNameOverride, GuestRecord } from "@/types";

export function rewriteDishWithShortOverride(
  dish: string,
  dishNameOverrides: Record<string, Pick<DishNameOverride, "shortName">>
): string {
  const key = dish.trim();
  if (!key) return dish;
  const override = dishNameOverrides[key];
  if (!override) return dish;
  const next = override.shortName.trim();
  return next || dish;
}

export function applyDishShortOverridesToGuests(
  guests: GuestRecord[],
  dishNameOverrides: Record<string, DishNameOverride>
): GuestRecord[] {
  return guests.map((guest) => ({
    ...guest,
    starter: rewriteDishWithShortOverride(guest.starter, dishNameOverrides),
    main: rewriteDishWithShortOverride(guest.main, dishNameOverrides),
    dessert: rewriteDishWithShortOverride(guest.dessert, dishNameOverrides)
  }));
}
