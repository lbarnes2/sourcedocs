/**
 * "Fill an area" with banquet tables: as many tables as fit in a rectangle or a room's walls, on a grid
 * (or brick-staggered), keeping a gangway between neighbouring tables' chairs and clear of walls,
 * fixtures, keep-clear zones, door swings and anything already on the plan.
 *
 * These are measurements of what fits, not a verdict on what's safe: the gangway and margin are the
 * user's own figures.
 */
import { DEFAULT_UNITS_PER_METRE, rotatePoint, type Point, type RoundTableSize } from "@/lib/floorplans/geometry";
import { isFloorAreaFor, isFurnishing, isObstacle, objectOnWalls, objectOutsidePolygon, prepare, preparedCollide, shapesBounds } from "@/lib/floorplans/collision";
import { tableTemplate, type TableStyle } from "@/lib/floorplans/model";
import { roomWorldPoints } from "@/lib/floorplans/room";
import { FACING_ROTATION, findStage, type FillArea, type TheatreFacing } from "@/lib/floorplans/theatre";
import type { FloorplanAutoLayoutSettings, FloorplanCanvasObject, FloorplanRoomObject, FloorplanTableObject } from "@/types";

export type BanquetFillSettings = {
  style: TableStyle;
  roundSize: RoundTableSize;
  seats: number;
  /** Clear floor between neighbouring tables' chairs (chair back to chair back), metres. */
  gangwayM: number;
  layout: FloorplanAutoLayoutSettings["tableLayout"];
  /** Stop at this many tables; null for as many as fit. */
  maxTables: number | null;
  /** Cabaret: the open side faces this way. Long tables: up/down run across, left/right run down. */
  facing: TheatreFacing;
  numbering: FloorplanAutoLayoutSettings["numbering"];
  startCorner: FloorplanAutoLayoutSettings["startCorner"];
};

export const BANQUET_DEFAULTS = { gangwayM: 1.5, maxTables: null, facing: "up" as TheatreFacing };

export type BanquetFillResult = {
  tables: FloorplanTableObject[];
  covers: number;
  rows: number;
  /** Most tables in one row. */
  perRow: number;
  /** Tables left out because "up to N" was set. */
  capped: number;
};

type Cell = { row: number; x: number; y: number; table: FloorplanTableObject };

/**
 * Fill `area` (or, with `room`, the room's walls) with tables. `marginM` is kept clear inside the edges;
 * `clearanceM` is kept round fixtures and other obstacles. Numbers come from `numberFor(i)` in visit order.
 */
