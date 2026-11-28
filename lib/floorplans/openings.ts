/**
 * Doors, windows and openings in a room's walls: where they sit on the plan, how the walls are drawn
 * around them, and the floor a door sweeps through as it opens.
 */
import { roomWorldPoints, wallLengths, type Point } from "@/lib/floorplans/room";
import type { FloorplanOpening, FloorplanOpeningKind, FloorplanRoomObject } from "@/types";

export const OPENING_KINDS: ReadonlyArray<{ value: FloorplanOpeningKind; label: string; widthM: number }> = [
  { value: "door", label: "Door", widthM: 0.9 },
  { value: "double-door", label: "Double door", widthM: 1.8 },
  { value: "window", label: "Window", widthM: 1.5 },
  { value: "opening", label: "Opening", widthM: 1.2 }
];

export function openingKindLabel(kind: FloorplanOpeningKind): string {
  return OPENING_KINDS.find((k) => k.value === kind)?.label ?? "Opening";
}

export function isDoor(o: FloorplanOpening): boolean {
  return o.kind === "door" || o.kind === "double-door";
}

/** How thick walls are drawn (plan units): 12 cm with a scale. */
export function wallThickness(unitsPerMetre: number | null | undefined): number {
  return Math.max(1.5, (unitsPerMetre ?? 24) * 0.12);
}

/** One wall on the plan: its ends, length, direction and the normal pointing into the room. */
export type WallFrame = { a: Point; b: Point; len: number; ux: number; uy: number; nx: number; ny: number };

export function roomWalls(room: FloorplanRoomObject): WallFrame[] {
  const pts = roomWorldPoints(room);
  let signed = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    signed += p.x * q.y - q.x * p.y;
  }
  return pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = len ? (b.x - a.x) / len : 1;
    const uy = len ? (b.y - a.y) / len : 0;
    // With the corners going round one way the room is on the left of each wall; the other way, the right.
    return signed >= 0 ? { a, b, len, ux, uy, nx: -uy, ny: ux } : { a, b, len, ux, uy, nx: uy, ny: -ux };
  });
}

/** Keep an opening's centre far enough from the corners for the whole opening to fit on the wall. */
export function clampOffset(wallLength: number, width: number, offset: number): number {
  if (wallLength <= width) return wallLength / 2;
  return Math.min(wallLength - width / 2, Math.max(width / 2, offset));
}

const at = (f: WallFrame, d: number): Point => ({ x: f.a.x + f.ux * d, y: f.a.y + f.uy * d });

/** A door leaf: the hinge, where the leaf's tip is when open (90°), and where it is when shut. */
export type DoorLeaf = { hinge: Point; open: Point; closed: Point };

export type OpeningGeometry = {
  opening: FloorplanOpening;
  wall: WallFrame;
  /** The two sides of the opening: `start` nearer the wall's start corner. */
  start: Point;
  end: Point;
  centre: Point;
  width: number;
  leaves: DoorLeaf[];
};

export function openingGeometry(walls: WallFrame[], o: FloorplanOpening): OpeningGeometry | null {
  const wall = walls[o.wall];
  if (!wall || wall.len <= 0) return null;
  const width = Math.min(o.width, wall.len);
  const c = clampOffset(wall.len, width, o.offset);
  const start = at(wall, c - width / 2);
  const end = at(wall, c + width / 2);
  const centre = at(wall, c);
  const leaves: DoorLeaf[] = [];
  if (isDoor(o)) {
    const s = o.swing === "out" ? -1 : 1;
    const dx = wall.nx * s;
    const dy = wall.ny * s;
    const leaf = (hinge: Point, closed: Point, len: number): DoorLeaf => ({
      hinge,
      closed,
      open: { x: hinge.x + dx * len, y: hinge.y + dy * len }
    });
    if (o.kind === "double-door") leaves.push(leaf(start, centre, width / 2), leaf(end, centre, width / 2));
    else if (o.hinge === "end") leaves.push(leaf(end, start, width));
    else leaves.push(leaf(start, end, width));
  }
  return { opening: o, wall, start, end, centre, width, leaves };
}

export function roomOpenings(room: FloorplanRoomObject, walls = roomWalls(room)): OpeningGeometry[] {
  return (room.openings ?? []).map((o) => openingGeometry(walls, o)).filter((g): g is OpeningGeometry => g != null);
}

/**
 * The walls as drawn: runs of wall between the openings. With no openings it is one closed outline;
 * otherwise each run goes from the edge of one opening, round any corners, to the edge of the next.
 */
