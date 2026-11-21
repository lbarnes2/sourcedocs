/**
 * Plan measurements for the Plan panel: plain numbers (narrowest aisle, longest run of seats, exit
 * width…) with where they were measured, so the panel can point at them. Nothing here decides whether
 * a layout is acceptable; the user compares the numbers with their venue's rules and their own limits.
 */
import { objectBox, rotatePoint, tableSeatCount, type Point } from "@/lib/floorplans/geometry";
import {
  blockAisleWidth,
  longestRun,
  seatingAisleStrips,
  seatingAisles,
  seatingSeatCount,
  seatingSeatwayStrip,
  seatway,
  type LocalBox
} from "@/lib/floorplans/seating";
import { findStage } from "@/lib/floorplans/theatre";
import type { FloorplanCanvasObject, FloorplanLimits, FloorplanSeatingObject } from "@/types";

/** Where a measurement was taken: shapes to outline and/or a dimension line. */
export type Highlight = { polygons: Point[][]; line?: [Point, Point]; label?: string };

export type Measurement = {
  id: string;
  label: string;
  /** Formatted value, e.g. "1.20 m". */
  value: string;
  detail?: string;
  /** Past the user's own limit (shown amber; never a verdict). */
  past?: boolean;
  /** The limit compared against, formatted. */
  limit?: string;
  highlight?: Highlight;
  /** Objects the measurement is about (used to centre the view). */
  objectIds: string[];
};

/** Pairs of blocks further apart than this aren't reported as a gangway. */
const GANGWAY_RANGE_M = 6;

function boxPolygon(cx: number, cy: number, w: number, h: number, rotation: number): Point[] {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1]
  ].map(([sx, sy]) => {
    const p = rotatePoint({ x: (sx * w) / 2, y: (sy * h) / 2 }, rotation);
    return { x: cx + p.x, y: cy + p.y };
  });
}

export function objectPolygon(obj: FloorplanCanvasObject): Point[] {
  const b = objectBox(obj);
  if (b.round && b.w === b.h) {
    // A 24-sided stand-in for a circle is close enough for distances.
    const r = b.w / 2;
    return Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2;
      return { x: b.cx + r * Math.cos(a), y: b.cy + r * Math.sin(a) };
    });
  }
  return boxPolygon(b.cx, b.cy, b.w, b.h, b.rotation);
}

/** A box in a seating block's own frame, placed on the plan. */
function blockLocalPolygon(s: FloorplanSeatingObject, lb: LocalBox): Point[] {
  const rotation = s.rotation ?? 0;
  const c = rotatePoint({ x: lb.cx, y: lb.cy }, rotation);
  return boxPolygon(s.x + c.x, s.y + c.y, lb.w, lb.h, rotation);
}

function closestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

function convexOverlap(a: Point[], b: Point[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const axis = { x: -(q.y - p.y), y: q.x - p.x };
      const pa = a.map((v) => v.x * axis.x + v.y * axis.y);
      const pb = b.map((v) => v.x * axis.x + v.y * axis.y);
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
    }
  }
  return true;
}

/** Shortest distance between two convex polygons, with the closest points (0 when they overlap). */
export function polygonDistance(a: Point[], b: Point[]): { d: number; from: Point; to: Point } {
  if (convexOverlap(a, b)) return { d: 0, from: a[0], to: a[0] };
  let best = { d: Infinity, from: a[0], to: b[0] };
  const test = (pts: Point[], poly: Point[], flip: boolean) => {
    for (const p of pts) {
      for (let i = 0; i < poly.length; i += 1) {
        const c = closestOnSegment(p, poly[i], poly[(i + 1) % poly.length]);
        const d = Math.hypot(p.x - c.x, p.y - c.y);
        if (d < best.d) best = flip ? { d, from: c, to: p } : { d, from: p, to: c };
      }
    }
  };
  test(a, b, false);
  test(b, a, true);
  return best;
}

