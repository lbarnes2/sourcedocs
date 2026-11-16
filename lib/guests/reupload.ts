import { normalizeDietary } from "@/lib/csv/validation";
import type { GuestRecord } from "@/types";

/**
 * Merging a revised guest list into one that has already been edited by hand.
 *
 * Three versions of each guest are compared, field by field:
 *   - `baseline`: the guest as last imported from a file,
 *   - `current`:  the guest now, including manual edits,
 *   - `next`:     the guest in the newly uploaded file.
 * A field the file didn't change keeps its current value (so manual edits survive); a field only the
 * file changed takes the file's value; a field both changed differently is a conflict to resolve.
 */

export const MERGE_FIELDS = ["name", "tableNumber", "starter", "main", "dessert", "dietaryOriginal"] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

export const MERGE_FIELD_LABELS: Record<MergeField, string> = {
  name: "Name",
  tableNumber: "Table",
  starter: "Starter",
  main: "Main",
  dessert: "Dessert",
  dietaryOriginal: "Dietary"
};

export interface FieldChange {
  field: MergeField;
  from: string;
  to: string;
}

export interface FieldConflict {
  field: MergeField;
  /** Value in the last imported file. */
  original: string;
  mine: string;
  file: string;
}

export interface MatchedGuest {
  /** Id the guest keeps (their current id). */
  id: string;
  current: GuestRecord;
  next: GuestRecord;
  /** Fields the new file changed that will be applied. */
  changes: FieldChange[];
  /** Fields changed both by hand and in the new file, to different values. */
  conflicts: FieldConflict[];
  /** How many hand-edited fields are carried over untouched. */
  editsKept: number;
}

export interface ReuploadPlan {
  matched: MatchedGuest[];
  /** In the new file, not in the list before. */
  added: GuestRecord[];
  /** In the list now, missing from the new file. */
  removed: GuestRecord[];
  /** Added by hand (never in a file) and still not in the new file: always kept. */
  manualOnly: GuestRecord[];
  /** Guests deleted by hand that the new file still contains: they stay deleted. */
  stillDeleted: GuestRecord[];
  /** True when the new file changes nothing about the guest list. */
  unchanged: boolean;
  editsKept: number;
}

export type ConflictChoice = "mine" | "file";

export interface ReuploadChoices {
  /** Keyed `${guestId}:${field}`; conflicts default to keeping the hand-made edit. */
  conflicts: Record<string, ConflictChoice>;
  /** Ids of `removed` guests to keep even though the new file dropped them. */
  keepRemoved: string[];
}

const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");
const value = (guest: GuestRecord, field: MergeField) => (guest[field] ?? "").trim();

/**
 * @param pairs Removed-guest id → added-guest id, for people the new file renamed ("these are the same person").
 */
