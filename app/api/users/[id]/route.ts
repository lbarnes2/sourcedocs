import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth/currentUser";
import { deleteManagedUser, updateManagedUser } from "@/lib/auth/manageUsers";
import { UserRuleError } from "@/lib/auth/userStore";
import { errorMessage } from "@/lib/http/errorMessage";
import { updateUserBodySchema } from "@/lib/validation/userSchemas";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Ctx) {
  const auth = await authorize(request);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  const parsed = updateUserBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: errorMessage(parsed.error, "Invalid request.") }, { status: 400 });
  }
  try {
    return NextResponse.json(await updateManagedUser(auth.id, id, parsed.data));
  } catch (error) {
    const status = error instanceof UserRuleError ? 409 : 500;
    return NextResponse.json({ error: errorMessage(error, "Failed to update user.") }, { status });
  }
}

export async function DELETE(request: Request, context: Ctx) {
  const auth = await authorize(request);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  try {
    await deleteManagedUser(auth.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = error instanceof UserRuleError ? 409 : 500;
    return NextResponse.json({ error: errorMessage(error, "Failed to delete user.") }, { status });
  }
}
