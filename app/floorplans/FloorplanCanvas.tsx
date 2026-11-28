"use client";

import { type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_FILLS,
  OCCUPANCY_COLORS,
  OUTLINE_COLOR,
  TEXT_DEFAULT_COLOR,
  chairMetrics,
  normaliseRotation,
  objectBodyBounds,
  objectBox,
  objectPrintBounds,
  objectsBodyBounds,
  occupancyStatus,
  resizeFromCorner,
  seatOffsets,
  tableSeatCount,
  tableShape,
  type Bounds,
  type Point
} from "@/lib/floorplans/geometry";
import { guestCountFor, type TableGuestMap } from "@/lib/floorplans/guests";
import type { Highlight } from "@/lib/floorplans/measure";
import {
  seatKey,
  seatingNameBand,
  seatingPositions,
  seatingSeatCount,
  type SeatState
} from "@/lib/floorplans/seating";
import {
  insertCorner,
  normaliseRoom,
  pointAlong,
  polygonArea,
  removeCorner,
  roomWorldPoints,
  snapAngle,
  wallLengths
} from "@/lib/floorplans/room";
import {
  clampOffset,
  doorLeafPath,
  nearestWall,
  outsideReach,
  remapOpenings,
  roomOpenings,
  roomWalls,
  wallLabelOffsets,
  wallRunsPath,
  wallThickness,
  type OpeningGeometry
} from "@/lib/floorplans/openings";
import type { FloorplanCanvasObject, FloorplanRoomObject } from "@/types";

export type CanvasView = { zoom: number; pan: Point };

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 4;

export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

type Guide = { axis: "x" | "y"; pos: number; from: number; to: number };

type Interaction =
  | { kind: "pan"; startClient: Point; startPan: Point }
  | {
      kind: "drag";
      ids: string[];
      start: Map<string, FloorplanCanvasObject>;
      startPoint: Point;
      startClient: Point;
      primaryId: string;
      moved: boolean;
      collapseTo: string | null;
    }
  | { kind: "marquee"; startClient: Point; additive: boolean; base: string[]; moved: boolean }
  | { kind: "draw"; startClient: Point; moved: boolean }
  | { kind: "resize"; id: string; handle: { sx: -1 | 1; sy: -1 | 1 }; startObj: FloorplanCanvasObject; moved: boolean }
  | { kind: "rotate"; id: string; startObj: FloorplanCanvasObject; moved: boolean }
  /** Dragging one corner of a room (`startObj` already has the corner, if it's a new one). */
  | { kind: "corner"; id: string; index: number; startObj: FloorplanRoomObject; moved: boolean }
  /** Sliding a door or window along the walls. */
  | { kind: "opening"; id: string; openingId: string; startObj: FloorplanRoomObject; startClient: Point; moved: boolean }
  | { kind: "pinch"; startDistance: number; startMid: Point; startView: CanvasView };

const DRAG_THRESHOLD_PX = 3;
const GUIDE_THRESHOLD_PX = 6;

interface Props {
  objects: FloorplanCanvasObject[];
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  gridSize: number;
  snapToGrid: boolean;
  view: CanvasView;
  onViewChange: (updater: (view: CanvasView) => CanvasView) => void;
  viewportRef: RefObject<HTMLDivElement | null>;
  /** Background drags pan instead of drawing a selection box. */
  panActive: boolean;
  /** Canvas-space rectangle that will be printed, or null to hide it. */
  frame: Bounds | null;
  frameLabel: string;
  tableGuests: TableGuestMap | null;
  colorByOccupancy: boolean;
  /** Canvas units per metre; enables the scale bar and size readout. */
  unitsPerMetre: number | null;
  /** Called once, just before the first live change of a drag / resize / rotate. */
  onBeginGesture: () => void;
  /** Escape during a drag / resize / rotate that has changed something: undo it back to the start. */
  onCancelGesture: () => void;
  onLive: (objects: FloorplanCanvasObject[]) => void;
  emptyHint: ReactNode;
  /** A measurement to point at (outlined shapes and/or a dimension line). */
  highlight?: Highlight | null;
  /** The seating block whose chairs are being edited, and what clicking a chair does. */
  seatEdit?: { id: string; tool: "remove" | "wheelchair" } | null;
  /** Drawing an area: drags on the canvas draw a rectangle instead of selecting. */
  drawMode?: boolean;
  onDrawArea?: (area: Bounds) => void;
  /** Drawing a room: each click adds a corner. */
  roomDraw?: boolean;
  /** The finished room's corners on the plan, or null when drawing was cancelled. */
  onRoomDrawn?: (points: Point[] | null) => void;
  /** The door or window selected in the selected room, if any. */
  openingId?: string | null;
  onSelectOpening?: (openingId: string | null) => void;
  /** Double-click on a seating block. */
  onEditSeats?: (id: string) => void;
  /** Set chair positions in a block; `stroke` is the same for every call in one press-and-drag. */
  onSeatPaint?: (id: string, key: string, state: SeatState, stroke: number) => void;
}

/** The lucide "accessible" wheelchair symbol, drawn in a 24-unit box. */
export const WHEELCHAIR_PATHS = [
  "M18 19 19 12 13 13",
  "M5 8 8 5 13.5 8 11.14 11.5",
  "M4.24 14.5a5 5 0 0 0 6.88 6",
  "M13.76 17.5a5 5 0 0 0-6.88-6"
];

