"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Hand, Maximize, MousePointer2, PencilRuler, Redo2, Save, Shapes, Square, Type, Undo2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Callout, Field, Section, Toasts } from "@/app/components/ui";
import { FloorplanCanvas, type CanvasView, clampZoom } from "@/app/floorplans/FloorplanCanvas";
import { Inspector } from "@/app/floorplans/Inspector";
import { MenuButton, MenuItem, MenuSeparator } from "@/app/floorplans/Menu";
import { OBJECT_PRESETS } from "@/app/floorplans/presets";
import { objectsPrintBounds } from "@/lib/floorplans/geometry";
import { polygonArea, roomFromWorldPoints, roomLocalBounds } from "@/lib/floorplans/room";
import { ROOM_TEMPLATE_UNITS_PER_METRE, isFixtureType, templateContentFromPlan } from "@/lib/floorplans/roomTemplates";
import { readResponseError } from "@/lib/http/readError";
import type { FloorplanCanvasObject, FloorplanRoomObject, FloorplanRoomTemplate, FloorplanVenue } from "@/types";

const UPM = ROOM_TEMPLATE_UNITS_PER_METRE;
const GRID = UPM / 2;
const FIXTURE_PRESET_IDS = ["pillar", "stage", "bar", "buffet", "dance-floor", "entrance", "av-desk", "keep-clear"];
const MAX_HISTORY = 100;

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

/** The room and its fixtures as objects on the editor canvas (templates are already at the editor's scale). */
function objectsOf(template: FloorplanRoomTemplate): FloorplanCanvasObject[] {
  return [template.room, ...template.fixtures.map((f) => ({ ...f, roomId: template.room.id }))];
}

