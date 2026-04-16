import type { EventModel } from "@/types";

export interface PlaceCardData {
  id: string;
  name: string;
  tableNumber: string;
  courses: {
    starter: string;
    main: string;
    dessert: string;
  };
  dietary: string[];
}

export function buildPlaceCardDocument(model: EventModel): PlaceCardData[] {
  return model.guests.map((guest) => ({
    id: guest.id,
    name: guest.name,
    tableNumber: guest.tableNumber,
    courses: {
      starter: guest.starter,
      main: guest.main,
      dessert: guest.dessert
    },
    dietary: guest.dietaryNormalized
  }));
}
