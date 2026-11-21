/**
 * Geometry for theatre-style seating blocks. Everything here is in the block's own frame: centred on the
 * block, unrotated, facing up the page (front row at the top). Callers rotate into place.
 */
import type { FloorplanSeatingObject } from "@/types";

export type LocalBox = { cx: number; cy: number; w: number; h: number };

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
  return Array.from(new Set((s.aisles ?? []).map((a) => Math.round(a)).filter((a) => a >= 1 && a < n))).sort((a, b) => a - b);
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

export type SeatState = "chair" | "removed" | "wheelchair";
export type SeatPosition = { row: number; seat: number; x: number; y: number; state: SeatState };

function inBlock(s: FloorplanSeatingObject, key: string): boolean {
  const [r, c] = key.split(":").map(Number);
  return r >= 0 && r < s.rows && c >= 0 && c < s.seatsPerRow;
}

/** Every chair position in the block frame, with what's there. */
export function seatingPositions(s: FloorplanSeatingObject): SeatPosition[] {
  const { w, h } = seatingSize(s);
  const aisles = seatingAisles(s);
  const removed = new Set(s.removed ?? []);
  const wheelchair = new Set(s.wheelchair ?? []);
  const out: SeatPosition[] = [];
  for (let r = 0; r < s.rows; r += 1) {
    const y = rowY(s, r, h);
    for (let c = 0; c < s.seatsPerRow; c += 1) {
      const key = seatKey(r, c);
      const state: SeatState = wheelchair.has(key) ? "wheelchair" : removed.has(key) ? "removed" : "chair";
      out.push({ row: r, seat: c, x: seatX(s, c, aisles, w), y, state });
    }
  }
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
  return Math.max(0, s.rows * s.seatsPerRow - gone.size);
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

/** Runs of seats between aisles: [first seat, last seat] (inclusive). */
export function seatingRuns(s: FloorplanSeatingObject): Array<[number, number]> {
  const cuts = [0, ...seatingAisles(s), s.seatsPerRow];
  const runs: Array<[number, number]> = [];
  for (let i = 0; i < cuts.length - 1; i += 1) runs.push([cuts[i], cuts[i + 1] - 1]);
  return runs;
}

/**
 * The solid parts of the block, for overlap checks: each unbroken stretch of chairs (or wheelchair
 * spaces) in each row as one box. Aisles and seats taken out are open floor.
 */
export function seatingRunBoxes(s: FloorplanSeatingObject): LocalBox[] {
  const { w, h } = seatingSize(s);
  const aisles = seatingAisles(s);
  const removed = new Set(s.removed ?? []);
  const out: LocalBox[] = [];
  const push = (y: number, a: number, b: number) => {
    const x0 = seatX(s, a, aisles, w) - s.chairWidth / 2;
    const x1 = seatX(s, b, aisles, w) + s.chairWidth / 2;
    out.push({ cx: (x0 + x1) / 2, cy: y, w: x1 - x0, h: s.chairDepth });
  };
  for (let r = 0; r < s.rows; r += 1) {
    const y = rowY(s, r, h);
    for (const [a, b] of seatingRuns(s)) {
      let start = -1;
      for (let c = a; c <= b + 1; c += 1) {
        const solid = c <= b && !removed.has(seatKey(r, c));
        if (solid && start < 0) start = c;
        if (!solid && start >= 0) {
          push(y, start, c - 1);
          start = -1;
        }
      }
    }
  }
  return out;
}

/** The aisles inside the block as full-depth strips, chair edge to chair edge. */
export function seatingAisleStrips(s: FloorplanSeatingObject): LocalBox[] {
  const { w, h } = seatingSize(s);
  const aisles = seatingAisles(s);
  return aisles.map((a) => {
    const left = seatX(s, a - 1, aisles, w) + s.chairWidth / 2;
    const right = seatX(s, a, aisles, w) - s.chairWidth / 2;
    return { cx: (left + right) / 2, cy: 0, w: right - left, h };
  });
}

/** The seatway between the front two rows, across the whole block. */
export function seatingSeatwayStrip(s: FloorplanSeatingObject): LocalBox | null {
  if (s.rows < 2) return null;
  const { w, h } = seatingSize(s);
  const top = rowY(s, 0, h) + s.chairDepth / 2;
  const bottom = rowY(s, 1, h) - s.chairDepth / 2;
  return { cx: 0, cy: (top + bottom) / 2, w, h: bottom - top };
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
  const rows = Math.max(1, Math.min(MAX_SEATING_ROWS, Math.round((h - s.chairDepth) / s.rowPitch) + 1));
  const extra = seatingAisles(s).length * aisleExtra(s);
  const seats = Math.max(1, Math.min(MAX_SEATS_PER_ROW, Math.round((w - s.chairWidth - extra) / s.seatSpacing) + 1));
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
  for (let r = 0; r < s.rows; r += 1) {
    for (const [a, b] of seatingRuns(s)) {
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
