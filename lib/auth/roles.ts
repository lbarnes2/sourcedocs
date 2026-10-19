export const ROLES = ["viewer", "editor", "admin"] as const;

export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

/** True when `role` is at least as privileged as `required`. */
export function hasRole(role: Role, required: Role): boolean {
  return RANK[role] >= RANK[required];
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
