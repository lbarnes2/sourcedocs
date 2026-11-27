/**
 * Geometry for theatre-style seating blocks. Everything here is in the block's own frame: centred on the
 * block, unrotated, facing up the page (front row at the top). Callers rotate into place.
 *
 * Rows can be straight, curved (arcs around a point in front of the block, each chair turned to face it,
 * back rows holding more seats at the same spacing, aisles running out from that point) or chevron (two
 * straight wings either side of a centre aisle, each angled so its outer end comes forward).
 */
import type { FloorplanSeatingObject } from "@/types";

/** A box in the block frame; `angle` (degrees, clockwise) turns it about its centre. */
export type LocalBox = { cx: number; cy: number; w: number; h: number; angle?: number };

export type RowShape = "straight" | "curved" | "chevron";

export const ROW_SHAPES: Array<{ value: RowShape; label: string }> = [
  { value: "straight", label: "Straight" },
  { value: "curved", label: "Curved" },
  { value: "chevron", label: "Chevron" }
];

export const CHEVRON_DEFAULT_ANGLE = 15;
export const CHEVRON_MAX_ANGLE = 45;
/** A curve never wraps further round than a half circle. */
const MAX_CURVE_SPAN = Math.PI;

export function rowShape(s: Pick<FloorplanSeatingObject, "rowShape">): RowShape {
  return s.rowShape === "curved" || s.rowShape === "chevron" ? s.rowShape : "straight";
}

/** Common chair sizes, in metres. Venues' chairs vary, so the sizes stay editable per block. */
export const CHAIR_PRESETS = [
  { id: "banquet", label: "Banquet", widthM: 0.45, depthM: 0.45 },
  { id: "chiavari", label: "Chiavari", widthM: 0.4, depthM: 0.42 },
  { id: "conference", label: "Conference", widthM: 0.5, depthM: 0.52 },
  { id: "folding", label: "Folding", widthM: 0.44, depthM: 0.46 }
] as const;

export type ChairPresetId = (typeof CHAIR_PRESETS)[number]["id"];

export function chairPreset(id: string | undefined) {
  return CHAIR_PRESETS.find((p) => p.id === id) ?? CHAIR_PRESETS[0];
}

/** Starting values (metres) for new blocks. */
export const SEATING_DEFAULTS = {
  /** Gap between neighbouring chairs in a row. */
  seatGapM: 0.05,
  seatwayM: 0.45,
  aisleWidthM: 1.2
};

export const MAX_SEATING_ROWS = 200;
export const MAX_SEATS_PER_ROW = 200;

/** Build a block's sizes from metres and a plan scale. */
export function seatingDimensions(
  preset: string | undefined,
  unitsPerMetre: number,
  overrides: { seatwayM?: number; aisleWidthM?: number } = {}
): Pick<FloorplanSeatingObject, "chairWidth" | "chairDepth" | "seatSpacing" | "rowPitch" | "aisleWidth" | "chairPreset"> {
  const p = chairPreset(preset);
  const k = unitsPerMetre;
  return {
    chairPreset: p.id,
    chairWidth: p.widthM * k,
    chairDepth: p.depthM * k,
    seatSpacing: (p.widthM + SEATING_DEFAULTS.seatGapM) * k,
    rowPitch: (p.depthM + (overrides.seatwayM ?? SEATING_DEFAULTS.seatwayM)) * k,
    aisleWidth: (overrides.aisleWidthM ?? SEATING_DEFAULTS.aisleWidthM) * k
  };
}

