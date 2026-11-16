import type { EventModel } from "@/types";
import { guestNameParts, indexLetter, surnameFirst } from "@/lib/event/surname";

export type ByPersonSort = "firstName" | "surname";

export interface ByPersonDocumentData {
  people: Array<{
    /** The name as printed in the list. */
    name: string;
    tableNumber: string;
    /** A–Z heading this person files under; only set when sorting by surname. */
    letter?: string;
  }>;
}

export function buildByPersonDocument(model: EventModel, sortBy: ByPersonSort = "firstName"): ByPersonDocumentData {
  if (sortBy !== "surname") {
    return {
      people: model.sortedByName.map((guest) => ({
        name: guest.name,
        tableNumber: guest.tableNumber
      }))
    };
  }

  const compare = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  const people = model.guests
    .map((guest) => {
      const parts = guestNameParts(guest);
      return { parts, tableNumber: guest.tableNumber, letter: indexLetter(parts.surname || parts.given) };
    })
    .sort(
      (a, b) =>
        // "#" (names that don't start with a letter) goes last.
        Number(a.letter === "#") - Number(b.letter === "#") ||
        compare(a.parts.surname, b.parts.surname) ||
        compare(a.parts.given, b.parts.given)
    )
    .map(({ parts, tableNumber, letter }) => ({ name: surnameFirst(parts), tableNumber, letter }));
  return { people };
}
