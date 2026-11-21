"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Copy,
  CopyPlus,
  Download,
  Eraser,
  Eye,
  FilePlus,
  FolderOpen,
  Frame,
  Grid3x3,
  Hand,
  Maximize,
  Redo2,
  Save,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { LogoPicker } from "@/app/components/LogoPicker";
import { Callout, Field, Modal, PageHeader, Section, Segmented, Switch, Toasts } from "@/app/components/ui";
import { FloorplanCanvas, type CanvasView, clampZoom } from "@/app/floorplans/FloorplanCanvas";
import { Inspector } from "@/app/floorplans/Inspector";
import { NumericInput } from "@/app/floorplans/NumericInput";
import { MAX_FLOORPLAN_GRID } from "@/lib/validation/limits";
import { OBJECT_PRESETS } from "@/app/floorplans/presets";
import { buildPlanIssues, planTotals, type PlanIssue } from "@/lib/floorplans/checks";
import { findFreeCentre } from "@/lib/floorplans/collision";
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

const AUTOSAVE_KEY = "floorplan-autosave-v1";
const MAX_HISTORY = 100;
const MAX_GRID = MAX_FLOORPLAN_GRID;
const MAX_GENERATED_TABLES = 400;
const UNTITLED = "Untitled floorplan";
/** Ids Auto layout gives its tables ("table-12", "table-top"); anything else was placed by hand. */
const GENERATED_ID = /^table-/;

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

  // Guest list link
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [guestRecords, setGuestRecords] = useState<GuestRecord[] | null>(null);
  const [guestsLoading, setGuestsLoading] = useState(false);

  const [recovered, setRecovered] = useState<Autosave | null>(null);
  const [generatePrompt, setGeneratePrompt] = useState(false);
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

  function generateTables() {
    if (handPlacedTables.length) {
      setGeneratePrompt(true);
      return;
    }
    runGenerate(false);
  }

  function runGenerate(keepHandPlaced: boolean) {
    setGeneratePrompt(false);
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
      objects: [...doc.objects.filter((o) => o.type !== "table" || keptIds.has(o.id)), ...generated]
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

  async function previewFloorplan() {
    setBusy(true);
    setError("");
    try {
      const blob = await renderPdfBlob();
      setPreviewUrl(URL.createObjectURL(new Blob([blob], { type: "application/pdf" })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed.");
    } finally {
      setBusy(false);
    }
  }

  function closePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
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
    if (listOpen || previewUrl || generatePrompt) return;
    const meta = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (meta && key === "s") {
      event.preventDefault();
      if (!busy) void saveCurrent();
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
    if (event.key === "Delete" || event.key === "Backspace") {
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
            <button type="button" className="icon-btn icon-btn--bordered" onClick={startNew} disabled={busy} aria-label="New floorplan" title="New">
              <FilePlus size={16} />
            </button>
            <button
              type="button"
              className="icon-btn icon-btn--bordered"
              onClick={() => {
                loadDocument(copyForDuplicate(draftRef.current), true);
              }}
              disabled={busy}
              aria-label="Duplicate floorplan"
              title="Duplicate floorplan"
            >
              <Copy size={16} />
            </button>
            <button
              type="button"
              className="icon-btn icon-btn--bordered btn-danger"
              onClick={() => void deleteCurrent()}
              disabled={busy}
              aria-label={isSaved ? "Delete floorplan" : "Discard floorplan"}
              title={isSaved ? "Delete" : "Discard"}
            >
              <Trash2 size={16} />
            </button>
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

      {generatePrompt ? (
        <Modal
          title="Replace tables?"
          size="sm"
          onClose={() => setGeneratePrompt(false)}
          footer={
            <>
              <button type="button" onClick={() => setGeneratePrompt(false)}>
                Cancel
              </button>
              <button type="button" onClick={() => runGenerate(true)}>
                Keep them
              </button>
              <button type="button" className="btn-primary" onClick={() => runGenerate(false)}>
                Replace all tables
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            {handPlacedTables.length} table{handPlacedTables.length === 1 ? " was" : "s were"} added by hand rather than by
            Auto layout. Generating replaces every table on the plan; you can keep the hand-placed ones instead, and new
            tables will skip their numbers. Shapes and labels are kept either way, and you can undo.
          </p>
        </Modal>
      ) : null}

      {previewUrl ? (
        <Modal title="Print preview" size="lg" onClose={closePreview}>
          <iframe className="fp-preview-frame" src={previewUrl} title="Floorplan print preview" />
        </Modal>
      ) : null}

      <div className="editor">
        <section className="card editor-canvas-card">
          <div className="toolbar" role="toolbar" aria-label="Canvas tools">
            <div className="btn-group">
              <button type="button" className="icon-btn" disabled={!historySize.undo} onClick={undo} title="Undo (⌘Z)" aria-label="Undo">
                <Undo2 size={16} />
              </button>
              <button type="button" className="icon-btn" disabled={!historySize.redo} onClick={redo} title="Redo (⇧⌘Z)" aria-label="Redo">
                <Redo2 size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={!validSelected.length}
                onClick={duplicateSelection}
                title="Duplicate selection (⌘D)"
                aria-label="Duplicate selection"
              >
                <CopyPlus size={16} />
              </button>
              <button
                type="button"
                className="icon-btn btn-danger"
                disabled={!validSelected.length}
                onClick={deleteSelection}
                title="Delete selection (Delete)"
                aria-label="Delete selection"
              >
                <Trash2 size={16} />
              </button>
              <button
                type="button"
                className="icon-btn btn-danger"
                disabled={!objects.length}
                onClick={clearCanvas}
                title="Clear canvas"
                aria-label="Clear canvas"
              >
                <Eraser size={16} />
              </button>
            </div>
            <div className="btn-group">
              <button type="button" className="icon-btn" disabled={!canAlign} onClick={() => alignSelected("left")} title="Align left" aria-label="Align left">
                <AlignStartVertical size={16} />
              </button>
              <button type="button" className="icon-btn" disabled={!canAlign} onClick={() => alignSelected("hcenter")} title="Align centre" aria-label="Align centre">
                <AlignCenterVertical size={16} />
              </button>
              <button type="button" className="icon-btn" disabled={!canAlign} onClick={() => alignSelected("right")} title="Align right" aria-label="Align right">
                <AlignEndVertical size={16} />
              </button>
              <button type="button" className="icon-btn" disabled={!canAlign} onClick={() => alignSelected("top")} title="Align top" aria-label="Align top">
                <AlignStartHorizontal size={16} />
              </button>
              <button type="button" className="icon-btn" disabled={!canAlign} onClick={() => alignSelected("vcenter")} title="Align middle" aria-label="Align middle">
                <AlignCenterHorizontal size={16} />
              </button>
              <button type="button" className="icon-btn" disabled={!canAlign} onClick={() => alignSelected("bottom")} title="Align bottom" aria-label="Align bottom">
                <AlignEndHorizontal size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={!canDistribute}
                onClick={() => distributeSelected("horizontal")}
                title="Distribute horizontally"
                aria-label="Distribute horizontally"
              >
                <AlignHorizontalDistributeCenter size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={!canDistribute}
                onClick={() => distributeSelected("vertical")}
                title="Distribute vertically"
                aria-label="Distribute vertically"
              >
                <AlignVerticalDistributeCenter size={16} />
              </button>
            </div>
            <span className="spacer" />
            <div className="btn-group">
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
              <button
                type="button"
                className={`icon-btn${panTool ? " icon-btn--on" : ""}`}
                aria-pressed={panTool}
                onClick={() => setPanTool((v) => !v)}
                title="Hand tool: drag to pan (or hold Space)"
                aria-label="Hand tool"
              >
                <Hand size={16} />
              </button>
            </div>
            <div className="btn-group">
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
            emptyHint={
              <span>
                Add tables from <strong>Add to plan</strong>, or generate a grid with <strong>Auto layout</strong>.
              </span>
            }
          />
          <div className="editor-hint">
            Drag to move · Shift-drag moves freely · Drag the background to select · Space-drag or ⌘/Ctrl-scroll to pan and zoom
            · Arrow keys nudge · ⌘C / ⌘V / ⌘D copy, paste, duplicate
          </div>
        </section>

        <aside className="editor-side">

          <Section title="Add to plan" collapsible defaultOpen>
            <div className="preset-grid">
              {OBJECT_PRESETS.map((preset) => (
                <button key={preset.id} type="button" className="btn-sm" onClick={() => addPreset(preset.id)}>
                  {preset.label}
                </button>
              ))}
            </div>
          </Section>

          {primary ? (
            <Inspector
              primary={primary}
              selectionCount={validSelected.length}
              tableGuests={tableGuests}
              totalGuests={totals.guests ?? 0}
              gridSize={draft.canvas.gridSize}
              unitsPerMetre={unitsPerMetre}
              onPatch={patchSelected}
              onDelete={deleteSelection}
              onOrder={reorderSelected}
            />
          ) : null}

          <Section
            title="Checks"
            collapsible
            defaultOpen
            summary={issues.length ? `${issues.length} to look at` : "All clear"}
            description={`${totals.tables} table${totals.tables === 1 ? "" : "s"} · ${totals.seats} seats${
              totals.guests != null ? ` · ${totals.guests} guests` : ""
            }`}
          >
            {issues.length === 0 ? (
              <p className="field-hint" style={{ margin: 0 }}>
                {hasTables ? "No problems found." : "Add some tables to see checks."}
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

          <Section title="Guest list" collapsible defaultOpen={Boolean(draft.projectId)} summary={linkedProject?.name ?? "Not linked"}>
            <div className="stack">
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
            </div>
          </Section>

          <Section
            title="Grid and scale"
            collapsible
            defaultOpen={false}
            summary={metresPerSquare ? `1 square = ${Math.round(metresPerSquare * 100) / 100} m` : "No scale set"}
          >
            <div className="stack">
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
          </Section>

          <Section title="Print">
            <div className="stack">
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
                  Set a scale under <strong>Grid and scale</strong> to print at a true scale or add a scale bar.
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
            <div className="card-foot card-foot--inset">
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
              <button type="button" onClick={() => void previewFloorplan()} disabled={busy}>
                <Eye size={16} aria-hidden /> Preview
              </button>
              <button type="button" className="btn-primary" onClick={() => void printFloorplan()} disabled={busy}>
                <Download size={16} aria-hidden />
                {outputFormat === "png" ? "Export PNG" : "Print PDF"}
              </button>
            </div>
          </Section>

          <Section
            title="Numbering"
            collapsible
            defaultOpen={false}
            summary="Renumber tables by position or close gaps"
          >
            <div className="stack">
              <button type="button" onClick={renumberByPosition} disabled={!hasTables}>
                Renumber by position
              </button>
              <button type="button" onClick={closeNumberGaps} disabled={!hasTables}>
                Close gaps in numbering
              </button>
              <p className="field-hint" style={{ margin: 0 }}>
                Position numbering runs left to right, top to bottom. Non-numeric tables (like “Top”) are left alone. Both are undoable.
              </p>
            </div>
          </Section>

          <Section
            title="Auto layout"
            collapsible
            defaultOpen={objects.length === 0}
            summary="Generate a numbered grid of tables"
          >
            <div className="stack">
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
              <button type="button" onClick={generateTables}>
                Generate tables
              </button>
              {hasTables ? (
                <p className="field-hint" style={{ margin: 0 }}>
                  Replaces the existing tables. Shapes and labels are kept. Undo is available.
                </p>
              ) : null}
            </div>
          </Section>
        </aside>
      </div>

      <Toasts>
        {error ? (
          <Callout tone="error" onDismiss={() => setError("")}>
            {error}
          </Callout>
        ) : null}
      </Toasts>
    </main>
  );
}
