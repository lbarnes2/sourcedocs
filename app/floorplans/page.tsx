"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Armchair,
  BringToFront,
  CircleCheck,
  CircleDot,
  CircleHelp,
  Copy,
  CopyPlus,
  Download,
  Ellipsis,
  Eraser,
  FilePlus,
  FolderOpen,
  Frame,
  Grid3x3,
  Hand,
  Hash,
  LayoutGrid,
  ListOrdered,
  Loader2,
  Maximize,
  MousePointer2,
  Printer,
  Redo2,
  Rows3,
  Ruler,
  Save,
  SendToBack,
  Settings2,
  Shapes,
  SquareDashedMousePointer,
  Trash2,
  TriangleAlert,
  Type,
  Undo2,
  Users,
  WandSparkles,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { LogoPicker } from "@/app/components/LogoPicker";
import { Callout, Field, Modal, PageHeader, Section, Segmented, Switch, Toasts } from "@/app/components/ui";
import { FloorplanCanvas, type CanvasView, clampZoom } from "@/app/floorplans/FloorplanCanvas";
import { Inspector } from "@/app/floorplans/Inspector";
import { PlanPanel } from "@/app/floorplans/PlanPanel";
import { MenuButton, MenuItem, MenuLabel, MenuPanel, MenuSeparator } from "@/app/floorplans/Menu";
import { buildMeasurements, type Measurement } from "@/lib/floorplans/measure";
import { NumericInput } from "@/app/floorplans/NumericInput";
import { MAX_FLOORPLAN_GRID } from "@/lib/validation/limits";
import { OBJECT_PRESETS } from "@/app/floorplans/presets";
import { buildPlanIssues, planTotals, type PlanIssue } from "@/lib/floorplans/checks";
import { findFreeCentre, seatsBlocked } from "@/lib/floorplans/collision";
import { CHAIR_PRESETS, CHEVRON_MAX_ANGLE, ROW_SHAPES, seatingRowLengths, withSeatState, type RowShape, type SeatState } from "@/lib/floorplans/seating";
import {
  GENERATED_SEATING_ID,
  MAX_THEATRE_SEATS,
  buildTheatreLayout,
  fillAreaWithSeating,
  findStage,
  resolveTheatreSettings,
  theatreRows,
  type FillArea,
  type TheatreFacing
} from "@/lib/floorplans/theatre";
import {
  DEFAULT_UNITS_PER_METRE,
  MAX_TABLE_SEATS,
  ROUND_TABLE_SIZES,
  type RoundTableSize,
  FIXED_SCALE_OPTIONS,
  fixedPointsPerUnit,
  nextTableNumber,
  objectBodyBounds,
  objectBox,
  objectsPrintBounds,
  printFit,
  printLayout,
  rotatePoint,
  recommendedRadius,
  recommendedRectSize,
  resolvePrintOptions,
  tableSeatCount,
  tableShape,
  withCentre,
  type Bounds
} from "@/lib/floorplans/geometry";
import { buildTableGuests, guestCountFor, naturalTableCompare, type TableGuestMap } from "@/lib/floorplans/guests";
import {
  buildEmptyFloorplanDraft,
  buildTablesFromAutoLayout,
  copyForDuplicate,
  type TableStyle
} from "@/lib/floorplans/model";
import { PAPER_SIZE_OPTIONS } from "@/lib/paperSizes";
import { readResponseError } from "@/lib/http/readError";
import { downloadBlob, downloadPdfBlobAsPngs } from "@/lib/pdf/pdfToPngExport";
import type {
  FloorplanCanvasObject,
  FloorplanDocument,
  FloorplanListItem,
  FloorplanPrintOptions,
  FloorplanTableObject,
  GuestRecord,
  ProjectListItem
} from "@/types";

const PAPER_OPTIONS = PAPER_SIZE_OPTIONS.map((o) => ({ value: o.value, label: o.value }));
const ORIENTATION_OPTIONS = [
  { value: "portrait" as const, label: "Portrait" },
  { value: "landscape" as const, label: "Landscape" }
];
const STYLE_OPTIONS: Array<{ value: TableStyle; label: string; title: string }> = [
  { value: "round", label: "Round", title: "Round tables with chairs all the way round" },
  { value: "cabaret", label: "Cabaret", title: "Round tables seated on the side facing the stage (stage at the top)" },
  { value: "long", label: "Long", title: "Long rectangular tables seated on both sides" }
];

/** Which add menu each preset lives in; the seating block and text label have their own places. */
const TABLE_PRESET_IDS = ["round-6ft", "round-5ft", "rect-table", "top-table"];
const ROOM_PRESET_IDS = ["room", "stage", "dance-floor", "bar", "buffet", "entrance", "av-desk", "pillar"];

const SHORTCUTS: Array<[string, string]> = [
  ["Drag", "Move (Shift-drag moves off the grid)"],
  ["Drag the background", "Select everything in a box"],
  ["Space-drag", "Pan"],
  ["⌘/Ctrl-scroll", "Zoom"],
  ["Arrow keys", "Nudge (with Shift: one grid square)"],
  ["⌘Z / ⇧⌘Z", "Undo / redo"],
  ["⌘C / ⌘V / ⌘D", "Copy / paste / duplicate"],
  ["⌘A", "Select everything"],
  ["Delete", "Delete the selection"],
  ["V / H / F", "Select, hand, fill an area"],
  ["A", "Auto layout"],
  ["⌘S / ⌘P", "Save / print and export"],
  ["Esc", "Deselect, or stop what you're doing"]
];

const AUTOSAVE_KEY = "floorplan-autosave-v1";
const MAX_HISTORY = 100;
const MAX_GRID = MAX_FLOORPLAN_GRID;
const MAX_GENERATED_TABLES = 400;
const UNTITLED = "Untitled floorplan";
/** Ids Auto layout gives its tables ("table-12", "table-top"); anything else was placed by hand. */
const GENERATED_ID = /^table-/;

/** Corners of a fill area, for outlining it on the canvas. */
function areaPolygon(area: FillArea) {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1]
  ].map(([sx, sy]) => {
    const p = rotatePoint({ x: (sx * area.w) / 2, y: (sy * area.h) / 2 }, area.rotation);
    return { x: area.cx + p.x, y: area.cy + p.y };
  });
}

/** The smallest grid (keeping the column count where possible) that fits `count` tables, or null if it already fits. */
function growGridToFit(count: number, rows: number, columns: number): { rows: number; columns: number } | null {
  if (count <= rows * columns) return null;
  let cols = columns;
  if (Math.ceil(count / cols) > MAX_GRID) cols = Math.min(MAX_GRID, Math.ceil(count / MAX_GRID));
  return { rows: Math.min(MAX_GRID, Math.ceil(count / cols)), columns: cols };
}

type Library = { loaded: boolean; configured: boolean; items: Array<{ key: string; label: string; assetUrl: string }> };
const EMPTY_LIBRARY: Library = { loaded: false, configured: false, items: [] };