export function wallRuns(room: FloorplanRoomObject, walls = roomWalls(room)): { closed: boolean; runs: Point[][] } {
  const pts = walls.map((w) => w.a);
  const starts: number[] = [];
  let perimeter = 0;
  for (const w of walls) {
    starts.push(perimeter);
    perimeter += w.len;
  }
  const gaps = roomOpenings(room, walls)
    .map((g) => {
      const c = starts[g.opening.wall] + clampOffset(g.wall.len, g.width, g.opening.offset);
      return [c - g.width / 2, c + g.width / 2] as [number, number];
    })
    .sort((a, b) => a[0] - b[0]);
  if (!gaps.length || perimeter <= 0) return { closed: true, runs: [pts] };
  // Overlapping openings make one gap.
  const merged: Array<[number, number]> = [];
  for (const g of gaps) {
    const last = merged[merged.length - 1];
    if (last && g[0] <= last[1]) last[1] = Math.max(last[1], g[1]);
    else merged.push([g[0], g[1]]);
  }
  const pointAt = (d: number): Point => {
    const m = ((d % perimeter) + perimeter) % perimeter;
    let i = starts.length - 1;
    while (i > 0 && starts[i] > m) i -= 1;
    return at(walls[i], m - starts[i]);
  };
  const runs: Point[][] = [];
  for (let k = 0; k < merged.length; k += 1) {
    const from = merged[k][1];
    let to = merged[(k + 1) % merged.length][0];
    if (to <= from) to += perimeter;
    if (to - from < 1e-6) continue;
    const run: Point[] = [pointAt(from)];
    for (const base of [0, perimeter]) {
      starts.forEach((s, i) => {
        const d = s + base;
        if (d > from + 1e-6 && d < to - 1e-6) run.push(pts[i]);
      });
    }
    run.push(pointAt(to));
    runs.push(run);
  }
  return { closed: false, runs };
}

/** A plan point to where it's drawn (canvas box or PDF page). */
export type PointMap = (p: Point) => Point;
const fmtPoint = (map: PointMap) => (q: Point) => {
  const m = map(q);
  return `${m.x.toFixed(3)} ${m.y.toFixed(3)}`;
};

/** SVG path data for the wall runs. */
export function wallRunsPath(room: FloorplanRoomObject, walls = roomWalls(room), map: PointMap = (q) => q): string {
  const { closed, runs } = wallRuns(room, walls);
  const p = fmtPoint(map);
  return runs.map((run) => `M ${run.map(p).join(" L ")}${closed ? " Z" : ""}`).join(" ");
}

/**
 * SVG path data for a door leaf and its swing arc. `map` places the points; `scale` is how much it
 * scales lengths (for the arc radius), and a negative scale means it mirrors (flips the arc's sweep).
 */
export function doorLeafPath(leaf: DoorLeaf, map: PointMap = (q) => q, scale = 1): string {
  const r = Math.hypot(leaf.open.x - leaf.hinge.x, leaf.open.y - leaf.hinge.y) * Math.abs(scale);
  const v1 = { x: leaf.open.x - leaf.hinge.x, y: leaf.open.y - leaf.hinge.y };
  const v2 = { x: leaf.closed.x - leaf.hinge.x, y: leaf.closed.y - leaf.hinge.y };
  let sweep = v1.x * v2.y - v1.y * v2.x > 0 ? 1 : 0;
  if (scale < 0) sweep = 1 - sweep;
  const p = fmtPoint(map);
  return `M ${p(leaf.hinge)} L ${p(leaf.open)} A ${r.toFixed(3)} ${r.toFixed(3)} 0 0 ${sweep} ${p(leaf.closed)}`;
}

/** A box on the plan: centre, size and rotation in degrees. */
export type SwingBox = { cx: number; cy: number; w: number; h: number; rotation: number };

/** The floor inside the room that doors sweep through as they open, as boxes (a leaf-sized square each). */
export function doorSwingBoxes(room: FloorplanRoomObject): SwingBox[] {
  const walls = roomWalls(room);
  const out: SwingBox[] = [];
  for (const g of roomOpenings(room, walls)) {
    if (!isDoor(g.opening) || g.opening.swing === "out") continue;
    const rotation = (Math.atan2(g.wall.uy, g.wall.ux) * 180) / Math.PI;
    for (const leaf of g.leaves) {
      const len = Math.hypot(leaf.closed.x - leaf.hinge.x, leaf.closed.y - leaf.hinge.y);
      out.push({
        cx: (leaf.hinge.x + leaf.closed.x) / 2 + g.wall.nx * (len / 2),
        cy: (leaf.hinge.y + leaf.closed.y) / 2 + g.wall.ny * (len / 2),
        w: len,
        h: len,
        rotation
      });
    }
  }
  return out;
}

/** The nearest wall to a point on the plan, and how far along it the point is. */
export function nearestWall(walls: WallFrame[], p: Point): { wall: number; offset: number; distance: number } {
  let best = { wall: 0, offset: 0, distance: Infinity };
  walls.forEach((w, i) => {
    const t = Math.max(0, Math.min(w.len, (p.x - w.a.x) * w.ux + (p.y - w.a.y) * w.uy));
    const q = at(w, t);
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.distance) best = { wall: i, offset: t, distance: d };
  });
  return best;
}

