"use client";

import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Circle,
  CircleDot,
  Copy,
  Download,
  Eraser,
  FolderOpen,
  Maximize,
  RotateCcw,
  Save,
  Square,
  SquareDashed,
  SquareDashedMousePointer,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { LogoPicker } from "@/app/components/LogoPicker";
import { Callout, Field, Modal, PageHeader, Section, Segmented, Toasts } from "@/app/components/ui";
import { buildEmptyFloorplanDraft, buildTablesFromAutoLayout, copyForDuplicate } from "@/lib/floorplans/model";
import { PAPER_SIZE_OPTIONS } from "@/lib/paperSizes";
import { readResponseError } from "@/lib/http/readError";
import { downloadBlob, downloadPdfBlobAsPngs } from "@/lib/pdf/pdfToPngExport";
import type { FloorplanCanvasObject, FloorplanDocument, FloorplanListItem } from "@/types";

/** Next free table number: one past the highest numeric table (shapes and labels don't count). */
function nextTableNumber(objects: FloorplanCanvasObject[]): string {
  let highest = 0;
  for (const obj of objects) {
    if (obj.type !== "table") continue;
    const n = Number(obj.tableNumber);
    if (Number.isInteger(n) && n > highest) highest = n;
  }
  return String(highest + 1);
}

const PAPER_OPTIONS = PAPER_SIZE_OPTIONS.map((o) => ({ value: o.value, label: o.value }));
const ORIENTATION_OPTIONS = [
  { value: "portrait" as const, label: "Portrait" },
  { value: "landscape" as const, label: "Landscape" }
];

function snap(value: number, grid: number, free: boolean): number {
  if (free) return value;
  return Math.round(value / grid) * grid;
}