/** Aisle positions that actually fall inside the row, sorted and de-duplicated. */
export function seatingAisles(s: FloorplanSeatingObject): number[] {
  const n = s.seatsPerRow;
  const set = new Set((s.aisles ?? []).map((a) => Math.round(a)).filter((a) => a >= 1 && a < n));
  const centre = chevronCentre(s, set);
  if (centre != null) set.add(centre);
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * Where a chevron block's wings meet: an aisle at (or within a seat of) the middle of the front row,
 * added if there isn't one. Null for other shapes or a single seat.
 */
function chevronCentre(s: FloorplanSeatingObject, aisles: Set<number>): number | null {
  const n = s.seatsPerRow;
  if (rowShape(s) !== "chevron" || n < 2) return null;
  let best: number | null = null;
  for (const a of aisles) if (Math.abs(a - n / 2) <= 1 && (best == null || Math.abs(a - n / 2) < Math.abs(best - n / 2))) best = a;
  return best ?? Math.min(n - 1, Math.max(1, Math.round(n / 2)));
}

/** The chevron centre aisle (front-row seat index it comes after), or null. */
export function seatingCentreAisle(s: FloorplanSeatingObject): number | null {
  return chevronCentre(s, new Set((s.aisles ?? []).map((a) => Math.round(a)).filter((a) => a >= 1 && a < s.seatsPerRow)));
}

/** Clear gap between neighbouring chairs in a row. */
export function seatGap(s: FloorplanSeatingObject): number {
  return Math.max(0, s.seatSpacing - s.chairWidth);
}

/** Seatway: the clear gap from the back of one row to the front of the row behind. */
export function seatway(s: FloorplanSeatingObject): number {
  return Math.max(0, s.rowPitch - s.chairDepth);
}

/** The clear width of an aisle inside the block. */
export function blockAisleWidth(s: FloorplanSeatingObject): number {
  return Math.max(seatGap(s), s.aisleWidth ?? seatGap(s));
}

/** How much further apart the chairs either side of an aisle are than ordinary neighbours. */
function aisleExtra(s: FloorplanSeatingObject): number {
  return blockAisleWidth(s) - seatGap(s);
}

export function seatingSize(s: FloorplanSeatingObject): { w: number; h: number } {
  const l = layout(s);
  return { w: l.w, h: l.h };
}

/** Size of the block laid out in straight rows. */
function straightSize(s: FloorplanSeatingObject): { w: number; h: number } {
  const n = Math.max(1, s.seatsPerRow);
  const rows = Math.max(1, s.rows);
  return {
    w: s.chairWidth + (n - 1) * s.seatSpacing + seatingAisles(s).length * aisleExtra(s),
    h: s.chairDepth + (rows - 1) * s.rowPitch
  };
}

function seatX(s: FloorplanSeatingObject, seat: number, aisles: number[], w: number): number {
  const before = aisles.filter((a) => a <= seat).length;
  return -w / 2 + s.chairWidth / 2 + seat * s.seatSpacing + before * aisleExtra(s);
}

function rowY(s: FloorplanSeatingObject, row: number, h: number): number {
  return -h / 2 + s.chairDepth / 2 + row * s.rowPitch;
}

export function seatKey(row: number, seat: number): string {
  return `${row}:${seat}`;
}

/* ---------- layout: every chair position in every row ---------- */

/** One chair position: centre, the way it's turned (degrees, clockwise) and the run (between aisles) it's in. */
type Slot = { x: number; y: number; angle: number; run: number };
type Layout = {
  rows: Slot[][];
  w: number;
  h: number;
  /** Curved rows: the point they curve around. */
  focus: { x: number; y: number } | null;
  /** Middle of the front row's front edge (between the wings of a chevron). */
  anchor: { x: number; y: number };
};

const layoutCache = new WeakMap<FloorplanSeatingObject, Layout>();

function layout(s: FloorplanSeatingObject): Layout {
  const hit = layoutCache.get(s);
  if (hit) return hit;
  const shape = rowShape(s);
  const built = shape === "curved" ? curvedLayout(s) : shape === "chevron" ? chevronLayout(s) : straightLayout(s);
  layoutCache.set(s, built);
  return built;
}

function rad(deg: number) {
  return (deg * Math.PI) / 180;
}

function turn(x: number, y: number, deg: number): { x: number; y: number } {
  if (!deg) return { x, y };
  const r = rad(deg);
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
}

function straightLayout(s: FloorplanSeatingObject): Layout {
  const { w, h } = straightSize(s);
  const aisles = seatingAisles(s);
  const rows: Slot[][] = [];
  for (let r = 0; r < Math.max(1, s.rows); r += 1) {
    const y = rowY(s, r, h);
    const row: Slot[] = [];
    for (let c = 0; c < Math.max(1, s.seatsPerRow); c += 1) {
      row.push({ x: seatX(s, c, aisles, w), y, angle: 0, run: aisles.filter((a) => a <= c).length });
    }
    rows.push(row);
  }
  return { rows, w, h, focus: null, anchor: { x: 0, y: -h / 2 } };
}

/** Centre the chairs on the origin and measure them. */
function settle(
  s: FloorplanSeatingObject,
  rows: Slot[][],
  focus: { x: number; y: number } | null,
  anchor: { x: number; y: number }
): Layout {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const row of rows) {
    for (const slot of row) {
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1]
      ]) {
        const p = turn((sx * s.chairWidth) / 2, (sy * s.chairDepth) / 2, slot.angle);
        minX = Math.min(minX, slot.x + p.x);
        maxX = Math.max(maxX, slot.x + p.x);
        minY = Math.min(minY, slot.y + p.y);
        maxY = Math.max(maxY, slot.y + p.y);
      }
    }
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    rows: rows.map((row) => row.map((slot) => ({ ...slot, x: slot.x - cx, y: slot.y - cy }))),
    w: maxX - minX,
    h: maxY - minY,
    focus: focus ? { x: focus.x - cx, y: focus.y - cy } : null,
    anchor: { x: anchor.x - cx, y: anchor.y - cy }
  };
}

