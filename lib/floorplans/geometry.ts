/**
 * Geometry shared by the floorplan editor and the PDF renderer, so what you see on the canvas is
 * what gets printed. Everything is in canvas units; nothing here touches the DOM or pdf-lib.
 */
import { pdfPageDimensions } from "@/lib/paperSizes";
import type {
  FloorplanCanvasObject,
  FloorplanPrintOptions,
  FloorplanTableObject,
  FloorplanTextObject,
  PaperOrientation,
  PaperSize
} from "@/types";

export type Point = { x: number; y: number };
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export const DEFAULT_TABLE_SEATS = 8;
export const MAX_TABLE_SEATS = 60;
export const DEFAULT_TABLE_RADIUS = 22;
/** New plans: one 24-unit grid square is one metre, which makes a 22-unit round table a 6 ft (1.8 m) table. */
export const DEFAULT_UNITS_PER_METRE = 24;

export const DEFAULT_PRINT_OPTIONS: FloorplanPrintOptions = {
  legend: false,
  guestCounts: false,
  colorByOccupancy: false,
  guestListPage: false,
  scaleBar: false,
  fixedScale: null
};

export function resolvePrintOptions(print: FloorplanPrintOptions | undefined): FloorplanPrintOptions {
  return { ...DEFAULT_PRINT_OPTIONS, ...(print ?? {}) };
}

/* ---------- colours ---------- */

export const DEFAULT_FILLS = {
  table: "#abc2d4",
  rect: "#d6e0eb",
  circle: "#d1e6dc"
} as const;

export const TEXT_DEFAULT_COLOR = "#33404d";
export const OUTLINE_COLOR = "#8092a8";

/** Swatches offered in the inspector. `null` hex means "type default". */
export const FILL_SWATCHES: ReadonlyArray<{ name: string; hex: string }> = [
  { name: "Blue", hex: "#abc2d4" },
  { name: "Green", hex: "#c3dfc9" },
  { name: "Sand", hex: "#ecdcb4" },
  { name: "Rose", hex: "#efc4c4" },
  { name: "Lilac", hex: "#d6cbe8" },
  { name: "Stone", hex: "#d9dde2" },
  { name: "Charcoal", hex: "#8a96a3" }
];

export type OccupancyStatus = "none" | "empty" | "spare" | "full" | "over";

export const OCCUPANCY_COLORS: Record<Exclude<OccupancyStatus, "none">, string> = {
  empty: "#e5e7eb",
  spare: "#f6e2ac",
  full: "#bfe3c8",
  over: "#f1b0a8"
};

export const OCCUPANCY_LABELS: Record<Exclude<OccupancyStatus, "none">, string> = {
  empty: "No guests",
  spare: "Spare seats",
  full: "Full",
  over: "Over capacity"
};

export function occupancyStatus(seats: number, guests: number | null): OccupancyStatus {
  if (guests == null) return "none";
  if (guests === 0) return "empty";
  if (guests > seats) return "over";
  if (guests === seats) return "full";
  return "spare";
}

/* ---------- small maths ---------- */

