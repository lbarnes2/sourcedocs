import type { GuestRecord } from "@/types";

export interface TableGuestInfo {
  count: number;
  guests: Array<{ name: string; dietary: string }>;
}

export type TableGuestMap = Record<string, TableGuestInfo>;

/** Table numbers are matched as trimmed strings, so " 5" and "5" are the same table. */
export function tableKey(tableNumber: string): string {
  return tableNumber.trim();
}

export function buildTableGuests(guests: GuestRecord[]): TableGuestMap {
  const map = new Map<string, TableGuestInfo>();
  for (const guest of guests) {
    const key = tableKey(guest.tableNumber);
    if (!key) continue;
    let info = map.get(key);
    if (!info) {
      info = { count: 0, guests: [] };
      map.set(key, info);
    }
    info.count += 1;
    info.guests.push({
      name: guest.name,
      dietary: guest.dietaryNormalized.length ? guest.dietaryNormalized.join(", ") : ""
    });
  }
  const out: TableGuestMap = {};
  map.forEach((info, key) => {
    info.guests.sort((a, b) => a.name.localeCompare(b.name));
    out[key] = info;
  });
  return out;
}

export function naturalTableCompare(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  const aNum = a.trim() !== "" && Number.isFinite(na);
  const bNum = b.trim() !== "" && Number.isFinite(nb);
  if (aNum && bNum && na !== nb) return na - nb;
  if (aNum !== bNum) return aNum ? -1 : 1;
  return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * Guests assigned to a table, or null when the table shouldn't be judged against the guest list:
 * no list is linked, or the table is a named one ("Top") that no guest is assigned to.
 */
export function guestCountFor(tableNumber: string, guests: TableGuestMap | null): number | null {
  if (!guests) return null;
  const key = tableKey(tableNumber);
  const info = guests[key];
  if (info) return info.count;
  return /^\d+$/.test(key) ? 0 : null;
}
