import type { EventModel } from "@/types";

export interface ByPersonDocumentData {
  people: Array<{
    name: string;
    tableNumber: string;
  }>;
}

export function buildByPersonDocument(model: EventModel): ByPersonDocumentData {
  return {
    people: model.sortedByName.map((guest) => ({
      name: guest.name,
      tableNumber: guest.tableNumber
    }))
  };
}