export function rotatePoint(p: Point, degrees: number): Point {
  if (!degrees) return p;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

function emptyBounds(): Bounds {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function growBounds(b: Bounds, x: number, y: number): void {
  if (x < b.minX) b.minX = x;
  if (y < b.minY) b.minY = y;
  if (x > b.maxX) b.maxX = x;
  if (y > b.maxY) b.maxY = y;
}

export function unionBounds(list: Bounds[]): Bounds | null {
  if (!list.length) return null;
  const out = emptyBounds();
  for (const b of list) {
    growBounds(out, b.minX, b.minY);
    growBounds(out, b.maxX, b.maxY);
  }
  return Number.isFinite(out.minX) ? out : null;
}

/* ---------- tables ---------- */

export function tableShape(t: FloorplanTableObject): "round" | "rect" {
  return t.shape === "rect" ? "rect" : "round";
}

export function tableSeatCount(t: FloorplanTableObject): number {
  const n = t.seats ?? DEFAULT_TABLE_SEATS;
  return Math.max(0, Math.min(MAX_TABLE_SEATS, Math.round(n)));
}

/** Standard banqueting rounds. Seats are the usual full seating; legacy tables with no seat count still draw 8. */
export const ROUND_TABLE_SIZES = {
  "6ft": { label: "6 ft", diameterM: 1.8288, seats: 12 },
  "5ft": { label: "5 ft", diameterM: 1.524, seats: 10 }
} as const;

export type RoundTableSize = keyof typeof ROUND_TABLE_SIZES;

export function roundTableRadius(size: RoundTableSize, unitsPerMetre: number): number {
  return Math.max(6, Math.round((ROUND_TABLE_SIZES[size].diameterM / 2) * unitsPerMetre * 10) / 10);
}

/** Round tables grow with their seat count so chairs don't pile up. */
export function recommendedRadius(seats: number): number {
  return Math.max(DEFAULT_TABLE_RADIUS, Math.round(seats * 2.6));
}

// At the default scale (24 units = 1 m): a 0.9 m deep table with a chair every ~0.67 m.
const RECT_TABLE_DEPTH = 22;
const RECT_CHAIR_PITCH = 16;

/** Length that fits `seats` chairs along the seated side(s) of a rectangular table. */
export function recommendedRectSize(seats: number, oneSide: boolean): { width: number; height: number } {
  const perSide = Math.max(1, oneSide ? seats : Math.ceil(seats / 2));
  return { width: Math.max(72, perSide * RECT_CHAIR_PITCH), height: RECT_TABLE_DEPTH };
}

/** Width/height of the table surface (before rotation). */
export function tableBodySize(t: FloorplanTableObject): { w: number; h: number } {
  if (tableShape(t) === "round") return { w: t.radius * 2, h: t.radius * 2 };
  return { w: t.width ?? t.radius * 3, h: t.height ?? t.radius * 2 };
}

export function chairMetrics(t: FloorplanTableObject): { radius: number; gap: number } {
  const { w, h } = tableBodySize(t);
  const base = Math.min(w, h) / 2;
  // Rectangular tables are shallow, so a proportional chair would be tiny; keep them chair-sized.
  const floor = tableShape(t) === "rect" ? 4 : 2;
  return { radius: Math.max(floor, base * 0.18), gap: Math.max(floor * 0.75, base * 0.14) };
}

/** Chair centres relative to the table centre, with the table's rotation already applied. */
export function seatOffsets(t: FloorplanTableObject): Point[] {
  const n = tableSeatCount(t);
  if (n === 0) return [];
  const rotation = t.rotation ?? 0;
  const { radius: cr, gap } = chairMetrics(t);
  const out: Point[] = [];

  if (tableShape(t) === "round") {
    const ring = t.radius + gap + cr;
    const span = Math.max(30, Math.min(360, t.seatSpan ?? 360));
    const pitch = (span / n) * (Math.PI / 180);
    for (let i = 0; i < n; i += 1) {
      const angle =
        span >= 360
          ? -Math.PI / 2 + i * pitch
          : Math.PI / 2 - (span * Math.PI) / 360 + (i + 0.5) * pitch;
      out.push(rotatePoint({ x: ring * Math.cos(angle), y: ring * Math.sin(angle) }, rotation));
    }
    return out;
  }

  const { w, h } = tableBodySize(t);
  const edge = h / 2 + gap + cr;
  const oneSide = Boolean(t.seatsOneSide);
  const bottom = oneSide ? n : Math.floor(n / 2);
  const top = n - bottom;
  const row = (count: number, y: number) => {
    for (let j = 0; j < count; j += 1) {
      out.push(rotatePoint({ x: -w / 2 + ((j + 0.5) * w) / count, y }, rotation));
    }
  };
  row(top, -edge);
  row(bottom, edge);
  return out;
}

/* ---------- objects ---------- */

export function estimateTextSize(obj: Pick<FloorplanTextObject, "text" | "fontSize" | "bold">): { w: number; h: number } {
  const lines = (obj.text || " ").split("\n");
  const factor = obj.bold ? 0.62 : 0.58;
  const longest = Math.max(...lines.map((line) => line.length));
  return {
    w: Math.max(40, longest * obj.fontSize * factor),
    h: Math.max(12, lines.length * obj.fontSize * 1.25)
  };
}

/** The unrotated box of an object, plus the rotation applied about its centre. */
export type ObjectBox = { cx: number; cy: number; w: number; h: number; rotation: number; round: boolean };

export function objectBox(obj: FloorplanCanvasObject): ObjectBox {
  if (obj.type === "table") {
    const { w, h } = tableBodySize(obj);
    return { cx: obj.x, cy: obj.y, w, h, rotation: obj.rotation ?? 0, round: tableShape(obj) === "round" };
  }
  if (obj.type === "rect") {
    return {
      cx: obj.x + obj.width / 2,
      cy: obj.y + obj.height / 2,
      w: obj.width,
      h: obj.height,
      rotation: obj.rotation ?? 0,
      round: false
    };
  }
  if (obj.type === "circle") {
    return { cx: obj.x, cy: obj.y, w: obj.radius * 2, h: obj.radius * 2, rotation: 0, round: true };
  }
  const { w, h } = estimateTextSize(obj);
  return { cx: obj.x + w / 2, cy: obj.y + h / 2, w, h, rotation: obj.rotation ?? 0, round: false };
}

/** Move an object so the centre of its box is at (cx, cy). */
export function withCentre(obj: FloorplanCanvasObject, cx: number, cy: number): FloorplanCanvasObject {
  const box = objectBox(obj);
  return { ...obj, x: obj.x + (cx - box.cx), y: obj.y + (cy - box.cy) } as FloorplanCanvasObject;
}

function boxBounds(box: ObjectBox): Bounds {
  if (box.round && box.w === box.h) {
    const r = box.w / 2;
    return { minX: box.cx - r, minY: box.cy - r, maxX: box.cx + r, maxY: box.cy + r };
  }
  const b = emptyBounds();
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1]
  ]) {
    const p = rotatePoint({ x: (sx * box.w) / 2, y: (sy * box.h) / 2 }, box.rotation);
    growBounds(b, box.cx + p.x, box.cy + p.y);
  }
  return b;
}