/** Chevron: straight rows, with the wings either side of the centre aisle turned about their inner front corners. */
function chevronLayout(s: FloorplanSeatingObject): Layout {
  const base = straightLayout(s);
  const centre = seatingCentreAisle(s);
  const angle = Math.max(0, Math.min(CHEVRON_MAX_ANGLE, s.chevronAngle ?? CHEVRON_DEFAULT_ANGLE));
  if (centre == null || !angle) return base;
  const front = -base.h / 2;
  const left = base.rows[0][centre - 1].x + s.chairWidth / 2;
  const right = base.rows[0][centre].x - s.chairWidth / 2;
  const rows = base.rows.map((row) =>
    row.map((slot, c) => {
      // The right wing turns anticlockwise (its outer end comes forward), the left wing clockwise.
      const deg = c >= centre ? -angle : angle;
      const pivot = c >= centre ? right : left;
      const p = turn(slot.x - pivot, slot.y - front, deg);
      return { ...slot, x: pivot + p.x, y: front + p.y, angle: deg };
    })
  );
  return settle(s, rows, null, { x: (left + right) / 2, y: front });
}

/** Front-row distances along the row from the first chair's centre, allowing for aisles. */
function frontOffsets(s: FloorplanSeatingObject): number[] {
  const aisles = seatingAisles(s);
  const extra = aisleExtra(s);
  return Array.from({ length: Math.max(1, s.seatsPerRow) }, (_, c) => c * s.seatSpacing + aisles.filter((a) => a <= c).length * extra);
}

/** Front-row radius used for a curved block: the saved one, or the front row's length, and never so tight it wraps past a half circle. */
export function seatingCurveRadius(s: FloorplanSeatingObject): number {
  const offsets = frontOffsets(s);
  const length = offsets[offsets.length - 1];
  const wanted = s.curveRadius && s.curveRadius > 0 ? s.curveRadius : length + s.chairDepth / 2;
  // Spacing is measured along the chairs' front edges, so that radius can't drop below the chair depth.
  return Math.max(wanted, length / MAX_CURVE_SPAN + s.chairDepth / 2, s.chairDepth);
}