export function fillAreaWithTables(
  area: FillArea,
  settings: BanquetFillSettings,
  options: {
    unitsPerMetre: number;
    marginM: number;
    clearance: number;
    objects: FloorplanCanvasObject[];
    room?: FloorplanRoomObject;
    numberFor: (index: number) => string;
  }
): BanquetFillResult {
  const empty: BanquetFillResult = { tables: [], covers: 0, rows: 0, perRow: 0, capped: 0 };
  const upm = options.unitsPerMetre;
  const k = upm / DEFAULT_UNITS_PER_METRE;
  const seats = Math.max(1, Math.round(settings.seats));
  const template = tableTemplate(seats, settings.style, k, settings.roundSize);
  const turn = settings.style === "round" ? 0 : FACING_ROTATION[settings.facing];
  const rotation = (((area.rotation + turn) % 360) + 360) % 360;

  // The table's footprint (top and chairs) in the area's frame. Cabaret chairs sit on one side, so the
  // footprint isn't centred on the table.
  const sample = { id: "", type: "table", tableNumber: "", x: 0, y: 0, ...template, rotation: turn || undefined } as FloorplanTableObject;
  const fb = shapesBounds(sample);
  const fw = fb.maxX - fb.minX;
  const fh = fb.maxY - fb.minY;
  const fcx = (fb.minX + fb.maxX) / 2;
  const fcy = (fb.minY + fb.maxY) / 2;
  const gangway = Math.max(0, settings.gangwayM) * upm;
  const cellW = fw + gangway;
  const cellH = fh + gangway;
  const margin = Math.max(0, options.marginM) * upm;

  // The usable rectangle in the area's frame (centred on the origin).
  const L = -area.w / 2 + margin;
  const R = area.w / 2 - margin;
  const T = -area.h / 2 + margin;
  const B = area.h / 2 - margin;
  if (R - L < fw || B - T < fh) return empty;

  const toWorld = (p: Point): Point => {
    const r = rotatePoint(p, area.rotation);
    return { x: area.cx + r.x, y: area.cy + r.y };
  };
  const polygon = options.room
    ? roomWorldPoints(options.room)
    : [
        { x: -area.w / 2, y: -area.h / 2 },
        { x: area.w / 2, y: -area.h / 2 },
        { x: area.w / 2, y: area.h / 2 },
        { x: -area.w / 2, y: area.h / 2 }
      ].map(toWorld);

  // What tables keep clear of: fixtures and obstacles (with the clearance), and tables and seating
  // already on the plan (with the gangway). A room's door swings count too.
  const others = options.room ? [...options.objects, options.room] : options.objects;
  const obstacles = others.filter(isObstacle).map(prepare);
  const furniture = others.filter(isFurnishing).map(prepare);
  // Other rooms' walls: a table goes on one side of a wall or the other, never across it.
  const rooms = options.objects.filter((o): o is FloorplanRoomObject => o.type === "room" && o.id !== options.room?.id);

  const makeTable = (x: number, y: number): FloorplanTableObject => {
    const c = toWorld({ x: x - fcx, y: y - fcy });
    return { id: crypto.randomUUID(), type: "table", tableNumber: "", x: c.x, y: c.y, ...template, rotation: rotation || undefined };
  };
  const fits = (t: FloorplanTableObject) => {
    // Tables at the area's own edge: the margin applies there too.
    if (objectOutsidePolygon(t, polygon, margin)) return false;
    if (rooms.some((r) => objectOnWalls(t, r, options.clearance))) return false;
    const p = prepare(t);
    if (obstacles.some((o) => !isFloorAreaFor(o.obj, t) && preparedCollide(p, o, options.clearance))) return false;
    return !furniture.some((o) => preparedCollide(p, o, gangway));
  };

  const stagger = settings.layout === "staggered";
  const layout = (offX: number, offY: number): Cell[] => {
    const cells: Cell[] = [];
    for (let row = 0; ; row += 1) {
      const cy = T + fh / 2 + offY + row * cellH;
      if (cy + fh / 2 > B + 1e-6) break;
      // Staggered rows shift half a table; wrapping keeps a column on the left where one fits.
      const shift = stagger && row % 2 === 1 ? cellW / 2 : 0;
      for (let cx = L + fw / 2 + ((offX + shift) % cellW); cx + fw / 2 <= R + 1e-6; cx += cellW) {
        const table = makeTable(cx, cy);
        if (fits(table)) cells.push({ row, x: cx, y: cy, table });
      }
    }
    return cells;
  };

  // A grid centred in the area first; then a few other offsets, in case one fits more round pillars
  // or into a room's corners. Ties keep the earlier (centred) one.
  const slackX = R - L - fw - Math.floor((R - L - fw) / cellW) * cellW;
  const slackY = B - T - fh - Math.floor((B - T - fh) / cellH) * cellH;
  const steps = [0, 0.25, 0.5, 0.75];
  const offsetsX = [slackX / 2, ...steps.map((s) => s * cellW).filter((v) => v <= slackX + 1e-6 || options.room)];
  const offsetsY = [slackY / 2, ...steps.map((s) => s * cellH).filter((v) => v <= slackY + 1e-6 || options.room)];
  let best: Cell[] = [];
  for (const oy of offsetsY) {
    for (const ox of offsetsX) {
      const cells = layout(ox, oy);
      if (cells.length > best.length) best = cells;
    }
  }
  if (!best.length) return empty;

  // "Up to N tables": keep those nearest the stage, or the middle when there's no stage.
  let kept = best;
  let capped = 0;
  const max = settings.maxTables && settings.maxTables > 0 ? Math.round(settings.maxTables) : null;
  if (max != null && kept.length > max) {
    const stage = findStage(options.objects);
    const focus = stage ? { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 } : { x: area.cx, y: area.cy };
    const ranked = [...kept].sort((a, b) => Math.hypot(a.table.x - focus.x, a.table.y - focus.y) - Math.hypot(b.table.x - focus.x, b.table.y - focus.y));
    const keep = new Set(ranked.slice(0, max));
    capped = kept.length - max;
    kept = kept.filter((c) => keep.has(c));
  }

  // Number in visit order: rows from the start corner's side, straight or snaked across.
  const fromTop = settings.startCorner === "topLeft" || settings.startCorner === "topRight";
  const fromLeft = settings.startCorner === "topLeft" || settings.startCorner === "bottomLeft";
  const rowIds = [...new Set(kept.map((c) => c.row))].sort((a, b) => (fromTop ? a - b : b - a));
  const ordered: Cell[] = [];
  rowIds.forEach((row, i) => {
    const forward = settings.numbering === "snaked" && i % 2 === 1 ? !fromLeft : fromLeft;
    ordered.push(...kept.filter((c) => c.row === row).sort((a, b) => (forward ? a.x - b.x : b.x - a.x)));
  });
  const tables = ordered.map((c, i) => ({ ...c.table, tableNumber: options.numberFor(i) }));
  const perRow = Math.max(...rowIds.map((row) => kept.filter((c) => c.row === row).length));
  return { tables, covers: tables.length * seats, rows: rowIds.length, perRow, capped };
}
