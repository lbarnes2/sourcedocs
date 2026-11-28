/**
 * Rooms: a closed outline of corners. Helpers for the room's shape (area, wall lengths, editing corners)
 * and for turning old "Room outline" rectangles into rooms.
 */
import type { FloorplanCanvasObject, FloorplanRoomObject } from "@/types";

export type Point = { x: number; y: number };

const EPS = 1e-6;

/** Corners on the plan (the room's corners are stored relative to its x/y). */
export function roomWorldPoints(room: FloorplanRoomObject): Point[] {
  return room.points.map((p) => ({ x: room.x + p.x, y: room.y + p.y }));
}

export function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function wallLengths(points: Point[]): number[] {
  return points.map((a, i) => {
    const b = points[(i + 1) % points.length];
    return Math.hypot(b.x - a.x, b.y - a.y);
  });
}

export function polygonPerimeter(points: Point[]): number {
  return wallLengths(points).reduce((s, l) => s + l, 0);
}

export function pointInPolygon(p: Point, points: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Bounding box of the room's corners, relative to its x/y. */
export function roomLocalBounds(room: Pick<FloorplanRoomObject, "points">) {
  const xs = room.points.map((p) => p.x);
  const ys = room.points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

const tidy = (v: number) => Math.round(v * 1000) / 1000;

/** Keep x/y at the top-left of the corners' bounding box, so the room's box and its origin agree. */
export function normaliseRoom(room: FloorplanRoomObject): FloorplanRoomObject {
  const b = roomLocalBounds(room);
  if (Math.abs(b.minX) < EPS && Math.abs(b.minY) < EPS) return room;
  return {
    ...room,
    x: tidy(room.x + b.minX),
    y: tidy(room.y + b.minY),
    points: room.points.map((p) => ({ x: tidy(p.x - b.minX), y: tidy(p.y - b.minY) }))
  };
}

/** A room from corners on the plan. */
export function roomFromWorldPoints(points: Point[], extra: Partial<FloorplanRoomObject> = {}): FloorplanRoomObject {
  return normaliseRoom({ id: crypto.randomUUID(), type: "room", x: 0, y: 0, points: points.map((p) => ({ ...p })), ...extra });
}

/** Drop repeated corners and corners that sit in the middle of a straight wall. */
export function cleanCorners(points: Point[]): Point[] {
  let pts = points.filter((p, i) => {
    const q = points[(i + 1) % points.length];
    return Math.hypot(q.x - p.x, q.y - p.y) > EPS;
  });
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[(i - 1 + pts.length) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
      if (Math.abs(cross) < 1e-3 * Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y) && dot > 0) {
        pts = pts.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/**
 * Set wall `index` to `length`, keeping its start corner and direction. The corners after it move
 * along with its end, up to the first wall that runs (at least partly) the same way: that wall takes up
 * the change. So on a rectangle, lengthening the top wall moves the right-hand wall out, and the bottom
 * wall gets longer to match.
 */
export function setWallLength(points: Point[], index: number, length: number): Point[] {
  const n = points.length;
  if (n < 3 || length <= 0) return points;
  const a = points[index];
  const b = points[(index + 1) % n];
  const current = Math.hypot(b.x - a.x, b.y - a.y);
  if (current < EPS) return points;
  const ux = (b.x - a.x) / current;
  const uy = (b.y - a.y) / current;
  const dx = ux * (length - current);
  const dy = uy * (length - current);
  const moved = new Set<number>();
  for (let step = 1; step < n; step += 1) {
    const i = (index + step) % n;
    moved.add(i);
    const p = points[i];
    const q = points[(i + 1) % n];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    // The next wall: if it runs across the change, its far corner moves too; otherwise it absorbs it.
    const along = len < EPS ? 0 : Math.abs(((q.x - p.x) * ux + (q.y - p.y) * uy) / len);
    if (along > 0.01) break;
    if ((i + 1) % n === index) break;
  }
  // Nothing absorbs it (every other wall runs across): just move the end corner.
  if (moved.size === n - 1) {
    moved.clear();
    moved.add((index + 1) % n);
  }
  return points.map((p, i) => (moved.has(i) ? { x: tidy(p.x + dx), y: tidy(p.y + dy) } : p));
}

/** Add a corner in the middle of wall `index`. */
export function insertCorner(points: Point[], index: number): Point[] {
  const a = points[index];
  const b = points[(index + 1) % points.length];
  const mid = { x: tidy((a.x + b.x) / 2), y: tidy((a.y + b.y) / 2) };
  return [...points.slice(0, index + 1), mid, ...points.slice(index + 1)];
}

/** Take out corner `index` (a room keeps at least three). */
export function removeCorner(points: Point[], index: number): Point[] {
  if (points.length <= 3) return points;
  return points.filter((_, i) => i !== index);
}

/**
 * Where to put the next corner while drawing: `to` turned to the nearest multiple of `stepDeg` from
 * `from`, keeping its distance.
 */
export function snapAngle(from: Point, to: Point, stepDeg = 45): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return to;
  const step = (stepDeg * Math.PI) / 180;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + Math.cos(angle) * len, y: from.y + Math.sin(angle) * len };
}

/** A point `length` from `from`, in the direction of `toward`. */
export function pointAlong(from: Point, toward: Point, length: number): Point {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return { x: from.x + length, y: from.y };
  return { x: from.x + (dx / len) * length, y: from.y + (dy / len) * length };
}

/** Whether a rectangle is an old "Room outline": an unlabelled outline-only rectangle. */
function isLegacyOutline(obj: FloorplanCanvasObject): boolean {
  return obj.type === "rect" && obj.fill === "none" && !obj.label?.trim() && !obj.exit;
}

/** Turn old "Room outline" rectangles into rooms with four corners (rotation included). */
export function migrateRoomOutlines(objects: FloorplanCanvasObject[]): FloorplanCanvasObject[] {
  if (!objects.some(isLegacyOutline)) return objects;
  return objects.map((obj) => {
    if (obj.type !== "rect" || !isLegacyOutline(obj)) return obj;
    const cx = obj.x + obj.width / 2;
    const cy = obj.y + obj.height / 2;
    const rad = ((obj.rotation ?? 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1]
    ].map(([sx, sy]) => {
      const x = (sx * obj.width) / 2;
      const y = (sy * obj.height) / 2;
      return { x: tidy(cx + x * cos - y * sin), y: tidy(cy + x * sin + y * cos) };
    });
    return { ...roomFromWorldPoints(corners), id: obj.id };
  });
}

/** A rectangular room of the given size (plan units), centred on `centre`. */
export function rectangularRoom(centre: Point, width: number, height: number, name?: string): FloorplanRoomObject {
  const x0 = centre.x - width / 2;
  const y0 = centre.y - height / 2;
  return roomFromWorldPoints(
    [
      { x: x0, y: y0 },
      { x: x0 + width, y: y0 },
      { x: x0 + width, y: y0 + height },
      { x: x0, y: y0 + height }
    ],
    name ? { name } : {}
  );
}