export default function FloorplansPage() {
  const [draft, setDraft] = useState<FloorplanDocument>(() => buildEmptyFloorplanDraft());
  const [undoStack, setUndoStack] = useState<FloorplanDocument[]>([]);
  const [items, setItems] = useState<FloorplanListItem[]>([]);
  const [tableCount, setTableCount] = useState(12);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{
    ids: string[];
    startPoint: { x: number; y: number };
    startPositions: Record<string, { x: number; y: number }>;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const [outputFormat, setOutputFormat] = useState<"pdf" | "png">("pdf");
  const [listOpen, setListOpen] = useState(false);
  const [venueLogoLibrary, setVenueLogoLibrary] = useState<{
    loaded: boolean;
    configured: boolean;
    items: Array<{ key: string; label: string; assetUrl: string }>;
  }>({ loaded: false, configured: false, items: [] });
  const [clientLogoLibrary, setClientLogoLibrary] = useState<{
    loaded: boolean;
    configured: boolean;
    items: Array<{ key: string; label: string; assetUrl: string }>;
  }>({ loaded: false, configured: false, items: [] });

  const selected = useMemo(
    () => draft.objects.find((obj) => obj.id === activeId) ?? null,
    [activeId, draft.objects]
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  function pushUndoSnapshot(snapshot?: FloorplanDocument) {
    const base = snapshot ?? draft;
    setUndoStack((previous) => [...previous, structuredClone(base)].slice(-80));
  }

  function undo() {
    if (!undoStack.length) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((stack) => stack.slice(0, -1));
    setDraft(previous);
    setActiveId(null);
    setSelectedIds([]);
  }

  useEffect(() => {
    void refreshList();
    void Promise.all([refreshVenueLogoLibrary(), refreshClientLogoLibrary()]);
  }, []);

  async function refreshList() {
    const response = await fetch("/api/floorplans/saved");
    if (!response.ok) throw new Error(await readResponseError(response, "Failed to list floorplans."));
    const payload = await response.json();
    setItems(Array.isArray(payload.items) ? payload.items : []);
  }

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

  function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read image."));
      reader.readAsDataURL(blob);
    });
  }

  async function applyLogoFromLibrary(
    item: { assetUrl: string; key: string },
    field: "venueLogoDataUrl" | "clientLogoDataUrl"
  ) {
    setError("");
    try {
      const response = await fetch(item.assetUrl);
      if (!response.ok) throw new Error("Could not load that logo from storage.");
      const blob = await response.blob();
      const dataUrl = await blobToDataUrl(blob);
      setDraft((prev) => ({
        ...prev,
        themeSnapshot: { ...prev.themeSnapshot, [field]: dataUrl },
        selectedVenueLogoKey: field === "venueLogoDataUrl" ? item.key : prev.selectedVenueLogoKey ?? null,
        selectedClientLogoKey: field === "clientLogoDataUrl" ? item.key : prev.selectedClientLogoKey ?? null
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply logo.");
    }
  }

  async function saveCurrent() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/floorplans/saved", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft)
      });
      if (!response.ok) throw new Error(await readResponseError(response, "Save failed."));
      const payload = await response.json();
      setDraft((prev) => ({ ...prev, id: payload.id as string, savedAt: payload.savedAt as string }));
      await refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function loadItem(id: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/floorplans/saved/${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error(await readResponseError(response, "Load failed."));
      const payload = await response.json();
      setDraft(payload.floorplan as FloorplanDocument);
      setActiveId(null);
      setSelectedIds([]);
      setUndoStack([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteCurrent() {
    const isSaved = items.some((item) => item.id === draft.id);
    if (!isSaved) {
      // Never-saved draft: nothing to delete on the server, so treat this as "discard".
      if (!window.confirm("This floorplan has not been saved. Discard it and start a new one?")) return;
      pushUndoSnapshot();
      setDraft(buildEmptyFloorplanDraft());
      setActiveId(null);
      setSelectedIds([]);
      return;
    }
    if (!window.confirm("Delete this saved floorplan?")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/floorplans/saved/${encodeURIComponent(draft.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readResponseError(response, "Delete failed."));
      setDraft(buildEmptyFloorplanDraft());
      setActiveId(null);
      setSelectedIds([]);
      setUndoStack([]);
      await refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  async function printFloorplan() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/floorplans/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ floorplan: draft })
      });
      if (!response.ok) throw new Error(await readResponseError(response, "Print failed."));
      const blob = await response.blob();
      if (outputFormat === "png") {
        await downloadPdfBlobAsPngs(blob, "floorplan");
      } else {
        downloadBlob(blob, "floorplan.pdf");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Print failed.");
    } finally {
      setBusy(false);
    }
  }

  function seedFromAutoLayout() {
    pushUndoSnapshot();
    const nextTables = buildTablesFromAutoLayout(draft.autoLayout, tableCount);
    setDraft((prev) => ({
      ...prev,
      metadata: {
        title: prev.metadata.title || prev.themeSnapshot.eventName,
        subtitle: prev.metadata.subtitle || prev.themeSnapshot.eventSubtitle || ""
      },
      objects: [...nextTables, ...prev.objects.filter((obj) => obj.type !== "table")]
    }));
  }

  function addObject(kind: FloorplanCanvasObject["type"]) {
    const id = crypto.randomUUID();
    if (kind === "table") {
      setDraft((prev) => ({
        ...prev,
        objects: [...prev.objects, { id, type: "table", tableNumber: nextTableNumber(prev.objects), x: 96, y: 96, radius: 18 }]
      }));
      return;
    }
    if (kind === "rect") {
      setDraft((prev) => ({ ...prev, objects: [...prev.objects, { id, type: "rect", x: 120, y: 120, width: 90, height: 60 }] }));
      return;
    }
    if (kind === "circle") {
      setDraft((prev) => ({ ...prev, objects: [...prev.objects, { id, type: "circle", x: 140, y: 140, radius: 30 }] }));
      return;
    }
    setDraft((prev) => ({ ...prev, objects: [...prev.objects, { id, type: "text", x: 160, y: 160, text: "Label", fontSize: 16 }] }));
  }

  function clearCanvas() {
    if (!window.confirm("Clear all objects from this canvas?")) return;
    pushUndoSnapshot();
    setDraft((prev) => ({ ...prev, objects: [] }));
    setActiveId(null);
    setSelectedIds([]);
  }

  function objectBounds(items: FloorplanCanvasObject[]) {
    if (!items.length) return null;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const item of items) {
      if (item.type === "table") {
        minX = Math.min(minX, item.x - item.radius);
        minY = Math.min(minY, item.y - item.radius);
        maxX = Math.max(maxX, item.x + item.radius);
        maxY = Math.max(maxY, item.y + item.radius);
        continue;
      }
      if (item.type === "rect") {
        minX = Math.min(minX, item.x);
        minY = Math.min(minY, item.y);
        maxX = Math.max(maxX, item.x + item.width);
        maxY = Math.max(maxY, item.y + item.height);
        continue;
      }
      if (item.type === "circle") {
        minX = Math.min(minX, item.x - item.radius);
        minY = Math.min(minY, item.y - item.radius);
        maxX = Math.max(maxX, item.x + item.radius);
        maxY = Math.max(maxY, item.y + item.radius);
        continue;
      }
      const textW = Math.max(40, item.text.length * item.fontSize * 0.58);
      const textH = Math.max(12, item.fontSize * 1.25);
      minX = Math.min(minX, item.x);
      minY = Math.min(minY, item.y);
      maxX = Math.max(maxX, item.x + textW);
      maxY = Math.max(maxY, item.y + textH);
    }
    return { minX, minY, maxX, maxY };
  }

  function itemBounds(item: FloorplanCanvasObject) {
    if (item.type === "table") {
      return { left: item.x - item.radius, top: item.y - item.radius, right: item.x + item.radius, bottom: item.y + item.radius };
    }
    if (item.type === "rect") {
      return { left: item.x, top: item.y, right: item.x + item.width, bottom: item.y + item.height };
    }
    if (item.type === "circle") {
      return { left: item.x - item.radius, top: item.y - item.radius, right: item.x + item.radius, bottom: item.y + item.radius };
    }
    const textW = Math.max(40, item.text.length * item.fontSize * 0.58);
    const textH = Math.max(12, item.fontSize * 1.25);
    return { left: item.x, top: item.y, right: item.x + textW, bottom: item.y + textH };
  }

  function itemCenter(item: FloorplanCanvasObject) {
    const b = itemBounds(item);
    return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
  }

  function moveItemToBounds(item: FloorplanCanvasObject, target: { left?: number; right?: number; top?: number; bottom?: number; cx?: number; cy?: number }) {
    const b = itemBounds(item);
    const c = itemCenter(item);
    let dx = 0;
    let dy = 0;
    if (target.left != null) dx = target.left - b.left;
    if (target.right != null) dx = target.right - b.right;
    if (target.cx != null) dx = target.cx - c.x;
    if (target.top != null) dy = target.top - b.top;
    if (target.bottom != null) dy = target.bottom - b.bottom;
    if (target.cy != null) dy = target.cy - c.y;
    return { ...item, x: item.x + dx, y: item.y + dy } as FloorplanCanvasObject;
  }

  function alignSelected(mode: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom") {
    if (selectedIds.length < 2) return;
    const selectedItems = draft.objects.filter((obj) => selectedSet.has(obj.id));
    if (selectedItems.length < 2) return;
    pushUndoSnapshot();
    const bounds = selectedItems.map(itemBounds);
    const group = {
      left: Math.min(...bounds.map((b) => b.left)),
      right: Math.max(...bounds.map((b) => b.right)),
      top: Math.min(...bounds.map((b) => b.top)),
      bottom: Math.max(...bounds.map((b) => b.bottom))
    };
    const groupCx = (group.left + group.right) / 2;
    const groupCy = (group.top + group.bottom) / 2;
    setDraft((prev) => ({
      ...prev,
      objects: prev.objects.map((obj) => {
        if (!selectedSet.has(obj.id)) return obj;
        if (mode === "left") return moveItemToBounds(obj, { left: group.left });
        if (mode === "hcenter") return moveItemToBounds(obj, { cx: groupCx });
        if (mode === "right") return moveItemToBounds(obj, { right: group.right });
        if (mode === "top") return moveItemToBounds(obj, { top: group.top });
        if (mode === "vcenter") return moveItemToBounds(obj, { cy: groupCy });
        return moveItemToBounds(obj, { bottom: group.bottom });
      })
    }));
  }

  function distributeSelected(axis: "horizontal" | "vertical") {
    if (selectedIds.length < 3) return;
    const selectedItems = draft.objects.filter((obj) => selectedSet.has(obj.id));
    if (selectedItems.length < 3) return;
    pushUndoSnapshot();
    const sorted = selectedItems
      .map((item) => ({ item, c: itemCenter(item) }))
      .sort((a, b) => (axis === "horizontal" ? a.c.x - b.c.x : a.c.y - b.c.y));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const span = axis === "horizontal" ? last.c.x - first.c.x : last.c.y - first.c.y;
    const step = span / (sorted.length - 1);
    const target = new Map<string, number>();
    sorted.forEach((entry, idx) => {
      target.set(entry.item.id, (axis === "horizontal" ? first.c.x : first.c.y) + idx * step);
    });
    setDraft((prev) => ({
      ...prev,
      objects: prev.objects.map((obj) => {
        if (!selectedSet.has(obj.id)) return obj;
        const t = target.get(obj.id);
        if (t == null) return obj;
        return axis === "horizontal" ? moveItemToBounds(obj, { cx: t }) : moveItemToBounds(obj, { cy: t });
      })
    }));
  }

  function zoomToFit() {
    const bounds = objectBounds(draft.objects);
    const viewport = canvasViewportRef.current;
    if (!bounds || !viewport) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    const viewportRect = viewport.getBoundingClientRect();
    const vw = viewportRect.width;
    const vh = viewportRect.height;
    const padding = 36;
    const bw = Math.max(1, bounds.maxX - bounds.minX);
    const bh = Math.max(1, bounds.maxY - bounds.minY);
    const nextZoom = Math.max(0.3, Math.min(3, Math.min((vw - padding * 2) / bw, (vh - padding * 2) / bh)));
    const nextPan = {
      x: (vw - bw * nextZoom) / 2 - bounds.minX * nextZoom,
      y: (vh - bh * nextZoom) / 2 - bounds.minY * nextZoom
    };
    setZoom(nextZoom);
    setPan(nextPan);
  }

  function startObjectDrag(
    id: string,
    event: PointerEvent<HTMLButtonElement>
  ) {
    const ids = selectedSet.has(id) && selectedIds.length > 1 ? selectedIds : [id];
    const point = screenToCanvas(
      event as unknown as PointerEvent<HTMLDivElement>,
      canvasViewportRef.current as HTMLDivElement,
      zoom,
      pan
    );
    const positions: Record<string, { x: number; y: number }> = {};
    draft.objects.forEach((obj) => {
      if (ids.includes(obj.id)) positions[obj.id] = { x: obj.x, y: obj.y };
    });
    pushUndoSnapshot();
    setDraggingId(id);
    setDragState({
      ids,
      startPoint: point,
      startPositions: positions
    });
  }

  function screenToCanvas(
    event: PointerEvent<HTMLDivElement>,
    element: HTMLDivElement,
    zoomValue: number,
    panValue: { x: number; y: number }
  ) {
    const rect = element.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - panValue.x) / zoomValue,
      y: (event.clientY - rect.top - panValue.y) / zoomValue
    };
  }

  const isSaved = items.some((item) => item.id === draft.id);
  const canAlign = selectedIds.length >= 2;
  const canDistribute = selectedIds.length >= 3;

  function selectObject(id: string, shiftKey: boolean) {
    setActiveId(id);
    setSelectedIds((prev) => {
      if (shiftKey) {
        return prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id];
      }
      return [id];
    });
  }

  function updateSelected(patch: Record<string, unknown>, withUndo = true) {
    if (!selected) return;
    if (withUndo) pushUndoSnapshot();
    setDraft((p) => ({
      ...p,
      objects: p.objects.map((o) => (o.id === selected.id ? ({ ...o, ...patch } as FloorplanCanvasObject) : o))
    }));
  }

  const objectBorder = (id: string, fallback: string) => (selectedSet.has(id) ? "2px solid #0b5068" : fallback);

  return (
    <main className="page page--wide">
      <PageHeader
        title="Floorplans"
        description="Lay out tables, shapes and labels, then print."
        actions={
          <>
            <input
              className="header-input"
              value={draft.name}
              onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
              aria-label="Floorplan name"
              placeholder="Floorplan name"
            />
            <button type="button" onClick={() => void saveCurrent()} disabled={busy}>
              <Save size={15} aria-hidden /> Save
            </button>
            <button
              type="button"
              onClick={() => {
                void refreshList();
                setListOpen(true);
              }}
            >
              <FolderOpen size={15} aria-hidden /> Open
            </button>
            <button
              type="button"
              className="icon-btn icon-btn--bordered"
              onClick={() => setDraft(copyForDuplicate(draft))}
              disabled={busy}
              aria-label="Duplicate floorplan"
              title="Duplicate"
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

      {listOpen ? (
        <Modal title="Saved floorplans" onClose={() => setListOpen(false)}>
          {items.length === 0 ? (
            <p className="text-muted" style={{ margin: 0 }}>
              No saved floorplans yet.
            </p>
          ) : (
            <ul className="list">
              {items.map((item) => (
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
                </li>
              ))}
            </ul>
          )}
        </Modal>
      ) : null}

      <div className="editor">
        <section className="card editor-canvas-card">
          <div className="toolbar" role="toolbar" aria-label="Canvas tools">
            <div className="btn-group">
              <button type="button" onClick={() => addObject("table")} title="Add table">
                <CircleDot size={16} aria-hidden /> Table
              </button>
              <button type="button" className="icon-btn" onClick={() => addObject("rect")} title="Add rectangle" aria-label="Add rectangle">
                <Square size={16} />
              </button>
              <button type="button" className="icon-btn" onClick={() => addObject("circle")} title="Add circle" aria-label="Add circle">
                <Circle size={16} />
              </button>
              <button type="button" className="icon-btn" onClick={() => addObject("text")} title="Add text" aria-label="Add text">
                <Type size={16} />
              </button>
            </div>
            <div className="btn-group">
              <button type="button" className="icon-btn" disabled={!undoStack.length} onClick={undo} title="Undo" aria-label="Undo">
                <Undo2 size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setSelectedIds(draft.objects.map((o) => o.id))}
                title="Select all"
                aria-label="Select all"
              >
                <SquareDashedMousePointer size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={!selectedIds.length}
                onClick={() => setSelectedIds([])}
                title="Clear selection"
                aria-label="Clear selection"
              >
                <SquareDashed size={16} />
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
              <button type="button" className="icon-btn" onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))} title="Zoom out" aria-label="Zoom out">
                <ZoomOut size={16} />
              </button>
              <span className="toolbar-zoom">{(zoom * 100).toFixed(0)}%</span>
              <button type="button" className="icon-btn" onClick={() => setZoom((z) => Math.min(3, z + 0.1))} title="Zoom in" aria-label="Zoom in">
                <ZoomIn size={16} />
              </button>
              <button type="button" className="icon-btn" onClick={zoomToFit} title="Zoom to fit" aria-label="Zoom to fit">
                <Maximize size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                title="Reset view"
                aria-label="Reset view"
              >
                <RotateCcw size={16} />
              </button>
            </div>
            <button type="button" className="icon-btn btn-danger" onClick={clearCanvas} title="Clear canvas" aria-label="Clear canvas">
              <Eraser size={16} />
            </button>
          </div>
          <div
            ref={canvasViewportRef}
            className="editor-canvas"
            style={{
              backgroundSize: `${draft.canvas.gridSize * zoom}px ${draft.canvas.gridSize * zoom}px`,
              backgroundPosition: `${pan.x}px ${pan.y}px`
            }}
            onWheel={(event) => {
              event.preventDefault();
              const direction = event.deltaY < 0 ? 1 : -1;
              setZoom((previous) => Math.max(0.3, Math.min(3, previous + direction * 0.08)));
            }}
            onPointerDown={(event) => {
              const target = event.target as HTMLElement | null;
              const hitObjectButton = Boolean(target?.closest("button"));
              if (hitObjectButton) return;
              setIsPanning(true);
              setPanStart({ x: event.clientX - pan.x, y: event.clientY - pan.y });
            }}
            onPointerMove={(event) => {
              if (isPanning && panStart) {
                setPan({ x: event.clientX - panStart.x, y: event.clientY - panStart.y });
                return;
              }
              if (!draggingId || !dragState) return;
              const free = event.shiftKey;
              const point = screenToCanvas(event, event.currentTarget as HTMLDivElement, zoom, pan);
              const dx = point.x - dragState.startPoint.x;
              const dy = point.y - dragState.startPoint.y;
              setDraft((prev) => ({
                ...prev,
                objects: prev.objects.map((obj) =>
                  dragState.ids.includes(obj.id)
                    ? {
                        ...obj,
                        x: snap((dragState.startPositions[obj.id]?.x ?? obj.x) + dx, prev.canvas.gridSize, free),
                        y: snap((dragState.startPositions[obj.id]?.y ?? obj.y) + dy, prev.canvas.gridSize, free)
                      }
                    : obj
                )
              }));
            }}
            onPointerUp={() => {
              setDraggingId(null);
              setDragState(null);
              setIsPanning(false);
              setPanStart(null);
            }}
            onPointerLeave={() => {
              setDraggingId(null);
              setDragState(null);
              setIsPanning(false);
              setPanStart(null);
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "top left"
              }}
            >
              {draft.objects.map((obj) => {
                const common = {
                  type: "button" as const,
                  className: "fp-obj",
                  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => startObjectDrag(obj.id, event),
                  onClick: (event: React.MouseEvent<HTMLButtonElement>) => selectObject(obj.id, event.shiftKey)
                };
                if (obj.type === "table") {
                  return (
                    <button
                      key={obj.id}
                      {...common}
                      style={{
                        left: obj.x - obj.radius,
                        top: obj.y - obj.radius,
                        width: obj.radius * 2,
                        height: obj.radius * 2,
                        borderRadius: "999px",
                        border: objectBorder(obj.id, "1px solid #667085"),
                        background: activeId === obj.id ? "#d4e7ee" : "#eef5f8",
                        fontSize: 11
                      }}
                    >
                      {obj.tableNumber}
                    </button>
                  );
                }
                if (obj.type === "rect") {
                  return (
                    <button
                      key={obj.id}
                      {...common}
                      aria-label="Rectangle"
                      style={{
                        left: obj.x,
                        top: obj.y,
                        width: obj.width,
                        height: obj.height,
                        border: objectBorder(obj.id, "1px solid #667085"),
                        background: activeId === obj.id ? "#e4e7ec" : "#f2f4f7"
                      }}
                    />
                  );
                }
                if (obj.type === "circle") {
                  return (
                    <button
                      key={obj.id}
                      {...common}
                      aria-label="Circle"
                      style={{
                        left: obj.x - obj.radius,
                        top: obj.y - obj.radius,
                        width: obj.radius * 2,
                        height: obj.radius * 2,
                        borderRadius: "999px",
                        border: objectBorder(obj.id, "1px solid #667085"),
                        background: activeId === obj.id ? "#e4e7ec" : "#f2f4f7"
                      }}
                    />
                  );
                }
                return (
                  <button
                    key={obj.id}
                    {...common}
                    style={{
                      left: obj.x,
                      top: obj.y,
                      border: selectedSet.has(obj.id) ? "1px dashed #0b5068" : "1px solid transparent",
                      background: "transparent",
                      color: "#101828",
                      fontSize: obj.fontSize
                    }}
                  >
                    {obj.text}
                  </button>
                );
              })}
            </div>
            {draft.objects.length === 0 ? (
              <div className="editor-canvas-empty">
                Add tables from the toolbar, or generate a grid with <strong>Auto layout</strong>.
              </div>
            ) : null}
          </div>
          <div className="editor-hint">
            Drag to move · Shift-drag for fine movement · Shift-click to multi-select · Drag the background to pan · Scroll to
            zoom
          </div>
        </section>

        <aside className="editor-side">
          {selected ? (
            <Section
              title={
                selectedIds.length > 1
                  ? `${selectedIds.length} selected`
                  : selected.type === "table"
                    ? `Table ${selected.tableNumber}`
                    : selected.type === "rect"
                      ? "Rectangle"
                      : selected.type === "circle"
                        ? "Circle"
                        : "Text"
              }
              actions={
                <button
                  type="button"
                  className="icon-btn icon-btn--sm btn-danger"
                  aria-label="Delete object"
                  title="Delete"
                  onClick={() => {
                    pushUndoSnapshot();
                    setDraft((p) => ({ ...p, objects: p.objects.filter((o) => o.id !== selected.id) }));
                  }}
                >
                  <Trash2 size={15} />
                </button>
              }
            >
              <div className="form-grid">
                {selected.type === "table" ? (
                  <>
                    <Field label="Table number">
                      <input value={selected.tableNumber} onChange={(e) => updateSelected({ tableNumber: e.target.value }, false)} />
                    </Field>
                    <Field label="Radius">
                      <input
                        type="number"
                        min={6}
                        max={200}
                        value={selected.radius}
                        onChange={(e) => updateSelected({ radius: Math.max(6, Number(e.target.value) || 6) })}
                      />
                    </Field>
                  </>
                ) : null}
                {selected.type === "rect" ? (
                  <>
                    <Field label="Width">
                      <input
                        type="number"
                        min={6}
                        value={selected.width}
                        onChange={(e) => updateSelected({ width: Math.max(6, Number(e.target.value) || 6) })}
                      />
                    </Field>
                    <Field label="Height">
                      <input
                        type="number"
                        min={6}
                        value={selected.height}
                        onChange={(e) => updateSelected({ height: Math.max(6, Number(e.target.value) || 6) })}
                      />
                    </Field>
                  </>
                ) : null}
                {selected.type === "circle" ? (
                  <Field label="Radius">
                    <input
                      type="number"
                      min={4}
                      value={selected.radius}
                      onChange={(e) => updateSelected({ radius: Math.max(4, Number(e.target.value) || 4) })}
                    />
                  </Field>
                ) : null}
                {selected.type === "text" ? (
                  <>
                    <Field label="Text" className="span-all">
                      <input value={selected.text} onChange={(e) => updateSelected({ text: e.target.value })} />
                    </Field>
                    <Field label="Font size">
                      <input
                        type="number"
                        min={6}
                        max={200}
                        value={selected.fontSize}
                        onChange={(e) => updateSelected({ fontSize: Math.max(6, Number(e.target.value) || 6) })}
                      />
                    </Field>
                  </>
                ) : null}
              </div>
              {selectedIds.length > 1 ? (
                <p className="field-hint" style={{ margin: "10px 0 0" }}>
                  Editing the last object clicked. Use the toolbar to align or distribute the selection.
                </p>
              ) : null}
            </Section>
          ) : null}

          <Section title="Print">
            <div className="stack">
              <Field label="Title">
                <input
                  value={draft.metadata.title}
                  onChange={(e) => setDraft((p) => ({ ...p, metadata: { ...p.metadata, title: e.target.value } }))}
                />
              </Field>
              <Field label="Subtitle">
                <input
                  value={draft.metadata.subtitle}
                  onChange={(e) => setDraft((p) => ({ ...p, metadata: { ...p.metadata, subtitle: e.target.value } }))}
                />
              </Field>
              <Field label="Paper" as="div">
                <Segmented
                  value={draft.canvas.paperSize}
                  options={PAPER_OPTIONS}
                  onChange={(value) =>
                    setDraft((p) => ({
                      ...p,
                      canvas: { ...p.canvas, paperSize: value as FloorplanDocument["canvas"]["paperSize"] },
                      autoLayout: { ...p.autoLayout, paperSize: value as FloorplanDocument["autoLayout"]["paperSize"] }
                    }))
                  }
                />
              </Field>
              <Field label="Orientation" as="div">
                <Segmented
                  value={draft.canvas.orientation}
                  options={ORIENTATION_OPTIONS}
                  onChange={(value) =>
                    setDraft((p) => ({
                      ...p,
                      canvas: { ...p.canvas, orientation: value },
                      autoLayout: { ...p.autoLayout, orientation: value }
                    }))
                  }
                />
              </Field>
              {venueLogoLibrary.loaded && venueLogoLibrary.configured && clientLogoLibrary.loaded && clientLogoLibrary.configured ? (
                <>
                  <LogoPicker
                    title="Client logo"
                    items={clientLogoLibrary.items}
                    value={draft.selectedClientLogoKey ?? ""}
                    onChange={(key) => {
                      if (!key) {
                        setDraft((prev) => ({
                          ...prev,
                          selectedClientLogoKey: null,
                          themeSnapshot: { ...prev.themeSnapshot, clientLogoDataUrl: undefined }
                        }));
                        return;
                      }
                      const item = clientLogoLibrary.items.find((entry) => entry.key === key);
                      if (item) void applyLogoFromLibrary(item, "clientLogoDataUrl");
                    }}
                    emptyOption={{ label: "No client logo", value: "" }}
                  />
                  <LogoPicker
                    title="Venue logo"
                    items={venueLogoLibrary.items}
                    value={draft.selectedVenueLogoKey ?? ""}
                    onChange={(key) => {
                      if (!key) {
                        setDraft((prev) => ({
                          ...prev,
                          selectedVenueLogoKey: null,
                          themeSnapshot: { ...prev.themeSnapshot, venueLogoDataUrl: undefined }
                        }));
                        return;
                      }
                      const item = venueLogoLibrary.items.find((entry) => entry.key === key);
                      if (item) void applyLogoFromLibrary(item, "venueLogoDataUrl");
                    }}
                    emptyOption={{ label: "No venue logo", value: "" }}
                  />
                </>
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
              <button type="button" className="btn-primary" onClick={() => void printFloorplan()} disabled={busy}>
                <Download size={16} aria-hidden />
                {outputFormat === "png" ? "Export PNG" : "Print PDF"}
              </button>
            </div>
          </Section>

          <Section title="Auto layout" collapsible defaultOpen={draft.objects.length === 0} summary="Generate a numbered grid of tables">
            <div className="stack">
              <div className="form-grid">
                <Field label="Tables">
                  <input
                    type="number"
                    min={1}
                    max={400}
                    value={tableCount}
                    onChange={(e) => setTableCount(Math.max(1, Number(e.target.value) || 1))}
                  />
                </Field>
                <Field label="Grid snap">
                  <input
                    type="number"
                    min={4}
                    max={200}
                    value={draft.canvas.gridSize}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, canvas: { ...p.canvas, gridSize: Math.max(4, Number(e.target.value) || 24) } }))
                    }
                  />
                </Field>
                <Field label="Rows">
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={draft.autoLayout.rows}
                    onChange={(e) =>
                      setDraft((p) => ({
                        ...p,
                        autoLayout: { ...p.autoLayout, rows: Math.max(1, Math.min(24, Number(e.target.value) || 1)) }
                      }))
                    }
                  />
                </Field>
                <Field label="Columns">
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={draft.autoLayout.columns}
                    onChange={(e) =>
                      setDraft((p) => ({
                        ...p,
                        autoLayout: { ...p.autoLayout, columns: Math.max(1, Math.min(24, Number(e.target.value) || 1)) }
                      }))
                    }
                  />
                </Field>
                <Field label="Numbering">
                  <select
                    value={draft.autoLayout.numbering}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, autoLayout: { ...p.autoLayout, numbering: e.target.value as "straight" | "snaked" } }))
                    }
                  >
                    <option value="straight">Straight</option>
                    <option value="snaked">Snaked</option>
                  </select>
                </Field>
                <Field label="Start corner">
                  <select
                    value={draft.autoLayout.startCorner}
                    onChange={(e) =>
                      setDraft((p) => ({
                        ...p,
                        autoLayout: {
                          ...p.autoLayout,
                          startCorner: e.target.value as FloorplanDocument["autoLayout"]["startCorner"]
                        }
                      }))
                    }
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
                      setDraft((p) => ({
                        ...p,
                        autoLayout: {
                          ...p.autoLayout,
                          tableLayout: value,
                          staggerAxis: value === "staggered" ? (p.autoLayout.staggerAxis ?? "horizontal") : undefined
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
                        setDraft((p) => ({ ...p, autoLayout: { ...p.autoLayout, staggerAxis: value } }))
                      }
                    />
                  </Field>
                ) : null}
              </div>
              <button type="button" onClick={seedFromAutoLayout}>
                Generate tables
              </button>
              {draft.objects.some((obj) => obj.type === "table") ? (
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