type Autosave = { doc: FloorplanDocument; at: string };

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read image."));
    reader.readAsDataURL(blob);
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "earlier" : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export default function FloorplansPage() {
  const [draft, setDraft] = useState<FloorplanDocument>(() => buildEmptyFloorplanDraft());
  const draftRef = useRef(draft);
  const pastRef = useRef<FloorplanDocument[]>([]);
  const futureRef = useRef<FloorplanDocument[]>([]);
  const coalesceRef = useRef<{ key: string | null; at: number }>({ key: null, at: 0 });
  const [historySize, setHistorySize] = useState({ undo: 0, redo: 0 });
  const [dirty, setDirty] = useState(false);

  const [items, setItems] = useState<FloorplanListItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<CanvasView>({ zoom: 1, pan: { x: 0, y: 0 } });
  const [panTool, setPanTool] = useState(false);
  /** Drawing a rectangle to fill with seating. */
  const [drawMode, setDrawMode] = useState(false);
  const [fillPrompt, setFillPrompt] = useState<{
    area: FillArea;
    marginM: number;
    facing: TheatreFacing;
    /** The shape being filled, which isn't in the way of its own seating. */
    shapeId?: string;
  } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [showFrame, setShowFrame] = useState(true);
  const showFrameRef = useRef(true);
  showFrameRef.current = showFrame;
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const [outputFormat, setOutputFormat] = useState<"pdf" | "png">("pdf");
  const [listOpen, setListOpen] = useState(false);
  const [listQuery, setListQuery] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const previewSeqRef = useRef(0);
  const [printOpen, setPrintOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [venueLogoLibrary, setVenueLogoLibrary] = useState<Library>(EMPTY_LIBRARY);
  const [clientLogoLibrary, setClientLogoLibrary] = useState<Library>(EMPTY_LIBRARY);

  // Auto layout form
  // Saved with the plan (doc.autoLayout); older plans fall back to these defaults.
  const tableCount = draft.autoLayout.tableCount ?? 12;
  const roundSize: RoundTableSize = draft.autoLayout.roundSize ?? "6ft";
  const seatsPerTable = draft.autoLayout.seatsPerTable ?? ROUND_TABLE_SIZES[roundSize].seats;
  const tableStyle: TableStyle = draft.autoLayout.tableStyle ?? "round";
  const withTopTable = draft.autoLayout.topTable ?? false;
  const useGuestNumbers = draft.autoLayout.useGuestNumbers ?? true;
  const generator = draft.autoLayout.generator ?? "tables";
  const theatre = resolveTheatreSettings(draft.autoLayout.theatre);

  // Guest list link
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [guestRecords, setGuestRecords] = useState<GuestRecord[] | null>(null);
  const [guestsLoading, setGuestsLoading] = useState(false);

  const [recovered, setRecovered] = useState<Autosave | null>(null);
  /** Which generator is asking before it replaces things, and whether to clear the other kind too. */
  const [generatePrompt, setGeneratePrompt] = useState<"tables" | "theatre" | null>(null);
  const [removeOther, setRemoveOther] = useState(false);
  /** Editing the chairs of one seating block: clicking a chair takes it out or marks a wheelchair space. */
  const [seatEdit, setSeatEdit] = useState<{ id: string; tool: "remove" | "wheelchair" } | null>(null);
  /** A short-lived note about something that just happened. */
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  /** The Plan panel measurement being pointed out on the canvas. */
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const clipboardRef = useRef<{ objects: FloorplanCanvasObject[]; pastes: number } | null>(null);

  /* ---------- derived ---------- */

  const objects = draft.objects;
  const validSelected = useMemo(() => {
    const ids = new Set(objects.map((o) => o.id));
    return selectedIds.filter((id) => ids.has(id));
  }, [objects, selectedIds]);
  const primary = useMemo(
    () => objects.find((o) => o.id === validSelected[validSelected.length - 1]) ?? null,
    [objects, validSelected]
  );
  const print = resolvePrintOptions(draft.print);
  const unitsPerMetre = draft.canvas.unitsPerMetre && draft.canvas.unitsPerMetre > 0 ? draft.canvas.unitsPerMetre : null;
  const tableGuests: TableGuestMap | null = useMemo(
    () => (guestRecords ? buildTableGuests(guestRecords) : null),
    [guestRecords]
  );
  const totals = useMemo(() => planTotals(objects, tableGuests), [objects, tableGuests]);
  const hasTables = objects.some((o) => o.type === "table");
  const wantedScale = fixedPointsPerUnit(print.fixedScale, unitsPerMetre);

  const fit = useMemo(() => {
    if (objects.length === 0) return null;
    const layout = printLayout(draft.canvas.paperSize, draft.canvas.orientation, print.legend);
    return printFit(objectsPrintBounds(objects), layout, wantedScale);
  }, [objects, draft.canvas.paperSize, draft.canvas.orientation, print.legend, wantedScale]);
  const frame: Bounds | null = showFrame && fit ? fit.frame : null;

  const issues = useMemo(() => {
    const list: PlanIssue[] = buildPlanIssues(objects, tableGuests);
    if (fit && wantedScale != null && !fit.fits) {
      list.unshift({
        id: "scale-fit",
        severity: "warning",
        message: `The plan is too big to print at 1:${print.fixedScale} on ${draft.canvas.paperSize} ${draft.canvas.orientation}. It will be scaled to fit instead; try A3, a smaller scale, or a smaller plan.`,
        objectIds: []
      });
    }
    return list;
  }, [objects, tableGuests, fit, wantedScale, print.fixedScale, draft.canvas.paperSize, draft.canvas.orientation]);

  const guestTableNumbers = useMemo(
    () => (tableGuests ? Object.keys(tableGuests).sort(naturalTableCompare) : []),
    [tableGuests]
  );
  const usingGuestNumbers = useGuestNumbers && guestTableNumbers.length > 0;
  const plannedCount = usingGuestNumbers ? guestTableNumbers.length : tableCount;
  const gridCapacity = draft.autoLayout.rows * draft.autoLayout.columns;
  const gridOverflow = growGridToFit(plannedCount, draft.autoLayout.rows, draft.autoLayout.columns);

  const measurements = useMemo(
    () => buildMeasurements(objects, unitsPerMetre, draft.limits),
    [objects, unitsPerMetre, draft.limits]
  );
  // Looked up by id each render, so the highlight follows the plan as it's edited.
  const activeMeasurement = measurements.find((item) => item.id === highlightId && item.highlight) ?? null;
  const canvasHighlight = activeMeasurement?.highlight
    ? { ...activeMeasurement.highlight, label: activeMeasurement.value }
    : null;

  const isSaved = items.some((item) => item.id === draft.id);
  const filteredItems = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => `${item.name} ${item.title}`.toLowerCase().includes(q));
  }, [items, listQuery]);
  const canAlign = validSelected.length >= 2;
  const canDistribute = validSelected.length >= 3;

  /* ---------- document + history ---------- */

  const setDoc = useCallback((next: FloorplanDocument) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const syncHistory = useCallback(() => {
    setHistorySize({ undo: pastRef.current.length, redo: futureRef.current.length });
  }, []);

  const pushHistory = useCallback(() => {
    pastRef.current.push(draftRef.current);
    if (pastRef.current.length > MAX_HISTORY) pastRef.current.shift();
    futureRef.current = [];
    // A new step starts here, so the next keyed edit must not fold into the one before it.
    coalesceRef.current = { key: null, at: 0 };
    syncHistory();
  }, [syncHistory]);

  /** Apply an undoable change. Edits sharing a `key` within ~1s collapse into one undo step. */
  const commit = useCallback(
    (updater: (doc: FloorplanDocument) => FloorplanDocument, key?: string) => {
      const now = Date.now();
      const same = key && coalesceRef.current.key === key && now - coalesceRef.current.at < 1000;
      if (!same) pushHistory();
      coalesceRef.current = { key: key ?? null, at: now };
      setDoc(updater(draftRef.current));
      setDirty(true);
    },
    [pushHistory, setDoc]
  );

  const commitObjects = useCallback(
    (fn: (objects: FloorplanCanvasObject[]) => FloorplanCanvasObject[], key?: string) =>
      commit((doc) => ({ ...doc, objects: fn(doc.objects) }), key),
    [commit]
  );

  const undo = useCallback(() => {
    const previous = pastRef.current.pop();
    if (!previous) return;
    futureRef.current.push(draftRef.current);
    coalesceRef.current = { key: null, at: 0 };
    setDoc(previous);
    setDirty(true);
    syncHistory();
  }, [setDoc, syncHistory]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(draftRef.current);
    coalesceRef.current = { key: null, at: 0 };
    setDoc(next);
    setDirty(true);
    syncHistory();
  }, [setDoc, syncHistory]);

  /** Escape mid-drag: put back the state saved when the gesture began, and drop that undo step. */
  const cancelGesture = useCallback(() => {
    const before = pastRef.current.pop();
    if (before) setDoc(before);
    coalesceRef.current = { key: null, at: 0 };
    syncHistory();
  }, [setDoc, syncHistory]);

  const loadDocument = useCallback(
    (doc: FloorplanDocument, markDirty = false) => {
      pastRef.current = [];
      futureRef.current = [];
      coalesceRef.current = { key: null, at: 0 };
      setDoc(doc);
      setSelectedIds([]);
      setDirty(markDirty);
      syncHistory();
    },
    [setDoc, syncHistory]
  );

  function clearAutosave() {
    try {
      window.localStorage.removeItem(AUTOSAVE_KEY);
    } catch {
      /* storage unavailable */
    }
  }

  /* ---------- view ---------- */

  const zoomBy = useCallback((factor: number) => {
    const rect = canvasViewportRef.current?.getBoundingClientRect();
    const cx = (rect?.width ?? 0) / 2;
    const cy = (rect?.height ?? 0) / 2;
    setView((v) => {
      const zoom = clampZoom(v.zoom * factor);
      const k = zoom / v.zoom;
      return { zoom, pan: { x: cx - (cx - v.pan.x) * k, y: cy - (cy - v.pan.y) * k } };
    });
  }, []);

  const zoomToFit = useCallback(() => {
    const doc = draftRef.current;
    const viewport = canvasViewportRef.current;
    const bounds = objectsPrintBounds(doc.objects);
    let target = bounds;
    if (bounds && showFrameRef.current) {
      // Fit the printed area, not just the objects, so the frame is never cut off.
      const layout = printLayout(doc.canvas.paperSize, doc.canvas.orientation, resolvePrintOptions(doc.print).legend);
      const doc2 = resolvePrintOptions(doc.print);
      const upm = doc.canvas.unitsPerMetre && doc.canvas.unitsPerMetre > 0 ? doc.canvas.unitsPerMetre : null;
      const f = printFit(bounds, layout, fixedPointsPerUnit(doc2.fixedScale, upm)).frame;
      target = {
        minX: Math.min(bounds.minX, f.minX),
        minY: Math.min(bounds.minY, f.minY),
        maxX: Math.max(bounds.maxX, f.maxX),
        maxY: Math.max(bounds.maxY, f.maxY)
      };
    }
    if (!target || !viewport) {
      setView({ zoom: 1, pan: { x: 0, y: 0 } });
      return;
    }
    const rect = viewport.getBoundingClientRect();
    const pad = 48;
    const bw = Math.max(1, target.maxX - target.minX);
    const bh = Math.max(1, target.maxY - target.minY);
    const zoom = clampZoom(Math.min((rect.width - pad * 2) / bw, (rect.height - pad * 2) / bh));
    setView({
      zoom,
      pan: {
        x: (rect.width - bw * zoom) / 2 - target.minX * zoom,
        y: (rect.height - bh * zoom) / 2 - target.minY * zoom
      }
    });
  }, []);

  const fitSoon = useCallback(() => {
    requestAnimationFrame(() => zoomToFit());
  }, [zoomToFit]);

  // Seat editing ends when its block is no longer the one thing selected.
  useEffect(() => {
    if (seatEdit && !(validSelected.length === 1 && validSelected[0] === seatEdit.id)) setSeatEdit(null);
  }, [seatEdit, validSelected]);

  function editSeats(id: string) {
    setSelectedIds([id]);
    setSeatEdit((current) => ({ id, tool: current?.tool ?? "remove" }));
  }

  function paintSeat(id: string, key: string, state: SeatState, stroke: number) {
    commitObjects(
      (list) => list.map((o) => (o.id === id && o.type === "seating" ? withSeatState(o, key, state) : o)),
      `seats-${stroke}`
    );
  }

  /** Clearance kept between chairs and the objects they're cleared from. */
  const seatClearance = (unitsPerMetre ?? DEFAULT_UNITS_PER_METRE) * 0.3;

  function clearSeatsUnderObjects() {
    const ids = new Set(validSelected);
    let cleared = 0;
    const next = objects.map((o) => {
      if (!ids.has(o.id) || o.type !== "seating") return o;
      const keys = seatsBlocked(o, objects, seatClearance);
      cleared += keys.length;
      return keys.reduce((s, key) => withSeatState(s, key, "removed"), o);
    });
    if (!cleared) {
      setNotice("No chairs stand on another object.");
      return;
    }
    commitObjects(() => next);
    setNotice(`Took out ${cleared} chair${cleared === 1 ? "" : "s"}. Undo puts them back.`);
  }

  /** Which way an audience in `area` would face to look at the stage (or the saved setting without one). */
  function facingFor(area: FillArea): TheatreFacing {
    const stage = findStage(objects);
    if (!stage) return theatre.facing;
    const b = objectBodyBounds(stage);
    const v = rotatePoint({ x: (b.minX + b.maxX) / 2 - area.cx, y: (b.minY + b.maxY) / 2 - area.cy }, -area.rotation);
    if (Math.abs(v.x) > Math.abs(v.y)) return v.x < 0 ? "left" : "right";
    return v.y < 0 ? "up" : "down";
  }

  function openFill(area: FillArea, marginM: number, shapeId?: string) {
    setDrawMode(false);
    setFillPrompt({ area, marginM, facing: facingFor(area), shapeId });
  }

  function onDrawArea(b: Bounds) {
    setDrawMode(false);
    const minSize = (unitsPerMetre ?? DEFAULT_UNITS_PER_METRE) * 0.5;
    if (b.maxX - b.minX < minSize || b.maxY - b.minY < minSize) return;
    openFill({ cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, w: b.maxX - b.minX, h: b.maxY - b.minY, rotation: 0 }, 0);
  }

  function fillSelectedShape() {
    if (!primary || primary.type !== "rect") return;
    const box = objectBox(primary);
    // A room outline gets a gangway round the walls to start with; any other shape is filled to its edges.
    openFill({ cx: box.cx, cy: box.cy, w: box.w, h: box.h, rotation: box.rotation }, primary.fill === "none" ? 1 : 0, primary.id);
  }

  function runFill(blocks: FloorplanCanvasObject[], patch: Partial<NonNullable<FloorplanDocument["autoLayout"]["theatre"]>>) {
    setFillPrompt(null);
    if (!blocks.length) return;
    commit((doc) => ({
      ...doc,
      autoLayout: { ...doc.autoLayout, theatre: { ...doc.autoLayout.theatre, ...patch } },
      objects: [...doc.objects, ...blocks]
    }));
    setSelectedIds(blocks.map((b) => b.id));
  }

  // Selecting something on the canvas puts the measurement highlight away.
  useEffect(() => {
    if (validSelected.length) setHighlightId(null);
  }, [validSelected.length]);

  /** Point out a measurement: highlight it and bring it into the middle of the view. */
  function showMeasurement(item: Measurement | null) {
    setHighlightId(item?.id ?? null);
    const pts = item?.highlight ? [...item.highlight.polygons.flat(), ...(item.highlight.line ?? [])] : [];
    const rect = canvasViewportRef.current?.getBoundingClientRect();
    if (!pts.length || !rect) return;
    const cx = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2;
    const cy = (Math.min(...pts.map((p) => p.y)) + Math.max(...pts.map((p) => p.y))) / 2;
    setView((v) => ({ ...v, pan: { x: rect.width / 2 - cx * v.zoom, y: rect.height / 2 - cy * v.zoom } }));
  }

  function setLimits(patch: Partial<NonNullable<FloorplanDocument["limits"]>>) {
    commit((doc) => {
      const merged = { ...doc.limits, ...patch };
      const kept = Object.fromEntries(Object.entries(merged).filter(([, v]) => v != null));
      return { ...doc, limits: Object.keys(kept).length ? kept : undefined };
    }, "limits");
  }

  function viewCentre() {
    const rect = canvasViewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 120, y: 120 };
    return { x: (rect.width / 2 - view.pan.x) / view.zoom, y: (rect.height / 2 - view.pan.y) / view.zoom };
  }

  /* ---------- editing actions ---------- */

  function snapPoint(p: { x: number; y: number }) {
    const g = draft.canvas.gridSize;
    return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
  }

  function addPreset(presetId: string) {
    const preset = OBJECT_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const existing = draftRef.current.objects;
    let centre = snapPoint(viewCentre());
    const step = draft.canvas.gridSize;
    for (let i = 0; i < 40; i += 1) {
      const clash = existing.some((o) => {
        const b = objectBox(o);
        return Math.abs(b.cx - centre.x) < 1 && Math.abs(b.cy - centre.y) < 1;
      });
      if (!clash) break;
      centre = { x: centre.x + step, y: centre.y + step };
    }
    let obj = preset.build(centre, existing, unitsPerMetre ?? DEFAULT_UNITS_PER_METRE);
    // Tables and furniture go to the nearest clear spot instead of landing on top of what's in the middle.
    // Floor pieces (room, stage, dance floor) and text labels still go exactly where the view is centred.
    if (!preset.behind && obj.type !== "text") {
      const clearance = (unitsPerMetre ?? DEFAULT_UNITS_PER_METRE) * 0.3;
      const box = objectBox(obj);
      const spot = findFreeCentre(obj, existing, { x: box.cx, y: box.cy }, step, clearance, withCentre);
      obj = withCentre(obj, spot.x, spot.y);
    }
    commitObjects((list) => (preset.behind ? [obj, ...list] : [...list, obj]));
    setSelectedIds([obj.id]);
  }

  function deleteSelection() {
    if (!validSelected.length) return;
    const gone = new Set(validSelected);
    commitObjects((list) => list.filter((o) => !gone.has(o.id)));
    setSelectedIds([]);
  }

  function clearCanvas() {
    if (!objects.length) return;
    if (!window.confirm("Clear all objects from this canvas? You can undo this.")) return;
    commitObjects(() => []);
    setSelectedIds([]);
  }

  function copySelection() {
    const picked = draftRef.current.objects.filter((o) => validSelected.includes(o.id));
    if (picked.length) clipboardRef.current = { objects: structuredClone(picked), pastes: 0 };
  }

  function pasteClipboard(offsetFromSelection = false) {
    const clip = clipboardRef.current;
    if (!clip || !clip.objects.length) return;
    clip.pastes += 1;
    const shift = draft.canvas.gridSize * (offsetFromSelection ? 1 : clip.pastes);
    const created: FloorplanCanvasObject[] = [];
    commitObjects((list) => {
      const working = [...list];
      for (const src of clip.objects) {
        const copy = { ...structuredClone(src), id: crypto.randomUUID(), x: src.x + shift, y: src.y + shift } as FloorplanCanvasObject;
        if (copy.type === "table") {
          copy.tableNumber = nextTableNumber(working);
          if (src.type === "table" && src.label && !/^table\b/i.test(src.label)) copy.label = src.label;
        }
        created.push(copy);
        working.push(copy);
      }
      return working;
    });
    setSelectedIds(created.map((o) => o.id));
  }

  function duplicateSelection() {
    if (!validSelected.length) return;
    copySelection();
    if (clipboardRef.current) {
      clipboardRef.current.pastes = 0;
      pasteClipboard(true);
    }
  }

  function nudge(dx: number, dy: number) {
    if (!validSelected.length) return;
    const ids = new Set(validSelected);
    commitObjects(
      (list) => list.map((o) => (ids.has(o.id) ? ({ ...o, x: o.x + dx, y: o.y + dy } as FloorplanCanvasObject) : o)),
      "nudge"
    );
  }

  function patchSelected(fn: (obj: FloorplanCanvasObject) => FloorplanCanvasObject, key?: string) {
    if (!primary) return;
    const ids = new Set(validSelected.filter((id) => objects.find((o) => o.id === id)?.type === primary.type));
    commitObjects((list) => list.map((o) => (ids.has(o.id) ? fn(o) : o)), key ? `${key}:${primary.id}` : undefined);
  }

  function reorderSelected(where: "front" | "back") {
    if (!validSelected.length) return;
    const ids = new Set(validSelected);
    commitObjects((list) => {
      const picked = list.filter((o) => ids.has(o.id));
      const rest = list.filter((o) => !ids.has(o.id));
      return where === "front" ? [...rest, ...picked] : [...picked, ...rest];
    });
  }

  function alignSelected(mode: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom") {
    const picked = objects.filter((o) => validSelected.includes(o.id));
    if (picked.length < 2) return;
    const bounds = picked.map(objectBodyBounds);
    const group = {
      left: Math.min(...bounds.map((b) => b.minX)),
      right: Math.max(...bounds.map((b) => b.maxX)),
      top: Math.min(...bounds.map((b) => b.minY)),
      bottom: Math.max(...bounds.map((b) => b.maxY))
    };
    const ids = new Set(picked.map((o) => o.id));
    commitObjects((list) =>
      list.map((o) => {
        if (!ids.has(o.id)) return o;
        const b = objectBodyBounds(o);
        const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
        let dx = 0;
        let dy = 0;
        if (mode === "left") dx = group.left - b.minX;
        if (mode === "right") dx = group.right - b.maxX;
        if (mode === "hcenter") dx = (group.left + group.right) / 2 - c.x;
        if (mode === "top") dy = group.top - b.minY;
        if (mode === "bottom") dy = group.bottom - b.maxY;
        if (mode === "vcenter") dy = (group.top + group.bottom) / 2 - c.y;
        return { ...o, x: o.x + dx, y: o.y + dy } as FloorplanCanvasObject;
      })
    );
  }

  function distributeSelected(axis: "horizontal" | "vertical") {
    const picked = objects.filter((o) => validSelected.includes(o.id));
    if (picked.length < 3) return;
    const centres = picked
      .map((o) => ({ o, c: objectBox(o) }))
      .sort((a, b) => (axis === "horizontal" ? a.c.cx - b.c.cx : a.c.cy - b.c.cy));
    const first = centres[0].c;
    const last = centres[centres.length - 1].c;
    const target = new Map<string, number>();
    centres.forEach((entry, i) => {
      const t =
        axis === "horizontal"
          ? first.cx + (i * (last.cx - first.cx)) / (centres.length - 1)
          : first.cy + (i * (last.cy - first.cy)) / (centres.length - 1);
      target.set(entry.o.id, t);
    });
    commitObjects((list) =>
      list.map((o) => {
        const t = target.get(o.id);
        if (t == null) return o;
        const b = objectBox(o);
        return axis === "horizontal" ? withCentre(o, t, b.cy) : withCentre(o, b.cx, t);
      })
    );
  }

  function renumberByPosition() {
    const tables = objects.filter((o): o is FloorplanTableObject => o.type === "table" && /^\d+$/.test(o.tableNumber.trim()));
    if (!tables.length) return;
    const tolerance = Math.max(12, Math.min(...tables.map((t) => objectBox(t).h)) * 0.6);
    const byY = [...tables].sort((a, b) => a.y - b.y);
    const rows: FloorplanTableObject[][] = [];
    let rowY = -Infinity;
    for (const t of byY) {
      if (rows.length === 0 || t.y - rowY > tolerance) {
        rows.push([t]);
        rowY = t.y;
      } else {
        rows[rows.length - 1].push(t);
      }
    }
    const next = new Map<string, string>();
    let n = 1;
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x);
      for (const t of row) next.set(t.id, String(n++));
    }
    applyNumbers(next);
  }

  function closeNumberGaps() {
    const tables = objects
      .filter((o): o is FloorplanTableObject => o.type === "table" && /^\d+$/.test(o.tableNumber.trim()))
      .sort((a, b) => naturalTableCompare(a.tableNumber, b.tableNumber));
    const next = new Map<string, string>();
    tables.forEach((t, i) => next.set(t.id, String(i + 1)));
    applyNumbers(next);
  }

  /**
   * Apply new table numbers. Guests are matched to tables by number, so when a guest list is linked,
   * say how many guests would end up at a different table and ask first.
   */
  function applyNumbers(next: Map<string, string>) {
    const changed = objects.filter(
      (o): o is FloorplanTableObject => o.type === "table" && next.has(o.id) && next.get(o.id) !== o.tableNumber
    );
    if (!changed.length) return;
    if (tableGuests) {
      const moved = changed.reduce((sum, t) => sum + (guestCountFor(t.tableNumber, tableGuests) ?? 0), 0);
      if (moved > 0) {
        const tables = `${changed.length} table${changed.length === 1 ? "" : "s"}`;
        const guests = `${moved} guest${moved === 1 ? "" : "s"}`;
        const ok = window.confirm(
          `This changes the number on ${tables}. The linked guest list seats guests by table number, so ${guests} will move to a different table on the plan. Renumber anyway? You can undo this.`
        );
        if (!ok) return;
      }
    }
    commitObjects((list) =>
      list.map((o) => (o.type === "table" && next.has(o.id) ? { ...o, tableNumber: next.get(o.id)! } : o))
    );
  }

  function matchSeatsToGuests() {
    if (!tableGuests) return;
    commitObjects((list) =>
      list.map((o) => {
        if (o.type !== "table") return o;
        const count = guestCountFor(o.tableNumber, tableGuests) ?? 0;
        if (count === 0 || count === tableSeatCount(o)) return o;
        return { ...o, seats: Math.min(MAX_TABLE_SEATS, count) };
      })
    );
  }

  function setAuto(patch: Partial<FloorplanDocument["autoLayout"]>, key?: string) {
    commit((doc) => ({ ...doc, autoLayout: { ...doc.autoLayout, ...patch } }), key);
  }

  /** Tables Auto layout didn't make (added from the panel, pasted or duplicated). */
  const handPlacedTables = objects.filter((o) => o.type === "table" && !GENERATED_ID.test(o.id));

  /** Seating blocks Auto layout didn't make. */
  const handPlacedSeating = objects.filter((o) => o.type === "seating" && !GENERATED_SEATING_ID.test(o.id));
  const seatingBlocks = objects.filter((o) => o.type === "seating");
  const tableObjects = objects.filter((o) => o.type === "table");
  const stage = findStage(objects);

  function setTheatre(patch: Partial<NonNullable<FloorplanDocument["autoLayout"]["theatre"]>>, key?: string) {
    commit((doc) => ({ ...doc, autoLayout: { ...doc.autoLayout, theatre: { ...doc.autoLayout.theatre, ...patch } } }), key);
  }

  /**
   * Ask first when generating would replace things placed by hand, or when the plan holds the other kind of
   * seating (tables while laying out theatre rows, or the other way round), which is kept unless asked.
   */
  function startGenerate(kind: "tables" | "theatre") {
    const handPlaced = kind === "tables" ? handPlacedTables : handPlacedSeating;
    const other = kind === "tables" ? seatingBlocks : tableObjects;
    if (handPlaced.length || other.length) {
      setRemoveOther(false);
      setGeneratePrompt(kind);
      return;
    }
    if (kind === "tables") runGenerate(false, false);
    else runTheatre(false, false);
  }

  function runTheatre(keepHandPlaced: boolean, clearTables: boolean) {
    setGeneratePrompt(null);
    const kept = new Set(keepHandPlaced ? handPlacedSeating.map((o) => o.id) : []);
    const generated = buildTheatreLayout(draft.autoLayout.theatre, {
      unitsPerMetre: unitsPerMetre ?? DEFAULT_UNITS_PER_METRE,
      objects,
      fallbackCentre: viewCentre()
    });
    commit((doc) => ({
      ...doc,
      metadata: {
        title: doc.metadata.title || doc.themeSnapshot.eventName,
        subtitle: doc.metadata.subtitle || doc.themeSnapshot.eventSubtitle || ""
      },
      objects: [
        ...doc.objects.filter((o) => {
          if (o.type === "seating") return kept.has(o.id);
          if (o.type === "table") return !clearTables;
          return true;
        }),
        ...generated
      ]
    }));
    setSelectedIds([]);
    fitSoon();
  }

  function runGenerate(keepHandPlaced: boolean, clearSeating: boolean) {
    setGeneratePrompt(null);
    const kept = keepHandPlaced ? handPlacedTables : [];
    const taken = new Set(kept.map((t) => (t.type === "table" ? t.tableNumber.trim() : "")));
    let numbers: string[];
    if (usingGuestNumbers) {
      numbers = guestTableNumbers.filter((n) => !taken.has(n));
    } else {
      // Same number of tables as asked for, skipping numbers the kept tables already use.
      numbers = [];
      for (let n = 1; numbers.length < tableCount; n += 1) if (!taken.has(String(n))) numbers.push(String(n));
    }
    // Grow the grid rather than silently dropping the tables that don't fit.
    const grow = growGridToFit(numbers.length, draft.autoLayout.rows, draft.autoLayout.columns);
    const autoLayout = grow ? { ...draft.autoLayout, ...grow } : draft.autoLayout;
    const keptIds = new Set(kept.map((t) => t.id));
    const generated = buildTablesFromAutoLayout(autoLayout, numbers.length, {
      tableNumbers: numbers,
      seats: seatsPerTable,
      roundSize,
      style: tableStyle,
      topTable: withTopTable,
      unitsPerMetre
    });
    commit((doc) => ({
      ...doc,
      metadata: {
        title: doc.metadata.title || doc.themeSnapshot.eventName,
        subtitle: doc.metadata.subtitle || doc.themeSnapshot.eventSubtitle || ""
      },
      autoLayout,
      objects: [
        ...doc.objects.filter((o) => {
          if (o.type === "table") return keptIds.has(o.id);
          if (o.type === "seating") return !clearSeating;
          return true;
        }),
        ...generated
      ]
    }));
    setSelectedIds([]);
    fitSoon();
  }

  /* ---------- logos ---------- */

  async function refreshVenueLogoLibrary() {
    try {
      const response = await fetch("/api/logos/venue");
      const payload = await response.json();
      setVenueLogoLibrary({
        loaded: true,
        configured: Boolean(payload.configured),
        items: Array.isArray(payload.items) ? payload.items : []
      });
    } catch {
      setVenueLogoLibrary({ loaded: true, configured: false, items: [] });
    }
  }

  async function refreshClientLogoLibrary() {
    try {
      const response = await fetch("/api/logos/client");
      const payload = await response.json();
      setClientLogoLibrary({
        loaded: true,
        configured: Boolean(payload.configured),
        items: Array.isArray(payload.items) ? payload.items : []
      });
    } catch {
      setClientLogoLibrary({ loaded: true, configured: false, items: [] });
    }
  }

  async function applyLogoFromLibrary(
    item: { assetUrl: string; key: string },
    field: "venueLogoDataUrl" | "clientLogoDataUrl"
  ) {
    setError("");
    try {
      const response = await fetch(item.assetUrl);
      if (!response.ok) throw new Error("Could not load that logo from storage.");
      const dataUrl = await blobToDataUrl(await response.blob());
      commit((doc) => ({
        ...doc,
        themeSnapshot: { ...doc.themeSnapshot, [field]: dataUrl },
        selectedVenueLogoKey: field === "venueLogoDataUrl" ? item.key : (doc.selectedVenueLogoKey ?? null),
        selectedClientLogoKey: field === "clientLogoDataUrl" ? item.key : (doc.selectedClientLogoKey ?? null)
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply logo.");
    }
  }

  /* ---------- server I/O ---------- */

  async function refreshList() {
    const response = await fetch("/api/floorplans/saved");
    if (!response.ok) throw new Error(await readResponseError(response, "Failed to list floorplans."));
    const payload = await response.json();
    setItems(Array.isArray(payload.items) ? payload.items : []);
  }

  async function saveCurrent() {
    setBusy(true);
    setError("");
    try {
      const sent = draftRef.current;
      const name = sent.name.trim() || UNTITLED;
      const response = await fetch("/api/floorplans/saved", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...sent, name })
      });
      if (!response.ok) throw new Error(await readResponseError(response, "Save failed."));
      const payload = await response.json();
      // Edits made while the request was in flight aren't in the saved copy: keep them unsaved.
      const unchanged = draftRef.current === sent;
      // The id is the only thing that has to change; keep it out of undo history.
      setDoc({
        ...draftRef.current,
        ...(unchanged ? { name } : {}),
        id: payload.id as string,
        savedAt: payload.savedAt as string
      });
      if (unchanged) {
        setDirty(false);
        clearAutosave();
      }
      await refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function loadItem(id: string) {
    if (dirty && !window.confirm("You have unsaved changes. Open another floorplan anyway?")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/floorplans/saved/${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error(await readResponseError(response, "Load failed."));
      const payload = await response.json();
      loadDocument(payload.floorplan as FloorplanDocument);
      clearAutosave();
      fitSoon();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed.");
    } finally {
      setBusy(false);
    }
  }

  function startNew() {
    if (dirty && !window.confirm("You have unsaved changes. Start a new floorplan anyway?")) return;
    loadDocument(buildEmptyFloorplanDraft());
    setGuestRecords(null);
    clearAutosave();
    setView({ zoom: 1, pan: { x: 0, y: 0 } });
  }

  /** Delete a saved plan from the Open list. If it's the one being edited, it stays open as an unsaved plan. */
  async function deleteSaved(item: FloorplanListItem) {
    if (!window.confirm(`Delete the saved floorplan “${item.name}”? This can't be undone.`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/floorplans/saved/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readResponseError(response, "Delete failed."));
      if (item.id === draftRef.current.id) setDirty(true);
      await refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteCurrent() {
    if (!isSaved) {
      if (!window.confirm("This floorplan has not been saved. Discard it and start a new one?")) return;
      loadDocument(buildEmptyFloorplanDraft());
      clearAutosave();
      return;
    }
    if (!window.confirm("Delete this saved floorplan?")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/floorplans/saved/${encodeURIComponent(draft.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readResponseError(response, "Delete failed."));
      loadDocument(buildEmptyFloorplanDraft());
      clearAutosave();
      await refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  async function renderPdfBlob(): Promise<Blob> {
    const response = await fetch("/api/floorplans/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ floorplan: draftRef.current })
    });
    if (!response.ok) throw new Error(await readResponseError(response, "Print failed."));
    return response.blob();
  }

  async function printFloorplan() {
    setBusy(true);
    setError("");
    try {
      const blob = await renderPdfBlob();
      // Name the file after the plan so downloads for different events are told apart.
      const doc = draftRef.current;
      const slug = (doc.metadata.title || doc.name || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      const base = slug && slug !== "untitled-floorplan" ? `${slug}-floorplan` : "floorplan";
      if (outputFormat === "png") await downloadPdfBlobAsPngs(blob, base);
      else downloadBlob(blob, `${base}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Print failed.");
    } finally {
      setBusy(false);
    }
  }

  /** Close Print and export, dropping its preview and any render still on the way. */
  function closePrint() {
    previewSeqRef.current += 1;
    setPrintOpen(false);
    setPreviewBusy(false);
    setPreviewError("");
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
  }

  const hasPreviewRef = useRef(false);
  hasPreviewRef.current = previewUrl != null;
  // While Print and export is open, redraw its preview shortly after each change.
  useEffect(() => {
    if (!printOpen) return;
    const seq = ++previewSeqRef.current;
    if (!draft.objects.length) {
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
      return;
    }
    const timer = window.setTimeout(
      async () => {
        setPreviewBusy(true);
        try {
          const blob = await renderPdfBlob();
          if (seq !== previewSeqRef.current) return;
          const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
          setPreviewUrl((old) => {
            if (old) URL.revokeObjectURL(old);
            return url;
          });
          setPreviewError("");
        } catch (err) {
          if (seq === previewSeqRef.current) setPreviewError(err instanceof Error ? err.message : "Preview failed.");
        } finally {
          if (seq === previewSeqRef.current) setPreviewBusy(false);
        }
      },
      hasPreviewRef.current ? 700 : 0
    );
    return () => window.clearTimeout(timer);
  }, [printOpen, draft]);

  /** Clear the selection so the sidebar shows the checks, and bring them into view. */
  function showChecks() {
    setSelectedIds([]);
    setSeatEdit(null);
    requestAnimationFrame(() => document.getElementById("fp-checks")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }

  /* ---------- effects ---------- */

  useEffect(() => {
    void refreshList().catch((err) => setError(err instanceof Error ? err.message : "Failed to list floorplans."));
    void Promise.all([refreshVenueLogoLibrary(), refreshClientLogoLibrary()]);
    void fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        if (payload && Array.isArray(payload.projects)) setProjects(payload.projects);
      })
      .catch(() => undefined);
    try {
      const raw = window.localStorage.getItem(AUTOSAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Autosave;
        if (parsed?.doc?.objects?.length) setRecovered(parsed);
      }
    } catch {
      /* ignore unreadable autosave */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the linked project's guest list whenever the link changes.
  useEffect(() => {
    const id = draft.projectId;
    if (!id) {
      setGuestRecords(null);
      return;
    }
    let cancelled = false;
    setGuestsLoading(true);
    void fetch(`/api/projects/${encodeURIComponent(id)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await readResponseError(response, "Could not load that guest list."));
        return response.json();
      })
      .then((payload) => {
        if (!cancelled) setGuestRecords((payload.project?.guests ?? []) as GuestRecord[]);
      })
      .catch((err) => {
        if (cancelled) return;
        setGuestRecords(null);
        setError(err instanceof Error ? err.message : "Could not load that guest list.");
      })
      .finally(() => {
        if (!cancelled) setGuestsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draft.projectId]);

  // Debounced local autosave while there are unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      try {
        const payload: Autosave = { doc: draftRef.current, at: new Date().toISOString() };
        window.localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
      } catch {
        /* quota or private mode: autosave is best-effort */
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [dirty, draft]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Keyboard shortcuts. The handler is re-bound each render so it always sees fresh state.
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keyHandlerRef.current = (event: KeyboardEvent) => {
    if (listOpen || printOpen || settingsOpen || autoOpen || generatePrompt || fillPrompt) return;
    const meta = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (meta && key === "s") {
      event.preventDefault();
      if (!busy) void saveCurrent();
      return;
    }
    if (meta && key === "p") {
      event.preventDefault();
      setPrintOpen(true);
      return;
    }
    if (isTypingTarget(event.target)) return;
    if (meta && key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (meta && key === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if (meta && key === "a") {
      event.preventDefault();
      setSelectedIds(objects.map((o) => o.id));
      return;
    }
    if (meta && key === "c") {
      copySelection();
      return;
    }
    if (meta && key === "v") {
      event.preventDefault();
      pasteClipboard();
      return;
    }
    if (meta && key === "d") {
      event.preventDefault();
      duplicateSelection();
      return;
    }
    if (meta) return;
    if (event.key === "Escape" && seatEdit) {
      setSeatEdit(null);
      return;
    }
    if (event.key === "Escape" && drawMode) {
      setDrawMode(false);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      // Editing seats: the block itself isn't what's being worked on.
      if (seatEdit) return;
      if (validSelected.length) {
        event.preventDefault();
        deleteSelection();
      }
      return;
    }
    if (event.key === "Escape") {
      setSelectedIds([]);
      return;
    }
    if (event.key.startsWith("Arrow") && validSelected.length) {
      event.preventDefault();
      const step = event.shiftKey ? draft.canvas.gridSize : 1;
      if (event.key === "ArrowLeft") nudge(-step, 0);
      if (event.key === "ArrowRight") nudge(step, 0);
      if (event.key === "ArrowUp") nudge(0, -step);
      if (event.key === "ArrowDown") nudge(0, step);
      return;
    }
    if (!event.altKey && !event.shiftKey && (key === "v" || key === "h" || key === "f" || key === "a")) {
      if (key === "a") setAutoOpen(true);
      else {
        setPanTool(key === "h");
        setDrawMode(key === "f");
      }
      return;
    }
    if (event.key === " " && !event.repeat) {
      event.preventDefault();
      setSpaceDown(true);
    }
  };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => keyHandlerRef.current(e);
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") setSpaceDown(false);
    };
    // A Space released while another window has focus never reaches us; don't leave pan mode stuck on.
    const onBlur = () => setSpaceDown(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  /* ---------- small setters ---------- */

  function setPrint(patch: Partial<FloorplanPrintOptions>) {
    commit((doc) => ({ ...doc, print: { ...resolvePrintOptions(doc.print), ...patch } }));
  }

  const guestFeaturesOff = !tableGuests;
  function presetItem(id: string, icon?: ReactNode, hint?: string) {
    const preset = OBJECT_PRESETS.find((p) => p.id === id);
    if (!preset) return null;
    return (
      <MenuItem key={id} icon={icon} hint={hint} onSelect={() => addPreset(id)}>
        {preset.label}
      </MenuItem>
    );
  }
  const totalsText = [
    totals.tables || !totals.blocks ? `${totals.tables} table${totals.tables === 1 ? "" : "s"} · ${totals.seats} seats` : "",
    totals.blocks ? `${totals.theatreSeats} theatre seats` : "",
    totals.wheelchairSpaces ? `${totals.wheelchairSpaces} wheelchair space${totals.wheelchairSpaces === 1 ? "" : "s"}` : "",
    totals.guests != null ? `${totals.guests} guests` : ""
  ]
    .filter(Boolean)
    .join(" · ");
  const metresPerSquare = unitsPerMetre ? draft.canvas.gridSize / unitsPerMetre : null;
  const linkedProject = projects.find((p) => p.id === draft.projectId);

  return (
    <main className="page page--wide">
      <PageHeader
        title="Floorplans"
        description="Lay out tables, shapes and labels, then print."
        actions={
          <>
            {dirty ? <span className="text-muted">Unsaved changes</span> : null}
            <input
              className="header-input"
              value={draft.name}
              onChange={(e) => {
                const name = e.target.value;
                commit((doc) => ({ ...doc, name }), "name");
              }}
              aria-label="Floorplan name"
              placeholder="Floorplan name"
            />
            <button type="button" onClick={() => void saveCurrent()} disabled={busy} title="Save (⌘S)">
              <Save size={15} aria-hidden /> Save
            </button>
            <button
              type="button"
              onClick={() => {
                void refreshList().catch((err) => setError(err instanceof Error ? err.message : "Failed to list floorplans."));
                setListQuery("");
                setListOpen(true);
              }}
            >
              <FolderOpen size={15} aria-hidden /> Open
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title={linkedProject ? `Guest list: ${linkedProject.name}. Grid and scale.` : "Guest list, grid and scale"}
            >
              <Settings2 size={15} aria-hidden /> Plan settings
            </button>
            <button type="button" className="btn-primary" onClick={() => setPrintOpen(true)} title="Print and export (⌘P)">
              <Printer size={15} aria-hidden /> Print and export
            </button>
            <MenuButton
              className="icon-btn icon-btn--bordered"
              icon={<Ellipsis size={16} aria-hidden />}
              chevron={false}
              align="end"
              ariaLabel="More floorplan actions"
              title="More"
            >
              <MenuItem icon={<FilePlus size={15} />} disabled={busy} onSelect={startNew}>
                New floorplan
              </MenuItem>
              <MenuItem
                icon={<Copy size={15} />}
                disabled={busy}
                hint="An unsaved copy you can rename"
                onSelect={() => loadDocument(copyForDuplicate(draftRef.current), true)}
              >
                Duplicate floorplan
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Trash2 size={15} />} danger disabled={busy} onSelect={() => void deleteCurrent()}>
                {isSaved ? "Delete floorplan" : "Discard floorplan"}
              </MenuItem>
            </MenuButton>
          </>
        }
      />

      {recovered ? (
        <Callout tone="info" className="fp-recovered">
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span>
              Unsaved floorplan “{recovered.doc.name}” from {formatTime(recovered.at)} was recovered.
            </span>
            <button
              type="button"
              className="btn-sm"
              onClick={() => {
                loadDocument(recovered.doc, true);
                setRecovered(null);
                fitSoon();
              }}
            >
              Restore
            </button>
            <button
              type="button"
              className="btn-sm"
              onClick={() => {
                clearAutosave();
                setRecovered(null);
              }}
            >
              Discard
            </button>
          </div>
        </Callout>
      ) : null}

      {listOpen ? (
        <Modal title="Saved floorplans" onClose={() => setListOpen(false)}>
          {items.length === 0 ? (
            <p className="text-muted" style={{ margin: 0 }}>
              No saved floorplans yet.
            </p>
          ) : (
            <div className="stack">
              {items.length > 5 ? (
                <input
                  type="search"
                  autoFocus
                  value={listQuery}
                  onChange={(e) => setListQuery(e.target.value)}
                  placeholder="Search by name or title"
                  aria-label="Search saved floorplans"
                />
              ) : null}
              {filteredItems.length === 0 ? (
                <p className="text-muted" style={{ margin: 0 }}>
                  No floorplans match “{listQuery}”.
                </p>
              ) : (
                <ul className="list">
                  {filteredItems.map((item) => (
                    <li key={item.id} className={item.id === draft.id ? "list-item list-item--active" : "list-item"}>
                      <div className="list-item-main">
                        <button
                          type="button"
                          className="list-item-title"
                          disabled={busy}
                          onClick={() => {
                            void loadItem(item.id);
                            setListOpen(false);
                          }}
                        >
                          {item.name}
                        </button>
                        <span className="list-item-meta text-muted">
                          {[item.title && item.title !== item.name ? item.title : null, `Saved ${formatTime(item.savedAt)}`]
                            .filter(Boolean)
                            .join(" · ")}
                          {item.id === draft.id ? " · Open now" : ""}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn-sm"
                        disabled={busy}
                        onClick={() => {
                          void loadItem(item.id);
                          setListOpen(false);
                        }}
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn--sm btn-danger"
                        disabled={busy}
                        onClick={() => void deleteSaved(item)}
                        aria-label={`Delete ${item.name}`}
                        title="Delete"
                      >
                        <Trash2 size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Modal>
      ) : null}

      {fillPrompt ? (
        <FillPrompt
          area={fillPrompt.area}
          initialMargin={fillPrompt.marginM}
          initialFacing={fillPrompt.facing}
          settings={theatre}
          objects={fillPrompt.shapeId ? objects.filter((o) => o.id !== fillPrompt.shapeId) : objects}
          unitsPerMetre={unitsPerMetre ?? DEFAULT_UNITS_PER_METRE}
          clearance={seatClearance}
          scaled={Boolean(unitsPerMetre)}
          onCancel={() => setFillPrompt(null)}
          onFill={runFill}
        />
      ) : null}

      {generatePrompt ? (
        <GeneratePrompt
          kind={generatePrompt}
          handPlaced={generatePrompt === "tables" ? handPlacedTables.length : handPlacedSeating.length}
          other={generatePrompt === "tables" ? seatingBlocks.length : tableObjects.length}
          removeOther={removeOther}
          onRemoveOther={setRemoveOther}
          onCancel={() => setGeneratePrompt(null)}
          onRun={(keep) => (generatePrompt === "tables" ? runGenerate(keep, removeOther) : runTheatre(keep, removeOther))}
        />
      ) : null}

      {autoOpen ? (
        <Modal title="Auto layout" onClose={() => setAutoOpen(false)}>
          <div className="stack">
            <Segmented
              value={generator}
              aria-label="What to generate"
              options={[
                { value: "tables", label: "Tables" },
                { value: "theatre", label: "Theatre seating" }
              ]}
              onChange={(value) => setAuto({ generator: value })}
            />
            {generator === "tables" ? (
              <>
                <Field label="Table type" as="div">
                  <Segmented value={tableStyle} options={STYLE_OPTIONS} onChange={(value) => setAuto({ tableStyle: value })} />
                </Field>
                {tableStyle !== "long" ? (
                  <Field label="Round table size" as="div">
                    <Segmented
                      value={roundSize}
                      options={(Object.keys(ROUND_TABLE_SIZES) as RoundTableSize[]).map((key) => ({
                        value: key,
                        label: ROUND_TABLE_SIZES[key].label,
                        title: `${ROUND_TABLE_SIZES[key].diameterM.toFixed(2)} m across, seats ${ROUND_TABLE_SIZES[key].seats}`
                      }))}
                      onChange={(value) => {
                        setAuto({ roundSize: value, seatsPerTable: ROUND_TABLE_SIZES[value].seats });
                      }}
                    />
                  </Field>
                ) : null}
                <div className="form-grid">
                  <Field label="Tables">
                    <NumericInput
                      min={1}
                      max={MAX_GENERATED_TABLES}
                      integer
                      value={plannedCount}
                      disabled={usingGuestNumbers}
                      onCommit={(n) => {
                        if (n != null) setAuto({ tableCount: n }, "tableCount");
                      }}
                    />
                  </Field>
                  <Field label="Seats each">
                    <NumericInput
                      min={1}
                      max={MAX_TABLE_SEATS}
                      integer
                      value={seatsPerTable}
                      onCommit={(n) => {
                        if (n != null) setAuto({ seatsPerTable: n }, "seatsPerTable");
                      }}
                    />
                  </Field>
                  <Field label="Rows">
                    <NumericInput
                      min={1}
                      max={MAX_GRID}
                      integer
                      value={draft.autoLayout.rows}
                      onCommit={(rows) => {
                        if (rows != null) commit((doc) => ({ ...doc, autoLayout: { ...doc.autoLayout, rows } }), "rows");
                      }}
                    />
                  </Field>
                  <Field label="Columns">
                    <NumericInput
                      min={1}
                      max={MAX_GRID}
                      integer
                      value={draft.autoLayout.columns}
                      onCommit={(columns) => {
                        if (columns != null)
                          commit((doc) => ({ ...doc, autoLayout: { ...doc.autoLayout, columns } }), "columns");
                      }}
                    />
                  </Field>
                  {gridOverflow ? (
                    <p className="field-hint span-all" style={{ margin: 0 }}>
                      A {draft.autoLayout.rows} × {draft.autoLayout.columns} grid holds {gridCapacity} tables. Generating{" "}
                      {plannedCount} will make it {gridOverflow.rows} × {gridOverflow.columns}.
                    </p>
                  ) : null}
                  <Field label="Numbering">
                    <select
                      value={draft.autoLayout.numbering}
                      onChange={(e) => {
                        const numbering = e.target.value as "straight" | "snaked";
                        commit((doc) => ({ ...doc, autoLayout: { ...doc.autoLayout, numbering } }));
                      }}
                    >
                      <option value="straight">Straight</option>
                      <option value="snaked">Snaked</option>
                    </select>
                  </Field>
                  <Field label="Start corner">
                    <select
                      value={draft.autoLayout.startCorner}
                      onChange={(e) => {
                        const startCorner = e.target.value as FloorplanDocument["autoLayout"]["startCorner"];
                        commit((doc) => ({ ...doc, autoLayout: { ...doc.autoLayout, startCorner } }));
                      }}
                    >
                      <option value="topLeft">Top left</option>
                      <option value="topRight">Top right</option>
                      <option value="bottomLeft">Bottom left</option>
                      <option value="bottomRight">Bottom right</option>
                    </select>
                  </Field>
                  <Field
                    label="Arrangement"
                    as="div"
                    className="span-all"
                    hint="Staggered offsets every other row or column by half a cell so tables nest like bricks."
                  >
                    <Segmented
                      value={draft.autoLayout.tableLayout}
                      options={[
                        { value: "aligned", label: "Aligned grid" },
                        { value: "staggered", label: "Staggered" }
                      ]}
                      onChange={(value) =>
                        commit((doc) => ({
                          ...doc,
                          autoLayout: {
                            ...doc.autoLayout,
                            tableLayout: value,
                            staggerAxis: value === "staggered" ? (doc.autoLayout.staggerAxis ?? "horizontal") : undefined
                          }
                        }))
                      }
                    />
                  </Field>
                  {draft.autoLayout.tableLayout === "staggered" ? (
                    <Field label="Offset" as="div" className="span-all">
                      <Segmented
                        value={draft.autoLayout.staggerAxis ?? "horizontal"}
                        options={[
                          { value: "horizontal", label: "Odd rows", title: "Horizontal: odd rows offset (classic banqueting)" },
                          { value: "vertical", label: "Odd columns", title: "Vertical: odd columns offset downward" }
                        ]}
                        onChange={(value) =>
                          commit((doc) => ({ ...doc, autoLayout: { ...doc.autoLayout, staggerAxis: value } }))
                        }
                      />
                    </Field>
                  ) : null}
                </div>
                <Switch label="Add a top table" checked={withTopTable} onChange={(topTable) => setAuto({ topTable })} />
                {tableGuests ? (
                  <Switch
                    label="Use table numbers from guest list"
                    hint={`${Object.keys(tableGuests).length} tables in the linked event.`}
                    checked={useGuestNumbers}
                    onChange={(on) => setAuto({ useGuestNumbers: on })}
                  />
                ) : null}
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    setAutoOpen(false);
                    startGenerate("tables");
                  }}
                >
                  Generate tables
                </button>
                {hasTables ? (
                  <p className="field-hint" style={{ margin: 0 }}>
                    Replaces the existing tables. Shapes and labels are kept. Undo is available.
                  </p>
                ) : null}
              </>
            ) : (
              <TheatreForm
                settings={theatre}
                stageLabel={stage ? stage.label || "Stage" : null}
                scaled={Boolean(unitsPerMetre)}
                hasSeating={seatingBlocks.length > 0}
                onChange={setTheatre}
                onGenerate={() => {
                  setAutoOpen(false);
                  startGenerate("theatre");
                }}
              />
            )}
          </div>
        </Modal>
      ) : null}

      {settingsOpen ? (
        <Modal
          title="Plan settings"
          onClose={() => setSettingsOpen(false)}
          footer={
            <button type="button" className="btn-primary" onClick={() => setSettingsOpen(false)}>
              Done
            </button>
          }
        >
          <div className="stack">
            <h3 className="dialog-heading">Guest list</h3>
            <Field
              label="Event"
              hint="Link a saved event to see guest counts per table, spot overfull tables and print a guest list."
            >
              <select
                value={draft.projectId ?? ""}
                onChange={(e) => {
                  const projectId = e.target.value || null;
                  commit((doc) => ({ ...doc, projectId }));
                }}
              >
                <option value="">None</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            {guestsLoading ? <p className="field-hint" style={{ margin: 0 }}>Loading guests…</p> : null}
            {tableGuests ? (
              <p className="field-hint" style={{ margin: 0 }}>
                {guestRecords?.length ?? 0} guests across {Object.keys(tableGuests).length} tables.
              </p>
            ) : null}
            {tableGuests && hasTables ? (
              <button type="button" className="btn-sm" onClick={matchSeatsToGuests}>
                Match seats to guest counts
              </button>
            ) : null}
            <h3 className="dialog-heading">Grid and scale</h3>
            <Field
              label="Grid square"
              hint={
                metresPerSquare
                  ? `Snapping step. At this scale one square is ${Math.round(metresPerSquare * 100) / 100} m; changing it doesn't resize anything.`
                  : "Snapping step, in plan units."
              }
            >
              <NumericInput
                min={4}
                max={200}
                integer
                value={draft.canvas.gridSize}
                onCommit={(gridSize) => {
                  if (gridSize == null) return;
                  // unitsPerMetre is left alone, so tables keep their real-world size.
                  commit((doc) => ({ ...doc, canvas: { ...doc.canvas, gridSize } }), "grid");
                }}
              />
            </Field>
            <Field
              label="Scale: one grid square is"
              hint={
                metresPerSquare
                  ? "Sets what a metre means on the plan, so changing it changes the real size of everything. Sizes show in metres and the scale bar is drawn."
                  : "Leave blank for an unscaled plan. 1 m per square makes the default 6 ft round table 1.8 m."
              }
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <NumericInput
                  min={0.05}
                  // unitsPerMetre must stay ≥ 1, so a square can be at most gridSize metres.
                  max={draft.canvas.gridSize}
                  step={0.1}
                  allowEmpty
                  value={metresPerSquare}
                  placeholder="—"
                  onCommit={(value) => {
                    const m = value ?? 0;
                    commit(
                      (doc) => ({
                        ...doc,
                        canvas: {
                          ...doc.canvas,
                          unitsPerMetre: m > 0 ? doc.canvas.gridSize / m : null
                        }
                      }),
                      "scale"
                    );
                  }}
                />
                <span className="text-muted">m</span>
              </div>
            </Field>
          </div>
        </Modal>
      ) : null}

      {printOpen ? (
        <Modal
          title="Print and export"
          size="xl"
          onClose={closePrint}
          footer={
            <>
              <Segmented
                size="sm"
                value={outputFormat}
                options={[
                  { value: "pdf", label: "PDF" },
                  { value: "png", label: "PNG" }
                ]}
                onChange={setOutputFormat}
                aria-label="Output format"
              />
              <span className="spacer" />
              <button type="button" onClick={closePrint}>
                Close
              </button>
              <button type="button" className="btn-primary" onClick={() => void printFloorplan()} disabled={busy || !objects.length}>
                <Download size={16} aria-hidden />
                {outputFormat === "png" ? "Download PNG" : "Download PDF"}
              </button>
            </>
          }
        >
          <div className="print-dialog">
            <div className="print-dialog-settings stack">
              <Field label="Title">
                <input
                  value={draft.metadata.title}
                  onChange={(e) => {
                    const title = e.target.value;
                    commit((doc) => ({ ...doc, metadata: { ...doc.metadata, title } }), "title");
                  }}
                />
              </Field>
              <Field label="Subtitle">
                <input
                  value={draft.metadata.subtitle}
                  onChange={(e) => {
                    const subtitle = e.target.value;
                    commit((doc) => ({ ...doc, metadata: { ...doc.metadata, subtitle } }), "subtitle");
                  }}
                />
              </Field>
              <Field label="Paper" as="div">
                <Segmented
                  value={draft.canvas.paperSize}
                  options={PAPER_OPTIONS}
                  onChange={(value) =>
                    commit((doc) => ({
                      ...doc,
                      canvas: { ...doc.canvas, paperSize: value as FloorplanDocument["canvas"]["paperSize"] },
                      autoLayout: { ...doc.autoLayout, paperSize: value as FloorplanDocument["autoLayout"]["paperSize"] }
                    }))
                  }
                />
              </Field>
              <Field label="Orientation" as="div">
                <Segmented
                  value={draft.canvas.orientation}
                  options={ORIENTATION_OPTIONS}
                  onChange={(value) =>
                    commit((doc) => ({
                      ...doc,
                      canvas: { ...doc.canvas, orientation: value },
                      autoLayout: { ...doc.autoLayout, orientation: value }
                    }))
                  }
                />
              </Field>
              <Switch
                label="Legend and totals"
                hint="Footer with table, seat and guest totals."
                checked={print.legend}
                onChange={(legend) => setPrint({ legend })}
              />
              <Switch
                label="Guest counts on tables"
                hint={guestFeaturesOff ? "Link a guest list first." : "Shows guests/seats under each table."}
                checked={print.guestCounts}
                disabled={guestFeaturesOff}
                onChange={(guestCounts) => setPrint({ guestCounts })}
              />
              <Switch
                label="Colour tables by occupancy"
                hint={guestFeaturesOff ? "Link a guest list first." : "Full, spare seats, over capacity, empty."}
                checked={print.colorByOccupancy}
                disabled={guestFeaturesOff}
                onChange={(colorByOccupancy) => setPrint({ colorByOccupancy })}
              />
              <Switch
                label="Guest list pages"
                hint={guestFeaturesOff ? "Link a guest list first." : "Adds pages listing each table's guests and dietaries."}
                checked={print.guestListPage}
                disabled={guestFeaturesOff}
                onChange={(guestListPage) => setPrint({ guestListPage })}
              />
              {!unitsPerMetre ? (
                <p className="field-hint" style={{ margin: 0 }}>
                  Set a scale in <strong>Plan settings</strong> to print at a true scale or add a scale bar.
                </p>
              ) : null}
              {unitsPerMetre ? (
                <>
                  <Field
                    label="Print at"
                    hint={
                      print.fixedScale
                        ? `True scale on ${draft.canvas.paperSize}: measure a 1 m bar on paper = ${(1000 / print.fixedScale).toFixed(1)} mm.`
                        : "Fit to page scales the plan to fill the sheet."
                    }
                  >
                    <select
                      value={print.fixedScale ?? ""}
                      onChange={(e) => setPrint({ fixedScale: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">Fit to page</option>
                      {FIXED_SCALE_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                          1:{n}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Switch label="Scale bar" checked={print.scaleBar} onChange={(scaleBar) => setPrint({ scaleBar })} />
                </>
              ) : null}
              {clientLogoLibrary.loaded && clientLogoLibrary.configured ? (
                <LogoPicker
                  title="Client logo"
                  items={clientLogoLibrary.items}
                  value={draft.selectedClientLogoKey ?? ""}
                  onChange={(key) => {
                    if (!key) {
                      commit((doc) => ({
                        ...doc,
                        selectedClientLogoKey: null,
                        themeSnapshot: { ...doc.themeSnapshot, clientLogoDataUrl: undefined }
                      }));
                      return;
                    }
                    const item = clientLogoLibrary.items.find((entry) => entry.key === key);
                    if (item) void applyLogoFromLibrary(item, "clientLogoDataUrl");
                  }}
                  emptyOption={{ label: "No client logo", value: "" }}
                />
              ) : null}
              {venueLogoLibrary.loaded && venueLogoLibrary.configured ? (
                <LogoPicker
                  title="Venue logo"
                  items={venueLogoLibrary.items}
                  value={draft.selectedVenueLogoKey ?? ""}
                  onChange={(key) => {
                    if (!key) {
                      commit((doc) => ({
                        ...doc,
                        selectedVenueLogoKey: null,
                        themeSnapshot: { ...doc.themeSnapshot, venueLogoDataUrl: undefined }
                      }));
                      return;
                    }
                    const item = venueLogoLibrary.items.find((entry) => entry.key === key);
                    if (item) void applyLogoFromLibrary(item, "venueLogoDataUrl");
                  }}
                  emptyOption={{ label: "No venue logo", value: "" }}
                />
              ) : null}
            </div>
            <div className="print-dialog-preview">
              {previewUrl ? (
                <iframe className="fp-preview-frame" src={`${previewUrl}#navpanes=0&view=Fit`} title="Floorplan print preview" />
              ) : (
                <div className="print-preview-empty">
                  {objects.length ? "Drawing the preview…" : "Add something to the plan to see a preview."}
                </div>
              )}
              {previewBusy && previewUrl ? (
                <span className="print-preview-status" role="status">
                  <Loader2 size={13} aria-hidden className="spin" /> Updating preview…
                </span>
              ) : null}
              {previewError ? (
                <Callout tone="error" className="print-preview-error">
                  {previewError}
                </Callout>
              ) : null}
            </div>
          </div>
        </Modal>
      ) : null}

      <div className="editor">
        <section className="card editor-canvas-card">
          <div className="toolbar" role="toolbar" aria-label="Canvas tools">
            <div className="toolbar-add">
              <MenuButton className="toolbar-btn" icon={<CircleDot size={15} aria-hidden />} label="Tables" title="Add tables, renumber">
                <MenuLabel>Add</MenuLabel>
                {TABLE_PRESET_IDS.map((id) => presetItem(id))}
                <MenuSeparator />
                <MenuLabel>Numbering</MenuLabel>
                <MenuItem
                  icon={<ListOrdered size={15} />}
                  disabled={!hasTables}
                  hint="Left to right, top to bottom"
                  onSelect={renumberByPosition}
                >
                  Renumber by position
                </MenuItem>
                <MenuItem icon={<Hash size={15} />} disabled={!hasTables} hint="1, 2, 4 becomes 1, 2, 3" onSelect={closeNumberGaps}>
                  Close gaps in numbering
                </MenuItem>
                <MenuItem
                  icon={<Users size={15} />}
                  disabled={!tableGuests || !hasTables}
                  hint={tableGuests ? "Seats per table from the guest list" : "Link a guest list in Plan settings first"}
                  onSelect={matchSeatsToGuests}
                >
                  Match seats to guest counts
                </MenuItem>
              </MenuButton>
              <MenuButton className="toolbar-btn" icon={<Armchair size={15} aria-hidden />} label="Seating" title="Add theatre seating">
                {presetItem("seating", <Rows3 size={15} />, "Rows of chairs you can resize")}
                <MenuItem
                  icon={<SquareDashedMousePointer size={15} />}
                  hint="Drag a rectangle on the plan"
                  shortcut="F"
                  onSelect={() => {
                    setDrawMode(true);
                    setPanTool(false);
                  }}
                >
                  Fill an area…
                </MenuItem>
              </MenuButton>
              <MenuButton className="toolbar-btn" icon={<Shapes size={15} aria-hidden />} label="Room" title="Add room features">
                {ROOM_PRESET_IDS.map((id) => presetItem(id))}
              </MenuButton>
              <button type="button" className="toolbar-btn" onClick={() => addPreset("text")} title="Add a text label">
                <Type size={15} aria-hidden /> Text
              </button>
            </div>
            <button type="button" className="toolbar-btn" onClick={() => setAutoOpen(true)} title="Generate tables or theatre seating (A)">
              <WandSparkles size={15} aria-hidden /> Auto layout
            </button>
            <div className="btn-group">
              <button type="button" className="icon-btn" disabled={!historySize.undo} onClick={undo} title="Undo (⌘Z)" aria-label="Undo">
                <Undo2 size={16} />
              </button>
              <button type="button" className="icon-btn" disabled={!historySize.redo} onClick={redo} title="Redo (⇧⌘Z)" aria-label="Redo">
                <Redo2 size={16} />
              </button>
            </div>
            <MenuButton
              className="toolbar-btn"
              icon={<LayoutGrid size={15} aria-hidden />}
              label="Arrange"
              title="Align, distribute, order, duplicate, delete"
              disabled={!objects.length}
            >
              <MenuLabel>Align {canAlign ? "" : "· select two or more"}</MenuLabel>
              <MenuItem icon={<AlignStartVertical size={15} />} disabled={!canAlign} onSelect={() => alignSelected("left")}>
                Left edges
              </MenuItem>
              <MenuItem icon={<AlignCenterVertical size={15} />} disabled={!canAlign} onSelect={() => alignSelected("hcenter")}>
                Centres
              </MenuItem>
              <MenuItem icon={<AlignEndVertical size={15} />} disabled={!canAlign} onSelect={() => alignSelected("right")}>
                Right edges
              </MenuItem>
              <MenuItem icon={<AlignStartHorizontal size={15} />} disabled={!canAlign} onSelect={() => alignSelected("top")}>
                Top edges
              </MenuItem>
              <MenuItem icon={<AlignCenterHorizontal size={15} />} disabled={!canAlign} onSelect={() => alignSelected("vcenter")}>
                Middles
              </MenuItem>
              <MenuItem icon={<AlignEndHorizontal size={15} />} disabled={!canAlign} onSelect={() => alignSelected("bottom")}>
                Bottom edges
              </MenuItem>
              <MenuLabel>Distribute {canDistribute ? "" : "· select three or more"}</MenuLabel>
              <MenuItem
                icon={<AlignHorizontalDistributeCenter size={15} />}
                disabled={!canDistribute}
                onSelect={() => distributeSelected("horizontal")}
              >
                Space evenly across
              </MenuItem>
              <MenuItem
                icon={<AlignVerticalDistributeCenter size={15} />}
                disabled={!canDistribute}
                onSelect={() => distributeSelected("vertical")}
              >
                Space evenly down
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<BringToFront size={15} />} disabled={!validSelected.length} onSelect={() => reorderSelected("front")}>
                Bring to front
              </MenuItem>
              <MenuItem icon={<SendToBack size={15} />} disabled={!validSelected.length} onSelect={() => reorderSelected("back")}>
                Send to back
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<CopyPlus size={15} />} disabled={!validSelected.length} shortcut="⌘D" onSelect={duplicateSelection}>
                Duplicate
              </MenuItem>
              <MenuItem icon={<Trash2 size={15} />} danger disabled={!validSelected.length} shortcut="⌫" onSelect={deleteSelection}>
                Delete
              </MenuItem>
              <MenuItem icon={<Eraser size={15} />} danger onSelect={clearCanvas}>
                Clear the whole plan
              </MenuItem>
            </MenuButton>
            <span className="spacer" />
            <div className="btn-group" role="group" aria-label="Tools">
              <button
                type="button"
                className={`icon-btn${!panTool && !drawMode ? " icon-btn--on" : ""}`}
                aria-pressed={!panTool && !drawMode}
                onClick={() => {
                  setPanTool(false);
                  setDrawMode(false);
                }}
                title="Select and move (V)"
                aria-label="Select tool"
              >
                <MousePointer2 size={16} />
              </button>
              <button
                type="button"
                className={`icon-btn${panTool ? " icon-btn--on" : ""}`}
                aria-pressed={panTool}
                onClick={() => {
                  setPanTool((v) => !v);
                  setDrawMode(false);
                }}
                title="Hand: drag to pan (H, or hold Space)"
                aria-label="Hand tool"
              >
                <Hand size={16} />
              </button>
              <button
                type="button"
                className={`icon-btn${drawMode ? " icon-btn--on" : ""}`}
                aria-pressed={drawMode}
                onClick={() => {
                  setDrawMode((v) => !v);
                  setPanTool(false);
                }}
                title="Fill an area with seating: drag a rectangle on the plan (F)"
                aria-label="Fill an area with seating"
              >
                <SquareDashedMousePointer size={16} />
              </button>
            </div>
          </div>
          <FloorplanCanvas
            objects={objects}
            selectedIds={validSelected}
            onSelect={setSelectedIds}
            gridSize={draft.canvas.gridSize}
            snapToGrid={snapToGrid}
            view={view}
            onViewChange={(updater) => setView(updater)}
            viewportRef={canvasViewportRef}
            panActive={panTool || spaceDown}
            frame={frame}
            frameLabel={`Print area · ${draft.canvas.paperSize} ${draft.canvas.orientation}`}
            tableGuests={tableGuests}
            colorByOccupancy={print.colorByOccupancy}
            unitsPerMetre={unitsPerMetre}
            onBeginGesture={pushHistory}
            onCancelGesture={cancelGesture}
            onLive={(next) => {
              setDoc({ ...draftRef.current, objects: next });
              setDirty(true);
            }}
            highlight={
fillPrompt ? { polygons: [areaPolygon(fillPrompt.area)] } : canvasHighlight
            }
            drawMode={drawMode}
            onDrawArea={onDrawArea}
            seatEdit={seatEdit}
            onEditSeats={editSeats}
            onSeatPaint={paintSeat}
            emptyHint={
              <span>
                Add tables, seating and room features from the toolbar, or generate a layout with <strong>Auto layout</strong>.
              </span>
            }
          />
          <div className="fp-status">
            <span className="fp-status-totals" title={totalsText || undefined}>
              {totalsText || "Nothing on the plan yet"}
            </span>
            {objects.length ? (
              <button
                type="button"
                className={`fp-status-btn${issues.length ? " fp-status-btn--warn" : ""}`}
                onClick={showChecks}
                title="Show the checks"
              >
                {issues.length ? <TriangleAlert size={13} aria-hidden /> : <CircleCheck size={13} aria-hidden />}
                {issues.length ? `${issues.length} to look at` : "No problems found"}
              </button>
            ) : null}
            <span className="spacer" />
            <div className="btn-group btn-group--sm" role="group" aria-label="View">
              <button
                type="button"
                className={`icon-btn${snapToGrid ? " icon-btn--on" : ""}`}
                aria-pressed={snapToGrid}
                onClick={() => setSnapToGrid((v) => !v)}
                title="Snap to grid (hold Shift while dragging to move freely)"
                aria-label="Snap to grid"
              >
                <Grid3x3 size={16} />
              </button>
              <button
                type="button"
                className={`icon-btn${showFrame ? " icon-btn--on" : ""}`}
                aria-pressed={showFrame}
                onClick={() => setShowFrame((v) => !v)}
                title="Show the area that will be printed"
                aria-label="Show print area"
              >
                <Frame size={16} />
              </button>
            </div>
            <div className="btn-group btn-group--sm" role="group" aria-label="Zoom">
              <button type="button" className="icon-btn" onClick={() => zoomBy(1 / 1.2)} title="Zoom out" aria-label="Zoom out">
                <ZoomOut size={16} />
              </button>
              <span className="toolbar-zoom">{Math.round(view.zoom * 100)}%</span>
              <button type="button" className="icon-btn" onClick={() => zoomBy(1.2)} title="Zoom in" aria-label="Zoom in">
                <ZoomIn size={16} />
              </button>
              <button type="button" className="icon-btn" onClick={zoomToFit} title="Zoom to fit" aria-label="Zoom to fit">
                <Maximize size={16} />
              </button>
            </div>
            <button type="button" className="fp-status-btn" onClick={() => setSettingsOpen(true)} title="Grid and scale, in Plan settings">
              <Ruler size={13} aria-hidden />
              {metresPerSquare ? `1 square = ${Math.round(metresPerSquare * 100) / 100} m` : "No scale set"}
            </button>
            <MenuButton
              className="fp-status-btn"
              icon={<CircleHelp size={15} aria-hidden />}
              chevron={false}
              align="end"
              ariaLabel="Keyboard and mouse shortcuts"
              title="Keyboard and mouse shortcuts"
            >
              <MenuPanel>
                <dl className="shortcut-list">
                  {SHORTCUTS.map(([keys, what]) => (
                    <div key={keys}>
                      <dt>{keys}</dt>
                      <dd>{what}</dd>
                    </div>
                  ))}
                </dl>
              </MenuPanel>
            </MenuButton>
          </div>
        </section>

        <aside className="editor-side">
          {primary ? (
            <Inspector
              primary={primary}
              selectionCount={validSelected.length}
              tableGuests={tableGuests}
              totalGuests={totals.guests ?? 0}
              gridSize={draft.canvas.gridSize}
              unitsPerMetre={unitsPerMetre}
              onPatch={patchSelected}
              seatEdit={seatEdit}
              onClearUnderObjects={clearSeatsUnderObjects}
              onFillShape={fillSelectedShape}
              onSeatEdit={(next) => setSeatEdit(next && primary ? { id: primary.id, tool: next } : null)}
              onDelete={deleteSelection}
              onOrder={reorderSelected}
            />
          ) : objects.length ? (
            <>
              <PlanPanel
                measurements={measurements}
                limits={draft.limits}
                scaled={Boolean(unitsPerMetre)}
                seatingBlocks={seatingBlocks.length}
                activeId={activeMeasurement?.id ?? null}
                onShow={showMeasurement}
                onLimits={setLimits}
                onSelectAllSeating={() => setSelectedIds(seatingBlocks.map((o) => o.id))}
              />
              <Section
                id="fp-checks"
                title="Checks"
                summary={issues.length ? `${issues.length} to look at` : "All clear"}
                description={issues.length ? "Click one to select what it's about." : undefined}
              >
                {issues.length === 0 ? (
                  <p className="field-hint" style={{ margin: 0 }}>
                    {hasTables || totals.blocks ? "No problems found." : "Add some tables or seating to see checks."}
                  </p>
                ) : (
                  <ul className="issue-list">
                    {issues.map((issue) => (
                      <li key={issue.id}>
                        <button
                          type="button"
                          className={`issue issue--${issue.severity}`}
                          disabled={!issue.objectIds.length}
                          onClick={() => setSelectedIds(issue.objectIds)}
                        >
                          {issue.message}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </>
          ) : (
            <Section title="Start a plan" description="Begin with a generated layout, or build it up piece by piece from the toolbar.">
              <div className="stack">
                <button type="button" className="btn-primary" onClick={() => setAutoOpen(true)}>
                  <WandSparkles size={15} aria-hidden /> Auto layout…
                </button>
                <button type="button" onClick={() => addPreset("room")}>
                  <Shapes size={15} aria-hidden /> Draw the room outline
                </button>
                <button type="button" onClick={() => setSettingsOpen(true)}>
                  <Settings2 size={15} aria-hidden /> Link a guest list or set the scale
                </button>
              </div>
            </Section>
          )}
        </aside>
      </div>

      <Toasts>
        {error ? (
          <Callout tone="error" onDismiss={() => setError("")}>
            {error}
          </Callout>
        ) : null}
        {notice ? (
          <Callout tone="info" onDismiss={() => setNotice("")}>
            {notice}
          </Callout>
        ) : null}
      </Toasts>
    </main>
  );
}

function GeneratePrompt({
  kind,
  handPlaced,
  other,
  removeOther,
  onRemoveOther,
  onCancel,
  onRun
}: {
  kind: "tables" | "theatre";
  handPlaced: number;
  other: number;
  removeOther: boolean;
  onRemoveOther: (on: boolean) => void;
  onCancel: () => void;
  onRun: (keepHandPlaced: boolean) => void;
}) {
  const tables = kind === "tables";
  const noun = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const otherNoun = tables ? noun(other, "seating block", "seating blocks") : noun(other, "table", "tables");
  return (
    <Modal
      title={tables ? "Generate tables" : "Generate theatre seating"}
      size="sm"
      onClose={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          {handPlaced ? (
            <button type="button" onClick={() => onRun(true)}>
              Keep them
            </button>
          ) : null}
          <button type="button" className="btn-primary" onClick={() => onRun(false)}>
            {handPlaced ? (tables ? "Replace all tables" : "Replace all seating") : "Generate"}
          </button>
        </>
      }
    >
      <div className="stack">
        {handPlaced ? (
          <p style={{ margin: 0 }}>
            {tables
              ? `${noun(handPlaced, "table was", "tables were")} added by hand rather than by Auto layout. Generating replaces every table on the plan; you can keep the hand-placed ones instead, and new tables will skip their numbers.`
              : `${noun(handPlaced, "seating block was", "seating blocks were")} added by hand rather than by Auto layout. Generating replaces all the seating on the plan; you can keep the hand-placed blocks instead.`}{" "}
            Shapes and labels are kept either way, and you can undo.
          </p>
        ) : null}
        {other ? (
          <Switch
            label={`Also remove the ${otherNoun}`}
            hint={
              tables
                ? "Off keeps the theatre seating alongside the new tables."
                : "Off keeps the tables alongside the new seating, e.g. to compare a dinner and a conference layout."
            }
            checked={removeOther}
            onChange={onRemoveOther}
          />
        ) : null}
      </div>
    </Modal>
  );
}

function TheatreForm({
  settings,
  stageLabel,
  scaled,
  hasSeating,
  onChange,
  onGenerate
}: {
  settings: ReturnType<typeof resolveTheatreSettings>;
  stageLabel: string | null;
  scaled: boolean;
  hasSeating: boolean;
  onChange: (patch: Partial<NonNullable<FloorplanDocument["autoLayout"]["theatre"]>>, key?: string) => void;
  onGenerate: () => void;
}) {
  const rows = theatreRows(settings);
  const actual = rows * settings.seatsPerRow;
  const aisles = Math.min(settings.aisles, Math.max(0, settings.seatsPerRow - 1));
  const shape = settings.rowShape;
  return (
    <>
      <RowShapeFields
        shape={shape}
        curveRadiusM={settings.curveRadiusM}
        chevronAngle={settings.chevronAngle}
        onChange={(patch) => onChange(patch, "theatreShape")}
      />
      <div className="form-grid">
        <Field label="Seats">
          <NumericInput
            min={1}
            max={MAX_THEATRE_SEATS}
            integer
            value={settings.totalSeats}
            onCommit={(n) => {
              if (n != null) onChange({ totalSeats: n }, "theatreTotal");
            }}
          />
        </Field>
        <Field label={shape === "curved" ? "Seats in front row" : "Seats per row"}>
          <NumericInput
            min={1}
            max={200}
            integer
            value={settings.seatsPerRow}
            onCommit={(n) => {
              if (n != null) onChange({ seatsPerRow: n }, "theatrePerRow");
            }}
          />
        </Field>
        <p className="field-hint span-all" style={{ margin: 0 }}>
          {shape === "curved" ? (
            <>Back rows of a curve hold more seats, so rows are added until there are at least {settings.totalSeats}.</>
          ) : (
            <>
              {rows} row{rows === 1 ? "" : "s"} of {settings.seatsPerRow} = <strong>{actual}</strong> seats
              {actual > settings.totalSeats ? ` (${actual - settings.totalSeats} more than asked, to fill the back row)` : ""}.
            </>
          )}
          {shape === "chevron" ? " A chevron always has a centre aisle." : ""}
        </p>
        <Field label="Chair" className="span-all">
          <select value={settings.chairPreset} onChange={(e) => onChange({ chairPreset: e.target.value })}>
            {CHAIR_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} ({Math.round(p.widthM * 100)} × {Math.round(p.depthM * 100)} cm)
              </option>
            ))}
          </select>
        </Field>
        <Field label="Seatway (m)" hint="Clear gap between rows.">
          <NumericInput
            min={0}
            max={5}
            value={settings.seatwayM}
            onCommit={(n) => {
              if (n != null) onChange({ seatwayM: n }, "theatreSeatway");
            }}
          />
        </Field>
        <Field label="Aisles">
          <NumericInput
            min={0}
            max={20}
            integer
            value={settings.aisles}
            onCommit={(n) => {
              if (n != null) onChange({ aisles: n }, "theatreAisles");
            }}
          />
        </Field>
        <Field label="Aisle width (m)">
          <NumericInput
            min={0}
            max={20}
            value={settings.aisleWidthM}
            onCommit={(n) => {
              if (n != null) onChange({ aisleWidthM: n }, "theatreAisleW");
            }}
          />
        </Field>
        <Field label="Cross aisle every" hint="Rows; 0 for none.">
          <NumericInput
            min={0}
            max={200}
            integer
            value={settings.crossAisleEvery}
            onCommit={(n) => {
              if (n != null) onChange({ crossAisleEvery: n }, "theatreCross");
            }}
          />
        </Field>
      </div>
      {aisles > 0 && shape === "straight" ? (
        <Switch
          label="A separate block for each section"
          hint="Each run of seats between aisles becomes its own block, so it can be moved on its own."
          checked={settings.splitAtAisles}
          onChange={(splitAtAisles) => onChange({ splitAtAisles })}
        />
      ) : null}
      <Field label="Audience faces" as="div">
        <Segmented
          value={settings.facing}
          options={[
            { value: "up", label: "Up" },
            { value: "down", label: "Down" },
            { value: "left", label: "Left" },
            { value: "right", label: "Right" }
          ]}
          onChange={(facing: TheatreFacing) => onChange({ facing })}
        />
      </Field>
      <Field
        label="Front row to stage (m)"
        hint={
          stageLabel
            ? `Measured from “${stageLabel}”.`
            : "No shape labelled Stage yet, so the seating goes in the middle of the view."
        }
      >
        <NumericInput
          min={0}
          max={100}
          value={settings.frontDistanceM}
          disabled={!stageLabel}
          onCommit={(n) => {
            if (n != null) onChange({ frontDistanceM: n }, "theatreFront");
          }}
        />
      </Field>
      {!scaled ? (
        <p className="field-hint" style={{ margin: 0 }}>
          No scale is set, so chair sizes are approximate. Set one in Plan settings for true sizes.
        </p>
      ) : null}
      <button type="button" onClick={onGenerate}>
        Generate seating
      </button>
      {hasSeating ? (
        <p className="field-hint" style={{ margin: 0 }}>
          Replaces the existing seating. Tables, shapes and labels are kept unless you choose otherwise. Undo is available.
        </p>
      ) : null}
    </>
  );
}

function FillPrompt({
  area,
  initialMargin,
  initialFacing,
  settings,
  objects,
  unitsPerMetre,
  clearance,
  scaled,
  onCancel,
  onFill
}: {
  area: FillArea;
  initialMargin: number;
  initialFacing: TheatreFacing;
  settings: ReturnType<typeof resolveTheatreSettings>;
  objects: FloorplanCanvasObject[];
  unitsPerMetre: number;
  clearance: number;
  scaled: boolean;
  onCancel: () => void;
  onFill: (
    blocks: FloorplanCanvasObject[],
    patch: Partial<NonNullable<FloorplanDocument["autoLayout"]["theatre"]>>
  ) => void;
}) {
  const [margin, setMargin] = useState(initialMargin);
  const [form, setForm] = useState({ ...settings, facing: initialFacing });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const result = useMemo(
    () =>
      fillAreaWithSeating(area, form, {
        unitsPerMetre,
        marginM: margin,
        maxRun: form.maxRun,
        objects,
        blocked: (block) => seatsBlocked(block, objects, clearance)
      }),
    [area, form, margin, unitsPerMetre, objects, clearance]
  );
  const total = result.blocks.reduce((n, b) => n + (b.type === "seating" ? seatingRowLengths(b).reduce((x, y) => x + y, 0) : 0), 0);
  const takenOut = total - result.seats;
  const shaped = form.rowShape !== "straight";

  return (
    <Modal
      title="Fill with seating"
      size="sm"
      onClose={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!result.blocks.length}
            onClick={() =>
              onFill(result.blocks, {
                facing: form.facing,
                maxRun: form.maxRun,
                chairPreset: form.chairPreset,
                seatwayM: form.seatwayM,
                aisleWidthM: form.aisleWidthM,
                splitAtAisles: form.splitAtAisles,
                crossAisleEvery: form.crossAisleEvery,
                frontDistanceM: form.frontDistanceM,
                rowShape: form.rowShape,
                curveRadiusM: form.curveRadiusM,
                chevronAngle: form.chevronAngle
              })
            }
          >
            Fill
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="fill-summary" style={{ margin: 0 }}>
          {result.blocks.length ? (
            <>
              <strong>{result.seats}</strong> seats: {result.rows} row{result.rows === 1 ? "" : "s"}
              {form.rowShape === "curved" ? `, ${result.perRow} in the front row` : ` of ${result.perRow}`}
              {result.aisles ? `, ${result.aisles} aisle${result.aisles === 1 ? "" : "s"}` : ", no aisles"}
              {takenOut
                ? `, ${takenOut} chair${takenOut === 1 ? "" : "s"} left out ${shaped ? "at the edges or " : ""}around other objects`
                : ""}
              .
            </>
          ) : (
            "No chairs fit in this area with these settings."
          )}
        </p>
        <RowShapeFields
          shape={form.rowShape}
          curveRadiusM={form.curveRadiusM}
          chevronAngle={form.chevronAngle}
          onChange={set}
        />
        <Field label="Audience faces" as="div" hint={area.rotation ? "Relative to the shape." : undefined}>
          <Segmented
            value={form.facing}
            options={[
              { value: "up", label: "Up" },
              { value: "down", label: "Down" },
              { value: "left", label: "Left" },
              { value: "right", label: "Right" }
            ]}
            onChange={(facing: TheatreFacing) => set({ facing })}
          />
        </Field>
        <div className="form-grid">
          <Field label="Most seats between aisles" hint="Aisles are added to keep every run within this.">
            <NumericInput min={1} max={200} integer value={form.maxRun} onCommit={(n) => n != null && set({ maxRun: n })} />
          </Field>
          <Field label="Margin (m)" hint="Clear space kept inside the edges.">
            <NumericInput min={0} max={20} value={margin} onCommit={(n) => n != null && setMargin(n)} />
          </Field>
          <Field label="Chair" className="span-all">
            <select value={form.chairPreset} onChange={(e) => set({ chairPreset: e.target.value })}>
              {CHAIR_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({Math.round(p.widthM * 100)} × {Math.round(p.depthM * 100)} cm)
                </option>
              ))}
            </select>
          </Field>
          <Field label="Seatway (m)">
            <NumericInput min={0} max={5} value={form.seatwayM} onCommit={(n) => n != null && set({ seatwayM: n })} />
          </Field>
          <Field label="Aisle width (m)">
            <NumericInput min={0} max={20} value={form.aisleWidthM} onCommit={(n) => n != null && set({ aisleWidthM: n })} />
          </Field>
          <Field label="Cross aisle every" hint="Rows; 0 for none.">
            <NumericInput
              min={0}
              max={200}
              integer
              value={form.crossAisleEvery}
              onCommit={(n) => n != null && set({ crossAisleEvery: n })}
            />
          </Field>
          <Field label="Front row to stage (m)" hint="Used when a stage reaches into the area.">
            <NumericInput min={0} max={100} value={form.frontDistanceM} onCommit={(n) => n != null && set({ frontDistanceM: n })} />
          </Field>
        </div>
        {form.rowShape === "straight" ? (
          <Switch
            label="A separate block for each section"
            checked={form.splitAtAisles}
            onChange={(splitAtAisles) => set({ splitAtAisles })}
          />
        ) : null}
        {!scaled ? (
          <p className="field-hint" style={{ margin: 0 }}>
            No scale is set, so chair sizes are approximate. Set one in Plan settings for true sizes.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/** Row shape for the generators: straight, curved (with a radius) or chevron (with a wing angle). */
function RowShapeFields({
  shape,
  curveRadiusM,
  chevronAngle,
  onChange
}: {
  shape: RowShape;
  curveRadiusM: number;
  chevronAngle: number;
  onChange: (patch: { rowShape?: RowShape; curveRadiusM?: number; chevronAngle?: number }) => void;
}) {
  return (
    <>
      <Field label="Rows are" as="div">
        <Segmented value={shape} options={ROW_SHAPES} onChange={(rowShape) => onChange({ rowShape })} />
      </Field>
      {shape === "curved" ? (
        <Field label="Curve radius (m)" hint="From the point the rows curve round to the front row. Leave blank to match the row length.">
          <NumericInput
            min={0}
            max={500}
            allowEmpty
            placeholder="Auto"
            value={curveRadiusM > 0 ? curveRadiusM : null}
            onCommit={(n) => onChange({ curveRadiusM: n ?? 0 })}
          />
        </Field>
      ) : null}
      {shape === "chevron" ? (
        <Field label="Wing angle (°)" hint="How far each side turns in towards the middle.">
          <NumericInput
            min={0}
            max={CHEVRON_MAX_ANGLE}
            value={chevronAngle}
            onCommit={(n) => n != null && onChange({ chevronAngle: n })}
          />
        </Field>
      ) : null}
    </>
  );
}
