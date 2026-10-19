import { promises as fs } from "node:fs";
import path from "node:path";
import { isR2Configured, r2GetObjectUtf8, r2PutObjectUtf8 } from "@/lib/storage/r2";
import { usersFileSchema } from "@/lib/validation/userSchemas";
import type { StoredUser, UsersFile } from "@/types/auth";

/** scripts/create-admin.mjs reads and writes the same locations. */
const R2_KEY = "auth/users.json";
const FS_PATH = path.join(process.cwd(), "data", "users.json");

function parse(raw: string | null): UsersFile {
  if (!raw) return { version: 1, users: [] };
  /* Fail loudly: silently treating a damaged file as "no users" would lock everyone out with no clue why. */
  return usersFileSchema.parse(JSON.parse(raw));
}

async function readUsersFile(): Promise<UsersFile> {
  if (isR2Configured()) return parse(await r2GetObjectUtf8(R2_KEY));
  try {
    return parse(await fs.readFile(FS_PATH, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return parse(null);
    throw error;
  }
}

async function writeUsersFile(file: UsersFile): Promise<void> {
  const body = JSON.stringify(file, null, 2);
  if (isR2Configured()) return r2PutObjectUtf8(R2_KEY, body);
  await fs.mkdir(path.dirname(FS_PATH), { recursive: true });
  await fs.writeFile(FS_PATH, body, "utf8");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function listUsers(): Promise<StoredUser[]> {
  return (await readUsersFile()).users;
}

export async function findUserByEmail(email: string): Promise<StoredUser | null> {
  const wanted = normalizeEmail(email);
  return (await listUsers()).find((u) => u.email === wanted) ?? null;
}

export async function getUserById(id: string): Promise<StoredUser | null> {
  return (await listUsers()).find((u) => u.id === id) ?? null;
}

/** Read-modify-write one user. Returns the updated user, or null if it no longer exists. */
export async function updateUser(
  id: string,
  change: (user: StoredUser) => StoredUser
): Promise<StoredUser | null> {
  const file = await readUsersFile();
  const index = file.users.findIndex((u) => u.id === id);
  if (index < 0) return null;
  const updated = { ...change(file.users[index]), updatedAt: new Date().toISOString() };
  file.users[index] = updated;
  await writeUsersFile(file);
  return updated;
}
