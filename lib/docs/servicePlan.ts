import type { EventModel } from "@/types";

export type ServiceCourseKey = "starter" | "main" | "dessert";

const COURSE_ORDER: ServiceCourseKey[] = ["starter", "main", "dessert"];

export const SERVICE_COURSE_LABEL: Record<ServiceCourseKey, string> = {
  starter: "Starter",
  main: "Main",
  dessert: "Dessert"
};

export interface ServicePlanTableCourseBlock {
  course: ServiceCourseKey;
  label: string;
  groupedByDish: Array<{
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
}

export interface ServicePlanData {
  /** Courses included on the plan (non-empty across the guest list), in serving order. */
  coursesOnPlan: ServiceCourseKey[];
  tables: Array<{
    tableNumber: string;
    courseBlocks: ServicePlanTableCourseBlock[];
  }>;
}

function buildCourseBlockForTable(
  guests: Array<{ name: string; starter: string; main: string; dessert: string; dietaryNormalized: string[] }>,
  course: ServiceCourseKey
): ServicePlanTableCourseBlock {
  const groupMap = new Map<string, Array<{ name: string; dietary: string[] }>>();
  guests.forEach((guest) => {
    const raw = guest[course]?.trim() ?? "";
    const dish = raw || `No ${course} selected`;
    if (!groupMap.has(dish)) groupMap.set(dish, []);
    groupMap.get(dish)?.push({ name: guest.name, dietary: guest.dietaryNormalized });
  });

  const groupedByDish = Array.from(groupMap.entries()).map(([dish, groupedGuests]) => ({
    dish,
    guests: groupedGuests.sort((a, b) => a.name.localeCompare(b.name))
  }));

  const dishCounts = groupedByDish
    .map(({ dish, guests: groupedGuests }) => ({ dish, count: groupedGuests.length }))
    .sort((a, b) => b.count - a.count || a.dish.localeCompare(b.dish));

  return {
    course,
    label: SERVICE_COURSE_LABEL[course],
    groupedByDish: groupedByDish.sort((a, b) => a.dish.localeCompare(b.dish)),
    dishCounts
  };
}

export function buildServicePlanDocument(model: EventModel): ServicePlanData {
  let coursesOnPlan = COURSE_ORDER.filter((key) => model.guests.some((guest) => Boolean(guest[key]?.trim())));
  if (coursesOnPlan.length === 0) {
    coursesOnPlan = ["main"];
  }

  const tables = Object.entries(model.byTable).map(([tableNumber, guests]) => ({
    tableNumber,
    courseBlocks: coursesOnPlan.map((course) => buildCourseBlockForTable(guests, course))
  }));

  return { coursesOnPlan, tables };
}