/** Bounds of the object body only (what selection, alignment and snapping care about). */
export function objectBodyBounds(obj: FloorplanCanvasObject): Bounds {
  return boxBounds(objectBox(obj));
}

/** Bounds including chairs (what the printed plan has to fit). */
export function objectPrintBounds(obj: FloorplanCanvasObject): Bounds {
  const body = boxBounds(objectBox(obj));
  if (obj.type !== "table") return body;
  const { radius } = chairMetrics(obj);
  for (const s of seatOffsets(obj)) {
    growBounds(body, obj.x + s.x - radius, obj.y + s.y - radius);
    growBounds(body, obj.x + s.x + radius, obj.y + s.y + radius);
  }
  return body;
}

export function objectsPrintBounds(objects: FloorplanCanvasObject[]): Bounds | null {
  return unionBounds(objects.map(objectPrintBounds));
}

export function objectsBodyBounds(objects: FloorplanCanvasObject[]): Bounds | null {
  return unionBounds(objects.map(objectBodyBounds));
}

/* ---------- print layout ---------- */

export type PrintLayout = {
  width: number;
  height: number;
  margin: number;
  headerH: number;
  /** y (PDF coordinates) of the top edge of the framed body. */
  bodyTop: number;
  /** Height reserved at the bottom of the frame for the legend. */
  footerH: number;
  contentLeft: number;
  contentBottom: number;
  contentWidth: number;
  contentHeight: number;
};

export const PRINT_MARGIN = 40;
export const PRINT_BODY_PAD = 22;
export const PRINT_HEADER_H = 96;
export const PRINT_FOOTER_H = 34;

export function printLayout(paperSize: PaperSize, orientation: PaperOrientation, withFooter: boolean): PrintLayout {
  const [width, height] = pdfPageDimensions(paperSize, orientation);
  const footerH = withFooter ? PRINT_FOOTER_H : 0;
  const bodyTop = height - PRINT_HEADER_H - PRINT_MARGIN;
  const contentLeft = PRINT_MARGIN + PRINT_BODY_PAD;
  const contentBottom = PRINT_MARGIN + footerH + PRINT_BODY_PAD;
  return {
    width,
    height,
    margin: PRINT_MARGIN,
    headerH: PRINT_HEADER_H,
    bodyTop,
    footerH,
    contentLeft,
    contentBottom,
    contentWidth: width - 2 * (PRINT_MARGIN + PRINT_BODY_PAD),
    contentHeight: bodyTop - PRINT_BODY_PAD - contentBottom
  };
}

export const MIN_PRINT_SCALE = 0.2;
export const MAX_PRINT_SCALE = 8;

/**
 * How the printer fits a set of objects into the page body: a uniform scale, and the rectangle of
 * canvas space that ends up inside the frame (the objects are centred in it).
 */
/** Printed points per canvas unit for a true 1:`ratio` print, or null when no scale is set. */
export function fixedPointsPerUnit(ratio: number | null | undefined, unitsPerMetre: number | null | undefined): number | null {
  if (!ratio || ratio <= 0 || !unitsPerMetre || unitsPerMetre <= 0) return null;
  // 1 m at 1:ratio is 1000/ratio mm on paper; 72 points per 25.4 mm.
  return ((1000 / ratio) * (72 / 25.4)) / unitsPerMetre;
}

