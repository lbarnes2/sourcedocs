/**
 * Theatre-style auto layout: turns the form's numbers (seats, seats per row, aisles…) into one or more
 * seating blocks, set out in front of the stage if the plan has one.
 */
import { objectBodyBounds, rotatePoint, type Point } from "@/lib/floorplans/geometry";
import {
  CHEVRON_DEFAULT_ANGLE,
  curvedRunCounts,
  evenAisles,
  rowShape,
  seatingCurveRadius,
  seatingDimensions,
  seatingFrontAnchor,
  seatingNameBand,
  seatingPositions,
  seatingSeatCount,
  seatingSize,
  seatKey
} from "@/lib/floorplans/seating";
import type { FloorplanCanvasObject, FloorplanRectObject, FloorplanSeatingObject, FloorplanTheatreSettings } from "@/types";

export const GENERATED_SEATING_ID = /^seating-gen-/;
export const MAX_THEATRE_SEATS = 5000;

export type TheatreFacing = NonNullable<FloorplanTheatreSettings["facing"]>;

export const THEATRE_DEFAULTS: Required<FloorplanTheatreSettings> = {
  totalSeats: 200,
  seatsPerRow: 20,
  aisles: 1,
  aisleWidthM: 1.2,
  splitAtAisles: true,
  crossAisleEvery: 0,
  chairPreset: "banquet",
  seatwayM: 0.45,
  frontDistanceM: 2,
  facing: "up",
  maxRun: 14,
  rowShape: "straight",
  curveRadiusM: 0,
  chevronAngle: CHEVRON_DEFAULT_ANGLE
};