/** Tightest curve the block allows (front-row radius), for the Inspector. */
export function seatingMinCurveRadius(s: FloorplanSeatingObject): number {
  return seatingCurveRadius({ ...s, curveRadius: 1e-9 });
}

/**
 * Curved: rows on arcs around a focus in front of the block. Chairs are spaced along their front edges,
 * so neighbours and aisles are never tighter than in a straight row; each run keeps the angle it has in the
 * front row, so back rows hold more chairs and aisles widen slightly towards the back.
 */
function curvedLayout(s: FloorplanSeatingObject): Layout {
  const offsets = frontOffsets(s);
  const aisles = seatingAisles(s);
  const length = offsets[offsets.length - 1];
  const frontEdge = seatingCurveRadius(s) - s.chairDepth / 2;
  const angleAt = (c: number) => (offsets[c] - length / 2) / frontEdge;
  const cuts = [0, ...aisles, Math.max(1, s.seatsPerRow)];
  const runs = cuts.slice(0, -1).map((start, i) => ({ from: angleAt(start), to: angleAt(cuts[i + 1] - 1) }));
  const rows: Slot[][] = [];
  for (let r = 0; r < Math.max(1, s.rows); r += 1) {
    const edge = frontEdge + r * s.rowPitch;
    const centre = edge + s.chairDepth / 2;
    const step = s.seatSpacing / edge;
    const row: Slot[] = [];
    runs.forEach((run, i) => {
      const span = run.to - run.from;
      const count = Math.floor(span / step + 1e-6) + 1;
      const start = run.from + (span - (count - 1) * step) / 2;
      for (let k = 0; k < count; k += 1) {
        const a = start + k * step;
        row.push({ x: centre * Math.sin(a), y: centre * Math.cos(a), angle: (-a * 180) / Math.PI, run: i });
      }
    });
    rows.push(row);
  }
  return settle(s, rows, { x: 0, y: 0 }, { x: 0, y: frontEdge });
}

/** Chairs in each row (curved rows get longer towards the back). */
export function seatingRowLengths(s: FloorplanSeatingObject): number[] {
  return layout(s).rows.map((row) => row.length);
}

/** Middle of the front row's front edge, in the block frame. */
export function seatingFrontAnchor(s: FloorplanSeatingObject): { x: number; y: number } {
  return layout(s).anchor;
}

/** Curved rows: the point they curve around, in the block frame. */
export function seatingFocus(s: FloorplanSeatingObject): { x: number; y: number } | null {
  return layout(s).focus;
}

/**
 * Seat counts per run (between aisles) for a curved row at this distance from the focus to its chairs'
 * front edges, keeping each run's angle from the block's front row. Used to start a block further back
 * on the same curve.
 */
export function curvedRunCounts(s: FloorplanSeatingObject, frontEdge: number): number[] {
  const offsets = frontOffsets(s);
  const ownEdge = seatingCurveRadius(s) - s.chairDepth / 2;
  const cuts = [0, ...seatingAisles(s), Math.max(1, s.seatsPerRow)];
  const step = s.seatSpacing / frontEdge;
  return cuts.slice(0, -1).map((start, i) => {
    const span = (offsets[cuts[i + 1] - 1] - offsets[start]) / ownEdge;
    return Math.floor(span / step + 1e-6) + 1;
  });
}

export type SeatState = "chair" | "removed" | "wheelchair";
/** A chair position: centre in the block frame, `angle` it's turned by (degrees, clockwise), and what's there. */
export type SeatPosition = { row: number; seat: number; x: number; y: number; angle: number; state: SeatState };

function inBlock(s: FloorplanSeatingObject, key: string): boolean {
  const [r, c] = key.split(":").map(Number);
  const lengths = seatingRowLengths(s);
  return r >= 0 && r < lengths.length && c >= 0 && c < lengths[r];
}

