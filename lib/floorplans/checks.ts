import type { FloorplanCanvasObject, FloorplanTableObject } from "@/types";
import { tableSeatCount } from "@/lib/floorplans/geometry";
import { isFloorAreaFor, isObstacle, prepare, preparedCollide } from "@/lib/floorplans/collision";
import { guestCountFor, naturalTableCompare, tableKey, type TableGuestMap } from "@/lib/floorplans/guests";

export interface PlanIssue {
  id: string;
  severity: "error" | "warning" | "info";
  message: string;
  /** Objects to select when the issue is clicked. */
  objectIds: string[];
}

export interface PlanTotals {
  tables: number;
  seats: number;
  /** Guests seated at tables that are on the plan; null without a guest list. */
  guests: number | null;
}

export function planTotals(objects: FloorplanCanvasObject[], guests: TableGuestMap | null): PlanTotals {
  let tables = 0;
  let seats = 0;
  let seated = 0;
  const seen = new Set<string>();
  for (const obj of objects) {
    if (obj.type !== "table") continue;
    tables += 1;
    seats += tableSeatCount(obj);
    const key = tableKey(obj.tableNumber);
    if (guests && !seen.has(key)) {
      seen.add(key);
      seated += guests[key]?.count ?? 0;
    }
  }
  return { tables, seats, guests: guests ? seated : null };
}

const OVERLAP_CHECK_LIMIT = 400;

export function buildPlanIssues(objects: FloorplanCanvasObject[], guests: TableGuestMap | null): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const tables = objects.filter((o): o is FloorplanTableObject => o.type === "table");

  const byNumber = new Map<string, FloorplanTableObject[]>();
  for (const t of tables) {
    const key = tableKey(t.tableNumber);
    const list = byNumber.get(key);
    if (list) list.push(t);
    else byNumber.set(key, [t]);
  }
  Array.from(byNumber.entries())
    .filter(([, list]) => list.length > 1)
    .sort(([a], [b]) => naturalTableCompare(a, b))
    .forEach(([key, list]) => {
      issues.push({
        id: `dup-${key}`,
        severity: "error",
        message: `Table number ${key} is used ${list.length} times.`,
        objectIds: list.map((t) => t.id)
      });
    });

  if (guests) {
    const planned = new Set(byNumber.keys());
    Array.from(byNumber.entries())
      .sort(([a], [b]) => naturalTableCompare(a, b))
      .forEach(([key, list]) => {
        const count = guestCountFor(key, guests);
        if (count == null) return;
        const seats = tableSeatCount(list[0]);
        if (count > seats) {
          issues.push({
            id: `over-${key}`,
            severity: "error",
            message: `Table ${key} has ${count} guests for ${seats} seats.`,
            objectIds: [list[0].id]
          });
        } else if (count === 0) {
          issues.push({
            id: `empty-${key}`,
            severity: "info",
            message: `Table ${key} has no guests assigned.`,
            objectIds: [list[0].id]
          });
        }
      });

    const missing = Object.keys(guests)
      .filter((key) => !planned.has(key))
      .sort(naturalTableCompare);
    if (missing.length) {
      const guestTotal = missing.reduce((sum, key) => sum + guests[key].count, 0);
      issues.push({
        id: "missing-tables",
        severity: "warning",
        message: `${guestTotal} guest${guestTotal === 1 ? "" : "s"} sit${guestTotal === 1 ? "s" : ""} at ${
          missing.length === 1 ? "table" : "tables"
        } not on the plan: ${missing.join(", ")}.`,
        objectIds: []
      });
    }
  }

  if (tables.length <= OVERLAP_CHECK_LIMIT) {
    // Shape-accurate: round tables and chairs are circles, so diagonal neighbours and rotated tables
    // aren't flagged just because their bounding boxes meet.
    const prepped = tables.map(prepare);
    const overlapping = new Set<string>();
    for (let i = 0; i < prepped.length; i += 1) {
      for (let j = i + 1; j < prepped.length; j += 1) {
        if (preparedCollide(prepped[i], prepped[j])) {
          overlapping.add(tables[i].id);
          overlapping.add(tables[j].id);
        }
      }
    }
    if (overlapping.size) {
      issues.push({
        id: "overlap",
        severity: "warning",
        message: `${overlapping.size} tables overlap or have chairs touching.`,
        objectIds: Array.from(overlapping)
      });
    }

    const obstacles = objects.filter(isObstacle).map(prepare);
    const blockedTables = new Set<string>();
    const blockingObjects = new Set<string>();
    for (const t of prepped) {
      for (const o of obstacles) {
        if (!preparedCollide(t, o) || isFloorAreaFor(o.obj, t.obj)) continue;
        blockedTables.add(t.obj.id);
        blockingObjects.add(o.obj.id);
      }
    }
    if (blockedTables.size) {
      const n = blockedTables.size;
      issues.push({
        id: "obstacle",
        severity: "warning",
        message: `${n} table${n === 1 ? "" : "s"} run${n === 1 ? "s" : ""} into a pillar, stage, bar or other object.`,
        objectIds: [...Array.from(blockedTables), ...Array.from(blockingObjects)]
      });
    }
  }

  return issues;
}
