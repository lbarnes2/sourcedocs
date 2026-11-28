/**
 * Room templates: copying a saved room (walls, doors, windows and fixtures) into a plan at the plan's
 * scale, turning a room on a plan back into a template, and updating a plan's room from a newer template.
 */
import { DEFAULT_UNITS_PER_METRE, objectBox } from "@/lib/floorplans/geometry";
import { normaliseRoom, pointInPolygon, roomWorldPoints } from "@/lib/floorplans/room";
import type { FloorplanCanvasObject, FloorplanRoomObject, FloorplanRoomTemplate, FloorplanVenue } from "@/types";

/** Templates are stored at the app's default scale, whatever scale the plan they came from used. */
export const ROOM_TEMPLATE_UNITS_PER_METRE = DEFAULT_UNITS_PER_METRE;

/** Object types a template can carry as fixtures (tables and seating belong to plans, not rooms). */
export function isFixtureType(obj: FloorplanCanvasObject): boolean {
  return obj.type === "rect" || obj.type === "circle" || obj.type === "text";
}

const tidy = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Scale an object by `k` about the plan origin, then move it by `dx`/`dy`. Covers rooms and the fixture
 * types; text keeps its font size (labels stay readable at any scale).
 */
export function scaleObject<T extends FloorplanCanvasObject>(obj: T, k: number, dx = 0, dy = 0): T {
  const base = { ...obj, x: tidy(obj.x * k + dx), y: tidy(obj.y * k + dy) };
  if (obj.type === "room") {
    return {
      ...base,
      points: obj.points.map((p) => ({ x: tidy(p.x * k), y: tidy(p.y * k) })),
      openings: obj.openings?.map((o) => ({ ...o, offset: tidy(o.offset * k), width: tidy(o.width * k) }))
    } as T;
  }
  if (obj.type === "rect") return { ...base, width: tidy(obj.width * k), height: tidy(obj.height * k) } as T;
  if (obj.type === "circle") return { ...base, radius: tidy(obj.radius * k) } as T;
  return base as T;
}

/**
 * The room and fixtures from a template, at the plan's scale, with the room's top-left corner at
 * `origin`. Everything gets new ids; fixtures are tagged with the room's id.
 */
export function objectsFromTemplate(
  venue: FloorplanVenue,
  template: FloorplanRoomTemplate,
  unitsPerMetre: number,
  origin: { x: number; y: number },
  roomId: string = crypto.randomUUID()
): { room: FloorplanRoomObject; fixtures: FloorplanCanvasObject[] } {
  const k = unitsPerMetre / ROOM_TEMPLATE_UNITS_PER_METRE;
  const room: FloorplanRoomObject = {
    ...scaleObject(template.room, k, origin.x - template.room.x * k, origin.y - template.room.y * k),
    id: roomId,
    name: template.room.name?.trim() || template.name,
    source: { venueId: venue.id, templateId: template.id, version: template.version }
  };
  const fixtures = template.fixtures.map((f) => ({
    ...scaleObject(f, k, origin.x - template.room.x * k, origin.y - template.room.y * k),
    id: crypto.randomUUID(),
    roomId
  }));
  return { room, fixtures };
}

/**
 * A room on a plan (plus its fixtures) as a template's room and fixtures: back to the template scale,
 * with the room's origin at 0,0. Ids are kept, so saving the same room twice compares equal.
 */
export function templateContentFromPlan(
  room: FloorplanRoomObject,
  fixtures: FloorplanCanvasObject[],
  unitsPerMetre: number
): Pick<FloorplanRoomTemplate, "room" | "fixtures"> {
  const k = ROOM_TEMPLATE_UNITS_PER_METRE / unitsPerMetre;
  const ox = room.x;
  const oy = room.y;
  const { source: _source, locked: _locked, ...bare } = room;
  return {
    room: scaleObject({ ...bare, x: 0, y: 0 }, k),
    fixtures: fixtures.map((f) => {
      const { roomId: _roomId, ...rest } = f;
      return scaleObject({ ...rest, x: f.x - ox, y: f.y - oy } as FloorplanCanvasObject, k);
    })
  };
}

/** Shapes on the plan standing inside the room: candidates to save with it as fixtures. */
export function fixturesInside(room: FloorplanRoomObject, objects: FloorplanCanvasObject[]): FloorplanCanvasObject[] {
  const walls = roomWorldPoints(room);
  return objects.filter((o) => {
    if (o.id === room.id || !isFixtureType(o)) return false;
    if (o.roomId === room.id) return true;
    const b = objectBox(o);
    return pointInPolygon({ x: b.cx, y: b.cy }, walls);
  });
}

/**
 * Whether two templates hold the same room and fixtures (names, notes and object ids aside: a room
 * saved back from a plan carries the plan's ids, which says nothing about whether it changed).
 */
export function sameTemplateContent(a: Pick<FloorplanRoomTemplate, "room" | "fixtures">, b: Pick<FloorplanRoomTemplate, "room" | "fixtures">): boolean {
  const key = (t: Pick<FloorplanRoomTemplate, "room" | "fixtures">) => {
    const { id: _roomId, name: _name, ...room } = t.room;
    return JSON.stringify([room, t.fixtures.map(({ id: _id, ...rest }) => rest)]);
  };
  return key(a) === key(b);
}

/** A room on a plan whose template has a newer version the plan hasn't taken or skipped. */
export type RoomUpdate = { room: FloorplanRoomObject; venue: FloorplanVenue; template: FloorplanRoomTemplate };

export function pendingRoomUpdates(objects: FloorplanCanvasObject[], venues: FloorplanVenue[]): RoomUpdate[] {
  const out: RoomUpdate[] = [];
  for (const o of objects) {
    if (o.type !== "room" || !o.source) continue;
    const venue = venues.find((v) => v.id === o.source?.venueId);
    const template = venue?.rooms.find((r) => r.id === o.source?.templateId);
    if (!venue || !template) continue;
    if (template.version > o.source.version && template.version !== o.source.skippedVersion) out.push({ room: o, venue, template });
  }
  return out;
}

/**
 * Swap a plan's room (and its fixtures) for the template's current version, in the same place. The
 * room keeps its id and lock; everything else on the plan is left as it is.
 */
export function applyRoomUpdate(objects: FloorplanCanvasObject[], update: RoomUpdate, unitsPerMetre: number): FloorplanCanvasObject[] {
  const { room, venue, template } = update;
  const fresh = objectsFromTemplate(venue, template, unitsPerMetre, { x: room.x, y: room.y }, room.id);
  const next: FloorplanRoomObject = { ...normaliseRoom(fresh.room), locked: room.locked };
  const kept = objects.filter((o) => o.roomId !== room.id);
  const at = kept.findIndex((o) => o.id === room.id);
  const out = kept.map((o) => (o.id === room.id ? next : o));
  // Fixtures go just above their room, below everything else, as when the room was first added.
  out.splice(at + 1, 0, ...fresh.fixtures);
  return out;
}