/** Every chair position in the block frame, with what's there. */
export function seatingPositions(s: FloorplanSeatingObject): SeatPosition[] {
  const removed = new Set(s.removed ?? []);
  const wheelchair = new Set(s.wheelchair ?? []);
  const out: SeatPosition[] = [];
  layout(s).rows.forEach((row, r) => {
    row.forEach((slot, c) => {
      const key = seatKey(r, c);
      const state: SeatState = wheelchair.has(key) ? "wheelchair" : removed.has(key) ? "removed" : "chair";
      out.push({ row: r, seat: c, x: slot.x, y: slot.y, angle: slot.angle, state });
    });
  });
  return out;
}

/** Chair centres in the block frame (not removed seats or wheelchair spaces). */
export function seatingSeats(s: FloorplanSeatingObject): SeatPosition[] {
  return seatingPositions(s).filter((p) => p.state === "chair");
}

export function seatingWheelchairCount(s: FloorplanSeatingObject): number {
  return new Set((s.wheelchair ?? []).filter((key) => inBlock(s, key))).size;
}

/** Chairs in the block: every position less removed seats and wheelchair spaces. */
export function seatingSeatCount(s: FloorplanSeatingObject): number {
  const gone = new Set([...(s.removed ?? []), ...(s.wheelchair ?? [])].filter((key) => inBlock(s, key)));
  const total = seatingRowLengths(s).reduce((a, b) => a + b, 0);
  return Math.max(0, total - gone.size);
}

/** Set what's at one chair position. */
export function withSeatState(s: FloorplanSeatingObject, key: string, state: SeatState): FloorplanSeatingObject {
  const removed = (s.removed ?? []).filter((k) => k !== key);
  const wheelchair = (s.wheelchair ?? []).filter((k) => k !== key);
  if (state === "removed") removed.push(key);
  if (state === "wheelchair") wheelchair.push(key);
  return { ...s, removed: removed.length ? removed : undefined, wheelchair: wheelchair.length ? wheelchair : undefined };
}

export function seatStateAt(s: FloorplanSeatingObject, key: string): SeatState {
  if (s.wheelchair?.includes(key)) return "wheelchair";
  if (s.removed?.includes(key)) return "removed";
  return "chair";
}

/** Runs of seats between aisles in one row: [first seat, last seat] (inclusive). */
export function seatingRowRuns(s: FloorplanSeatingObject, row: number): Array<[number, number]> {
  const slots = layout(s).rows[row] ?? [];
  const runs: Array<[number, number]> = [];
  slots.forEach((slot, c) => {
    if (c === 0 || slot.run !== slots[c - 1].run) runs.push([c, c]);
    else runs[runs.length - 1][1] = c;
  });
  return runs;
}

/** The smallest box (turned to follow the chairs) around a group of chairs in a row. */
function chairsBox(s: FloorplanSeatingObject, slots: Slot[]): LocalBox {
  const first = slots[0];
  const last = slots[slots.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const angle = Math.hypot(dx, dy) > 1e-9 ? (Math.atan2(dy, dx) * 180) / Math.PI : first.angle;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const slot of slots) {
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1]
    ]) {
      const corner = turn((sx * s.chairWidth) / 2, (sy * s.chairDepth) / 2, slot.angle);
      const p = turn(slot.x + corner.x, slot.y + corner.y, -angle);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }
  const c = turn((minX + maxX) / 2, (minY + maxY) / 2, angle);
  return { cx: c.x, cy: c.y, w: maxX - minX, h: maxY - minY, ...(angle ? { angle } : {}) };
}

/**
 * The solid parts of the block, for overlap checks: each unbroken stretch of chairs (or wheelchair
 * spaces) in each row as one box (short pieces along a curve). Aisles and seats taken out are open floor.
 */
