import type { EventModel } from "@/types";
import { tablesInOrder } from "@/lib/event/model";

export interface ByTableDocumentData {
  tables: Array<{
    tableNumber: string;
    guests: string[];
  }>;
}

export function buildByTableDocument(model: EventModel): ByTableDocumentData {
  const tables = tablesInOrder(model).map(([tableNumber, guests]) => ({
    tableNumber,
    guests: guests.map((guest) => guest.name)
  }));

  return { tables };
}