function WheelchairMark({ cx, cy, size }: { cx: number; cy: number; size: number }) {
  const k = size / 24;
  return (
    <g transform={`translate(${cx - size / 2} ${cy - size / 2}) scale(${k})`} className="fp-seat-wc-mark">
      <circle cx={16} cy={4} r={1.4} />
      {WHEELCHAIR_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </g>
  );
}

function snapTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** Screen pixels within which a corner snaps into line with its neighbours, or closes the room. */
const CORNER_SNAP_PX = 8;

function formatLength(units: number, upm: number | null): string {
  if (!upm) return `${Math.round(units)}`;
  const m = units / upm;
  return `${m >= 100 ? m.toFixed(0) : m.toFixed(2).replace(/\.?0+$/, "")} m`;
}

/** A room being drawn: the corners so far, where the next one would go, and a length being typed. */
type RoomSketch = { points: Point[]; hover: Point | null; typed: string };

export function FloorplanCanvas(props: Props) {
  const { objects, selectedIds, gridSize, view, viewportRef, frame, frameLabel, tableGuests, colorByOccupancy, unitsPerMetre } = props;
  const latest = useRef(props);
  latest.current = props;
  const interaction = useRef<Interaction | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  /** Press-and-drag over chairs while editing seats: every chair passed over gets `state`. */
  const paint = useRef<{ id: string; state: SeatState; stroke: number } | null>(null);
  const strokeCount = useRef(0);
  const [sketch, setSketchState] = useState<RoomSketch>({ points: [], hover: null, typed: "" });
  const sketchRef = useRef(sketch);
  const setSketch = (next: RoomSketch) => {
    sketchRef.current = next;
    setSketchState(next);
  };
  const lastPointer = useRef<{ client: Point; shift: boolean } | null>(null);

  // Leaving the room tool (from the toolbar or a shortcut) throws away a half-drawn room.
  useEffect(() => {
    if (!props.roomDraw) setSketch({ points: [], hover: null, typed: "" });
  }, [props.roomDraw]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const single = selectedIds.length === 1 ? (objects.find((o) => o.id === selectedIds[0]) ?? null) : null;
  const multiBounds = useMemo(
    () => (selectedIds.length > 1 ? objectsBodyBounds(objects.filter((o) => selectedSet.has(o.id))) : null),
    [objects, selectedIds.length, selectedSet]
  );

  function toCanvas(clientX: number, clientY: number): Point {
    const rect = viewportRef.current?.getBoundingClientRect();
    const { view: v } = latest.current;
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left - v.pan.x) / v.zoom, y: (clientY - rect.top - v.pan.y) / v.zoom };
  }

  function replaceObjects(updates: Map<string, FloorplanCanvasObject>) {
    latest.current.onLive(latest.current.objects.map((o) => updates.get(o.id) ?? o));
  }

  /** Lengths snap to 0.1 m with a scale, or to the grid without one. */
  function lengthStep(): number {
    const p = latest.current;
    return p.unitsPerMetre ? p.unitsPerMetre * 0.1 : p.gridSize;
  }

  /**
   * Where the next corner of a room being drawn goes for the pointer at `raw`: on the grid for the first
   * corner; after that at a 45° step from the last corner and a tidy length, lined up with the first
   * corner when close, and onto the first corner itself to close the room. Shift turns snapping off.
   */
  function sketchPoint(raw: Point, free: boolean, pts: Point[]): Point {
    const p = latest.current;
    const near = CORNER_SNAP_PX / p.view.zoom;
    if (pts.length >= 3 && Math.hypot(raw.x - pts[0].x, raw.y - pts[0].y) < near * 1.5) return pts[0];
    if (free) return raw;
    if (!pts.length) return p.snapToGrid ? { x: snapTo(raw.x, p.gridSize), y: snapTo(raw.y, p.gridSize) } : raw;
    const last = pts[pts.length - 1];
    const dir = snapAngle(last, raw, 45);
    const len = Math.hypot(dir.x - last.x, dir.y - last.y);
    let next = pointAlong(last, dir, Math.max(lengthStep(), snapTo(len, lengthStep())));
    const first = pts[0];
    if (Math.abs(next.x - last.x) < 1e-6 && Math.abs(next.y - first.y) < near) next = { x: last.x, y: first.y };
    else if (Math.abs(next.y - last.y) < 1e-6 && Math.abs(next.x - first.x) < near) next = { x: first.x, y: last.y };
    return next;
  }

  function finishSketch(points: Point[] | null) {
    setSketch({ points: [], hover: null, typed: "" });
    latest.current.onRoomDrawn?.(points);
  }

  /** A click while drawing a room: add a corner, or finish on the first one. */
  function addSketchCorner(clientX: number, clientY: number, shift: boolean) {
    const cur = sketchRef.current;
    const pt = sketchPoint(toCanvas(clientX, clientY), shift, cur.points);
    if (cur.points.length >= 3 && pt === cur.points[0]) {
      finishSketch(cur.points);
      return;
    }
    const last = cur.points[cur.points.length - 1];
    if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 1e-6) return;
    setSketch({ points: [...cur.points, pt], hover: pt, typed: "" });
  }

  /** Move one corner of a room to `raw` (world), snapped to the grid and into line with its neighbours. */
  function movedCorner(room: FloorplanRoomObject, index: number, raw: Point, free: boolean): FloorplanRoomObject {
    const p = latest.current;
    const world = roomWorldPoints(room);
    let pt = raw;
    if (!free) {
      if (p.snapToGrid) pt = { x: snapTo(pt.x, lengthStep()), y: snapTo(pt.y, lengthStep()) };
      const near = CORNER_SNAP_PX / p.view.zoom;
      const n = world.length;
      for (const other of [world[(index - 1 + n) % n], world[(index + 1) % n]]) {
        if (Math.abs(raw.x - other.x) < near) pt = { ...pt, x: other.x };
        if (Math.abs(raw.y - other.y) < near) pt = { ...pt, y: other.y };
      }
    }
    const points = room.points.map((q, i) => (i === index ? { x: pt.x - room.x, y: pt.y - room.y } : q));
    return remapOpenings(room, normaliseRoom({ ...room, points }));
  }

  /** Slide an opening to the nearest wall position to `raw` (snapped to 5 cm unless `free`). */
  function movedOpening(room: FloorplanRoomObject, openingId: string, raw: Point, free: boolean): FloorplanRoomObject {
    const walls = roomWalls(room);
    const near = nearestWall(walls, raw);
    const step = latest.current.unitsPerMetre ? latest.current.unitsPerMetre * 0.05 : 1;
    const openings = (room.openings ?? []).map((o) => {
      if (o.id !== openingId) return o;
      const len = walls[near.wall].len;
      const width = Math.min(o.width, len);
      const offset = clampOffset(len, width, free ? near.offset : snapTo(near.offset - width / 2, step) + width / 2);
      return { ...o, wall: near.wall, offset };
    });
    return { ...room, openings };
  }

  function startOpening(event: ReactPointerEvent<HTMLElement>, room: FloorplanRoomObject, openingId: string) {
    if (interaction.current || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    latest.current.onSelectOpening?.(openingId);
    if (room.locked) return;
    interaction.current = {
      kind: "opening",
      id: room.id,
      openingId,
      startObj: room,
      startClient: { x: event.clientX, y: event.clientY },
      moved: false
    };
  }

  function startCorner(event: ReactPointerEvent<HTMLElement>, room: FloorplanRoomObject, index: number, insert: boolean) {
    if (interaction.current || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const startObj = insert ? remapOpenings(room, { ...room, points: insertCorner(room.points, index) }) : room;
    interaction.current = { kind: "corner", id: room.id, index: insert ? index + 1 : index, startObj, moved: false };
  }

  function deleteCorner(room: FloorplanRoomObject, index: number) {
    if (room.points.length <= 3) return;
    latest.current.onBeginGesture();
    replaceObjects(new Map([[room.id, remapOpenings(room, normaliseRoom({ ...room, points: removeCorner(room.points, index) }))]]));
  }

  // Wheel pans; ctrl/⌘ + wheel (and trackpad pinch) zooms about the cursor.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        const cx = event.clientX - rect.left;
        const cy = event.clientY - rect.top;
        const factor = Math.max(0.8, Math.min(1.25, Math.exp(-event.deltaY * 0.01)));
        latest.current.onViewChange((v) => {
          const zoom = clampZoom(v.zoom * factor);
          const k = zoom / v.zoom;
          return { zoom, pan: { x: cx - (cx - v.pan.x) * k, y: cy - (cy - v.pan.y) * k } };
        });
        return;
      }
      latest.current.onViewChange((v) => ({
        zoom: v.zoom,
        pan: { x: v.pan.x - event.deltaX, y: v.pan.y - event.deltaY }
      }));
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [viewportRef]);

  // Window-level listeners keep a drag alive when the pointer leaves the canvas.
  useEffect(() => {
    function onMove(event: PointerEvent) {
      if (pointers.current.has(event.pointerId)) {
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      const act = interaction.current;
      if (latest.current.roomDraw && !act) {
        lastPointer.current = { client: { x: event.clientX, y: event.clientY }, shift: event.shiftKey };
        const cur = sketchRef.current;
        const hover = sketchPoint(toCanvas(event.clientX, event.clientY), event.shiftKey, cur.points);
        setSketch({ ...cur, hover });
      }
      if (!act) return;
      const p = latest.current;

      if (act.kind === "opening") {
        if (!act.moved && Math.hypot(event.clientX - act.startClient.x, event.clientY - act.startClient.y) < DRAG_THRESHOLD_PX) return;
        if (!act.moved) {
          act.moved = true;
          p.onBeginGesture();
        }
        replaceObjects(new Map([[act.id, movedOpening(act.startObj, act.openingId, toCanvas(event.clientX, event.clientY), event.shiftKey)]]));
        return;
      }

      if (act.kind === "corner") {
        if (!act.moved) {
          act.moved = true;
          p.onBeginGesture();
        }
        replaceObjects(new Map([[act.id, movedCorner(act.startObj, act.index, toCanvas(event.clientX, event.clientY), event.shiftKey)]]));
        return;
      }

      if (act.kind === "pinch") {
        const pts = Array.from(pointers.current.values());
        if (pts.length < 2) return;
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        const rect = p.viewportRef.current?.getBoundingClientRect();
        if (!rect) return;
        const zoom = clampZoom(act.startView.zoom * (dist / act.startDistance));
        const k = zoom / act.startView.zoom;
        const sx = act.startMid.x - rect.left;
        const sy = act.startMid.y - rect.top;
        p.onViewChange(() => ({
          zoom,
          pan: {
            x: mid.x - rect.left - (sx - act.startView.pan.x) * k,
            y: mid.y - rect.top - (sy - act.startView.pan.y) * k
          }
        }));
        return;
      }

      if (act.kind === "pan") {
        const pan = {
          x: act.startPan.x + event.clientX - act.startClient.x,
          y: act.startPan.y + event.clientY - act.startClient.y
        };
        p.onViewChange((v) => ({ ...v, pan }));
        return;
      }

      if (act.kind === "draw") {
        const rect = p.viewportRef.current?.getBoundingClientRect();
        if (!rect) return;
        if (!act.moved && Math.hypot(event.clientX - act.startClient.x, event.clientY - act.startClient.y) < DRAG_THRESHOLD_PX) return;
        act.moved = true;
        setMarquee({
          x0: Math.min(act.startClient.x, event.clientX) - rect.left,
          y0: Math.min(act.startClient.y, event.clientY) - rect.top,
          x1: Math.max(act.startClient.x, event.clientX) - rect.left,
          y1: Math.max(act.startClient.y, event.clientY) - rect.top
        });
        return;
      }

      if (act.kind === "marquee") {
        const rect = p.viewportRef.current?.getBoundingClientRect();
        if (!rect) return;
        const dx = event.clientX - act.startClient.x;
        const dy = event.clientY - act.startClient.y;
        if (!act.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        act.moved = true;
        const a = toCanvas(act.startClient.x, act.startClient.y);
        const b = toCanvas(event.clientX, event.clientY);
        const box = {
          minX: Math.min(a.x, b.x),
          maxX: Math.max(a.x, b.x),
          minY: Math.min(a.y, b.y),
          maxY: Math.max(a.y, b.y)
        };
        setMarquee({
          x0: Math.min(act.startClient.x, event.clientX) - rect.left,
          y0: Math.min(act.startClient.y, event.clientY) - rect.top,
          x1: Math.max(act.startClient.x, event.clientX) - rect.left,
          y1: Math.max(act.startClient.y, event.clientY) - rect.top
        });
        const hit = p.objects
          .filter((o) => {
            const bb = objectBodyBounds(o);
            const touches = bb.minX < box.maxX && bb.maxX > box.minX && bb.minY < box.maxY && bb.maxY > box.minY;
            // A box drawn entirely inside a room, stage or dance floor is aimed at what's on it, not at the floor itself.
            const encloses = bb.minX <= box.minX && bb.maxX >= box.maxX && bb.minY <= box.minY && bb.maxY >= box.maxY;
            return touches && !encloses;
          })
          .map((o) => o.id);
        p.onSelect(act.additive ? Array.from(new Set([...act.base, ...hit])) : hit);
        return;
      }

      if (act.kind === "drag") {
        const screenDist = Math.hypot(event.clientX - act.startClient.x, event.clientY - act.startClient.y);
        if (!act.moved && screenDist < DRAG_THRESHOLD_PX) return;
        if (!act.moved) {
          act.moved = true;
          p.onBeginGesture();
        }
        const free = event.shiftKey;
        const pt = toCanvas(event.clientX, event.clientY);
        let dx = pt.x - act.startPoint.x;
        let dy = pt.y - act.startPoint.y;
        const primary = act.start.get(act.primaryId);
        if (primary && p.snapToGrid && !free) {
          dx = snapTo(primary.x + dx, p.gridSize) - primary.x;
          dy = snapTo(primary.y + dy, p.gridSize) - primary.y;
        }

        // Alignment guides against everything that isn't moving.
        const nextGuides: Guide[] = [];
        if (!free) {
          const moving = Array.from(act.start.values()).map(objectBodyBounds);
          const union = moving.reduce<Bounds>(
            (acc, b) => ({
              minX: Math.min(acc.minX, b.minX),
              minY: Math.min(acc.minY, b.minY),
              maxX: Math.max(acc.maxX, b.maxX),
              maxY: Math.max(acc.maxY, b.maxY)
            }),
            { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
          );
          const others = p.objects.filter((o) => !act.start.has(o.id)).map(objectBodyBounds);
          const threshold = GUIDE_THRESHOLD_PX / p.view.zoom;
          const mx = [union.minX + dx, (union.minX + union.maxX) / 2 + dx, union.maxX + dx];
          const my = [union.minY + dy, (union.minY + union.maxY) / 2 + dy, union.maxY + dy];
          let bestX: { diff: number; pos: number; other: Bounds } | null = null;
          let bestY: { diff: number; pos: number; other: Bounds } | null = null;
          for (const o of others) {
            const ox = [o.minX, (o.minX + o.maxX) / 2, o.maxX];
            const oy = [o.minY, (o.minY + o.maxY) / 2, o.maxY];
            for (const a of mx) {
              for (const b of ox) {
                const diff = b - a;
                if (Math.abs(diff) <= threshold && (!bestX || Math.abs(diff) < Math.abs(bestX.diff))) {
                  bestX = { diff, pos: b, other: o };
                }
              }
            }
            for (const a of my) {
              for (const b of oy) {
                const diff = b - a;
                if (Math.abs(diff) <= threshold && (!bestY || Math.abs(diff) < Math.abs(bestY.diff))) {
                  bestY = { diff, pos: b, other: o };
                }
              }
            }
          }
          if (bestX) dx += bestX.diff;
          if (bestY) dy += bestY.diff;
          if (bestX) {
            nextGuides.push({
              axis: "x",
              pos: bestX.pos,
              from: Math.min(union.minY + dy, bestX.other.minY),
              to: Math.max(union.maxY + dy, bestX.other.maxY)
            });
          }
          if (bestY) {
            nextGuides.push({
              axis: "y",
              pos: bestY.pos,
              from: Math.min(union.minX + dx, bestY.other.minX),
              to: Math.max(union.maxX + dx, bestY.other.maxX)
            });
          }
        }
        setGuides(nextGuides);

        const updates = new Map<string, FloorplanCanvasObject>();
        act.start.forEach((obj, id) => updates.set(id, { ...obj, x: obj.x + dx, y: obj.y + dy } as FloorplanCanvasObject));
        replaceObjects(updates);
        return;
      }

      if (act.kind === "resize") {
        const pt = toCanvas(event.clientX, event.clientY);
        if (!act.moved) {
          act.moved = true;
          p.onBeginGesture();
        }
        // With a scale, sizes snap to 0.1 m (diameter for round shapes); otherwise to half a grid square.
        const roundShape =
          act.startObj.type === "circle" || (act.startObj.type === "table" && tableShape(act.startObj) === "round");
        const step = p.unitsPerMetre ? p.unitsPerMetre * (roundShape ? 0.05 : 0.1) : Math.max(1, p.gridSize / 2);
        const snap = p.snapToGrid && !event.shiftKey ? step : 0;
        replaceObjects(new Map([[act.id, resizeFromCorner(act.startObj, act.handle, pt, snap)]]));
        return;
      }

      if (act.kind === "rotate") {
        const box = objectBox(act.startObj);
        const pt = toCanvas(event.clientX, event.clientY);
        let angle = (Math.atan2(pt.y - box.cy, pt.x - box.cx) * 180) / Math.PI + 90;
        if (!event.shiftKey) angle = Math.round(angle / 15) * 15;
        if (!act.moved) {
          act.moved = true;
          p.onBeginGesture();
        }
        replaceObjects(new Map([[act.id, { ...act.startObj, rotation: normaliseRotation(angle) } as FloorplanCanvasObject]]));
      }
    }

    function onUp(event: PointerEvent) {
      pointers.current.delete(event.pointerId);
      paint.current = null;
      const act = interaction.current;
      if (!act) return;
      if (act.kind === "pinch") {
        if (pointers.current.size < 2) interaction.current = null;
        return;
      }
      if (act.kind === "drag" && !act.moved && act.collapseTo) latest.current.onSelect([act.collapseTo]);
      if (act.kind === "marquee" && !act.moved && !act.additive) latest.current.onSelect([]);
      if (act.kind === "draw" && act.moved) {
        const a = toCanvas(act.startClient.x, act.startClient.y);
        const b = toCanvas(event.clientX, event.clientY);
        latest.current.onDrawArea?.({
          minX: Math.min(a.x, b.x),
          minY: Math.min(a.y, b.y),
          maxX: Math.max(a.x, b.x),
          maxY: Math.max(a.y, b.y)
        });
      }
      interaction.current = null;
      setGuides([]);
      setMarquee(null);
    }

    // Escape cancels the gesture in progress. Capture phase, so the page's own Escape (clear selection)
    // doesn't also run.
    function onKeyDown(event: KeyboardEvent) {
      const act = interaction.current;
      if (latest.current.roomDraw && !act && onSketchKey(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.key !== "Escape" || !act) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if ((act.kind === "drag" || act.kind === "resize" || act.kind === "rotate" || act.kind === "corner" || act.kind === "opening") && act.moved) {
        latest.current.onCancelGesture();
      }
      if (act.kind === "marquee") latest.current.onSelect(act.base);
      if (act.kind === "draw") latest.current.onDrawArea?.({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
      interaction.current = null;
      setGuides([]);
      setMarquee(null);
    }

    /** Keys while drawing a room. Returns true when the key was used. */
    function onSketchKey(event: KeyboardEvent): boolean {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return false;
      if (event.metaKey || event.ctrlKey || event.altKey) return false;
      const cur = sketchRef.current;
      if (event.key === "Escape") {
        finishSketch(null);
        return true;
      }
      if (/^[0-9.]$/.test(event.key) && cur.points.length) {
        if (event.key === "." && cur.typed.includes(".")) return true;
        setSketch({ ...cur, typed: cur.typed + event.key });
        return true;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        if (cur.typed) setSketch({ ...cur, typed: cur.typed.slice(0, -1) });
        else if (cur.points.length) {
          const points = cur.points.slice(0, -1);
          const lp = lastPointer.current;
          const hover = lp ? sketchPoint(toCanvas(lp.client.x, lp.client.y), lp.shift, points) : cur.hover;
          setSketch({ points, hover, typed: "" });
        } else finishSketch(null);
        return true;
      }
      if (event.key === "Enter") {
        const typed = parseFloat(cur.typed);
        const last = cur.points[cur.points.length - 1];
        if (last && cur.typed && typed > 0) {
          // A typed length: the next wall runs that far in the direction the pointer is showing.
          const upm = latest.current.unitsPerMetre;
          const toward = cur.hover && Math.hypot(cur.hover.x - last.x, cur.hover.y - last.y) > 1e-6 ? cur.hover : { x: last.x + 1, y: last.y };
          const pt = pointAlong(last, toward, upm ? typed * upm : typed);
          setSketch({ points: [...cur.points, pt], hover: pt, typed: "" });
        } else if (cur.points.length >= 3) {
          finishSketch(cur.points);
        } else if (cur.typed) {
          setSketch({ ...cur, typed: "" });
        }
        return true;
      }
      return false;
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // Handlers read everything through refs, so they are installed once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onViewportPointerDownCapture(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const pts = Array.from(pointers.current.values());
      interaction.current = {
        kind: "pinch",
        startDistance: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
        startMid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
        startView: latest.current.view
      };
      setMarquee(null);
      event.stopPropagation();
    }
  }

  function onBackgroundPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (interaction.current) return;
    const p = latest.current;
    if (event.button === 1 || p.panActive) {
      interaction.current = { kind: "pan", startClient: { x: event.clientX, y: event.clientY }, startPan: p.view.pan };
      return;
    }
    if (event.button !== 0) return;
    if (p.roomDraw) {
      addSketchCorner(event.clientX, event.clientY, event.shiftKey);
      return;
    }
    if (p.drawMode) {
      interaction.current = { kind: "draw", startClient: { x: event.clientX, y: event.clientY }, moved: false };
      return;
    }
    interaction.current = {
      kind: "marquee",
      startClient: { x: event.clientX, y: event.clientY },
      additive: event.shiftKey,
      base: event.shiftKey ? p.selectedIds : [],
      moved: false
    };
  }

  function onObjectPointerDown(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    const p = latest.current;
    if (interaction.current) return;
    event.stopPropagation();
    // While its seats are being edited, a block stays put; chairs handle their own clicks.
    if (p.seatEdit?.id === id) return;
    if (p.roomDraw && event.button === 0 && !p.panActive) {
      addSketchCorner(event.clientX, event.clientY, event.shiftKey);
      return;
    }
    if (p.drawMode && event.button === 0 && !p.panActive) {
      interaction.current = { kind: "draw", startClient: { x: event.clientX, y: event.clientY }, moved: false };
      return;
    }
    if (event.button === 1 || p.panActive) {
      interaction.current = { kind: "pan", startClient: { x: event.clientX, y: event.clientY }, startPan: p.view.pan };
      return;
    }
    if (event.button !== 0) return;
    let ids = p.selectedIds;
    let collapseTo: string | null = null;
    if (event.shiftKey) {
      ids = ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id];
      p.onSelect(ids);
      if (!ids.includes(id)) return;
    } else if (!ids.includes(id)) {
      ids = [id];
      p.onSelect(ids);
    } else if (ids.length > 1) {
      collapseTo = id;
    }
    const start = new Map<string, FloorplanCanvasObject>();
    p.objects.forEach((o) => {
      // A locked room stays put, even when it's dragged along with other things.
      if (ids.includes(o.id) && !(o.type === "room" && o.locked)) start.set(o.id, o);
    });
    if (!start.size) return;
    interaction.current = {
      kind: "drag",
      ids,
      start,
      startPoint: toCanvas(event.clientX, event.clientY),
      startClient: { x: event.clientX, y: event.clientY },
      primaryId: id,
      moved: false,
      collapseTo
    };
  }

  function startHandle(event: ReactPointerEvent<HTMLDivElement>, kind: "resize" | "rotate", handle?: { sx: -1 | 1; sy: -1 | 1 }) {
    if (!single || interaction.current || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    interaction.current =
      kind === "resize" && handle
        ? { kind: "resize", id: single.id, handle, startObj: single, moved: false }
        : { kind: "rotate", id: single.id, startObj: single, moved: false };
  }

  /* ---------- rendering ---------- */

  const inv = 1 / view.zoom;

  // Scale bar: the longest "nice" length that stays under ~140 screen px at this zoom.
  const scaleBar = useMemo(() => {
    if (!unitsPerMetre) return null;
    const pxPerMetre = unitsPerMetre * view.zoom;
    let chosen = 0.5;
    for (const m of [0.5, 1, 2, 5, 10, 20, 50, 100]) if (m * pxPerMetre <= 140) chosen = m;
    return { px: chosen * pxPerMetre, label: `${chosen} m` };
  }, [unitsPerMetre, view.zoom]);

  const sizeChip = useMemo(() => {
    if (!single || !unitsPerMetre) return null;
    const box = objectBox(single);
    // Seating names print below the back row, so the readout goes below those.
    const b = single.type === "seating" ? objectPrintBounds(single) : objectBodyBounds(single);
    const fmt = (units: number) => {
      const m = units / unitsPerMetre;
      return m >= 10 ? m.toFixed(0) : m.toFixed(1);
    };
    const dims = box.round && box.w === box.h ? `Ø ${fmt(box.w)} m` : `${fmt(box.w)} × ${fmt(box.h)} m`;
    const text =
      single.type === "seating"
        ? `${seatingSeatCount(single)} seats · ${dims}`
        : single.type === "room"
          ? `${dims} · ${(polygonArea(single.points) / (unitsPerMetre * unitsPerMetre)).toFixed(0)} m²`
          : dims;
    // A room's readout sits in the middle of its floor, clear of any doors on the bottom wall.
    if (single.type === "room") return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, text };
    return { x: (b.minX + b.maxX) / 2, y: b.maxY, text };
  }, [single, unitsPerMetre]);
  const handleSize = 10 * inv;

  function renderObject(obj: FloorplanCanvasObject) {
    const box = objectBox(obj);
    const selected = selectedSet.has(obj.id);
    const wrapper: CSSProperties = {
      left: box.cx - box.w / 2,
      top: box.cy - box.h / 2,
      width: box.w,
      height: box.h,
      transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined
    };
    const common = {
      type: "button" as const,
      className: `fp-obj${selected ? " fp-obj--selected" : ""}`,
      onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => onObjectPointerDown(event, obj.id),
      // Selection is handled on pointerdown; this just keeps keyboard activation (Enter / Space) working.
      onKeyDown: (event: React.KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          latest.current.onSelect(event.shiftKey ? Array.from(new Set([...selectedIds, obj.id])) : [obj.id]);
        }
      }
    };

    if (obj.type === "room") {
      // Drawn as a path in the room's own box; only the walls take the pointer, so the floor inside stays
      // free for drawing a selection box.
      const ox = obj.x - (box.cx - box.w / 2);
      const oy = obj.y - (box.cy - box.h / 2);
      const d = `M ${obj.points.map((p) => `${p.x + ox} ${p.y + oy}`).join(" L ")} Z`;
      const wall = wallThickness(unitsPerMetre);
      const name = obj.name?.trim();
      const walls = roomWalls(obj);
      const local = { x: -(box.cx - box.w / 2), y: -(box.cy - box.h / 2) };
      const openings = roomOpenings(obj, walls);
      return (
        <button
          key={obj.id}
          {...common}
          className={`${common.className} fp-obj--outline fp-obj--room${obj.locked ? " fp-obj--locked" : ""}`}
          aria-label={name ? `Room: ${name}` : "Room"}
          style={wrapper}
        >
          <svg className="fp-room" width={box.w} height={box.h} viewBox={`0 0 ${box.w} ${box.h}`} aria-hidden="true">
            <path d={d} className="fp-room-floor" />
            <path d={wallRunsPath(obj, walls, (q) => ({ x: q.x + local.x, y: q.y + local.y }))} className="fp-room-wall" strokeWidth={wall} />
            {openings.map((g) => (
              <OpeningMark key={g.opening.id} g={g} wall={wall} inv={inv} offset={local} />
            ))}
            <path d={d} className="fp-room-hit" strokeWidth={Math.max(wall, 10 * inv)} />
          </svg>
          {name ? (
            <span className="fp-room-name" style={{ fontSize: 12 * inv, left: 6 * inv + wall / 2, top: 4 * inv + wall / 2 }}>
              {name}
            </span>
          ) : null}
        </button>
      );
    }

    if (obj.type === "table") {
      const seats = tableSeatCount(obj);
      const count = guestCountFor(obj.tableNumber, tableGuests);
      const status = colorByOccupancy && count != null ? occupancyStatus(seats, count) : "none";
      const fill = obj.fill ?? (status !== "none" ? OCCUPANCY_COLORS[status] : DEFAULT_FILLS.table);
      const chair = chairMetrics(obj);
      const inner = Math.min(box.w, box.h);
      const numberSize = Math.max(8, Math.min(16, inner * 0.3));
      const counter = box.rotation ? { transform: `rotate(${-box.rotation}deg)` } : undefined;
      // Show the printed name ("Top table") when there is one, shrunk to fit across the table.
      const caption = obj.label?.trim() || obj.tableNumber;
      // The label is counter-rotated to stay level, so on a table turned on its side it runs along the depth.
      const sideways = Math.abs(Math.sin((box.rotation * Math.PI) / 180)) > 0.7;
      const across = tableShape(obj) === "round" ? box.w * 0.8 : (sideways ? box.h : box.w) * 0.92;
      const captionSize = Math.max(5, Math.min(numberSize, across / (Math.max(1, caption.length) * 0.62)));
      return (
        <button
          key={obj.id}
          {...common}
          aria-label={`Table ${obj.tableNumber}${obj.label ? `, ${obj.label}` : ""}`}
          style={wrapper}
        >
          {seatOffsets(obj).map((off, i) => (
            <span
              key={i}
              className="fp-chair"
              style={{
                left: box.w / 2 + off.x - chair.radius,
                top: box.h / 2 + off.y - chair.radius,
                width: chair.radius * 2,
                height: chair.radius * 2
              }}
            />
          ))}
          <span
            className="fp-body"
            style={{ background: fill, borderRadius: tableShape(obj) === "round" ? "50%" : 3 }}
          />
          <span className="fp-label" style={{ ...counter, fontSize: numberSize }}>
            <span style={{ fontSize: captionSize }}>{caption}</span>
            {count != null ? (
              <span className="fp-sublabel" style={{ fontSize: Math.max(6, numberSize * 0.7) }}>
                {count}/{seats}
              </span>
            ) : null}
          </span>
        </button>
      );
    }

    if (obj.type === "seating") {
      const back = Math.max(0.6, obj.chairDepth * 0.22);
      const band = seatingNameBand(obj);
      const name = obj.name?.trim();
      const count = seatingSeatCount(obj);
      const editing = props.seatEdit?.id === obj.id ? props.seatEdit : null;
      const startPaint = (event: ReactPointerEvent<SVGElement>, key: string, current: SeatState) => {
        if (!editing || event.button !== 0) return;
        event.stopPropagation();
        event.preventDefault();
        // Alt / Option swaps the tool for one stroke.
        const tool = event.altKey ? (editing.tool === "remove" ? "wheelchair" : "remove") : editing.tool;
        const state: SeatState =
          tool === "wheelchair" ? (current === "wheelchair" ? "chair" : "wheelchair") : current === "chair" ? "removed" : "chair";
        strokeCount.current += 1;
        paint.current = { id: obj.id, state, stroke: strokeCount.current };
        latest.current.onSeatPaint?.(obj.id, key, state, strokeCount.current);
      };
      const continuePaint = (key: string, current: SeatState) => {
        const stroke = paint.current;
        if (!stroke || stroke.id !== obj.id || current === stroke.state) return;
        latest.current.onSeatPaint?.(obj.id, key, stroke.state, stroke.stroke);
      };
      return (
        <button
          key={obj.id}
          {...common}
          className={`${common.className} fp-obj--seating${editing ? " fp-obj--editing" : ""}`}
          aria-label={`${name || "Seating block"}, ${count} seats`}
          style={wrapper}
          onDoubleClick={(event) => {
            event.stopPropagation();
            latest.current.onEditSeats?.(obj.id);
          }}
        >
          <svg className="fp-seating" width={box.w} height={box.h} viewBox={`0 0 ${box.w} ${box.h}`} aria-hidden="true">
            {seatingPositions(obj).map((seat) => {
              if (seat.state === "removed" && !editing) return null;
              const key = seatKey(seat.row, seat.seat);
              const x = box.w / 2 + seat.x - obj.chairWidth / 2;
              const y = box.h / 2 + seat.y - obj.chairDepth / 2;
              const handlers = editing
                ? {
                    onPointerDown: (event: ReactPointerEvent<SVGGElement>) => startPaint(event, key, seat.state),
                    onPointerEnter: () => continuePaint(key, seat.state),
                    style: { pointerEvents: "all" as const, cursor: "pointer" }
                  }
                : {};
              // Curved and chevron rows: each chair turned about its centre.
              const turn = seat.angle ? `rotate(${seat.angle} ${x + obj.chairWidth / 2} ${y + obj.chairDepth / 2})` : undefined;
              if (seat.state === "removed") {
                return (
                  <g key={key} {...handlers}>
                    <rect
                      x={x}
                      y={y}
                      width={obj.chairWidth}
                      height={obj.chairDepth}
                      rx={obj.chairWidth * 0.12}
                      className="fp-seat-gone"
                      transform={turn}
                    />
                  </g>
                );
              }
              if (seat.state === "wheelchair") {
                const size = Math.min(obj.chairWidth, obj.chairDepth);
                return (
                  <g key={key} {...handlers}>
                    <rect
                      x={x}
                      y={y}
                      width={obj.chairWidth}
                      height={obj.chairDepth}
                      rx={obj.chairWidth * 0.12}
                      className="fp-seat-wc"
                      transform={turn}
                    />
                    <WheelchairMark cx={x + obj.chairWidth / 2} cy={y + obj.chairDepth / 2} size={size * 0.85} />
                  </g>
                );
              }
              return (
                <g key={key} {...handlers} transform={turn}>
                  <rect x={x} y={y} width={obj.chairWidth} height={obj.chairDepth} rx={obj.chairWidth * 0.12} className="fp-seat" />
                  <rect x={x} y={y + obj.chairDepth - back} width={obj.chairWidth} height={back} className="fp-seat-back" />
                </g>
              );
            })}
          </svg>
          {name ? (
            <span
              className="fp-seating-name"
              style={{
                top: box.h,
                height: band,
                fontSize: Math.max(5, Math.min(14, band * 0.75)),
                // Keep the name the right way up when the block faces down or sideways.
                transform: box.rotation ? `rotate(${-box.rotation}deg)` : undefined
              }}
            >
              {name}
            </span>
          ) : null}
        </button>
      );
    }

    if (obj.type === "rect" || obj.type === "circle") {
      const fill = obj.fill === "none" ? "transparent" : (obj.fill ?? (obj.type === "rect" ? DEFAULT_FILLS.rect : DEFAULT_FILLS.circle));
      const counter = box.rotation ? { transform: `rotate(${-box.rotation}deg)` } : undefined;
      // An outline-only rectangle (e.g. the room) is grabbed by its edges, so the floor inside stays
      // free for drawing a selection box.
      const outlineOnly = obj.type === "rect" && obj.fill === "none";
      const edge = 8 * inv;
      return (
        <button
          key={obj.id}
          {...common}
          className={`${common.className}${outlineOnly ? " fp-obj--outline" : ""}`}
          aria-label={obj.label || (obj.type === "rect" ? "Rectangle" : "Circle")}
          style={wrapper}
        >
          <span
            className="fp-body"
            style={{ background: fill, borderRadius: obj.type === "circle" ? "50%" : 2, borderColor: OUTLINE_COLOR }}
          />
          {outlineOnly
            ? [
                { left: -edge / 2, top: -edge / 2, width: box.w + edge, height: edge },
                { left: -edge / 2, top: box.h - edge / 2, width: box.w + edge, height: edge },
                { left: -edge / 2, top: -edge / 2, width: edge, height: box.h + edge },
                { left: box.w - edge / 2, top: -edge / 2, width: edge, height: box.h + edge }
              ].map((style, i) => <span key={i} className="fp-edge" style={style} />)
            : null}
          {obj.label ? (
            <span className="fp-label fp-label--shape" style={{ ...counter, fontSize: Math.max(7, Math.min(16, Math.min(box.w, box.h) * 0.4)) }}>
              {obj.label}
            </span>
          ) : null}
        </button>
      );
    }

    return (
      <button
        key={obj.id}
        {...common}
        aria-label={`Text: ${obj.text}`}
        style={{
          ...wrapper,
          fontSize: obj.fontSize,
          fontWeight: obj.bold ? 700 : 500,
          color: obj.color ?? TEXT_DEFAULT_COLOR
        }}
      >
        <span className="fp-text">{obj.text}</span>
      </button>
    );
  }

  function renderRoomOverlay(room: FloorplanRoomObject) {
    const world = roomWorldPoints(room);
    const lengths = wallLengths(world);
    const labelOffsets = wallLabelOffsets(room, 24 * inv);
    const hs = handleSize;
    const editable = !room.locked;
    return (
      <>
        <svg className="fp-room-overlay" width={1} height={1} aria-hidden="true">
          <path d={`M ${world.map((p) => `${p.x} ${p.y}`).join(" L ")} Z`} strokeWidth={1.5 * inv} />
        </svg>
        {roomWalls(room).map((w, i) => {
          // Clear of any doors and windows on the wall, so neither hides the other.
          const along = labelOffsets[i];
          const mid = { x: w.a.x + w.ux * along, y: w.a.y + w.uy * along };
          // The length sits just outside the wall; the add-a-corner dot just inside.
          const out = 14 * inv;
          return (
            <div key={`len-${i}`}>
              <div
                className="fp-wall-length"
                style={{ left: mid.x - w.nx * out, top: mid.y - w.ny * out, transform: `translate(-50%, -50%) scale(${inv})` }}
              >
                {formatLength(lengths[i], unitsPerMetre)}
              </div>
              {editable && lengths[i] * view.zoom > 60 ? (
                <div
                  className="fp-handle fp-handle--add"
                  title="Drag to add a corner"
                  style={{
                    width: hs * 0.8,
                    height: hs * 0.8,
                    borderWidth: inv,
                    left: mid.x + w.nx * out - hs * 0.4,
                    top: mid.y + w.ny * out - hs * 0.4
                  }}
                  onPointerDown={(e) => startCorner(e, room, i, true)}
                />
              ) : null}
            </div>
          );
        })}
        {roomOpenings(room).map((g) => {
          const selected = props.openingId === g.opening.id;
          const along = (Math.atan2(g.wall.uy, g.wall.ux) * 180) / Math.PI;
          return (
            <div
              key={`opening-${g.opening.id}`}
              className={`fp-handle fp-handle--opening${selected ? " fp-handle--opening-on" : ""}`}
              title={editable ? "Click to edit · drag along the walls to move" : "Click to edit"}
              style={{
                width: Math.max(hs * 1.4, g.width),
                height: hs * 0.9,
                borderWidth: inv,
                left: g.centre.x - Math.max(hs * 1.4, g.width) / 2,
                top: g.centre.y - hs * 0.45,
                transform: `rotate(${along}deg)`,
                cursor: editable ? "grab" : "pointer"
              }}
              onPointerDown={(e) => startOpening(e, room, g.opening.id)}
            />
          );
        })}
        {editable
          ? world.map((p, i) => (
              <div
                key={`corner-${i}`}
                className="fp-handle fp-handle--corner"
                title={room.points.length > 3 ? "Drag to move this corner · double-click to take it out" : "Drag to move this corner"}
                style={{ width: hs, height: hs, borderWidth: inv, left: p.x - hs / 2, top: p.y - hs / 2 }}
                onPointerDown={(e) => startCorner(e, room, i, false)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  deleteCorner(room, i);
                }}
              />
            ))
          : null}
      </>
    );
  }

  function renderSketch() {
    if (!props.roomDraw) return null;
    const { points, hover, typed } = sketch;
    if (!points.length && !hover) return null;
    const last = points[points.length - 1];
    const live = hover && last && typed && parseFloat(typed) > 0
      ? pointAlong(last, hover, unitsPerMetre ? parseFloat(typed) * unitsPerMetre : parseFloat(typed))
      : hover;
    const all = live ? [...points, live] : points;
    const closing = points.length >= 3 && live === points[0];
    const seg = last && live ? { a: last, b: live } : null;
    return (
      <>
        <svg className="fp-sketch" width={1} height={1} aria-hidden="true">
          {all.length > 1 ? <polyline points={all.map((p) => `${p.x},${p.y}`).join(" ")} strokeWidth={2 * inv} /> : null}
          {points.length >= 2 && !closing && live ? (
            <line
              className="fp-sketch-close"
              x1={live.x}
              y1={live.y}
              x2={points[0].x}
              y2={points[0].y}
              strokeWidth={inv}
              strokeDasharray={`${5 * inv} ${4 * inv}`}
            />
          ) : null}
          {points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={(i === 0 && points.length >= 3 ? 5 : 3.5) * inv} className={i === 0 ? "fp-sketch-first" : undefined} />
          ))}
          {live ? <circle cx={live.x} cy={live.y} r={3 * inv} className="fp-sketch-cursor" /> : null}
        </svg>
        {seg ? (
          <div
            className={`fp-wall-length fp-wall-length--live${typed ? " fp-wall-length--typed" : ""}`}
            style={{
              left: (seg.a.x + seg.b.x) / 2,
              top: (seg.a.y + seg.b.y) / 2,
              transform: `translate(-50%, -140%) scale(${inv})`,
              transformOrigin: "bottom center"
            }}
          >
            {typed ? `${typed}${unitsPerMetre ? " m" : ""}` : formatLength(Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y), unitsPerMetre)}
          </div>
        ) : null}
      </>
    );
  }

  function renderOverlay() {
    if (single?.type === "room") return renderRoomOverlay(single);
    if (single) {
      const box = objectBox(single);
      const resizable = single.type !== "text";
      const rotatable =
        single.type === "rect" ||
        single.type === "text" ||
        single.type === "seating" ||
        (single.type === "table" && (tableShape(single) === "rect" || (single.seatSpan ?? 360) < 360));
      const corners: Array<{ sx: -1 | 1; sy: -1 | 1 }> = [
        { sx: -1, sy: -1 },
        { sx: 1, sy: -1 },
        { sx: 1, sy: 1 },
        { sx: -1, sy: 1 }
      ];
      const cursorFor = (sx: number, sy: number) => (sx * sy > 0 ? "nwse-resize" : "nesw-resize");
      const hs = handleSize;
      return (
        <div
          className="fp-overlay"
          style={{
            left: box.cx - box.w / 2,
            top: box.cy - box.h / 2,
            width: box.w,
            height: box.h,
            transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
            borderWidth: 1.5 * inv,
            borderRadius: box.round ? "50%" : 0
          }}
        >
          {resizable
            ? corners.map(({ sx, sy }) => {
                // On round shapes the handle sits on the circle's 45° points rather than the square's corners.
                const round = box.round && box.w === box.h;
                const ox = round ? (sx * box.w * (1 - Math.SQRT1_2)) / 2 : 0;
                const oy = round ? (sy * box.h * (1 - Math.SQRT1_2)) / 2 : 0;
                return (
                  <div
                    key={`${sx}${sy}`}
                    className="fp-handle"
                    style={{
                      width: hs,
                      height: hs,
                      borderWidth: inv,
                      left: (sx < 0 ? 0 : box.w) - hs / 2 - ox,
                      top: (sy < 0 ? 0 : box.h) - hs / 2 - oy,
                      cursor: cursorFor(sx, sy)
                    }}
                    onPointerDown={(e) => startHandle(e, "resize", { sx, sy })}
                  />
                );
              })
            : null}
          {rotatable ? (
            <>
              <div className="fp-stem" style={{ width: 1.5 * inv, height: 20 * inv, left: box.w / 2, top: -20 * inv }} />
              <div
                className="fp-handle fp-handle--rotate"
                style={{ width: hs * 1.2, height: hs * 1.2, borderWidth: inv, left: box.w / 2 - hs * 0.6, top: -20 * inv - hs * 1.2 }}
                onPointerDown={(e) => startHandle(e, "rotate")}
                title="Rotate (hold Shift for free rotation)"
              />
            </>
          ) : null}
        </div>
      );
    }
    if (multiBounds) {
      return (
        <div
          className="fp-overlay fp-overlay--multi"
          style={{
            left: multiBounds.minX,
            top: multiBounds.minY,
            width: multiBounds.maxX - multiBounds.minX,
            height: multiBounds.maxY - multiBounds.minY,
            borderWidth: 1.5 * inv
          }}
        />
      );
    }
    return null;
  }

  return (
    <div
      ref={viewportRef}
      className={`editor-canvas${props.panActive ? " editor-canvas--pan" : ""}${props.drawMode || props.roomDraw ? " editor-canvas--draw" : ""}`}
      style={{
        backgroundSize: `${gridSize * view.zoom}px ${gridSize * view.zoom}px`,
        backgroundPosition: `${view.pan.x}px ${view.pan.y}px`
      }}
      onPointerDownCapture={onViewportPointerDownCapture}
      onPointerDown={onBackgroundPointerDown}
    >
      <div
        className="fp-world"
        style={{ transform: `translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.zoom})` }}
      >
        {frame ? (
          <div
            className="fp-frame"
            style={{
              left: frame.minX,
              top: frame.minY,
              width: frame.maxX - frame.minX,
              height: frame.maxY - frame.minY,
              borderWidth: 1.5 * inv
            }}
          >
            <span className="fp-frame-label" style={{ fontSize: 11 * inv, top: -16 * inv }}>
              {frameLabel}
            </span>
          </div>
        ) : null}
        {objects.map(renderObject)}
        {props.highlight ? (
          <svg className="fp-highlight" width={1} height={1} aria-hidden="true">
            {props.highlight.polygons.map((poly, i) => (
              <polygon
                key={i}
                points={poly.map((p) => `${p.x},${p.y}`).join(" ")}
                strokeWidth={2 * inv}
                strokeDasharray={`${6 * inv} ${4 * inv}`}
              />
            ))}
            {props.highlight.line ? (
              <>
                <line
                  className="fp-highlight-line"
                  x1={props.highlight.line[0].x}
                  y1={props.highlight.line[0].y}
                  x2={props.highlight.line[1].x}
                  y2={props.highlight.line[1].y}
                  strokeWidth={2 * inv}
                />
                {props.highlight.line.map((p, i) => (
                  <circle key={i} className="fp-highlight-end" cx={p.x} cy={p.y} r={3.5 * inv} />
                ))}
              </>
            ) : null}
          </svg>
        ) : null}
        {props.highlight?.label ? (
          <HighlightLabel highlight={props.highlight} inv={inv} />
        ) : null}
        {renderOverlay()}
        {renderSketch()}
        {sizeChip ? (
          <div
            className="fp-size-chip"
            style={{ left: sizeChip.x, top: sizeChip.y + 8 * inv, transform: `translateX(-50%) scale(${inv})`, transformOrigin: "top center" }}
          >
            {sizeChip.text}
          </div>
        ) : null}
        {guides.map((g, i) => (
          <div
            key={i}
            className="fp-guide"
            style={
              g.axis === "x"
                ? { left: g.pos, top: g.from, width: inv, height: g.to - g.from }
                : { left: g.from, top: g.pos, width: g.to - g.from, height: inv }
            }
          />
        ))}
      </div>
      {scaleBar ? (
        <div className="fp-scalebar" aria-hidden>
          <span className="fp-scalebar-line" style={{ width: scaleBar.px }} />
          <span>{scaleBar.label}</span>
        </div>
      ) : null}
      {marquee ? (
        <div
          className={`fp-marquee${props.drawMode ? " fp-marquee--draw" : ""}`}
          style={{ left: marquee.x0, top: marquee.y0, width: marquee.x1 - marquee.x0, height: marquee.y1 - marquee.y0 }}
        />
      ) : null}
      {props.roomDraw ? (
        <div className="fp-draw-hint">
          {sketch.points.length === 0
            ? "Click to place the first corner of the room"
            : `Click to add corners · type a length${unitsPerMetre ? " in metres" : ""} and press Enter · ${
                sketch.points.length >= 3 ? "Enter or click the first corner to finish · " : ""
              }Backspace takes a corner back · Shift for any angle · Esc cancels`}
        </div>
      ) : objects.length === 0 ? (
        <div className="editor-canvas-empty">{props.emptyHint}</div>
      ) : null}
    </div>
  );
}