export function seatingRunBoxes(s: FloorplanSeatingObject): LocalBox[] {
  const removed = new Set(s.removed ?? []);
  const curved = rowShape(s) === "curved";
  const out: LocalBox[] = [];
  layout(s).rows.forEach((row, r) => {
    let stretch: Slot[] = [];
    const flush = () => {
      if (!stretch.length) return;
      // Along a curve, a few chairs at a time keeps each box snug.
      const size = curved ? 3 : stretch.length;
      for (let i = 0; i < stretch.length; i += size) out.push(chairsBox(s, stretch.slice(i, i + size)));
      stretch = [];
    };
    row.forEach((slot, c) => {
      if (removed.has(seatKey(r, c)) || (stretch.length && stretch[stretch.length - 1].run !== slot.run)) flush();
      if (!removed.has(seatKey(r, c))) stretch.push(slot);
    });
    flush();
  });
  return out;
}

/**
 * The aisles inside the block, chair edge to chair edge: full-depth strips for straight rows; for curved
 * and chevron rows, where aisles widen towards the back, the gap in every row.
 */
export function seatingAisleStrips(s: FloorplanSeatingObject): LocalBox[] {
  if (rowShape(s) === "straight") {
    const { w, h } = straightSize(s);
    const aisles = seatingAisles(s);
    return aisles.map((a) => {
      const left = seatX(s, a - 1, aisles, w) + s.chairWidth / 2;
      const right = seatX(s, a, aisles, w) - s.chairWidth / 2;
      return { cx: (left + right) / 2, cy: 0, w: right - left, h };
    });
  }
  const out: LocalBox[] = [];
  for (const row of layout(s).rows) {
    for (let c = 1; c < row.length; c += 1) {
      if (row[c].run === row[c - 1].run) continue;
      const pair = chairsBox(s, [row[c - 1], row[c]]);
      // The gap is the pair's box less a chair at each end (measured along the line between them).
      const gap = Math.max(0, pair.w - 2 * s.chairWidth);
      out.push({ cx: pair.cx, cy: pair.cy, w: gap, h: s.chairDepth, angle: pair.angle });
    }
  }
  return out;
}

/** The seatway between the front two rows: across the whole block, or at the middle of a curved or chevron block. */
export function seatingSeatwayStrip(s: FloorplanSeatingObject): LocalBox | null {
  if (s.rows < 2) return null;
  if (rowShape(s) === "straight") {
    const { w, h } = straightSize(s);
    const top = rowY(s, 0, h) + s.chairDepth / 2;
    const bottom = rowY(s, 1, h) - s.chairDepth / 2;
    return { cx: 0, cy: (top + bottom) / 2, w, h: bottom - top };
  }
  const front = layout(s).rows[0];
  const slot = front[Math.floor((front.length - 1) / 2)];
  const back = turn(0, s.chairDepth / 2 + seatway(s) / 2, slot.angle);
  return { cx: slot.x + back.x, cy: slot.y + back.y, w: s.seatSpacing * 3, h: seatway(s), angle: slot.angle || undefined };
}

/** Height reserved behind the back row for the block's name. */
export function seatingNameBand(s: FloorplanSeatingObject): number {
  return s.name?.trim() ? Math.max(s.chairDepth * 1.1, 6) : 0;
}

/**
 * Rows and seats that best fill a `w` × `h` box at the block's spacing (used when a block is resized by a
 * corner handle). Aisle positions past the new row length drop out.
 */
