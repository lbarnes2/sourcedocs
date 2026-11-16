import type { EventModel } from "@/types";
import { tablesInOrder } from "@/lib/event/model";
import { formatTableLabel } from "@/lib/event/tableLabel";
import { SERVICE_COURSE_LABEL, type ServiceCourseKey } from "@/lib/docs/servicePlan";

const COURSES: ServiceCourseKey[] = ["starter", "main", "dessert"];

export interface KitchenColumn {
  /** Unique key: course + dish. */
  key: string;
  course: ServiceCourseKey;
  courseLabel: string;
  dish: string;
  total: number;
}

export interface KitchenRow {
  table: string;
  tableLabel: string;
  pax: number;
  /** Portions per column key; absent means none. */
  counts: Record<string, number>;
  /** One entry per guest with a dietary requirement: "Name: requirement, requirement". */
  dietary: string[];
}

export interface KitchenSummaryData {
  columns: KitchenColumn[];
  rows: KitchenRow[];
  totalGuests: number;
  totalDietary: number;
}

/** Dish totals per course and a table-by-dish grid: the numbers the kitchen plates from. */
export function buildKitchenSummary(model: EventModel): KitchenSummaryData {
  const columns: KitchenColumn[] = [];
  COURSES.forEach((course) => {
    const totals = new Map<string, number>();
    model.guests.forEach((guest) => {
      const dish = guest[course]?.trim();
      if (dish) totals.set(dish, (totals.get(dish) ?? 0) + 1);
    });
    Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .forEach(([dish, total]) => {
        columns.push({ key: `${course}\u0000${dish}`, course, courseLabel: SERVICE_COURSE_LABEL[course], dish, total });
      });
  });

  let totalDietary = 0;
  const rows: KitchenRow[] = tablesInOrder(model).map(([table, guests]) => {
    const counts: Record<string, number> = {};
    const dietary: string[] = [];
    guests.forEach((guest) => {
      COURSES.forEach((course) => {
        const dish = guest[course]?.trim();
        if (!dish) return;
        const key = `${course}\u0000${dish}`;
        counts[key] = (counts[key] ?? 0) + 1;
      });
      if (guest.dietaryNormalized.length) {
        totalDietary += 1;
        dietary.push(`${guest.name}: ${guest.dietaryNormalized.join(", ")}`);
      }
    });
    return { table, tableLabel: formatTableLabel(table), pax: guests.length, counts, dietary };
  });

  return { columns, rows, totalGuests: model.guests.length, totalDietary };
}

/** The same numbers as a spreadsheet: one row per table, a totals row first. */
export function kitchenSummaryToRows(data: KitchenSummaryData): string[][] {
  const header = ["Table", "Guests", ...data.columns.map((c) => `${c.courseLabel}: ${c.dish}`), "Dietary requirements"];
  const totals = ["All tables", String(data.totalGuests), ...data.columns.map((c) => String(c.total)), `${data.totalDietary} guest${data.totalDietary === 1 ? "" : "s"}`];
  const body = data.rows.map((row) => [
    row.tableLabel,
    String(row.pax),
    ...data.columns.map((c) => (row.counts[c.key] ? String(row.counts[c.key]) : "")),
    row.dietary.join("; ")
  ]);
  return [header, totals, ...body];
}
