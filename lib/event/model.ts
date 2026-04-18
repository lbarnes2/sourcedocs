import type { EventModel, GuestRecord } from "@/types";

function tableSortKey(table: string): number {
  const parsed = Number(table);
  if (!Number.isNaN(parsed)) return parsed;
  return Number.MAX_SAFE_INTEGER;
}

/** Same ordering as table-plan-by-table (`buildByTableDocument`). */
export function sortedTableNumbers(model: EventModel): string[] {
  return Object.keys(model.byTable).sort(
    (a, b) => tableSortKey(a) - tableSortKey(b) || a.localeCompare(b)
  );
}

export function buildEventModel(guests: GuestRecord[]): EventModel {
  const byTable: Record<string, GuestRecord[]> = {};
  guests.forEach((guest) => {
    if (!byTable[guest.tableNumber]) byTable[guest.tableNumber] = [];
    byTable[guest.tableNumber].push(guest);
  });

  Object.keys(byTable).forEach((table) => {
    byTable[table] = byTable[table].slice().sort((a, b) => a.name.localeCompare(b.name));
  });

  const sortedByName = guests
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const sortedTableEntries = Object.entries(byTable).sort(
    ([a], [b]) => tableSortKey(a) - tableSortKey(b) || a.localeCompare(b)
  );

  return {
    guests: guests.slice(),
    byTable: Object.fromEntries(sortedTableEntries),
    sortedByName
  };
}
