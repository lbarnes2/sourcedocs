import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth/currentUser";
import { createUser, toManagedUser } from "@/lib/auth/manageUsers";
import { listUsers, UserRuleError } from "@/lib/auth/userStore";
import { errorMessage } from "@/lib/http/errorMessage";
import { createUserBodySchema } from "@/lib/validation/userSchemas";

export async function GET(request: Request) {
  const auth = await authorize(request);
  if (auth instanceof Response) return auth;
  try {
    const users = (await listUsers()).map(toManagedUser).sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ users });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error, "Failed to list users.") }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if (auth instanceof Response) return auth;
  const parsed = createUserBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: errorMessage(parsed.error, "Invalid request.") }, { status: 400 });
  }
  try {
    return NextResponse.json(await createUser(parsed.data));
  } catch (error) {
    const status = error instanceof UserRuleError ? 409 : 500;
    return NextResponse.json({ error: errorMessage(error, "Failed to create user.") }, { status });
  }
}