/** The 1:N ratio a given points-per-unit scale amounts to. */
export function ratioForScale(pointsPerUnit: number, unitsPerMetre: number): number {
  return (1000 * (72 / 25.4)) / (pointsPerUnit * unitsPerMetre);
}

export const FIXED_SCALE_OPTIONS = [20, 50, 100, 200, 500] as const;

export function printFit(
  bounds: Bounds | null,
  layout: Pick<PrintLayout, "contentWidth" | "contentHeight">,
  /** Points per unit for a true-scale print. Ignored (and `fits` is false) when the plan won't fit at it. */
  fixedScale?: number | null
): { scale: number; frame: Bounds; sourceMinX: number; sourceMinY: number; fits: boolean } {
  const minX = bounds?.minX ?? 0;
  const minY = bounds?.minY ?? 0;
  const sw = Math.max(1, (bounds?.maxX ?? 1) - minX);
  const sh = Math.max(1, (bounds?.maxY ?? 1) - minY);
  const fit = Math.min(layout.contentWidth / sw, layout.contentHeight / sh);
  const fixedFits = fixedScale != null && fixedScale <= fit + 1e-9;
  const scale = fixedFits ? fixedScale : Math.max(MIN_PRINT_SCALE, Math.min(MAX_PRINT_SCALE, fit));
  const fw = layout.contentWidth / scale;
  const fh = layout.contentHeight / scale;
  const fx = minX - (fw - sw) / 2;
  const fy = minY - (fh - sh) / 2;
  return {
    scale,
    frame: { minX: fx, minY: fy, maxX: fx + fw, maxY: fy + fh },
    sourceMinX: minX,
    sourceMinY: minY,
    fits: fixedScale == null ? true : fixedFits
  };
}

/* ---------- editing helpers ---------- */

/** Next free numeric table number: one past the highest numeric table. */
export function nextTableNumber(objects: FloorplanCanvasObject[]): string {
  let highest = 0;
  for (const obj of objects) {
    if (obj.type !== "table") continue;
    const n = Number(obj.tableNumber);
    if (Number.isInteger(n) && n > highest) highest = n;
  }
  return String(highest + 1);
}

export function snapValue(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value;
}

/**
 * Resize an object by dragging one corner of its (rotated) box. `handle` is the corner being dragged
 * as signs (-1 / +1); the opposite corner stays put in world space.
 */
export function resizeFromCorner(
  obj: FloorplanCanvasObject,
  handle: { sx: -1 | 1; sy: -1 | 1 },
  pointer: Point,
  snap: number
): FloorplanCanvasObject {
  const box = objectBox(obj);
  const MIN = 6;
  const local = rotatePoint({ x: pointer.x - box.cx, y: pointer.y - box.cy }, -box.rotation);

  if (obj.type === "circle" || (obj.type === "table" && tableShape(obj) === "round")) {
    // The handles sit on the corners of the bounding square, hence the /√2.
    const radius = Math.max(obj.type === "circle" ? 4 : MIN, Math.round(Math.hypot(local.x, local.y) / Math.SQRT2));
    return { ...obj, radius: snap > 0 ? Math.max(MIN, snapValue(radius, snap)) : radius } as FloorplanCanvasObject;
  }
  if (obj.type !== "rect" && obj.type !== "table") return obj;

  const anchor = { x: (-handle.sx * box.w) / 2, y: (-handle.sy * box.h) / 2 };
  let w = Math.max(MIN, (local.x - anchor.x) * handle.sx);
  let h = Math.max(MIN, (local.y - anchor.y) * handle.sy);
  if (snap > 0) {
    w = Math.max(MIN, snapValue(w, snap));
    h = Math.max(MIN, snapValue(h, snap));
  }
  const centreLocal = { x: anchor.x + (handle.sx * w) / 2, y: anchor.y + (handle.sy * h) / 2 };
  const shift = rotatePoint(centreLocal, box.rotation);
  const cx = box.cx + shift.x;
  const cy = box.cy + shift.y;
  if (obj.type === "rect") {
    return { ...obj, width: w, height: h, x: cx - w / 2, y: cy - h / 2 };
  }
  return { ...obj, width: w, height: h, radius: Math.max(MIN, Math.min(w, h) / 2), x: cx, y: cy };
}

export function normaliseRotation(deg: number): number {
  const r = ((deg % 360) + 360) % 360;
  return Math.round(r * 10) / 10;
}
