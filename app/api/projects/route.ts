import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/http/errorMessage";
import { isR2Configured } from "@/lib/storage/r2";
import { buildEventProjectFileFromSavePayload } from "@/lib/projects/parseProjectPayload";
import { listProjects, saveProject } from "@/lib/projects/store";
import { authorize } from "@/lib/auth/currentUser";

export async function GET() {
  try {
    const projects = await listProjects();
    return NextResponse.json({
      storage: isR2Configured() ? "r2" : "local",
      projects
    });
  } catch (error) {
    const message = errorMessage(error, "Failed to list projects.");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if (auth instanceof Response) return auth;
  try {
    const body = await request.json();
    const file = buildEventProjectFileFromSavePayload(body);
    await saveProject(file);
    return NextResponse.json({ ok: true, id: file.id, savedAt: file.savedAt });
  } catch (error) {
    const message = errorMessage(error, "Failed to save project.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
