# Floorplans: room templates, compound rooms, doors/windows, fill tools

Plan drafted 2026-11-28. Nothing built yet.

## Decisions (agreed)

- **Templates are copied into a plan, and the plan can be updated.** A plan keeps its own copy of the room and remembers which template and version it came from. If the template changes, the plan shows "The Orangery template has changed" with **Update room** / **Dismiss**. Nothing moves without you choosing it.
- **Rooms are drawn by clicking the corners.** Walls snap to 90°/45°, and you can type each wall's exact length. This covers L-shapes, bays and angled walls.
- **A template holds:** walls, doors, windows, pillars/columns, built-in bars and stages, fire exits (with widths), and keep-clear zones.
- **Templates are grouped by venue.** Pick a venue, then one of its rooms. A venue can carry a logo for the plan header.
- The tool still gives measurements, not safety verdicts: exits count toward exit width, keep-clear zones are left empty, and nothing is marked pass or fail.

## Data model

### New object type: `room`
Added to `FloorplanCanvasObject` in `types/floorplans.ts`:

```ts
interface FloorplanRoomObject extends FloorplanBaseObject {
  type: "room";
  name?: string;              // "The Orangery"
  points: Point[];            // corners, clockwise, relative to x/y (plan units)
  openings?: FloorplanOpening[];
  locked?: boolean;           // true by default when it comes from a template
}

interface FloorplanOpening {
  id: string;
  kind: "door" | "double-door" | "window" | "opening";
  wall: number;               // index of the wall (points[i] → points[i+1])
  offset: number;             // from the wall's start corner to the opening's centre
  width: number;
  swing?: "in" | "out";       // doors only
  hinge?: "start" | "end";
  exit?: boolean;             // counts toward exit width
  label?: string;             // "Fire exit 2"
}
```

Openings are attached to a wall by index and offset, so a door stays on its wall when you drag a corner or change a wall's length.

Because the room is an object rather than a document field, a plan can hold two rooms (for example a marquee and a terrace), and existing selection, moving and undo work unchanged.

### Fixtures and keep-clear zones
- Pillars, bars, stages and exits stay ordinary `circle`/`rect` objects, with two new optional fields: `roomId` (the room they belong to) and `locked`. Template updates replace only objects tagged with that room's `roomId`, so your furniture is left alone.
- Keep-clear zone: `rect` gains `keepClear?: boolean`. It is drawn hatched, and tables, seating and the fill tools avoid it. A polygon zone can come later if needed.

### Venues and room templates (new store)
```ts
interface FloorplanVenue {
  id: string; name: string; logoKey?: string | null;
  rooms: FloorplanRoomTemplate[];
}
interface FloorplanRoomTemplate {
  id: string; name: string; version: number; updatedAt: string;
  notes?: string;                          // "Max 120 dinner, 180 theatre"
  room: Omit<FloorplanRoomObject, "id">;   // stored in METRES, so it works at any plan scale
  fixtures: FloorplanCanvasObject[];       // in metres, relative to the room
}
```
- Storage follows the existing pattern: `lib/floorplans/venueStore.ts` with fs and R2 backends (same shape as `store.ts`/`fsStore.ts`/`r2Store.ts`), under the key prefix `floorplan-venues/`.
- API routes go in `app/api/floorplans/venues/` (list, get, save, delete), validated with zod in `lib/validation/floorplanSchemas.ts`.
- The plan records its source: `FloorplanDocument.roomSource?: { venueId, templateId, version }`.

## Retiring "Room outline"
- Remove the `room` preset (`app/floorplans/presets.ts:157`) and the empty-state "Draw the room outline" button (`page.tsx:2421`). Replace them with **Start from a room…** (template picker) and **Draw room** (corner tool).
- **Migration on load** (`lib/floorplans/model.ts`): an unlabelled `rect` with `fill: "none"` becomes a `room` with four corners (rotation applied). Old plans open looking the same.
- Code that currently looks for "outline-only rects" switches to `type === "room"`: floor area per seat (`measure.ts:318`, which becomes a shoelace-formula area), fill margin (`page.tsx:551`), collision exemptions (`collision.ts:117`), and edge-only hit-testing (`FloorplanCanvas.tsx:741`).

## Phases

