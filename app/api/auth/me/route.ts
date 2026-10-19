import { NextResponse } from "next/server";
import { getSession, sessionIsStale, setSessionCookie, toCurrentUser } from "@/lib/auth/currentUser";
import { getUserByIdCached } from "@/lib/auth/userStore";

/** The signed-in user. Also refreshes the cookie when an admin has changed the account since sign-in. */
export async function GET() {
  const session = await getSession();
  const stored = session ? await getUserByIdCached(session.uid) : null;
  if (!session || !stored || !stored.active) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const user = toCurrentUser(stored);
  const response = NextResponse.json({ user });
  if (sessionIsStale(session, user)) await setSessionCookie(response, user);
  return response;
}