export function resolveTheatreSettings(s: FloorplanTheatreSettings | undefined): Required<FloorplanTheatreSettings> {
  const out = { ...THEATRE_DEFAULTS };
  for (const [key, value] of Object.entries(s ?? {})) {
    if (value != null) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** Rotation that turns an up-facing block to face this way (the way the audience looks). */
export const FACING_ROTATION: Record<TheatreFacing, number> = { up: 0, right: 90, down: 180, left: 270 };

/** Full rows only: the seat total rounds up to a whole number of rows. */
export function theatreRows(s: Required<FloorplanTheatreSettings>): number {
  return Math.max(1, Math.ceil(s.totalSeats / Math.max(1, s.seatsPerRow)));
}

/** The plan's stage: the biggest rectangle labelled "stage", if there is one. */
export function findStage(objects: FloorplanCanvasObject[]): FloorplanRectObject | null {
  let best: FloorplanRectObject | null = null;
  for (const o of objects) {
    if (o.type !== "rect" || !/stage/i.test(o.label ?? "")) continue;
    if (!best || o.width * o.height > best.width * best.height) best = o;
  }
  return best;
}

function sectionNames(count: number): string[] {
  if (count === 1) return [""];
  if (count === 2) return ["Left", "Right"];
  if (count === 3) return ["Left", "Centre", "Right"];
  return Array.from({ length: count }, (_, i) => `Block ${i + 1}`);
}

function groupNames(count: number): string[] {
  if (count === 1) return [""];
  if (count === 2) return ["Front", "Back"];
  if (count === 3) return ["Front", "Middle", "Back"];
  return Array.from({ length: count }, (_, i) => `Section ${i + 1}`);
}

/** Split `n` into runs of `every` (the last one may be shorter); 0 means one run. */
function chunks(n: number, every: number): number[] {
  if (!every || every >= n) return [n];
  const out: number[] = [];
  for (let left = n; left > 0; left -= every) out.push(Math.min(every, left));
  return out;
}

type SeatingDims = ReturnType<typeof seatingDimensions>;

/** The block shape fields the settings ask for. */
function shapeFields(s: Required<FloorplanTheatreSettings>, k: number): Partial<FloorplanSeatingObject> {
  const shape = rowShape(s);
  if (shape === "curved") return { rowShape: shape, ...(s.curveRadiusM > 0 ? { curveRadius: s.curveRadiusM * k } : {}) };
  if (shape === "chevron") return { rowShape: shape, chevronAngle: s.chevronAngle };
  return {};
}

/**
 * Curved and chevron layouts: one block per section of rows (each keeps its aisles inside it). Curved
 * sections share the point they curve round, so a section behind fans out with more seats; chevron
 * sections sit one behind the other with their wings parallel.
 */
function assembleShapedBlocks(
  perRow: number,
  rows: number,
  aislePositions: number[],
  s: Required<FloorplanTheatreSettings>,
  dims: SeatingDims,
  aisleW: number,
  k: number
): { blocks: FloorplanSeatingObject[]; width: number; depth: number } {
  const groups = chunks(rows, Math.round(s.crossAisleEvery));
  const deep = groupNames(groups.length);
  const shape = shapeFields(s, k);
  const first: FloorplanSeatingObject = {
    id: "",
    type: "seating",
    x: 0,
    y: 0,
    rows: groups[0],
    seatsPerRow: perRow,
    ...dims,
    ...(aislePositions.length ? { aisles: aislePositions } : {}),
    ...shape
  };
  const blocks: FloorplanSeatingObject[] = [];
  // Group 0's front sits on y = 0; later groups follow from its anchor (front-row middle).
  const size0 = seatingSize(first);
  const anchor0 = seatingFrontAnchor(first);
  const frontAnchor = { x: anchor0.x, y: size0.h / 2 + anchor0.y };
  const edge0 = seatingCurveRadius(first) - dims.chairDepth / 2;
  const focusY = frontAnchor.y - edge0;
  const cos = Math.cos(((s.chevronAngle ?? 0) * Math.PI) / 180) || 1;
  let along = 0;
  let edge = edge0;
  groups.forEach((groupRows, g) => {
    let block: FloorplanSeatingObject = { ...first, rows: groupRows };
    if (g > 0 && shape.rowShape === "curved") {
      const counts = curvedRunCounts(first, edge);
      const cuts: number[] = [];
      counts.slice(0, -1).reduce((sum, n) => {
        cuts.push(sum + n);
        return sum + n;
      }, 0);
      block = {
        ...block,
        seatsPerRow: counts.reduce((a, b) => a + b, 0),
        aisles: cuts.length ? cuts : undefined,
        curveRadius: edge + dims.chairDepth / 2
      };
    }
    if (deep[g]) block.name = deep[g];
    const anchor = seatingFrontAnchor(block);
    const want = shape.rowShape === "curved" ? { x: frontAnchor.x, y: focusY + edge } : { x: frontAnchor.x, y: frontAnchor.y + along };
    blocks.push({ ...block, x: want.x - anchor.x, y: want.y - anchor.y });
    const straightDepth = dims.chairDepth + (groupRows - 1) * dims.rowPitch + seatingNameBand(block);
    edge += straightDepth + aisleW;
    along += (straightDepth + aisleW) / cos;
  });
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = 0;
  for (const b of blocks) {
    const size = seatingSize(b);
    minX = Math.min(minX, b.x - size.w / 2);
    maxX = Math.max(maxX, b.x + size.w / 2);
    maxY = Math.max(maxY, b.y + size.h / 2);
  }
  return { blocks, width: maxX - minX, depth: maxY };
}

/**
 * Blocks for `rows` rows of `perRow` seats with aisles after `aislePositions`, facing up: front edge of
 * the front row on y = 0, centred on x = 0 (ids not set yet). Also returns the overall depth.
 */
function assembleBlocks(
  perRow: number,
  rows: number,
  aislePositions: number[],
  s: Required<FloorplanTheatreSettings>,
  dims: SeatingDims,
  aisleW: number
): { blocks: FloorplanSeatingObject[]; width: number; depth: number } {
  // Sections across: one block with aisles in it, or one block per run of seats.
  const sections: Array<{ seats: number; aisles: number[] }> = [];
  if (s.splitAtAisles && aislePositions.length) {
    const cuts = [0, ...aislePositions, perRow];
    for (let i = 0; i < cuts.length - 1; i += 1) sections.push({ seats: cuts[i + 1] - cuts[i], aisles: [] });
  } else {
    sections.push({ seats: perRow, aisles: aislePositions });
  }
  const groups = chunks(rows, Math.round(s.crossAisleEvery));
  const across = sectionNames(sections.length);
  const deep = groupNames(groups.length);

  const blocks: FloorplanSeatingObject[] = [];
  let top = 0;
  let width = 0;
  groups.forEach((groupRows, g) => {
    const templates = sections.map((sec) => ({
      type: "seating" as const,
      rows: groupRows,
      seatsPerRow: sec.seats,
      ...dims,
      aisles: sec.aisles.length ? sec.aisles : undefined
    }));
    const widths = templates.map((t) => seatingSize({ ...t, id: "", x: 0, y: 0 }).w);
    const total = widths.reduce((a, b) => a + b, 0) + aisleW * (widths.length - 1);
    width = Math.max(width, total);
    let left = -total / 2;
    let groupDepth = 0;
    templates.forEach((t, i) => {
      const name = [deep[g], across[i]].filter(Boolean).join(" ");
      const block: FloorplanSeatingObject = { ...t, id: "", x: 0, y: 0, ...(name ? { name } : {}) };
      const size = seatingSize(block);
      blocks.push({ ...block, x: left + size.w / 2, y: top + size.h / 2 });
      left += size.w + aisleW;
      // Names print behind the back row; between groups they need room in the cross aisle, but behind the
      // last group they can sit in whatever space is there.
      groupDepth = Math.max(groupDepth, size.h + (g < groups.length - 1 ? seatingNameBand(block) : 0));
    });
    top += groupDepth + aisleW;
  });
  return { blocks, width, depth: top - aisleW };
}

/** Lay out rows as blocks facing up, front edge on y = 0, in whichever row shape the settings ask for. */
function assemble(
  perRow: number,
  rows: number,
  aislePositions: number[],
  s: Required<FloorplanTheatreSettings>,
  dims: SeatingDims,
  aisleW: number,
  k: number
): { blocks: FloorplanSeatingObject[]; width: number; depth: number } {
  return rowShape(s) === "straight"
    ? assembleBlocks(perRow, rows, aislePositions, s, dims, aisleW)
    : assembleShapedBlocks(perRow, rows, aislePositions, s, dims, aisleW, k);
}

/** Rotate blocks laid out facing up (about the origin) and move them so the origin lands on `origin`. */
function placeBlocks(blocks: FloorplanSeatingObject[], rotation: number, origin: Point, prefix: string): FloorplanSeatingObject[] {
  const tidy = (v: number) => Math.round(v * 1000) / 1000;
  const tag = Math.random().toString(36).slice(2, 7);
  return blocks.map((b, i) => {
    const p = rotatePoint({ x: b.x, y: b.y }, rotation);
    return {
      ...b,
      id: `${prefix}${i + 1}-${tag}`,
      x: tidy(origin.x + p.x),
      y: tidy(origin.y + p.y),
      ...(rotation ? { rotation } : {})
    };
  });
}

export function buildTheatreLayout(
  settings: FloorplanTheatreSettings | undefined,
  options: { unitsPerMetre: number; objects: FloorplanCanvasObject[]; fallbackCentre: Point }
): FloorplanSeatingObject[] {
  const s = resolveTheatreSettings(settings);
  const k = options.unitsPerMetre;
  const perRow = Math.max(1, Math.round(s.seatsPerRow));
  const rows = theatreRows(s);
  const aisleW = s.aisleWidthM * k;
  const dims = seatingDimensions(s.chairPreset, k, { seatwayM: s.seatwayM, aisleWidthM: s.aisleWidthM });
  const rotation = FACING_ROTATION[s.facing];
  const aislePositions = evenAisles(perRow, s.aisles);
  let laid = assemble(perRow, rows, aislePositions, s, dims, aisleW, k);
  if (rowShape(s) === "curved") {
    // Back rows of a curve hold more seats, so use only as many rows as the total needs.
    const total = (blocks: FloorplanSeatingObject[]) => blocks.reduce((n, b) => n + seatingSeatCount(b), 0);
    for (let r = 1; r < rows; r += 1) {
      const trial = assemble(perRow, r, aislePositions, s, dims, aisleW, k);
      if (total(trial.blocks) >= s.totalSeats) {
        laid = trial;
        break;
      }
    }
  }
  const { blocks, depth } = laid;

  // Where the front edge goes: in front of the stage on the side the audience faces it from, or so the
  // whole layout is centred on the view.
  const stage = findStage(options.objects);
  let origin: Point;
  if (stage) {
    const b = objectBodyBounds(stage);
    const gap = s.frontDistanceM * k;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    origin =
      s.facing === "up"
        ? { x: cx, y: b.maxY + gap }
        : s.facing === "down"
          ? { x: cx, y: b.minY - gap }
          : s.facing === "left"
            ? { x: b.maxX + gap, y: cy }
            : { x: b.minX - gap, y: cy };
  } else {
    const back = rotatePoint({ x: 0, y: depth / 2 }, rotation);
    origin = { x: options.fallbackCentre.x - back.x, y: options.fallbackCentre.y - back.y };
  }
  return placeBlocks(blocks, rotation, origin, "seating-gen-");
}

/** An area to fill: centre, size and rotation (as a rectangle on the plan). */
export type FillArea = { cx: number; cy: number; w: number; h: number; rotation: number };

export type FillResult = {
  blocks: FloorplanSeatingObject[];
  rows: number;
  perRow: number;
  aisles: number;
  /** Chairs left once those standing on other objects are taken out. */
  seats: number;
};

/**
 * Fill a rectangle with rows: as many rows and seats as fit inside the margin, with the fewest evenly
 * spaced aisles that keep every run at or under `maxRun`. The audience faces `facing` relative to the
 * area. If a stage reaches into the area, the front row starts `frontDistanceM` clear of it. Chairs that
 * stand on other objects are taken out (`blocked` reports them per block).
 */
export function fillAreaWithSeating(
  area: FillArea,
  settings: FloorplanTheatreSettings | undefined,
  options: {
    unitsPerMetre: number;
    marginM: number;
    maxRun: number;
    objects: FloorplanCanvasObject[];
    blocked: (block: FloorplanSeatingObject) => string[];
  }
): FillResult {
  const s = resolveTheatreSettings(settings);
  const k = options.unitsPerMetre;
  const aisleW = s.aisleWidthM * k;
  const dims = seatingDimensions(s.chairPreset, k, { seatwayM: s.seatwayM, aisleWidthM: s.aisleWidthM });
  const facingRot = FACING_ROTATION[s.facing];
  const rotation = (((area.rotation + facingRot) % 360) + 360) % 360;
  const sideways = facingRot === 90 || facingRot === 270;
  const margin = Math.max(0, options.marginM) * k;
  const across = (sideways ? area.h : area.w) - 2 * margin;
  let front = -(sideways ? area.w : area.h) / 2 + margin;
  const back = (sideways ? area.w : area.h) / 2 - margin;

  // Into the block frame (audience looking up the page, area centred on the origin).
  const toLocal = (p: Point) => rotatePoint({ x: p.x - area.cx, y: p.y - area.cy }, -rotation);

  // A stage reaching into the area pushes the front row back.
  const stage = findStage(options.objects);
  if (stage) {
    const b = objectBodyBounds(stage);
    const corners = [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.minY },
      { x: b.maxX, y: b.maxY },
      { x: b.minX, y: b.maxY }
    ].map(toLocal);
    const overlapsAcross = Math.min(...corners.map((c) => c.x)) < across / 2 && Math.max(...corners.map((c) => c.x)) > -across / 2;
    const stageBack = Math.max(...corners.map((c) => c.y));
    if (overlapsAcross && stageBack > front - s.frontDistanceM * k && Math.min(...corners.map((c) => c.y)) < back) {
      front = Math.max(front, stageBack + s.frontDistanceM * k);
    }
  }

  const empty: FillResult = { blocks: [], rows: 0, perRow: 0, aisles: 0, seats: 0 };
  const depthAvail = back - front;
  if (across < dims.chairWidth || depthAvail < dims.chairDepth) return empty;

  // Seats per row and aisles: the fewest aisles that keep runs within the limit.
  const gap = dims.seatSpacing - dims.chairWidth;
  const extra = Math.max(0, aisleW - gap);
  const maxRun = Math.max(1, Math.round(options.maxRun));
  let perRow = 0;
  let aisleCount = 0;
  for (let a = 0; a < 40; a += 1) {
    const n = Math.floor((across - dims.chairWidth - a * extra) / dims.seatSpacing) + 1;
    if (n < 1) break;
    if (Math.ceil(n / (a + 1)) <= maxRun || n <= a + 1) {
      perRow = Math.min(MAX_SEATS_PER_ROW_FILL, n);
      aisleCount = a;
      break;
    }
  }
  if (!perRow) return empty;
  const aislePositions = evenAisles(perRow, aisleCount);

  // As many rows as fit, counting cross aisles and block names.
  let rows = Math.max(1, Math.floor((depthAvail - dims.chairDepth) / dims.rowPitch) + 1);
  let laid = assemble(perRow, rows, aislePositions, s, dims, aisleW, k);
  while (rows > 1 && laid.depth > depthAvail + 1e-6) {
    rows -= 1;
    laid = assemble(perRow, rows, aislePositions, s, dims, aisleW, k);
  }
  if (laid.depth > depthAvail + 1e-6) return empty;

  const origin = rotatePoint({ x: 0, y: front }, rotation);
  const placed = placeBlocks(laid.blocks, rotation, { x: area.cx + origin.x, y: area.cy + origin.y }, "seating-fill-");
  // Curved and chevron rows don't make a rectangle: chairs that would stick out of the area are left out.
  const shaped = rowShape(s) !== "straight";
  const half = across / 2;
  const outside = (block: FloorplanSeatingObject): string[] => {
    if (!shaped) return [];
    const rot = block.rotation ?? 0;
    const out: string[] = [];
    for (const seat of seatingPositions(block)) {
      const corners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1]
      ].map(([sx, sy]) => {
        const c = rotatePoint({ x: (sx * block.chairWidth) / 2, y: (sy * block.chairDepth) / 2 }, seat.angle);
        const p = rotatePoint({ x: seat.x + c.x, y: seat.y + c.y }, rot);
        return toLocal({ x: block.x + p.x, y: block.y + p.y });
      });
      const eps = 1e-6;
      if (corners.some((c) => c.x < -half - eps || c.x > half + eps || c.y < front - eps || c.y > back + eps)) {
        out.push(seatKey(seat.row, seat.seat));
      }
    }
    return out;
  };
  let seats = 0;
  const blocks = placed.map((block) => {
    const gone = Array.from(new Set([...outside(block), ...options.blocked(block)]));
    const removed = gone.length ? { ...block, removed: gone } : block;
    seats += seatingSeatCount(removed);
    return removed;
  });
  return { blocks, rows, perRow, aisles: aislePositions.length, seats };
}

const MAX_SEATS_PER_ROW_FILL = 200;
