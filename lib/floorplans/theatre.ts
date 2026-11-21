/**
 * Theatre-style auto layout: turns the form's numbers (seats, seats per row, aisles…) into one or more
 * seating blocks, set out in front of the stage if the plan has one.
 */
import { objectBodyBounds, rotatePoint, type Point } from "@/lib/floorplans/geometry";
import { evenAisles, seatingDimensions, seatingNameBand, seatingSize } from "@/lib/floorplans/seating";
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
  facing: "up"
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

  // Lay the blocks out facing up, front edge of the front row on y = 0, centred on x = 0.
  const blocks: FloorplanSeatingObject[] = [];
  let top = 0;
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
    let left = -total / 2;
    let groupDepth = 0;
    templates.forEach((t, i) => {
      const name = [deep[g], across[i]].filter(Boolean).join(" ");
      const block: FloorplanSeatingObject = { ...t, id: "", x: 0, y: 0, ...(name ? { name } : {}) };
      const size = seatingSize(block);
      blocks.push({ ...block, x: left + size.w / 2, y: top + size.h / 2 });
      left += size.w + aisleW;
      groupDepth = Math.max(groupDepth, size.h + seatingNameBand(block));
    });
    top += groupDepth + aisleW;
  });

  // Where the front edge goes: in front of the stage on the side the audience faces it from, or so the
  // whole layout is centred on the view.
  const stage = findStage(options.objects);
  const depth = top - aisleW;
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

  const tidy = (v: number) => Math.round(v * 1000) / 1000;
  return blocks.map((b, i) => {
    const p = rotatePoint({ x: b.x, y: b.y }, rotation);
    return {
      ...b,
      id: `seating-gen-${i + 1}-${Math.random().toString(36).slice(2, 7)}`,
      x: tidy(origin.x + p.x),
      y: tidy(origin.y + p.y),
      ...(rotation ? { rotation } : {})
    };
  });
}