/** The measurement's value, by the dimension line or above the first outlined shape. */
function HighlightLabel({ highlight, inv }: { highlight: Highlight; inv: number }) {
  let at: Point | null = null;
  if (highlight.line) {
    at = { x: (highlight.line[0].x + highlight.line[1].x) / 2, y: (highlight.line[0].y + highlight.line[1].y) / 2 };
  } else if (highlight.polygons[0]?.length) {
    const poly = highlight.polygons[0];
    at = { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: Math.min(...poly.map((p) => p.y)) };
  }
  if (!at) return null;
  return (
    <div
      className="fp-highlight-label"
      style={{ left: at.x, top: at.y, transform: `translate(-50%, -120%) scale(${inv})`, transformOrigin: "bottom center" }}
    >
      {highlight.label}
    </div>
  );
}

/** A door (leaf and swing), window or opening drawn in the gap in a room's wall. */
function OpeningMark({ g, wall, inv, offset }: { g: OpeningGeometry; wall: number; inv: number; offset: Point }) {
  const o = g.opening;
  const p = (q: Point) => ({ x: q.x + offset.x, y: q.y + offset.y });
  const a = p(g.start);
  const b = p(g.end);
  const n = { x: g.wall.nx, y: g.wall.ny };
  const cls = `fp-opening${o.exit ? " fp-opening--exit" : ""}`;
  const label = o.label?.trim() || (o.exit ? "Exit" : "");
  // Labels go outside the room, beyond the wall.
  const away = wall + 9 * inv + outsideReach(g);
  const labelAt = p({ x: g.centre.x - n.x * away, y: g.centre.y - n.y * away });
  return (
    <g className={cls}>
      {/* Jambs: short ticks across the wall at each side of the gap. */}
      {[a, b].map((q, i) => (
        <line
          key={i}
          x1={q.x - (n.x * wall) / 2}
          y1={q.y - (n.y * wall) / 2}
          x2={q.x + (n.x * wall) / 2}
          y2={q.y + (n.y * wall) / 2}
          className="fp-opening-jamb"
          strokeWidth={Math.max(0.8, wall * 0.35)}
        />
      ))}
      {o.kind === "window" ? (
        <>
          <polygon
            points={[
              { x: a.x - (n.x * wall) / 2, y: a.y - (n.y * wall) / 2 },
              { x: b.x - (n.x * wall) / 2, y: b.y - (n.y * wall) / 2 },
              { x: b.x + (n.x * wall) / 2, y: b.y + (n.y * wall) / 2 },
              { x: a.x + (n.x * wall) / 2, y: a.y + (n.y * wall) / 2 }
            ]
              .map((q) => `${q.x},${q.y}`)
              .join(" ")}
            className="fp-window"
            strokeWidth={Math.max(0.5, wall * 0.15)}
          />
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="fp-window-glass" strokeWidth={Math.max(0.5, wall * 0.15)} />
        </>
      ) : null}
      {g.leaves.map((leaf, i) => (
        <path key={i} d={doorLeafPath(leaf, p)} className="fp-door" strokeWidth={Math.max(0.6, wall * 0.25)} />
      ))}
      {label ? (
        <text x={labelAt.x} y={labelAt.y} className="fp-opening-label" fontSize={10 * inv} textAnchor="middle" dominantBaseline="middle">
          {label}
        </text>
      ) : null}
    </g>
  );
}
