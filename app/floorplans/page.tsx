"use client";

import Link from "next/link";
import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { LogoPicker } from "@/app/components/LogoPicker";
import { buildEmptyFloorplanDraft, buildTablesFromAutoLayout, copyForDuplicate } from "@/lib/floorplans/model";
import { PAPER_SIZE_OPTIONS } from "@/lib/paperSizes";
import { downloadPdfBlobAsPngs } from "@/lib/pdf/pdfToPngExport";
import type { FloorplanCanvasObject, FloorplanDocument, FloorplanListItem } from "@/types";

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
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Failed to list floorplans.");
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
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Save failed.");
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
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Load failed.");
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
    if (!window.confirm("Delete this saved floorplan?")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/floorplans/saved/${encodeURIComponent(draft.id)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Delete failed.");
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
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "Print failed.");
      }
      const blob = await response.blob();
      if (outputFormat === "png") {
        await downloadPdfBlobAsPngs(blob, "floorplan");
      } else {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "floorplan.pdf";
        anchor.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Print failed.");
    } finally {
      setBusy(false);
    }
  }

  function seedFromAutoLayout() {
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
        objects: [...prev.objects, { id, type: "table", tableNumber: String(prev.objects.length + 1), x: 96, y: 96, radius: 18 }]
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

  return (
    <main>
      <header className="app-header">
        <Link href="/" className="app-backlink">← Home</Link>
        <h1>Floorplans</h1>
        <p className="app-tagline">Standalone floorplan tool with custom table editing, shapes, labels, saved plans, and printable output.</p>
      </header>

      <div className="panel">
        <h2>Saved floorplans</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <button type="button" className="secondary" onClick={() => void refreshList()} disabled={busy}>Refresh list</button>
          <button type="button" onClick={() => void saveCurrent()} disabled={busy}>Save</button>
          <button type="button" className="secondary" onClick={() => setDraft(copyForDuplicate(draft))} disabled={busy}>Duplicate</button>
          <button type="button" className="secondary" onClick={() => void deleteCurrent()} disabled={busy}>Delete</button>
          <button type="button" onClick={() => void printFloorplan()} disabled={busy}>
            {outputFormat === "png" ? "Export PNG" : "Print PDF"}
          </button>
        </div>
        <div className="grid two">
          <label>
            Floorplan name
            <input value={draft.name} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} />
          </label>
          <label>
            Load floorplan
            <select onChange={(e) => { if (e.target.value) void loadItem(e.target.value); }} defaultValue="">
              <option value="">-- choose --</option>
              {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>
            Print title
            <input value={draft.metadata.title} onChange={(e) => setDraft((p) => ({ ...p, metadata: { ...p.metadata, title: e.target.value } }))} />
          </label>
          <label>
            Print subtitle
            <input value={draft.metadata.subtitle} onChange={(e) => setDraft((p) => ({ ...p, metadata: { ...p.metadata, subtitle: e.target.value } }))} />
          </label>
          <label>
            Output format
            <select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value as "pdf" | "png")}>
              <option value="pdf">PDF</option>
              <option value="png">PNG</option>
            </select>
          </label>
          <label>
            Paper size
            <select
              value={draft.canvas.paperSize}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  canvas: { ...p.canvas, paperSize: e.target.value as FloorplanDocument["canvas"]["paperSize"] },
                  autoLayout: { ...p.autoLayout, paperSize: e.target.value as FloorplanDocument["autoLayout"]["paperSize"] }
                }))
              }
            >
              {PAPER_SIZE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Orientation
            <select
              value={draft.canvas.orientation}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  canvas: { ...p.canvas, orientation: e.target.value as "portrait" | "landscape" },
                  autoLayout: { ...p.autoLayout, orientation: e.target.value as "portrait" | "landscape" }
                }))
              }
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
        </div>
        {venueLogoLibrary.loaded && venueLogoLibrary.configured && clientLogoLibrary.loaded && clientLogoLibrary.configured && (
          <div className="grid two" style={{ marginTop: 12 }}>
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
              manageHref="/logo-library"
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
              manageHref="/logo-library"
            />
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Auto-generate tables</h2>
        <div className="grid two">
          <label>
            Table count
            <input type="number" min={1} max={400} value={tableCount} onChange={(e) => setTableCount(Math.max(1, Number(e.target.value) || 1))} />
          </label>
          <label>
            Grid snap size
            <input type="number" min={4} max={200} value={draft.canvas.gridSize} onChange={(e) => setDraft((p) => ({ ...p, canvas: { ...p.canvas, gridSize: Math.max(4, Number(e.target.value) || 24) } }))} />
          </label>
        </div>
        <div className="grid two">
          <label>
            Rows
            <input type="number" min={1} max={24} value={draft.autoLayout.rows} onChange={(e) => setDraft((p) => ({ ...p, autoLayout: { ...p.autoLayout, rows: Math.max(1, Math.min(24, Number(e.target.value) || 1)) } }))} />
          </label>
          <label>
            Columns
            <input type="number" min={1} max={24} value={draft.autoLayout.columns} onChange={(e) => setDraft((p) => ({ ...p, autoLayout: { ...p.autoLayout, columns: Math.max(1, Math.min(24, Number(e.target.value) || 1)) } }))} />
          </label>
          <label>
            Numbering
            <select value={draft.autoLayout.numbering} onChange={(e) => setDraft((p) => ({ ...p, autoLayout: { ...p.autoLayout, numbering: e.target.value as "straight" | "snaked" } }))}>
              <option value="straight">Straight</option>
              <option value="snaked">Snaked</option>
            </select>
          </label>
          <label>
            Start corner
            <select value={draft.autoLayout.startCorner} onChange={(e) => setDraft((p) => ({ ...p, autoLayout: { ...p.autoLayout, startCorner: e.target.value as FloorplanDocument["autoLayout"]["startCorner"] } }))}>
              <option value="topLeft">Top left</option>
              <option value="topRight">Top right</option>
              <option value="bottomLeft">Bottom left</option>
              <option value="bottomRight">Bottom right</option>
            </select>
          </label>
          <label>
            Table layout
            <select
              value={draft.autoLayout.tableLayout}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  autoLayout: {
                    ...p.autoLayout,
                    tableLayout: e.target.value as "aligned" | "staggered",
                    staggerAxis:
                      e.target.value === "staggered" ? (p.autoLayout.staggerAxis ?? "horizontal") : undefined
                  }
                }))
              }
            >
              <option value="aligned">Aligned grid</option>
              <option value="staggered">Staggered (brick)</option>
            </select>
          </label>
          <label>
            Brick stagger direction
            <select
              value={draft.autoLayout.staggerAxis ?? "horizontal"}
              disabled={draft.autoLayout.tableLayout !== "staggered"}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  autoLayout: {
                    ...p.autoLayout,
                    staggerAxis: e.target.value as "horizontal" | "vertical"
                  }
                }))
              }
            >
              <option value="horizontal">Horizontal (odd rows offset)</option>
              <option value="vertical">Vertical (odd columns offset)</option>
            </select>
          </label>
        </div>
        <p className="text-muted" style={{ marginTop: 0, marginBottom: 10, fontSize: 13 }}>
          Staggered layout offsets every other row or column by half a cell so tables nest like bricks. Horizontal
          matches the classic banqueting floorplan stagger; vertical offsets alternate columns downward.
        </p>
        <button type="button" onClick={seedFromAutoLayout}>Generate tables from settings</button>
      </div>

      <div className="panel">
        <h2>Canvas editor</h2>
        <p className="text-muted">Drag objects to move. Hold Shift while dragging for fine movement (no snap). Click objects to edit or delete.</p>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button type="button" onClick={() => addObject("table")}>Add table</button>
          <button type="button" onClick={() => addObject("rect")} className="secondary">Add rectangle</button>
          <button type="button" onClick={() => addObject("circle")} className="secondary">Add circle</button>
          <button type="button" onClick={() => addObject("text")} className="secondary">Add text</button>
          <button type="button" className="secondary" onClick={clearCanvas}>Clear canvas</button>
          <button type="button" className="secondary" onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))}>Zoom -</button>
          <button type="button" className="secondary" onClick={() => setZoom((z) => Math.min(3, z + 0.1))}>Zoom +</button>
          <button type="button" className="secondary" onClick={zoomToFit}>Zoom to fit</button>
          <button type="button" className="secondary" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Reset view</button>
          <button type="button" className="secondary" disabled={!undoStack.length} onClick={undo}>Undo</button>
          <button type="button" className="secondary" onClick={() => setSelectedIds(draft.objects.map((o) => o.id))}>Select all</button>
          <button type="button" className="secondary" onClick={() => setSelectedIds([])}>Clear selection</button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <button type="button" className="secondary" disabled={selectedIds.length < 2} onClick={() => alignSelected("left")}>Align left</button>
          <button type="button" className="secondary" disabled={selectedIds.length < 2} onClick={() => alignSelected("hcenter")}>Align center</button>
          <button type="button" className="secondary" disabled={selectedIds.length < 2} onClick={() => alignSelected("right")}>Align right</button>
          <button type="button" className="secondary" disabled={selectedIds.length < 2} onClick={() => alignSelected("top")}>Align top</button>
          <button type="button" className="secondary" disabled={selectedIds.length < 2} onClick={() => alignSelected("vcenter")}>Align middle</button>
          <button type="button" className="secondary" disabled={selectedIds.length < 2} onClick={() => alignSelected("bottom")}>Align bottom</button>
          <button type="button" className="secondary" disabled={selectedIds.length < 3} onClick={() => distributeSelected("horizontal")}>Distribute horizontal</button>
          <button type="button" className="secondary" disabled={selectedIds.length < 3} onClick={() => distributeSelected("vertical")}>Distribute vertical</button>
        </div>
        <p className="text-muted" style={{ marginTop: 0, marginBottom: 8 }}>
          Zoom: {(zoom * 100).toFixed(0)}% · Drag empty canvas background to pan · Shift-click objects to multi-select.
        </p>
        <div
          ref={canvasViewportRef}
          style={{ border: "1px solid #b7c2cf", borderRadius: 10, width: 920, maxWidth: "100%", height: 620, position: "relative", overflow: "hidden", backgroundSize: `${draft.canvas.gridSize}px ${draft.canvas.gridSize}px`, backgroundImage: "linear-gradient(to right, rgba(130,145,165,0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(130,145,165,0.15) 1px, transparent 1px)" }}
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
          onPointerUp={() => { setDraggingId(null); setDragState(null); setIsPanning(false); setPanStart(null); }}
          onPointerLeave={() => { setDraggingId(null); setDragState(null); setIsPanning(false); setPanStart(null); }}
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
            if (obj.type === "table") {
              return (
                <button
                  key={obj.id}
                  type="button"
                  onPointerDown={(event) => startObjectDrag(obj.id, event)}
                  onClick={(event) => {
                    setActiveId(obj.id);
                    setSelectedIds((prev) => {
                      if (event.shiftKey) {
                        return prev.includes(obj.id) ? prev.filter((id) => id !== obj.id) : [...prev, obj.id];
                      }
                      return [obj.id];
                    });
                  }}
                  style={{ position: "absolute", left: obj.x - obj.radius, top: obj.y - obj.radius, width: obj.radius * 2, height: obj.radius * 2, borderRadius: "999px", border: selectedSet.has(obj.id) ? "2px solid #265a96" : "1px solid #6e7f93", background: activeId === obj.id ? "#d5e8ff" : "#ecf4ff", cursor: "grab", fontSize: 11 }}
                >
                  {obj.tableNumber}
                </button>
              );
            }
            if (obj.type === "rect") {
              return <button key={obj.id} type="button" onPointerDown={(event) => startObjectDrag(obj.id, event)} onClick={(event) => { setActiveId(obj.id); setSelectedIds((prev) => event.shiftKey ? (prev.includes(obj.id) ? prev.filter((id) => id !== obj.id) : [...prev, obj.id]) : [obj.id]); }} style={{ position: "absolute", left: obj.x, top: obj.y, width: obj.width, height: obj.height, border: selectedSet.has(obj.id) ? "2px solid #265a96" : "1px solid #64758a", background: activeId === obj.id ? "#d9f0ff" : "#edf5fa", cursor: "grab" }} />;
            }
            if (obj.type === "circle") {
              return <button key={obj.id} type="button" onPointerDown={(event) => startObjectDrag(obj.id, event)} onClick={(event) => { setActiveId(obj.id); setSelectedIds((prev) => event.shiftKey ? (prev.includes(obj.id) ? prev.filter((id) => id !== obj.id) : [...prev, obj.id]) : [obj.id]); }} style={{ position: "absolute", left: obj.x - obj.radius, top: obj.y - obj.radius, width: obj.radius * 2, height: obj.radius * 2, borderRadius: "999px", border: selectedSet.has(obj.id) ? "2px solid #265a96" : "1px solid #6e7f93", background: activeId === obj.id ? "#def8ea" : "#edf9f2", cursor: "grab" }} />;
            }
            return <button key={obj.id} type="button" onPointerDown={(event) => startObjectDrag(obj.id, event)} onClick={(event) => { setActiveId(obj.id); setSelectedIds((prev) => event.shiftKey ? (prev.includes(obj.id) ? prev.filter((id) => id !== obj.id) : [...prev, obj.id]) : [obj.id]); }} style={{ position: "absolute", left: obj.x, top: obj.y, border: selectedSet.has(obj.id) ? "1px dashed #265a96" : "none", background: "transparent", color: "#0f2438", fontSize: obj.fontSize, cursor: "grab" }}>{obj.text}</button>;
            })}
          </div>
        </div>
      </div>

      {selected && (
        <div className="panel">
          <h2>Selected object</h2>
          <p className="text-muted">Selected: {selectedIds.length}</p>
          <p className="text-muted">ID: <code>{selected.id}</code></p>
          {selected.type === "table" && (
            <div className="grid two">
              <label>Table number<input value={selected.tableNumber} onChange={(e) => setDraft((p) => ({ ...p, objects: p.objects.map((o) => (o.id === selected.id && o.type === "table" ? { ...o, tableNumber: e.target.value } : o)) }))} /></label>
              <label>Radius<input type="number" min={6} max={200} value={selected.radius} onChange={(e) => { pushUndoSnapshot(); setDraft((p) => ({ ...p, objects: p.objects.map((o) => (o.id === selected.id && o.type === "table" ? { ...o, radius: Math.max(6, Number(e.target.value) || 6) } : o)) })); }} /></label>
            </div>
          )}
          {selected.type === "rect" && (
            <div className="grid two">
              <label>Width<input type="number" min={6} value={selected.width} onChange={(e) => { pushUndoSnapshot(); setDraft((p) => ({ ...p, objects: p.objects.map((o) => (o.id === selected.id && o.type === "rect" ? { ...o, width: Math.max(6, Number(e.target.value) || 6) } : o)) })); }} /></label>
              <label>Height<input type="number" min={6} value={selected.height} onChange={(e) => { pushUndoSnapshot(); setDraft((p) => ({ ...p, objects: p.objects.map((o) => (o.id === selected.id && o.type === "rect" ? { ...o, height: Math.max(6, Number(e.target.value) || 6) } : o)) })); }} /></label>
            </div>
          )}
          {selected.type === "circle" && (
            <label>Radius<input type="number" min={4} value={selected.radius} onChange={(e) => { pushUndoSnapshot(); setDraft((p) => ({ ...p, objects: p.objects.map((o) => (o.id === selected.id && o.type === "circle" ? { ...o, radius: Math.max(4, Number(e.target.value) || 4) } : o)) })); }} /></label>
          )}
          {selected.type === "text" && (
            <div className="grid two">
              <label>Text<input value={selected.text} onChange={(e) => { pushUndoSnapshot(); setDraft((p) => ({ ...p, objects: p.objects.map((o) => (o.id === selected.id && o.type === "text" ? { ...o, text: e.target.value } : o)) })); }} /></label>
              <label>Font size<input type="number" min={6} max={200} value={selected.fontSize} onChange={(e) => { pushUndoSnapshot(); setDraft((p) => ({ ...p, objects: p.objects.map((o) => (o.id === selected.id && o.type === "text" ? { ...o, fontSize: Math.max(6, Number(e.target.value) || 6) } : o)) })); }} /></label>
            </div>
          )}
          <button type="button" className="secondary" onClick={() => { pushUndoSnapshot(); setDraft((p) => ({ ...p, objects: p.objects.filter((o) => o.id !== selected.id) })); }}>Delete selected object</button>
        </div>
      )}

      {error && <div className="panel"><p className="error">{error}</p></div>}
    </main>
  );
}

