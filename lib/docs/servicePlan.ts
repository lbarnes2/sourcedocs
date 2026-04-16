import type { EventModel } from "@/types";

export interface ServicePlanData {
  serviceCourse: "main" | "starter" | "dessert";
  tables: Array<{
    tableNumber: string;
    groupedByMain: Array<{
      dish: string;
      guests: Array<{
        name: string;
        dietary: string[];
      }>;
    }>;
    dishCounts: Array<{
      dish: string;
      count: number;
    }>;
  }>;
}

export function buildServicePlanDocument(model: EventModel): ServicePlanData {
  const hasMain = model.guests.some((guest) => Boolean(guest.main));
  const hasStarter = model.guests.some((guest) => Boolean(guest.starter));
  const serviceCourse: "main" | "starter" | "dessert" = hasMain
    ? "main"
    : hasStarter
      ? "starter"
      : "dessert";

  const tables = Object.entries(model.byTable).map(([tableNumber, guests]) => {
    const groupMap = new Map<string, Array<{ name: string; dietary: string[] }>>();
    guests.forEach((guest) => {
      const dish = guest[serviceCourse] || `No ${serviceCourse} selected`;
      if (!groupMap.has(dish)) groupMap.set(dish, []);
      groupMap.get(dish)?.push({ name: guest.name, dietary: guest.dietaryNormalized });
    });

    const groupedByMain = Array.from(groupMap.entries()).map(([dish, groupedGuests]) => ({
      dish,
      guests: groupedGuests.sort((a, b) => a.name.localeCompare(b.name))
    }));

    const dishCounts = groupedByMain
      .map(({ dish, guests: groupedGuests }) => ({ dish, count: groupedGuests.length }))
      .sort((a, b) => b.count - a.count || a.dish.localeCompare(b.dish));

    return {
      tableNumber,
      groupedByMain: groupedByMain.sort((a, b) => a.dish.localeCompare(b.dish)),
      dishCounts
    };
  });

  return { serviceCourse, tables };
}
