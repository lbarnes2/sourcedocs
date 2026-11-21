/**
 * Shape-accurate overlap tests for floorplan objects: round tables and chairs as circles, rectangles
 * (rotated or not) as boxes. Used by the plan checks and to drop new objects into free space.
 */
import {
  chairMetrics,
  objectBox,
  objectPrintBounds,
  seatOffsets,
  type Bounds,
  type Point
} from "@/lib/floorplans/geometry";
import { seatKey, seatingRunBoxes, seatingSeats } from "@/lib/floorplans/seating";
import type { FloorplanCanvasObject, FloorplanSeatingObject, FloorplanTableObject } from "@/types";

type Circle = { kind: "circle"; x: number; y: number; r: number };
type Box = { kind: "box"; cx: number; cy: number; hw: number; hh: number; rotation: number };
type Shape = Circle | Box;

/** Overlaps shallower than this (canvas units) count as touching, not overlapping. */
const TOLERANCE = 0.5;

function rotate(p: Point, degrees: number): Point {
  if (!degrees) return p;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

/** The shapes that make up an object: a table's top plus each chair, or a shape's outline. */
export function objectShapes(obj: FloorplanCanvasObject): Shape[] {
  const box = objectBox(obj);
  if (obj.type === "seating") {
    // Each run of chairs between aisles, row by row: aisles and seatways are open floor.
    return seatingRunBoxes(obj).map((b) => {
      const c = rotate({ x: b.cx, y: b.cy }, box.rotation);
      return { kind: "box", cx: box.cx + c.x, cy: box.cy + c.y, hw: b.w / 2, hh: b.h / 2, rotation: box.rotation };
    });
  }
  const body: Shape =
    box.round && box.w === box.h
      ? { kind: "circle", x: box.cx, y: box.cy, r: box.w / 2 }
      : { kind: "box", cx: box.cx, cy: box.cy, hw: box.w / 2, hh: box.h / 2, rotation: box.rotation };
  if (obj.type !== "table") return [body];
  const { radius } = chairMetrics(obj);
  const chairs: Shape[] = seatOffsets(obj).map((s) => ({ kind: "circle", x: obj.x + s.x, y: obj.y + s.y, r: radius }));
  return [body, ...chairs];
}

function circleCircle(a: Circle, b: Circle, gap: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r + gap - TOLERANCE;
}

function circleBox(c: Circle, b: Box, gap: number): boolean {
  const local = rotate({ x: c.x - b.cx, y: c.y - b.cy }, -b.rotation);
  const nx = Math.max(-b.hw, Math.min(b.hw, local.x));
  const ny = Math.max(-b.hh, Math.min(b.hh, local.y));
  return Math.hypot(local.x - nx, local.y - ny) < c.r + gap - TOLERANCE;
}

function boxCorners(b: Box): Point[] {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1]
  ].map(([sx, sy]) => {
    const p = rotate({ x: sx * b.hw, y: sy * b.hh }, b.rotation);
    return { x: b.cx + p.x, y: b.cy + p.y };
  });
}

/** Separating-axis test for two rotated boxes. */
function boxBox(a: Box, b: Box, gap: number): boolean {
  const ca = boxCorners(a);
  const cb = boxCorners(b);
  const axes = [a.rotation, a.rotation + 90, b.rotation, b.rotation + 90].map((deg) => rotate({ x: 1, y: 0 }, deg));
  for (const axis of axes) {
    const pa = ca.map((p) => p.x * axis.x + p.y * axis.y);
    const pb = cb.map((p) => p.x * axis.x + p.y * axis.y);
    const overlap = Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb));
    if (overlap + gap <= TOLERANCE) return false;
  }
  return true;
}

function shapesHit(a: Shape, b: Shape, gap: number): boolean {
  if (a.kind === "circle" && b.kind === "circle") return circleCircle(a, b, gap);
  if (a.kind === "circle" && b.kind === "box") return circleBox(a, b, gap);
  if (a.kind === "box" && b.kind === "circle") return circleBox(b, a, gap);
  return boxBox(a as Box, b as Box, gap);
}

function boundsMeet(a: Bounds, b: Bounds, gap: number): boolean {
  return a.minX < b.maxX + gap && b.minX < a.maxX + gap && a.minY < b.maxY + gap && b.minY < a.maxY + gap;
}

export type Prepared = { obj: FloorplanCanvasObject; bounds: Bounds; shapes: Shape[] };

/** Work out an object's bounds and shapes once, for checks that compare it against many others. */
export function prepare(obj: FloorplanCanvasObject): Prepared {
  return { obj, bounds: objectPrintBounds(obj), shapes: objectShapes(obj) };
}