export function planReupload(
  baseline: GuestRecord[],
  current: GuestRecord[],
  next: GuestRecord[],
  pairs: Record<string, string> = {}
): ReuploadPlan {
  const currentById = new Map(current.map((guest) => [guest.id, guest]));
  const baselineIds = new Set(baseline.map((guest) => guest.id));

  // Index the new file by name; repeated names are matched in order.
  const nextByName = new Map<string, GuestRecord[]>();
  next.forEach((guest) => {
    const key = nameKey(guest.name);
    const list = nextByName.get(key);
    if (list) list.push(guest);
    else nextByName.set(key, [guest]);
  });
  const takeNext = (name: string, preferTable?: string): GuestRecord | undefined => {
    const list = nextByName.get(nameKey(name));
    if (!list?.length) return undefined;
    const sameTable = preferTable ? list.findIndex((guest) => guest.tableNumber.trim() === preferTable.trim()) : -1;
    return list.splice(sameTable >= 0 ? sameTable : 0, 1)[0];
  };
  const nextById = new Map(next.map((guest) => [guest.id, guest]));
  const pairedNextIds = new Set(Object.values(pairs));
  // Guests the user has paired are held back from name matching.
  pairedNextIds.forEach((id) => {
    const guest = nextById.get(id);
    if (!guest) return;
    const list = nextByName.get(nameKey(guest.name));
    const at = list?.indexOf(guest) ?? -1;
    if (list && at >= 0) list.splice(at, 1);
  });

  const matched: MatchedGuest[] = [];
  const removed: GuestRecord[] = [];
  const stillDeleted: GuestRecord[] = [];
  let editsKept = 0;

  const compare = (base: GuestRecord, now: GuestRecord, incoming: GuestRecord): MatchedGuest => {
    const changes: FieldChange[] = [];
    const conflicts: FieldConflict[] = [];
    let kept = 0;
    MERGE_FIELDS.forEach((field) => {
      const b = value(base, field);
      const c = value(now, field);
      const n = value(incoming, field);
      if (n === b) {
        if (c !== b) kept += 1;
        return;
      }
      if (c === n) return;
      if (c === b) changes.push({ field, from: c, to: n });
      else conflicts.push({ field, original: b, mine: c, file: n });
    });
    return { id: now.id, current: now, next: incoming, changes, conflicts, editsKept: kept };
  };

  baseline.forEach((base) => {
    const now = currentById.get(base.id);
    const pairedId = pairs[base.id];
    const incoming = (pairedId ? nextById.get(pairedId) : undefined) ?? takeNext(base.name, base.tableNumber);
    if (now && incoming) {
      const entry = compare(base, now, incoming);
      editsKept += entry.editsKept;
      matched.push(entry);
    } else if (now && !incoming) {
      removed.push(now);
    } else if (!now && incoming) {
      stillDeleted.push(incoming);
    }
  });

  // Guests added by hand: if the new file now has them, adopt the file's row but keep what was typed.
  const manualOnly: GuestRecord[] = [];
  current
    .filter((guest) => !baselineIds.has(guest.id))
    .forEach((guest) => {
      const incoming = takeNext(guest.name, guest.tableNumber);
      if (!incoming) {
        manualOnly.push(guest);
        return;
      }
      // Baseline = the file's row, so anything typed that differs counts as a kept edit rather than a conflict.
      const entry = compare(incoming, guest, incoming);
      editsKept += entry.editsKept;
      matched.push(entry);
    });

  const added = Array.from(nextByName.values()).flat();
  // Keep the new file's order for added guests.
  const order = new Map(next.map((guest, index) => [guest.id, index]));
  added.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  const unchanged =
    added.length === 0 &&
    removed.length === 0 &&
    matched.every((entry) => entry.changes.length === 0 && entry.conflicts.length === 0);

  return { matched, added, removed, manualOnly, stillDeleted, unchanged, editsKept };
}

function withField(guest: GuestRecord, field: MergeField, next: string): GuestRecord {
  if (field === "dietaryOriginal") {
    return { ...guest, dietaryOriginal: next, dietaryNormalized: normalizeDietary(next) };
  }
  return { ...guest, [field]: next };
}

/**
 * Applies a reviewed plan. Returns the merged guest list and the new baseline (the uploaded file's
 * rows, re-keyed to the ids the merged guests carry) for the next re-upload to compare against.
 */
export function applyReupload(
  plan: ReuploadPlan,
  next: GuestRecord[],
  choices: ReuploadChoices
): { guests: GuestRecord[]; baseline: GuestRecord[] } {
  const stamp = Date.now().toString(36);
  const mergedByNextId = new Map<string, GuestRecord>();
  const baselineByNextId = new Map<string, GuestRecord>();

  plan.matched.forEach((entry) => {
    let guest = entry.current;
    entry.changes.forEach((change) => {
      guest = withField(guest, change.field, change.to);
    });
    entry.conflicts.forEach((conflict) => {
      if (choices.conflicts[`${entry.id}:${conflict.field}`] === "file") {
        guest = withField(guest, conflict.field, conflict.file);
      }
    });
    // A surname from the file's last-name column follows the file unless one was typed by hand.
    if (!guest.lastName && entry.next.lastName) guest = { ...guest, lastName: entry.next.lastName };
    mergedByNextId.set(entry.next.id, guest);
    baselineByNextId.set(entry.next.id, { ...entry.next, id: entry.id });
  });

  plan.added.forEach((guest, index) => {
    const id = `guest-${stamp}-${index + 1}`;
    mergedByNextId.set(guest.id, { ...guest, id });
    baselineByNextId.set(guest.id, { ...guest, id });
  });

  // New-file order first, then anyone kept who isn't in the new file.
  const guests: GuestRecord[] = [];
  const baseline: GuestRecord[] = [];
  next.forEach((row) => {
    const merged = mergedByNextId.get(row.id);
    const base = baselineByNextId.get(row.id);
    if (merged) guests.push(merged);
    if (base) baseline.push(base);
  });
  const keep = new Set(choices.keepRemoved);
  plan.removed.filter((guest) => keep.has(guest.id)).forEach((guest) => guests.push(guest));
  plan.manualOnly.forEach((guest) => guests.push(guest));

  return { guests, baseline };
}