/**
 * Keep the openings on their walls after the room's corners change. With the same number of corners
 * each opening keeps its wall and distance along it (pulled in if the wall got too short); when corners
 * were added or taken out, each opening moves to the wall nearest where it was.
 */
export function remapOpenings(before: FloorplanRoomObject, after: FloorplanRoomObject): FloorplanRoomObject {
  if (!after.openings?.length) return after;
  const lengths = wallLengths(after.points);
  if (before.points.length === after.points.length) {
    const openings = after.openings.map((o) => {
      const len = lengths[o.wall] ?? 0;
      return { ...o, offset: clampOffset(len, Math.min(o.width, len), o.offset) };
    });
    return { ...after, openings };
  }
  const oldWalls = roomWalls(before);
  const newWalls = roomWalls(after);
  const openings = after.openings.map((o) => {
    const g = openingGeometry(oldWalls, o);
    if (!g) return { ...o, wall: 0, offset: clampOffset(lengths[0], o.width, o.offset) };
    const near = nearestWall(newWalls, g.centre);
    return { ...o, wall: near.wall, offset: clampOffset(newWalls[near.wall].len, Math.min(o.width, newWalls[near.wall].len), near.offset) };
  });
  return { ...after, openings };
}

/** The clear stretches of each wall (from, to along the wall), leaving `margin` round each opening. */
export function freeStretches(room: FloorplanRoomObject, margin: number): Array<Array<[number, number]>> {
  const lengths = wallLengths(room.points);
  return lengths.map((len, wall) => {
    const taken = (room.openings ?? [])
      .filter((o) => o.wall === wall)
      .map((o) => {
        const w = Math.min(o.width, len);
        const c = clampOffset(len, w, o.offset);
        return [c - w / 2 - margin, c + w / 2 + margin] as const;
      })
      .sort((a, b) => a[0] - b[0]);
    const out: Array<[number, number]> = [];
    let start = 0;
    for (const [a, b] of [...taken, [len, len] as const]) {
      if (a > start) out.push([start, a]);
      start = Math.max(start, b);
    }
    return out;
  });
}

/** Where along each wall its length label goes: the middle of its longest clear stretch. */
export function wallLabelOffsets(room: FloorplanRoomObject, margin: number): number[] {
  const lengths = wallLengths(room.points);
  return freeStretches(room, margin).map((stretches, i) => {
    const longest = stretches.reduce<[number, number] | null>((b, s) => (!b || s[1] - s[0] > b[1] - b[0] ? s : b), null);
    return longest ? (longest[0] + longest[1]) / 2 : lengths[i] / 2;
  });
}

/**
 * A new opening of `kind`, in the middle of the longest clear stretch of wall (clear of the corners and
 * of the openings already there).
 */
export function newOpening(room: FloorplanRoomObject, kind: FloorplanOpeningKind, unitsPerMetre: number): FloorplanOpening {
  const lengths = wallLengths(room.points);
  const widthM = OPENING_KINDS.find((k) => k.value === kind)?.widthM ?? 1;
  let best = { wall: 0, from: 0, to: -1 };
  freeStretches(room, 0.3 * unitsPerMetre).forEach((stretches, wall) => {
    for (const [from, to] of stretches) if (to - from > best.to - best.from) best = { wall, from, to };
  });
  // Every wall full: the middle of the longest one.
  if (best.to < best.from) {
    const wall = lengths.reduce((b, len, i) => (len > lengths[b] ? i : b), 0);
    best = { wall, from: 0, to: lengths[wall] };
  }
  const width = Math.min(widthM * unitsPerMetre, lengths[best.wall]);
  return { id: crypto.randomUUID(), kind, wall: best.wall, offset: clampOffset(lengths[best.wall], width, (best.from + best.to) / 2), width };
}

/** How far outside the wall a door's leaves reach (doors that open outwards), so labels clear them. */
export function outsideReach(g: OpeningGeometry): number {
  if (!isDoor(g.opening) || g.opening.swing !== "out") return 0;
  return g.opening.kind === "double-door" ? g.width / 2 : g.width;
}

/** A box round the opening, reaching `depth` either side of the wall (for highlighting it). */
export function openingPolygon(g: OpeningGeometry, depth: number): Point[] {
  const n = { x: g.wall.nx * depth, y: g.wall.ny * depth };
  return [
    { x: g.start.x - n.x, y: g.start.y - n.y },
    { x: g.end.x - n.x, y: g.end.y - n.y },
    { x: g.end.x + n.x, y: g.end.y + n.y },
    { x: g.start.x + n.x, y: g.start.y + n.y }
  ];
}
