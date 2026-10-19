import { promises as fs } from "node:fs";
import path from "node:path";
import { isR2Configured, r2GetObjectUtf8WithEtag, r2PutObjectUtf8IfUnchanged } from "@/lib/storage/r2";
import { usersFileSchema } from "@/lib/validation/userSchemas";
import type { StoredUser, UsersFile } from "@/types/auth";

/** scripts/create-admin.mjs reads and writes the same locations. */
const R2_KEY = "auth/users.json";
const FS_PATH = path.join(process.cwd(), "data", "users.json");

/** How long permission checks may reuse a read of the users file. */
const CACHE_MS = 30_000;
const MAX_WRITE_ATTEMPTS = 4;

/** A rule broken by a requested change (e.g. removing the last admin). Its message is safe to show. */
export class UserRuleError extends Error {}

interface Snapshot {
  file: UsersFile;
  /** R2 ETag, or null when the file does not exist yet (always null for local files). */
  etag: string | null;
}

let cache: { users: StoredUser[]; at: number } | null = null;

function parse(raw: string | null): UsersFile {
  if (!raw) return { version: 1, users: [] };
  /* Fail loudly: silently treating a damaged file as "no users" would lock everyone out with no clue why. */
  return usersFileSchema.parse(JSON.parse(raw));
}

async function readSnapshot(): Promise<Snapshot> {
  if (isR2Configured()) {
    const got = await r2GetObjectUtf8WithEtag(R2_KEY);
    return { file: parse(got?.body ?? null), etag: got?.etag ?? null };
  }
  try {
    return { file: parse(await fs.readFile(FS_PATH, "utf8")), etag: null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { file: parse(null), etag: null };
    throw error;
  }
}

/** Returns false if the R2 copy changed since `etag` was read. */
async function writeSnapshot(file: UsersFile, etag: string | null): Promise<boolean> {
  const body = JSON.stringify(file, null, 2);
  if (isR2Configured()) return r2PutObjectUtf8IfUnchanged(R2_KEY, body, etag);
  await fs.mkdir(path.dirname(FS_PATH), { recursive: true });
  await fs.writeFile(FS_PATH, body, "utf8");
  return true;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function listUsers(): Promise<StoredUser[]> {
  const users = (await readSnapshot()).file.users;
  cache = { users, at: Date.now() };
  return users;
}

export async function findUserByEmail(email: string): Promise<StoredUser | null> {
  const wanted = normalizeEmail(email);
  return (await listUsers()).find((u) => u.email === wanted) ?? null;
}

/** For per-request permission checks: may be up to CACHE_MS old. */
export async function getUserByIdCached(id: string): Promise<StoredUser | null> {
  const users = cache && Date.now() - cache.at < CACHE_MS ? cache.users : await listUsers();
  return users.find((u) => u.id === id) ?? null;
}

/**
 * Read-modify-write of the whole users list. If another request changed the file in between,
 * re-reads and re-applies `change`, so concurrent edits are never silently lost.
 */
export async function mutateUsers<T>(
  change: (users: StoredUser[]) => { users: StoredUser[]; result: T }
): Promise<T> {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const { file, etag } = await readSnapshot();
    const { users, result } = change(file.users.map((u) => ({ ...u })));
    if (await writeSnapshot({ ...file, users }, etag)) {
      cache = { users, at: Date.now() };
      return result;
    }
  }
  throw new Error("Accounts were being changed at the same time. Please try again.");
}

/** Updates one user. Returns the updated user, or null if it no longer exists. */
export async function updateUser(
  id: string,
  change: (user: StoredUser) => StoredUser
): Promise<StoredUser | null> {
  return mutateUsers((users) => {
    const index = users.findIndex((u) => u.id === id);
    if (index < 0) return { users, result: null };
    users[index] = { ...change(users[index]), updatedAt: new Date().toISOString() };
    return { users, result: users[index] };
  });
}

/** Throws UserRuleError if `users` would leave nobody able to manage accounts. */
export function assertActiveAdminRemains(users: StoredUser[]): void {
  if (!users.some((u) => u.role === "admin" && u.active)) {
    throw new UserRuleError("There must always be at least one active admin.");
  }
}
