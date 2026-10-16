import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/http/errorMessage";
import { z } from "zod";
import { floorplanDocumentSchema } from "@/lib/validation/floorplanSchemas";
import { renderFloorplanDocumentPdf } from "@/lib/pdf/floorplanDocumentRender";
import { buildTableGuests, type TableGuestMap } from "@/lib/floorplans/guests";
import { isValidProjectUuid } from "@/lib/projects/projectKeys";
import { getProject } from "@/lib/projects/store";

const bodySchema = z.object({
  floorplan: floorplanDocumentSchema
});

/** Guest counts are optional extras: a missing or unreadable project just prints without them. */
async function loadTableGuests(projectId: string | null | undefined): Promise<TableGuestMap | null> {
  if (!projectId || !isValidProjectUuid(projectId)) return null;
  try {
    const project = await getProject(projectId);
    return project ? buildTableGuests(project.guests) : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const raw = await request.json();
    const parsed = bodySchema.parse(raw);
    const tableGuests = await loadTableGuests(parsed.floorplan.projectId);
    const pdfBytes = await renderFloorplanDocumentPdf(parsed.floorplan, { tableGuests });
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="floorplan.pdf"'
      }
    });
  } catch (error) {
    const message = errorMessage(error, "Failed to generate floorplan PDF.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
