/**
 * Minimum role for each request. The middleware enforces this for every request; write routes
 * re-check the live account as well.
 */
import type { Role } from "@/lib/auth/roles";

/** Routes reachable without a session. */
export const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);

/** POST routes that only render a PDF and store nothing, so viewers may use them. */
const RENDER_ONLY_POSTS = new Set([
  "/api/generate",
  "/api/buffet-menu/generate",
  "/api/floorplans/generate",
  "/api/signage/generate",
  "/api/signage/general"
]);

/** Writes under these prefixes are admin-only. */
const ADMIN_WRITE_PREFIXES = ["/api/settings", "/api/buffet-menu/settings", "/api/users"];

/** Readable by admins only, not just writable. */
const ADMIN_READ_PREFIXES = ["/api/users"];

function underPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function requiredRole(pathname: string, method: string): Role {
  if (underPrefix(pathname, ADMIN_READ_PREFIXES)) return "admin";
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return "viewer";
  if (m === "POST" && RENDER_ONLY_POSTS.has(pathname)) return "viewer";
  /* Any signed-in user may sign out or change their own password. */
  if (pathname.startsWith("/api/auth/")) return "viewer";
  if (underPrefix(pathname, ADMIN_WRITE_PREFIXES)) return "admin";
  return "editor";
}
