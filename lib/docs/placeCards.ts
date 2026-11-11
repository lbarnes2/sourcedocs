import type { EventModel, PlaceCardSettings } from "@/types";

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

function tableSortKey(table: string): number {
  const parsed = Number(table.trim());
  if (!Number.isNaN(parsed)) return parsed;
  return Number.MAX_SAFE_INTEGER;
}

/**
 * Place cards: all guests on table 1, then table 2, …; within a table, alphabetical by name (same as `byTable`).
 * Lines switched off in the settings are blanked here so the renderer never sees them.
 */
export function buildPlaceCardDocument(
  model: EventModel,
  show: Pick<PlaceCardSettings, "showTable" | "showMenu" | "showDietary"> = {}
): PlaceCardData[] {
  const showTable = show.showTable !== false;
  const showMenu = show.showMenu !== false;
  const showDietary = show.showDietary !== false;
  return Object.entries(model.byTable)
    .sort(([a], [b]) => tableSortKey(a) - tableSortKey(b) || a.localeCompare(b))
    .flatMap(([, guests]) =>
      guests.map((guest) => ({
        id: guest.id,
        name: guest.name,
        tableNumber: showTable ? guest.tableNumber : "",
        courses: showMenu
          ? { starter: guest.starter, main: guest.main, dessert: guest.dessert }
          : { starter: "", main: "", dessert: "" },
        dietary: showDietary ? guest.dietaryNormalized : []
      }))
    );
}