/** Edit one room template: its walls, doors and windows, and the fixtures that stay with the room. */
export default function RoomTemplateEditorPage() {
  const params = useParams<{ venueId: string; roomId: string }>();
  const router = useRouter();
  const venueId = params.venueId;
  const isNew = params.roomId === "new";

  const [venue, setVenue] = useState<FloorplanVenue | null>(null);
  const [loadError, setLoadError] = useState("");
  const [template, setTemplate] = useState<FloorplanRoomTemplate | null>(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [objects, setObjectsState] = useState<FloorplanCanvasObject[]>([]);
  const objectsRef = useRef<FloorplanCanvasObject[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [openingIdRaw, setOpeningId] = useState<string | null>(null);
  const [view, setView] = useState<CanvasView>({ zoom: 1, pan: { x: 0, y: 0 } });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [roomDraw, setRoomDraw] = useState(false);
  const [panTool, setPanTool] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const pastRef = useRef<FloorplanCanvasObject[][]>([]);
  const futureRef = useRef<FloorplanCanvasObject[][]>([]);
  const coalesceRef = useRef<{ key: string | null; at: number }>({ key: null, at: 0 });
  const [historySize, setHistorySize] = useState({ undo: 0, redo: 0 });

  const room = objects.find((o): o is FloorplanRoomObject => o.type === "room") ?? null;
  const roomCount = objects.filter((o) => o.type === "room").length;
  const validSelected = selectedIds.filter((id) => objects.some((o) => o.id === id));
  const primary = objects.find((o) => o.id === validSelected[validSelected.length - 1]) ?? null;
  const openingId =
    primary?.type === "room" && validSelected.length === 1 && primary.openings?.some((o) => o.id === openingIdRaw) ? openingIdRaw : null;

  /* ---------- history ---------- */

  const setObjects = useCallback((next: FloorplanCanvasObject[]) => {
    objectsRef.current = next;
    setObjectsState(next);
  }, []);

  const syncHistory = useCallback(() => setHistorySize({ undo: pastRef.current.length, redo: futureRef.current.length }), []);

  const pushHistory = useCallback(() => {
    pastRef.current.push(objectsRef.current);
    if (pastRef.current.length > MAX_HISTORY) pastRef.current.shift();
    futureRef.current = [];
    coalesceRef.current = { key: null, at: 0 };
    syncHistory();
  }, [syncHistory]);

  const commitObjects = useCallback(
    (fn: (list: FloorplanCanvasObject[]) => FloorplanCanvasObject[], key?: string) => {
      const now = Date.now();
      const same = key && coalesceRef.current.key === key && now - coalesceRef.current.at < 1000;
      if (!same) pushHistory();
      coalesceRef.current = { key: key ?? null, at: now };
      setObjects(fn(objectsRef.current));
      setDirty(true);
    },
    [pushHistory, setObjects]
  );

  function undo() {
    const previous = pastRef.current.pop();
    if (!previous) return;
    futureRef.current.push(objectsRef.current);
    coalesceRef.current = { key: null, at: 0 };
    setObjects(previous);
    setDirty(true);
    syncHistory();
  }

  function redo() {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(objectsRef.current);
    coalesceRef.current = { key: null, at: 0 };
    setObjects(next);
    setDirty(true);
    syncHistory();
  }

  const cancelGesture = useCallback(() => {
    const before = pastRef.current.pop();
    if (before) setObjects(before);
    coalesceRef.current = { key: null, at: 0 };
    syncHistory();
  }, [setObjects, syncHistory]);

  /* ---------- view ---------- */

  const zoomToFit = useCallback(() => {
    const viewport = viewportRef.current;
    const bounds = objectsPrintBounds(objectsRef.current);
    if (!bounds || !viewport) {
      setView({ zoom: 1, pan: { x: 40, y: 40 } });
      return;
    }
    const rect = viewport.getBoundingClientRect();
    const pad = 56;
    const bw = Math.max(1, bounds.maxX - bounds.minX);
    const bh = Math.max(1, bounds.maxY - bounds.minY);
    const zoom = clampZoom(Math.min((rect.width - pad * 2) / bw, (rect.height - pad * 2) / bh));
    setView({ zoom, pan: { x: (rect.width - bw * zoom) / 2 - bounds.minX * zoom, y: (rect.height - bh * zoom) / 2 - bounds.minY * zoom } });
  }, []);

  function viewCentre() {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 120, y: 120 };
    return { x: (rect.width / 2 - view.pan.x) / view.zoom, y: (rect.height / 2 - view.pan.y) / view.zoom };
  }

  /* ---------- load ---------- */

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/floorplans/venues/${encodeURIComponent(venueId)}`);
        if (!res.ok) throw new Error(await readResponseError(res, "Could not load the venue."));
        const loaded = ((await res.json()) as { venue: FloorplanVenue }).venue;
        if (cancelled) return;
        setVenue(loaded);
        if (isNew) {
          setName("");
          setObjects([]);
        } else {
          const t = loaded.rooms.find((r) => r.id === params.roomId);
          if (!t) throw new Error("That room isn't in this venue any more.");
          setTemplate(t);
          setName(t.name);
          setNotes(t.notes ?? "");
          setObjects(objectsOf(t));
        }
        requestAnimationFrame(() => zoomToFit());
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load the room.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venueId, params.roomId, isNew, setObjects, zoomToFit]);

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  /* ---------- editing ---------- */

  function startRoomDraw() {
    if (room) return;
    setRoomDraw(true);
    setPanTool(false);
    setSelectedIds([]);
  }

  function onRoomDrawn(points: { x: number; y: number }[] | null) {
    setRoomDraw(false);
    if (!points || points.length < 3) return;
    const drawn = { ...roomFromWorldPoints(points), name: name.trim() || undefined };
    commitObjects((list) => [drawn, ...list.map((o) => ({ ...o, roomId: drawn.id }))]);
    setSelectedIds([drawn.id]);
    requestAnimationFrame(() => zoomToFit());
  }

  function addPreset(presetId: string) {
    const preset = OBJECT_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const c = viewCentre();
    const centre = { x: Math.round(c.x / GRID) * GRID, y: Math.round(c.y / GRID) * GRID };
    let obj = preset.build(centre, objectsRef.current, UPM);
    if (obj.type === "room") {
      if (room) return;
      obj = { ...obj, name: name.trim() || undefined };
    } else if (room) {
      obj = { ...obj, roomId: room.id };
    }
    const placed = obj;
    commitObjects((list) =>
      placed.type === "room" ? [placed, ...list.map((o) => ({ ...o, roomId: placed.id }))] : preset.behind ? [placed, ...list] : [...list, placed]
    );
    setSelectedIds([placed.id]);
    if (placed.type === "room") requestAnimationFrame(() => zoomToFit());
  }

  function deleteSelection() {
    if (!validSelected.length) return;
    const gone = new Set(validSelected);
    commitObjects((list) => list.filter((o) => !gone.has(o.id)).map((o) => (o.roomId && gone.has(o.roomId) ? { ...o, roomId: undefined } : o)));
    setSelectedIds([]);
  }

  function patchSelected(fn: (obj: FloorplanCanvasObject) => FloorplanCanvasObject, key?: string) {
    if (!primary) return;
    const ids = new Set(validSelected.filter((id) => objectsRef.current.find((o) => o.id === id)?.type === primary.type));
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

  /* ---------- save ---------- */

  async function save() {
    const roomName = name.trim();
    if (!roomName) {
      setError("Give the room a name first.");
      return;
    }
    if (roomCount !== 1 || !room) {
      setError(roomCount ? "A room template holds one room. Delete the extra rooms first." : "Draw the room's walls first.");
      return;
    }
    const fixtures = objectsRef.current.filter((o) => o.id !== room.id && isFixtureType(o));
    const content = templateContentFromPlan({ ...room, name: roomName }, fixtures, UPM);
    const next: FloorplanRoomTemplate = {
      id: template?.id ?? crypto.randomUUID(),
      name: roomName,
      version: template?.version ?? 1,
      updatedAt: new Date().toISOString(),
      notes: notes.trim() || undefined,
      ...content
    };
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/floorplans/venues/${encodeURIComponent(venueId)}/rooms`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next)
      });
      if (!res.ok) throw new Error(await readResponseError(res, "Could not save the room."));
      const savedVenue = ((await res.json()) as { venue: FloorplanVenue }).venue;
      const saved = savedVenue.rooms.find((r) => r.id === next.id) ?? next;
      setVenue(savedVenue);
      setTemplate(saved);
      setDirty(false);
      setNotice(
        template && saved.version > template.version
          ? `Saved as version ${saved.version}. Plans using this room will offer the update.`
          : "Saved."
      );
      // The room moved to 0,0 when saved; show it as stored so a second save compares equal.
      const ids = new Set(validSelected);
      setObjects(objectsOf(saved));
      setSelectedIds([...ids]);
      if (isNew) router.replace(`/floorplans/rooms/${venueId}/${saved.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the room.");
    } finally {
      setSaving(false);
    }
  }

  /* ---------- keyboard ---------- */

  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keyHandlerRef.current = (event: KeyboardEvent) => {
    const meta = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (meta && key === "s") {
      event.preventDefault();
      if (!saving) void save();
      return;
    }
    if (isTypingTarget(event.target)) return;
    if (meta && key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (meta) return;
    if (roomDraw) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      if (openingId && primary?.type === "room") {
        event.preventDefault();
        const id = openingId;
        patchSelected((o) => (o.type === "room" ? { ...o, openings: o.openings?.filter((x) => x.id !== id) } : o));
        setOpeningId(null);
        return;
      }
      if (validSelected.length) {
        event.preventDefault();
        deleteSelection();
      }
      return;
    }
    if (event.key === "Escape") {
      if (openingId) setOpeningId(null);
      else setSelectedIds([]);
      return;
    }
    if (event.key.startsWith("Arrow") && validSelected.length) {
      event.preventDefault();
      const step = event.shiftKey ? GRID : 1;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      const ids = new Set(validSelected);
      commitObjects((list) => list.map((o) => (ids.has(o.id) ? ({ ...o, x: o.x + dx, y: o.y + dy } as FloorplanCanvasObject) : o)), "nudge");
      return;
    }
    if (!event.altKey && !event.shiftKey && (key === "v" || key === "h" || key === "r")) {
      if (key === "r") startRoomDraw();
      else {
        setRoomDraw(false);
        setPanTool(key === "h");
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

  /* ---------- render ---------- */

  function presetItem(id: string, icon?: ReactNode, hint?: string) {
    const preset = OBJECT_PRESETS.find((p) => p.id === id);
    if (!preset) return null;
    return (
      <MenuItem key={id} icon={icon} hint={hint} onSelect={() => addPreset(id)}>
        {preset.label}
      </MenuItem>
    );
  }

  if (loadError) {
    return (
      <main className="page">
        <Callout tone="error">{loadError}</Callout>
        <p>
          <Link className="text-link" href="/floorplans/rooms">
            Back to venues & rooms
          </Link>
        </p>
      </main>
    );
  }

  const size = room
    ? (() => {
        const b = roomLocalBounds(room);
        const f = (v: number) => (v / UPM).toFixed(1).replace(/\.0$/, "");
        return `${f(b.maxX - b.minX)} × ${f(b.maxY - b.minY)} m · ${(polygonArea(room.points) / (UPM * UPM)).toFixed(0)} m²`;
      })()
    : null;
  const fixtureCount = room ? objects.filter((o) => o.id !== room.id && isFixtureType(o)).length : 0;

  return (
    <main className="page page--wide">
      <header className="page-header">
        <div className="page-header-text">
          <p className="field-hint" style={{ margin: 0 }}>
            <Link className="text-link" href="/floorplans/rooms">
              Venues & rooms
            </Link>{" "}
            › {venue?.name ?? "…"}
          </p>
          <h1>{name.trim() || (isNew ? "New room" : "Room")}</h1>
        </div>
        <div className="page-header-actions">
          <Link href="/floorplans/rooms" className="btn">
            <ArrowLeft size={15} aria-hidden /> Back
          </Link>
          <button type="button" className="btn-primary" disabled={saving || !venue} onClick={() => void save()} title="Save the room (⌘S)">
            <Save size={15} aria-hidden /> {saving ? "Saving…" : dirty || isNew ? "Save room" : "Saved"}
          </button>
        </div>
      </header>

      <div className="editor">
        <section className="card editor-canvas-card">
          <div className="toolbar" role="toolbar" aria-label="Room tools">
            <div className="toolbar-add">
              <MenuButton className="toolbar-btn" icon={<Shapes size={15} aria-hidden />} label="Room" title="Draw the walls and add fixtures">
                <MenuItem
                  icon={<PencilRuler size={15} />}
                  hint={room ? "Delete the room to draw it again" : "Click round the walls corner by corner"}
                  shortcut="R"
                  disabled={Boolean(room)}
                  onSelect={startRoomDraw}
                >
                  Draw a room…
                </MenuItem>
                {room ? null : presetItem("room", <Square size={15} />, "18 × 12 m, then drag its corners")}
                <MenuSeparator />
                {FIXTURE_PRESET_IDS.map((id) => presetItem(id))}
              </MenuButton>
              <button type="button" className="toolbar-btn" onClick={() => addPreset("text")} title="Add a text label">
                <Type size={15} aria-hidden /> Text
              </button>
            </div>
            <div className="btn-group">
              <button type="button" className="icon-btn" disabled={!historySize.undo} onClick={undo} title="Undo (⌘Z)" aria-label="Undo">
                <Undo2 size={16} />
              </button>
              <button type="button" className="icon-btn" disabled={!historySize.redo} onClick={redo} title="Redo (⇧⌘Z)" aria-label="Redo">
                <Redo2 size={16} />
              </button>
            </div>
            <span className="spacer" />
            <div className="btn-group" role="group" aria-label="Tools">
              <button
                type="button"
                className={`icon-btn${!panTool && !roomDraw ? " icon-btn--on" : ""}`}
                aria-pressed={!panTool && !roomDraw}
                onClick={() => {
                  setPanTool(false);
                  setRoomDraw(false);
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
                  setRoomDraw(false);
                }}
                title="Hand: drag to pan (H, or hold Space)"
                aria-label="Hand tool"
              >
                <Hand size={16} />
              </button>
              <button
                type="button"
                className={`icon-btn${roomDraw ? " icon-btn--on" : ""}`}
                aria-pressed={roomDraw}
                disabled={Boolean(room) && !roomDraw}
                onClick={() => (roomDraw ? setRoomDraw(false) : startRoomDraw())}
                title={room ? "The room is drawn: drag its corners to change it" : "Draw a room: click round the walls corner by corner (R)"}
                aria-label="Draw a room"
              >
                <PencilRuler size={16} />
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
            gridSize={GRID}
            snapToGrid
            view={view}
            onViewChange={(updater) => setView(updater)}
            viewportRef={viewportRef}
            panActive={panTool || spaceDown}
            frame={null}
            frameLabel=""
            tableGuests={null}
            colorByOccupancy={false}
            unitsPerMetre={UPM}
            onBeginGesture={pushHistory}
            onCancelGesture={cancelGesture}
            onLive={(next) => {
              setObjects(next);
              setDirty(true);
            }}
            roomDraw={roomDraw}
            onRoomDrawn={onRoomDrawn}
            openingId={openingId}
            onSelectOpening={setOpeningId}
            emptyHint={
              <span>
                Draw the room&apos;s walls with <strong>Room → Draw a room</strong> (R), then add its doors, windows and fixtures.
              </span>
            }
          />
        </section>

        <aside className="editor-side">
          {primary ? (
            <Inspector
              primary={primary}
              selectionCount={validSelected.length}
              tableGuests={null}
              totalGuests={0}
              gridSize={GRID}
              unitsPerMetre={UPM}
              onPatch={patchSelected}
              openingId={openingId}
              onOpeningId={setOpeningId}
              onDelete={deleteSelection}
              onOrder={reorderSelected}
            />
          ) : (
            <Section title="Room template" description={size ?? "No walls yet"}>
              <div className="stack">
                <Field label="Name" hint="As it appears when adding a room to a plan.">
                  <input
                    value={name}
                    placeholder="e.g. The Orangery"
                    onChange={(e) => {
                      const v = e.target.value;
                      setName(v);
                      setDirty(true);
                      if (room) setObjects(objectsRef.current.map((o) => (o.id === room.id ? { ...o, name: v.trim() || undefined } : o)));
                    }}
                  />
                </Field>
                <Field label="Notes" hint="For you: access, power, load-in. Not printed.">
                  <textarea
                    rows={4}
                    value={notes}
                    onChange={(e) => {
                      setNotes(e.target.value);
                      setDirty(true);
                    }}
                  />
                </Field>
                <p className="field-hint" style={{ margin: 0 }}>
                  {room
                    ? `${room.openings?.length ?? 0} door${room.openings?.length === 1 ? "" : "s"} and windows · ${fixtureCount} fixture${fixtureCount === 1 ? "" : "s"}. Select the room to add doors and windows.`
                    : "Draw the walls first. Pillars, bars, stages and keep-clear zones go in from the Room menu."}
                  {template ? ` Version ${template.version}.` : ""}
                </p>
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

