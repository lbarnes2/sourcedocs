/** Account changes made by admins from the Users screen. */
import { randomUUID } from "node:crypto";
import { generateTemporaryPassword, hashPassword } from "@/lib/auth/password";
import type { Role } from "@/lib/auth/roles";
import { assertActiveAdminRemains, mutateUsers, UserRuleError } from "@/lib/auth/userStore";
import type { ManagedUser, StoredUser } from "@/types/auth";

export function toManagedUser(user: StoredUser): ManagedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    active: user.active,
    mustChangePassword: user.mustChangePassword,
    locked: Boolean(user.lockedUntil && Date.parse(user.lockedUntil) > Date.now()),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

/** Creates an account with a temporary password, which is returned once and never stored in plain text. */
export async function createUser(input: {
  email: string;
  name: string;
  role: Role;
}): Promise<{ user: ManagedUser; temporaryPassword: string }> {
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const now = new Date().toISOString();
  const user = await mutateUsers((users) => {
    if (users.some((u) => u.email === input.email)) {
      throw new UserRuleError("An account with that email already exists.");
    }
    const created: StoredUser = {
      id: randomUUID(),
      email: input.email,
      name: input.name,
      role: input.role,
      passwordHash,
      active: true,
      mustChangePassword: true,
      failedLogins: 0,
      lockedUntil: null,
      createdAt: now,
      updatedAt: now
    };
    return { users: [...users, created], result: created };
  });
  return { user: toManagedUser(user), temporaryPassword };
}

export async function updateManagedUser(
  actorId: string,
  id: string,
  change: { name?: string; role?: Role; active?: boolean; resetPassword?: true }
): Promise<{ user: ManagedUser; temporaryPassword: string | null }> {
  if (id === actorId && (change.role !== undefined || change.active === false)) {
    throw new UserRuleError("You can't change your own role or deactivate yourself. Ask another admin.");
  }
  if (id === actorId && change.resetPassword) {
    throw new UserRuleError("Change your own password from your account page instead.");
  }
  const temporaryPassword = change.resetPassword ? generateTemporaryPassword() : null;
  const passwordHash = temporaryPassword ? await hashPassword(temporaryPassword) : null;

  const user = await mutateUsers((users) => {
    const index = users.findIndex((u) => u.id === id);
    if (index < 0) throw new UserRuleError("That account no longer exists.");
    const next: StoredUser = { ...users[index], updatedAt: new Date().toISOString() };
    if (change.name !== undefined) next.name = change.name;
    if (change.role !== undefined) next.role = change.role;
    if (change.active !== undefined) next.active = change.active;
    if (passwordHash) {
      Object.assign(next, { passwordHash, mustChangePassword: true, failedLogins: 0, lockedUntil: null });
    }
    users[index] = next;
    assertActiveAdminRemains(users);
    return { users, result: next };
  });
  return { user: toManagedUser(user), temporaryPassword };
}

export async function deleteManagedUser(actorId: string, id: string): Promise<void> {
  if (id === actorId) throw new UserRuleError("You can't delete your own account. Ask another admin.");
  await mutateUsers((users) => {
    const remaining = users.filter((u) => u.id !== id);
    if (remaining.length === users.length) throw new UserRuleError("That account no longer exists.");
    assertActiveAdminRemains(remaining);
    return { users: remaining, result: null };
  });
}
