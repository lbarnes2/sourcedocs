import type { Role } from "@/lib/auth/roles";

export interface StoredUser {
  id: string;
  /** Lower-cased. */
  email: string;
  name: string;
  role: Role;
  passwordHash: string;
  active: boolean;
  mustChangePassword: boolean;
  failedLogins: number;
  /** ISO time; logins are refused until then. */
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UsersFile {
  version: 1;
  users: StoredUser[];
}

/** What the browser is told about the signed-in user. */
export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
}

/** An account as shown to admins on the Users screen. */
export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
}