export function seatingFitTo(
  s: FloorplanSeatingObject,
  w: number,
  h: number,
  fromLeft = false,
  fromFront = false
): FloorplanSeatingObject {
  let rows: number;
  let seats: number;
  if (rowShape(s) === "straight") {
    rows = Math.max(1, Math.min(MAX_SEATING_ROWS, Math.round((h - s.chairDepth) / s.rowPitch) + 1));
    const extra = seatingAisles(s).length * aisleExtra(s);
    seats = Math.max(1, Math.min(MAX_SEATS_PER_ROW, Math.round((w - s.chairWidth - extra) / s.seatSpacing) + 1));
  } else {
    // Curved and chevron blocks don't grow by a fixed step, so measure how much a row or two seats add.
    const now = seatingSize(s);
    const perRow = Math.max(1e-6, seatingSize({ ...s, rows: s.rows + 1 }).h - now.h);
    const perSeat = Math.max(1e-6, (seatingSize({ ...s, seatsPerRow: s.seatsPerRow + 2 }).w - now.w) / 2);
    rows = Math.max(1, Math.min(MAX_SEATING_ROWS, s.rows + Math.round((h - now.h) / perRow)));
    seats = Math.max(1, Math.min(MAX_SEATS_PER_ROW, s.seatsPerRow + Math.round((w - now.w) / perSeat)));
  }
  // Dragging the left edge adds or takes away seats on the left, so the aisles move with the seats.
  const shift = fromLeft ? seats - s.seatsPerRow : 0;
  const aisles = (s.aisles ?? []).map((a) => a + shift).filter((a) => a >= 1 && a < seats);
  // Likewise rows added at the front: seats taken out keep their place in the block.
  const rowShift = fromFront ? rows - s.rows : 0;
  const move = (keys: string[] | undefined) =>
    keys?.map((key) => {
      const [r, c] = key.split(":").map(Number);
      return seatKey(r + rowShift, c + shift);
    });
  return pruneRemoved({
    ...s,
    rows,
    seatsPerRow: seats,
    aisles: aisles.length ? aisles : undefined,
    removed: move(s.removed),
    wheelchair: move(s.wheelchair)
  });
}

/** Even aisle positions for `count` aisles across `seats` seats (e.g. 20 seats, 1 aisle → [10]). */
export function evenAisles(seats: number, count: number): number[] {
  const n = Math.max(0, Math.min(count, seats - 1));
  const out: number[] = [];
  for (let i = 1; i <= n; i += 1) out.push(Math.round((seats * i) / (n + 1)));
  return Array.from(new Set(out)).filter((a) => a >= 1 && a < seats);
}

function rotateLocal(x: number, y: number, degrees: number): { x: number; y: number } {
  if (!degrees) return { x, y };
  const rad = (degrees * Math.PI) / 180;
  return { x: x * Math.cos(rad) - y * Math.sin(rad), y: x * Math.sin(rad) + y * Math.cos(rad) };
}

/**
 * Apply a change to a block's rows or spacing without moving its front row: the block grows backwards
 * (away from the stage) and stays centred across.
 */
export function keepFrontRow(before: FloorplanSeatingObject, after: FloorplanSeatingObject): FloorplanSeatingObject {
  const dh = seatingSize(after).h - seatingSize(before).h;
  if (!dh) return after;
  const shift = rotateLocal(0, dh / 2, after.rotation ?? 0);
  return { ...after, x: Math.round((before.x + shift.x) * 1000) / 1000, y: Math.round((before.y + shift.y) * 1000) / 1000 };
}

/**
 * Longest run of seats in any row: the people seated between two aisles (or an aisle and a row end).
 * Only aisles break a run. Seats taken out at the ends of a row shorten it; a gap left by a seat taken
 * out in the middle doesn't make a way out, so the people either side still count as one run. Wheelchair
 * spaces count as a place.
 */
export function longestRun(s: FloorplanSeatingObject): number {
  const removed = new Set(s.removed ?? []);
  let best = 0;
  for (let r = 0; r < seatingRowLengths(s).length; r += 1) {
    for (const [a, b] of seatingRowRuns(s, r)) {
      let n = 0;
      for (let c = a; c <= b; c += 1) if (!removed.has(seatKey(r, c))) n += 1;
      if (n > best) best = n;
    }
  }
  return best;
}

/** Drop removed-seat entries that no longer fall inside the block. */
export function pruneRemoved(s: FloorplanSeatingObject): FloorplanSeatingObject {
  if (!s.removed?.length && !s.wheelchair?.length) return s;
  const removed = (s.removed ?? []).filter((key) => inBlock(s, key));
  const wheelchair = (s.wheelchair ?? []).filter((key) => inBlock(s, key));
  return { ...s, removed: removed.length ? removed : undefined, wheelchair: wheelchair.length ? wheelchair : undefined };
}
