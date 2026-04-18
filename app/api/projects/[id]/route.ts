import { NextResponse } from "next/server";
import { parseStoredEventProjectFile } from "@/lib/projects/parseProjectPayload";
import { assertValidProjectId } from "@/lib/projects/projectKeys";
import { deleteProject, getProject } from "@/lib/projects/store";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    assertValidProjectId(id);
    const raw = await getProject(id);
    if (!raw) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }
    const file = parseStoredEventProjectFile(raw);
    return NextResponse.json({ project: file });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load project.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    assertValidProjectId(id);
    await deleteProject(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete project.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
