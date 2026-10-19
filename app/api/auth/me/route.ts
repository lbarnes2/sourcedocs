import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  return NextResponse.json({ user });
}
