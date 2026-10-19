import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { getUserById } from "@/lib/auth/userStore";
import type { CurrentUser } from "@/types/auth";

/**
 * The live account behind the request's session cookie, or null when signed out, deactivated or deleted.
 * The role comes from the account record, not the cookie, so role changes take effect immediately.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const user = await getUserById(session.uid);
  if (!user || !user.active) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    mustChangePassword: user.mustChangePassword
  };
}
