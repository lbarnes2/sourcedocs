import type { EventModel, GuestRecord } from "@/types";
import { compareTables } from "@/lib/event/tableLabel";

const byGuestName = (a: GuestRecord, b: GuestRecord) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) || a.name.localeCompare(b.name);

/** Tables in print order — the single ordering every document uses. */
export function sortedTableNumbers(model: EventModel): string[] {
  return model.tableOrder.slice();
}

/** `[table, guests]` pairs in print order. */
export function tablesInOrder(model: EventModel): Array<[string, GuestRecord[]]> {
  return model.tableOrder.map((table) => [table, model.byTable[table] ?? []]);
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
    byTable.set(table, list.slice().sort(byGuestName));
  });

  const sortedByName = guests.slice().sort(byGuestName);

  // Object key order can't be trusted for print order (integer-like keys always come first),
  // so the order is carried separately in `tableOrder`.
  const tableOrder = Array.from(byTable.keys()).sort(compareTables);

  return {
    guests: guests.slice(),
    byTable: Object.fromEntries(byTable.entries()),
    tableOrder,
    sortedByName
  };
}
