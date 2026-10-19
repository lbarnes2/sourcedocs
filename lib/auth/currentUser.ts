import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requiredRole } from "@/lib/auth/permissions";
import { hasRole } from "@/lib/auth/roles";
import { SESSION_COOKIE, sessionCookieOptions, signSession, verifySession, type SessionPayload } from "@/lib/auth/session";
import { getUserByIdCached } from "@/lib/auth/userStore";
import type { CurrentUser, StoredUser } from "@/types/auth";

export function toCurrentUser(user: StoredUser): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    mustChangePassword: user.mustChangePassword
  };
}

/** Signs `user` in on `response` (or refreshes their cookie after a change). */
export async function setSessionCookie(response: NextResponse, user: CurrentUser): Promise<void> {
  const token = await signSession({ uid: user.id, name: user.name, role: user.role, mcp: user.mustChangePassword });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
}

/** True when the cookie no longer matches the account (an admin changed the role, name or password flag). */
export function sessionIsStale(session: SessionPayload, user: CurrentUser): boolean {
  return session.role !== user.role || session.name !== user.name || session.mcp !== user.mustChangePassword;
}

export async function getSession(): Promise<SessionPayload | null> {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value);
}

/**
 * The live account behind the request's session cookie, or null when signed out, deactivated or deleted.
 * The role comes from the account record, not the cookie, so role changes apply within about 30 seconds.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getSession();
  if (!session) return null;
  const user = await getUserByIdCached(session.uid);
  if (!user || !user.active) return null;
  return toCurrentUser(user);
}

/**
 * Route-handler check against the live account, using the same role table as the middleware.
 * Returns the user, or a response to send back as-is:
 *
 *   const auth = await authorize(request);
 *   if (auth instanceof Response) return auth;
 */
export async function authorize(request: Request): Promise<CurrentUser | Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (user.mustChangePassword) {
    return NextResponse.json({ error: "Please change your password first." }, { status: 403 });
  }
  if (!hasRole(user.role, requiredRole(new URL(request.url).pathname, request.method))) {
    return NextResponse.json({ error: "Your account does not have permission to do this." }, { status: 403 });
  }
  return user;
}