### 1. Room object and corner drawing
- `lib/floorplans/room.ts`: polygon helpers (area, point-in-polygon, inset by a margin, wall lengths and angles, wall-to-point distance).
- Canvas: draw the room as an SVG path with thicker walls. Selecting a room shows corner handles (drag to move a corner, click a wall's midpoint to add a corner, Delete removes a selected corner).
- Draw tool (shortcut **R**): click each corner, with 0/45/90° snapping and a live length readout. Type a number then Enter to set the current wall's length in metres. Click the first corner or press Enter to close the shape; Esc cancels.
- Inspector: a list of walls showing each length in metres, editable, plus the room name and a lock toggle.
- PDF (`floorplanDocumentRender.ts`) draws the polygon, and print bounds include it.
- Migration and retiring the old outline happen in this phase.

### 2. Doors and windows
- Add from the Inspector ("Add door / window" on the selected wall) or by dragging one onto a wall. They slide along the wall and can't run past a corner.
- Drawing: a door is a gap in the wall plus a swing arc (double doors get two arcs). A window is a thin double line in the wall. An opening is just a gap.
- Exits: `exit: true` counts toward the plan's exit-width measurement, alongside today's Entrance rects. A door's swing area is treated as keep-clear for collisions and fills, so chairs are not placed in it.
- PDF rendering to match.

### 3. Venues and room templates
- **Venues & rooms** page at `/floorplans/rooms`: a list of venues, each with its rooms (name, area, last edited), plus New, Duplicate and Delete.
- The template editor reuses the floorplan canvas and Inspector in a "template" mode that only offers room, door/window, fixture and keep-clear tools, with no furniture, guests or print settings. This needs the editor parts pulled out of `page.tsx` (2,891 lines) first, which is the largest single job in this plan.
- **New plan from room:** pick a venue, then a room. This copies in the room and fixtures (converting metres to plan units), sets the scale, fills the subtitle with the room name, picks the venue logo, and centres the view.
- **Update from template:** when the plan's version is older than the template's, a banner offers **Update room**. It swaps the room and the objects tagged with its `roomId`, keeps everything else, and then flags any table or chair that now sits outside the walls or on a fixture, using the existing collision code. Undo reverses the whole update.
- **Save room as template** from an existing plan, which is useful for bringing in rooms already drawn.

### 4. "Fill an area" for theatre and banquet
- `FillArea` changes from a rectangle to a polygon plus a facing angle. Areas can come from a dragged rectangle (as today), the selected room (inset by a gangway margin round the walls, 1 m by default), or a selected rect.
- **Theatre:** the existing rectangle fill runs over the area's bounding box, lined up with the facing direction. Chairs outside the inset polygon, inside keep-clear zones or door swings, or on fixtures are removed, using the same `removed` mechanism already used for curved rows. The aisle and max-run logic does not change.
- **Banquet** (new `fillAreaWithTables` in `lib/floorplans/banquet.ts`):
  - Settings: table style (round 5 ft / 6 ft, cabaret, long), seats, gangway between tables (chair back to chair back, 1.5 m by default), grid or staggered, and "as many as fit" or "up to N tables".
  - It places a grid inside the inset polygon, tries a few offsets and keeps the one that fits the most tables, then drops any table whose chairs touch a wall, fixture, keep-clear zone or door swing.
  - Numbering reuses the existing visit-order code (`lib/docs/floorplanLayout.ts`: straight or snaked, start corner) and guest-list numbers when a guest list is linked.
  - The result line reads, for example, "Fits 14 tables · 140 covers".
- The fill dialog has a **Theatre / Banquet** switch and remembers its last settings in `autoLayout`, as theatre fill does now.

## Order and size
Phases 1 and 2 are needed before templates are worth saving. Phase 4 can start after phase 1 (it only needs the polygon room) and could run alongside phase 3. Expect each phase to be its own commit or set of commits on a `feature/room-templates` branch, merged together as the theatre-seating work was.

## Deferred / open
- Polygon keep-clear zones, curved walls (arcs), and multi-level rooms.
- Whether a template should carry the venue's own capacity figures to show beside the plan's measurements. These would be the venue's numbers, not the tool's.
- Linking venues to the existing signage venue profiles (`lib/signageVenues`). They could share a venue ID later, but are kept separate for now.