export function preparedCollide(a: Prepared, b: Prepared, gap = 0): boolean {
  if (!boundsMeet(a.bounds, b.bounds, gap)) return false;
  return a.shapes.some((x) => b.shapes.some((y) => shapesHit(x, y, gap)));
}

/** True when the two objects overlap, or come closer than `gap` canvas units. */
export function objectsCollide(a: FloorplanCanvasObject, b: FloorplanCanvasObject, gap = 0): boolean {
  return preparedCollide(prepare(a), prepare(b), gap);
}

/**
 * Things a table shouldn't stand on: pillars, stages, bars, dance floors… Outline-only shapes (the room)
 * and text labels are not obstacles.
 */
export function isObstacle(obj: FloorplanCanvasObject): boolean {
  if (obj.type === "text" || isFurnishing(obj)) return false;
  return obj.fill !== "none";
}

/** Tables and seating blocks: the things people sit at, which shouldn't overlap each other. */
export function isFurnishing(obj: FloorplanCanvasObject): obj is FloorplanTableObject | FloorplanSeatingObject {
  return obj.type === "table" || obj.type === "seating";
}

function area(b: Bounds): number {
  return Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
}

/**
 * A shape much bigger than the table that fully contains it is a floor area (a coloured room or zone),
 * not something the table is in the way of.
 */
export function isFloorAreaFor(obstacle: FloorplanCanvasObject, table: FloorplanCanvasObject): boolean {
  const o = objectPrintBounds(obstacle);
  const t = objectPrintBounds(table);
  const contains = o.minX <= t.minX && o.minY <= t.minY && o.maxX >= t.maxX && o.maxY >= t.maxY;
  return contains && area(o) >= area(t) * 10;
}

/**
 * Nearest centre to `start` (searching outwards in `step`s) where `obj` doesn't collide with any of
 * `others`, keeping `gap` clear. Falls back to `start` when nothing nearby is free.
 */
export function findFreeCentre(
  obj: FloorplanCanvasObject,
  others: FloorplanCanvasObject[],
  start: Point,
  step: number,
  gap: number,
  withCentreFn: (obj: FloorplanCanvasObject, cx: number, cy: number) => FloorplanCanvasObject,
  maxRings = 25
): Point {
  const blockers = others.filter(
    (o) => isFurnishing(o) || (isObstacle(o) && !(isFurnishing(obj) && isFloorAreaFor(o, obj)))
  );
  if (!blockers.length || step <= 0) return start;
  const prepared = blockers.map(prepare);
  const free = (p: Point) => {
    const moved = prepare(withCentreFn(obj, p.x, p.y));
    return !prepared.some((o) => preparedCollide(moved, o, gap));
  };
  for (let ring = 0; ring <= maxRings; ring += 1) {
    const points: Point[] = [];
    for (let i = -ring; i <= ring; i += 1) {
      for (let j = -ring; j <= ring; j += 1) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        points.push({ x: start.x + i * step, y: start.y + j * step });
      }
    }
    points.sort((a, b) => Math.hypot(a.x - start.x, a.y - start.y) - Math.hypot(b.x - start.x, b.y - start.y));
    const hit = points.find(free);
    if (hit) return hit;
  }
  return start;
}


/**
 * Chairs in a seating block that stand on, or come within `gap` of, something else: obstacles (pillars,
 * bars, AV desks…), tables and other seating. Floor areas the whole block stands on (a coloured room) and
 * the block's own chairs don't count. Returns "row:seat" keys.
 */
export function seatsBlocked(block: FloorplanSeatingObject, others: FloorplanCanvasObject[], gap: number): string[] {
  const blockers = others
    .filter((o) => o.id !== block.id && (isFurnishing(o) || (isObstacle(o) && !isFloorAreaFor(o, block))))
    .map(prepare);
  if (!blockers.length) return [];
  const rotation = block.rotation ?? 0;
  const out: string[] = [];
  for (const seat of seatingSeats(block)) {
    const c = rotate({ x: seat.x, y: seat.y }, rotation);
    const chair: Box = {
      kind: "box",
      cx: block.x + c.x,
      cy: block.y + c.y,
      hw: block.chairWidth / 2,
      hh: block.chairDepth / 2,
      rotation
    };
    const r = Math.hypot(chair.hw, chair.hh) + gap;
    const bounds = { minX: chair.cx - r, minY: chair.cy - r, maxX: chair.cx + r, maxY: chair.cy + r };
    const hit = blockers.some((o) => boundsMeet(bounds, o.bounds, 0) && o.shapes.some((sh) => shapesHit(chair, sh, gap)));
    if (hit) out.push(seatKey(seat.row, seat.seat));
  }
  return out;
}
