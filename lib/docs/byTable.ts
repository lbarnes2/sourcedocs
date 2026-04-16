import type { EventModel } from "@/types";

export interface ByTableDocumentData {
  tables: Array<{
    tableNumber: string;
    guests: string[];
  }>;
}

export function buildByTableDocument(model: EventModel): ByTableDocumentData {
  const tables = Object.entries(model.byTable).map(([tableNumber, guests]) => ({
    tableNumber,
    guests: guests.map((guest) => guest.name)
  }));

  return { tables };
}
