import { NextResponse } from "next/server";
import { z } from "zod";
import { floorplanDocumentSchema } from "@/lib/validation/floorplanSchemas";
import { renderFloorplanDocumentPdf } from "@/lib/pdf/floorplanDocumentRender";

const bodySchema = z.object({
  floorplan: floorplanDocumentSchema
});

export async function POST(request: Request) {
  try {
    const raw = await request.json();
    const parsed = bodySchema.parse(raw);
    const pdfBytes = await renderFloorplanDocumentPdf(parsed.floorplan);
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="floorplan.pdf"'
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate floorplan PDF.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

