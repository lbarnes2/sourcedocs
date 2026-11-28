/**
 * Venues and their room templates: one JSON file per venue, on disk or in R2 (same switch as the plans).
 * Saving bumps a room's version whenever its walls, doors, windows or fixtures change.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { isR2Configured, r2DeleteObject, r2GetObjectUtf8, r2ListObjectKeys, r2PutObjectUtf8 } from "@/lib/storage/r2";
import { isValidFloorplanUuid } from "@/lib/floorplans/floorplanKeys";
import { sameTemplateContent } from "@/lib/floorplans/roomTemplates";
import type { FloorplanRoomTemplate, FloorplanVenue } from "@/types";

const VENUE_PREFIX = "floorplan-venues/";
const VENUE_DIR = path.join(process.cwd(), "data", "floorplan-venues");

function assertVenueId(id: string): void {
  if (!isValidFloorplanUuid(id)) throw new Error("Invalid venue id.");
}

async function readRaw(id: string): Promise<string | null> {
  assertVenueId(id);
  if (isR2Configured()) return r2GetObjectUtf8(`${VENUE_PREFIX}${id}.json`);
  try {
    return await fs.readFile(path.join(VENUE_DIR, `${id}.json`), "utf8");
  } catch {
    return null;
  }
}

async function listIds(): Promise<string[]> {
  if (isR2Configured()) {
    return (await r2ListObjectKeys(VENUE_PREFIX))
      .map((key) => key.slice(VENUE_PREFIX.length))
      .filter((name) => name.endsWith(".json") && !name.includes("/"))
      .map((name) => name.slice(0, -".json".length))
      .filter(isValidFloorplanUuid);
  }
  try {
    const files = await fs.readdir(VENUE_DIR);
    return files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length)).filter(isValidFloorplanUuid);
  } catch {
    return [];
  }
}

export async function getVenue(id: string): Promise<FloorplanVenue | null> {
  const raw = await readRaw(id);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FloorplanVenue;
  } catch {
    return null;
  }
}

export async function listVenues(): Promise<FloorplanVenue[]> {
  const venues = await Promise.all((await listIds()).map(getVenue));
  return venues
    .filter((v): v is FloorplanVenue => v != null)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/**
 * Versions are the store's job: a new room starts at 1, and a room whose content changed goes up by
 * one from what's stored (whatever the client sent).
 */
function withVersions(next: FloorplanVenue, stored: FloorplanVenue | null): FloorplanVenue {
  const now = new Date().toISOString();
  const rooms: FloorplanRoomTemplate[] = next.rooms.map((room) => {
    const before = stored?.rooms.find((r) => r.id === room.id);
    if (!before) return { ...room, version: 1, updatedAt: now };
    if (sameTemplateContent(before, room)) return { ...room, version: before.version, updatedAt: before.updatedAt };
    return { ...room, version: before.version + 1, updatedAt: now };
  });
  return { ...next, rooms, updatedAt: now };
}

export async function saveVenue(venue: FloorplanVenue): Promise<FloorplanVenue> {
  assertVenueId(venue.id);
  const saved = withVersions(venue, await getVenue(venue.id));
  const body = JSON.stringify(saved, null, 2);
  if (isR2Configured()) await r2PutObjectUtf8(`${VENUE_PREFIX}${venue.id}.json`, body);
  else {
    await fs.mkdir(VENUE_DIR, { recursive: true });
    await fs.writeFile(path.join(VENUE_DIR, `${venue.id}.json`), body, "utf8");
  }
  return saved;
}

/** Add or replace one room in a venue. */
export async function saveRoomTemplate(venueId: string, room: FloorplanRoomTemplate): Promise<FloorplanVenue> {
  const venue = await getVenue(venueId);
  if (!venue) throw new Error("Venue not found.");
  const rooms = venue.rooms.some((r) => r.id === room.id)
    ? venue.rooms.map((r) => (r.id === room.id ? room : r))
    : [...venue.rooms, room];
  return saveVenue({ ...venue, rooms });
}

export async function deleteVenue(id: string): Promise<void> {
  assertVenueId(id);
  if (isR2Configured()) await r2DeleteObject(`${VENUE_PREFIX}${id}.json`);
  else await fs.rm(path.join(VENUE_DIR, `${id}.json`), { force: true });
}
