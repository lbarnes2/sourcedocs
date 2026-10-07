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
  // A Map avoids clashes with Object.prototype keys (e.g. a table literally named "__proto__").
  const byTable = new Map<string, GuestRecord[]>();
  guests.forEach((guest) => {
    const list = byTable.get(guest.tableNumber);
    if (list) list.push(guest);
    else byTable.set(guest.tableNumber, [guest]);
  });

  byTable.forEach((list, table) => {
    byTable.set(table, list.slice().sort((a, b) => a.name.localeCompare(b.name)));
  });

  const sortedByName = guests
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const sortedTableEntries = Array.from(byTable.entries()).sort(
    ([a], [b]) => tableSortKey(a) - tableSortKey(b) || a.localeCompare(b)
  );

  return {
    guests: guests.slice(),
    byTable: Object.fromEntries(sortedTableEntries),
    sortedByName
  };
}
