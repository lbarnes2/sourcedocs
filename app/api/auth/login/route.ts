import { NextResponse } from "next/server";
import { getDummyHash, verifyPassword } from "@/lib/auth/password";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth/session";
import { findUserByEmail, updateUser } from "@/lib/auth/userStore";
import { loginBodySchema } from "@/lib/validation/userSchemas";

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;
const BAD_LOGIN = "Email or password is incorrect.";

export async function POST(request: Request) {
  const parsed = loginBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: BAD_LOGIN }, { status: 400 });
  const { email, password } = parsed.data;

  try {
    const user = await findUserByEmail(email);
    if (!user || !user.active) {
      await verifyPassword(password, await getDummyHash());
      return NextResponse.json({ error: BAD_LOGIN }, { status: 401 });
    }

    if (user.lockedUntil && Date.parse(user.lockedUntil) > Date.now()) {
      const minutes = Math.ceil((Date.parse(user.lockedUntil) - Date.now()) / 60_000);
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` },
        { status: 429 }
      );
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      await updateUser(user.id, (u) => {
        const failedLogins = u.failedLogins + 1;
        return failedLogins >= MAX_FAILED_LOGINS
          ? { ...u, failedLogins: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString() }
          : { ...u, failedLogins };
      });
      return NextResponse.json({ error: BAD_LOGIN }, { status: 401 });
    }

    if (user.failedLogins > 0 || user.lockedUntil) {
      await updateUser(user.id, (u) => ({ ...u, failedLogins: 0, lockedUntil: null }));
    }

    const token = await signSession({ uid: user.id, name: user.name, role: user.role });
    const response = NextResponse.json({ ok: true, mustChangePassword: user.mustChangePassword });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Sign-in failed. Please try again." }, { status: 500 });
  }
}
