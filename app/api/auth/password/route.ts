import { NextResponse } from "next/server";
import { getSession, setSessionCookie, toCurrentUser } from "@/lib/auth/currentUser";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { listUsers, updateUser } from "@/lib/auth/userStore";
import { changePasswordBodySchema } from "@/lib/validation/userSchemas";

/** Change your own password. Also how a temporary password set by an admin gets replaced. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const parsed = changePasswordBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }
  const { currentPassword, newPassword } = parsed.data;

  try {
    /* Fresh read, not the permission cache: the hash must be current. */
    const user = (await listUsers()).find((u) => u.id === session.uid);
    if (!user || !user.active) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
    }
    if (currentPassword === newPassword) {
      return NextResponse.json({ error: "Choose a password different from the current one." }, { status: 400 });
    }

    const passwordHash = await hashPassword(newPassword);
    const updated = await updateUser(user.id, (u) => ({ ...u, passwordHash, mustChangePassword: false }));
    if (!updated) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

    const response = NextResponse.json({ ok: true });
    await setSessionCookie(response, toCurrentUser(updated));
    return response;
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Could not change password. Please try again." }, { status: 500 });
  }
}
