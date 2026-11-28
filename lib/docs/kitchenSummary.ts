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

export interface KitchenDishCount {
  dish: string;
  total: number;
  /** How many of these portions go to guests with a dietary requirement. */
  dietary: number;
}

export interface KitchenCourseTotals {
  course: ServiceCourseKey;
  courseLabel: string;
  dishes: KitchenDishCount[];
  total: number;
}

/** Guests who share exactly the same dietary requirement(s), and what they are eating. */
export interface KitchenDietaryGroup {
  requirement: string;
  pax: number;
  /** Per course (only courses with dishes on this event): dish → portions, most first. */
  courses: Partial<Record<ServiceCourseKey, Array<{ dish: string; count: number }>>>;
  tables: string[];
}

export interface KitchenSummaryData {
  columns: KitchenColumn[];
  rows: KitchenRow[];
  totalGuests: number;
  totalDietary: number;
  /** Courses that have at least one dish on this event. */
  courses: KitchenCourseTotals[];
  dietaryGroups: KitchenDietaryGroup[];
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

  const courses: KitchenCourseTotals[] = COURSES.map((course) => {
    const dishes: KitchenDishCount[] = columns
      .filter((column) => column.course === course)
      .map((column) => ({
        dish: column.dish,
        total: column.total,
        dietary: model.guests.filter((g) => g.dietaryNormalized.length && g[course]?.trim() === column.dish).length
      }));
    return { course, courseLabel: SERVICE_COURSE_LABEL[course], dishes, total: dishes.reduce((sum, d) => sum + d.total, 0) };
  }).filter((course) => course.dishes.length > 0);

  // Group by the guest's full set of requirements: "Gluten free, Dairy free" needs a plate that is both.
  const groups = new Map<string, { pax: number; dishes: Map<ServiceCourseKey, Map<string, number>>; tables: Set<string> }>();
  tablesInOrder(model).forEach(([table, guests]) => {
    guests.forEach((guest) => {
      if (!guest.dietaryNormalized.length) return;
      const requirement = guest.dietaryNormalized.join(", ");
      let group = groups.get(requirement);
      if (!group) {
        group = { pax: 0, dishes: new Map(), tables: new Set() };
        groups.set(requirement, group);
      }
      group.pax += 1;
      group.tables.add(formatTableLabel(table));
      COURSES.forEach((course) => {
        const dish = guest[course]?.trim();
        if (!dish) return;
        const byDish = group!.dishes.get(course) ?? new Map<string, number>();
        byDish.set(dish, (byDish.get(dish) ?? 0) + 1);
        group!.dishes.set(course, byDish);
      });
    });
  });
  const dietaryGroups: KitchenDietaryGroup[] = Array.from(groups.entries())
    .sort((a, b) => b[1].pax - a[1].pax || a[0].localeCompare(b[0]))
    .map(([requirement, group]) => {
      const perCourse: KitchenDietaryGroup["courses"] = {};
      courses.forEach(({ course }) => {
        perCourse[course] = Array.from(group.dishes.get(course)?.entries() ?? [])
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([dish, count]) => ({ dish, count }));
      });
      return { requirement, pax: group.pax, courses: perCourse, tables: Array.from(group.tables) };
    });

  return { columns, rows, totalGuests: model.guests.length, totalDietary, courses, dietaryGroups };
}

/** "2 x Risotto, 1 x Chicken" (as on the PDF) — or just the dish when everyone in the group has it. */
export function formatDietaryDishes(dishes: Array<{ dish: string; count: number }> | undefined, pax: number): string {
  if (!dishes?.length) return "";
  if (dishes.length === 1 && dishes[0].count === pax) return dishes[0].dish;
  return dishes.map((d) => `${d.count} x ${d.dish}`).join(", ");
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
  const dishSection = [
    [],
    ["Dish totals"],
    ["Course", "Dish", "Total", "Of which dietary"],
    ...data.courses.flatMap((course) => course.dishes.map((d) => [course.courseLabel, d.dish, String(d.total), d.dietary ? String(d.dietary) : ""]))
  ];
  const dietarySection = data.dietaryGroups.length
    ? [
        [],
        ["Dietary requirements by course"],
        ["Requirement", "Guests", ...data.courses.map((c) => c.courseLabel), "Tables"],
        ...data.dietaryGroups.map((group) => [
          group.requirement,
          String(group.pax),
          ...data.courses.map((c) => formatDietaryDishes(group.courses[c.course], group.pax)),
          group.tables.join(", ")
        ])
      ]
    : [];
  return [header, totals, ...body, ...dishSection, ...dietarySection];
}