export function buildMeasurements(
  objects: FloorplanCanvasObject[],
  unitsPerMetre: number | null,
  limits: FloorplanLimits | undefined
): Measurement[] {
  const upm = unitsPerMetre;
  const m = (units: number) => (upm ? units / upm : null);
  const fmt = (metres: number | null) => (metres == null ? "—" : `${metres.toFixed(2)} m`);
  const L = limits ?? {};
  const out: Measurement[] = [];
  const blocks = objects.filter((o): o is FloorplanSeatingObject => o.type === "seating");
  const nameOf = (s: FloorplanSeatingObject) => s.name?.trim() || "Seating block";

  // Capacity: every seat on the plan, at tables and in rows.
  const theatreSeats = blocks.reduce((sum, s) => sum + seatingSeatCount(s), 0);
  const tableSeats = objects.reduce((sum, o) => sum + (o.type === "table" ? tableSeatCount(o) : 0), 0);
  const capacity = theatreSeats + tableSeats;
  out.push({
    id: "capacity",
    label: "Seats",
    value: String(capacity),
    detail:
      theatreSeats && tableSeats
        ? `${theatreSeats} in rows, ${tableSeats} at tables`
        : blocks.length
          ? `${blocks.length} block${blocks.length === 1 ? "" : "s"}`
          : undefined,
    past: L.maxCapacity != null && capacity > L.maxCapacity,
    limit: L.maxCapacity != null ? `max ${L.maxCapacity}` : undefined,
    objectIds: []
  });

  if (blocks.length) {
    // Longest run of seats between aisles (or a block's ends).
    let run = { n: 0, block: blocks[0] };
    for (const s of blocks) {
      const n = longestRun(s);
      if (n > run.n) run = { n, block: s };
    }
    out.push({
      id: "longest-run",
      label: "Longest run of seats",
      value: String(run.n),
      detail: nameOf(run.block),
      past: L.maxSeatsBetweenAisles != null && run.n > L.maxSeatsBetweenAisles,
      limit: L.maxSeatsBetweenAisles != null ? `max ${L.maxSeatsBetweenAisles}` : undefined,
      highlight: { polygons: [objectPolygon(run.block)] },
      objectIds: [run.block.id]
    });

    let deepest = blocks[0];
    for (const s of blocks) if (s.rows > deepest.rows) deepest = s;
    out.push({
      id: "most-rows",
      label: "Most rows in a block",
      value: String(deepest.rows),
      detail: nameOf(deepest),
      highlight: { polygons: [objectPolygon(deepest)] },
      objectIds: [deepest.id]
    });

    // Smallest seatway.
    const multiRow = blocks.filter((s) => s.rows > 1);
    if (multiRow.length) {
      let tight = multiRow[0];
      for (const s of multiRow) if (seatway(s) < seatway(tight)) tight = s;
      const metres = m(seatway(tight));
      const strip = seatingSeatwayStrip(tight);
      out.push({
        id: "seatway",
        label: "Smallest seatway",
        value: fmt(metres),
        detail: nameOf(tight),
        past: metres != null && L.minSeatwayM != null && metres < L.minSeatwayM - 1e-6,
        limit: L.minSeatwayM != null ? `min ${L.minSeatwayM} m` : undefined,
        highlight: strip ? { polygons: [blockLocalPolygon(tight, strip)] } : undefined,
        objectIds: [tight.id]
      });
    }

    // Aisles inside blocks.
    const withAisles = blocks.filter((s) => seatingAisles(s).length);
    // Gangways between neighbouring blocks.
    let gap: { d: number; from: Point; to: Point; a: FloorplanSeatingObject; b: FloorplanSeatingObject } | null = null;
    const polys = blocks.map(objectPolygon);
    const range = (upm ?? 24) * GANGWAY_RANGE_M;
    for (let i = 0; i < blocks.length; i += 1) {
      for (let j = i + 1; j < blocks.length; j += 1) {
        const d = polygonDistance(polys[i], polys[j]);
        if (d.d <= 0 || d.d > range) continue;
        if (!gap || d.d < gap.d) gap = { ...d, a: blocks[i], b: blocks[j] };
      }
    }
    let aisle: { w: number; s: FloorplanSeatingObject } | null = null;
    for (const s of withAisles) {
      const w = blockAisleWidth(s);
      if (!aisle || w < aisle.w) aisle = { w, s };
    }
    if (aisle) {
      const metres = m(aisle.w);
      const strips = seatingAisleStrips(aisle.s);
      out.push({
        id: "aisle",
        label: "Narrowest aisle in a block",
        value: fmt(metres),
        detail: nameOf(aisle.s),
        past: metres != null && L.minAisleM != null && metres < L.minAisleM - 1e-6,
        limit: L.minAisleM != null ? `min ${L.minAisleM} m` : undefined,
        highlight: { polygons: strips.map((st) => blockLocalPolygon(aisle!.s, st)) },
        objectIds: [aisle.s.id]
      });
    }
    if (gap) {
      const metres = m(gap.d);
      out.push({
        id: "gangway",
        label: "Narrowest gap between blocks",
        value: fmt(metres),
        detail: `${nameOf(gap.a)} – ${nameOf(gap.b)}`,
        past: metres != null && L.minAisleM != null && metres < L.minAisleM - 1e-6,
        limit: L.minAisleM != null ? `min ${L.minAisleM} m` : undefined,
        highlight: { polygons: [polys[blocks.indexOf(gap.a)], polys[blocks.indexOf(gap.b)]], line: [gap.from, gap.to] },
        objectIds: [gap.a.id, gap.b.id]
      });
    }

    // Front row to the stage.
    const stage = findStage(objects);
    if (stage) {
      const sp = objectPolygon(stage);
      let near: { d: number; from: Point; to: Point; s: FloorplanSeatingObject } | null = null;
      blocks.forEach((s, i) => {
        const d = polygonDistance(sp, polys[i]);
        if (!near || d.d < near.d) near = { ...d, s };
      });
      if (near) {
        const n = near as { d: number; from: Point; to: Point; s: FloorplanSeatingObject };
        const metres = m(n.d);
        out.push({
          id: "front",
          label: "Front row to stage",
          value: fmt(metres),
          detail: nameOf(n.s),
          past: metres != null && L.minFrontDistanceM != null && metres < L.minFrontDistanceM - 1e-6,
          limit: L.minFrontDistanceM != null ? `min ${L.minFrontDistanceM} m` : undefined,
          highlight: { polygons: [sp], line: n.d > 0 ? [n.from, n.to] : undefined },
          objectIds: [n.s.id, stage.id]
        });
      }
    }
  }

  // Exits: shapes marked as exits; the longer side is the opening.
  const exits = objects.filter((o) => o.type === "rect" && o.exit);
  if (exits.length || L.minExitWidthM != null) {
    const width = exits.reduce((sum, o) => sum + (o.type === "rect" ? Math.max(o.width, o.height) : 0), 0);
    const metres = m(width);
    out.push({
      id: "exits",
      label: "Exits",
      value: exits.length ? `${exits.length} · ${fmt(metres)}` : "None marked",
      detail: exits.length ? "Total width of the shapes marked as exits" : "Mark a shape as an exit in its settings",
      past: L.minExitWidthM != null && (metres ?? 0) < L.minExitWidthM - 1e-6,
      limit: L.minExitWidthM != null ? `min ${L.minExitWidthM} m` : undefined,
      highlight: exits.length ? { polygons: exits.map(objectPolygon) } : undefined,
      objectIds: exits.map((o) => o.id)
    });
  }

  // Floor area per seat, from the outline-only shapes (rooms).
  const rooms = objects.filter((o) => o.type === "rect" && o.fill === "none");
  if (rooms.length && capacity && upm) {
    const area = rooms.reduce((sum, o) => sum + (o.type === "rect" ? o.width * o.height : 0), 0) / (upm * upm);
    out.push({
      id: "area",
      label: "Floor area per seat",
      value: `${(area / capacity).toFixed(2)} m²`,
      detail: `${area.toFixed(0)} m² of room outline`,
      highlight: { polygons: rooms.map(objectPolygon) },
      objectIds: rooms.map((o) => o.id)
    });
  }

  return out;
}
