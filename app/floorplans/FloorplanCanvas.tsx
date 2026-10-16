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
import type { FloorplanCanvasObject } from "@/types";

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
  | { kind: "resize"; id: string; handle: { sx: -1 | 1; sy: -1 | 1 }; startObj: FloorplanCanvasObject; moved: boolean }
  | { kind: "rotate"; id: string; startObj: FloorplanCanvasObject; moved: boolean }
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
  onLive: (objects: FloorplanCanvasObject[]) => void;
  emptyHint: ReactNode;
}

function snapTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function FloorplanCanvas(props: Props) {
  const { objects, selectedIds, gridSize, view, viewportRef, frame, frameLabel, tableGuests, colorByOccupancy, unitsPerMetre } = props;
  const latest = useRef(props);
  latest.current = props;
  const interaction = useRef<Interaction | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

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
      if (!act) return;
      const p = latest.current;

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
            return bb.minX < box.maxX && bb.maxX > box.minX && bb.minY < box.maxY && bb.maxY > box.minY;
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
        const snap = p.snapToGrid && !event.shiftKey ? Math.max(1, p.gridSize / 2) : 0;
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
      const act = interaction.current;
      if (!act) return;
      if (act.kind === "pinch") {
        if (pointers.current.size < 2) interaction.current = null;
        return;
      }
      if (act.kind === "drag" && !act.moved && act.collapseTo) latest.current.onSelect([act.collapseTo]);
      if (act.kind === "marquee" && !act.moved && !act.additive) latest.current.onSelect([]);
      interaction.current = null;
      setGuides([]);
      setMarquee(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
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
      if (ids.includes(o.id)) start.set(o.id, o);
    });
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
    const b = objectBodyBounds(single);
    const fmt = (units: number) => {
      const m = units / unitsPerMetre;
      return m >= 10 ? m.toFixed(0) : m.toFixed(1);
    };
    const text = box.round && box.w === box.h ? `Ø ${fmt(box.w)} m` : `${fmt(box.w)} × ${fmt(box.h)} m`;
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

    if (obj.type === "table") {
      const seats = tableSeatCount(obj);
      const count = guestCountFor(obj.tableNumber, tableGuests);
      const status = colorByOccupancy && count != null ? occupancyStatus(seats, count) : "none";
      const fill = obj.fill ?? (status !== "none" ? OCCUPANCY_COLORS[status] : DEFAULT_FILLS.table);
      const chair = chairMetrics(obj);
      const inner = Math.min(box.w, box.h);
      const numberSize = Math.max(8, Math.min(16, inner * 0.3));
      const counter = box.rotation ? { transform: `rotate(${-box.rotation}deg)` } : undefined;
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
            <span>{obj.tableNumber}</span>
            {count != null ? (
              <span className="fp-sublabel" style={{ fontSize: Math.max(6, numberSize * 0.7) }}>
                {count}/{seats}
              </span>
            ) : null}
          </span>
        </button>
      );
    }

    if (obj.type === "rect" || obj.type === "circle") {
      const fill = obj.fill === "none" ? "transparent" : (obj.fill ?? (obj.type === "rect" ? DEFAULT_FILLS.rect : DEFAULT_FILLS.circle));
      const counter = box.rotation ? { transform: `rotate(${-box.rotation}deg)` } : undefined;
      return (
        <button
          key={obj.id}
          {...common}
          aria-label={obj.label || (obj.type === "rect" ? "Rectangle" : "Circle")}
          style={wrapper}
        >
          <span
            className="fp-body"
            style={{ background: fill, borderRadius: obj.type === "circle" ? "50%" : 2, borderColor: OUTLINE_COLOR }}
          />
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

  function renderOverlay() {
    if (single) {
      const box = objectBox(single);
      const resizable = single.type !== "text";
      const rotatable =
        single.type === "rect" ||
        single.type === "text" ||
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
      className={`editor-canvas${props.panActive ? " editor-canvas--pan" : ""}`}
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
        {renderOverlay()}
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
          className="fp-marquee"
          style={{ left: marquee.x0, top: marquee.y0, width: marquee.x1 - marquee.x0, height: marquee.y1 - marquee.y0 }}
        />
      ) : null}
      {objects.length === 0 ? <div className="editor-canvas-empty">{props.emptyHint}</div> : null}
    </div>
  );
}
