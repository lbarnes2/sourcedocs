import JSZip from "jszip";
import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/http/errorMessage";
import { renderAllBuffetPdfs } from "@/lib/pdf/buffetMenuPdf";
import { loadLogoBytesFromKey, parseDataUrlImage } from "@/lib/signage/loadLogoBytes";
import { isR2Configured } from "@/lib/storage/r2";
import { buffetMenuGenerateBodySchema } from "@/lib/validation/buffetMenuSchemas";

async function resolveVenueLogo(
  key: string | null | undefined,
  dataUrl: string | undefined
): Promise<{ bytes: Uint8Array; contentType?: string } | null> {
  if (dataUrl?.trim()) {
    const parsed = parseDataUrlImage(dataUrl);
    if (parsed) return parsed;
  }
  const k = key?.trim();
  if (k && isR2Configured()) {
    return loadLogoBytesFromKey(k);
  }
  return null;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = buffetMenuGenerateBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Invalid payload — ${errorMessage(parsed.error, "check the fields")}`, details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { menu, venueLogoKey, venueLogoDataUrl, allergenStatement, export: exportMode } = parsed.data;
  let rendered: Awaited<ReturnType<typeof renderAllBuffetPdfs>>;
  try {
    const logo = await resolveVenueLogo(venueLogoKey ?? null, venueLogoDataUrl);
    rendered = await renderAllBuffetPdfs(menu, logo, { allergenStatement });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error, "Generation failed.") }, { status: 500 });
  }
  const { display, matrix, labelsA6, labelsA7 } = rendered;

  if (exportMode === "zip") {
    const zip = new JSZip();
    zip.file("buffet-menu-display.pdf", display);
    zip.file("buffet-allergen-matrix.pdf", matrix);
    zip.file("buffet-labels-a6.pdf", labelsA6);
    zip.file("buffet-labels-a7.pdf", labelsA7);
    const zipBytes = await zip.generateAsync({ type: "uint8array" });
    return new NextResponse(Buffer.from(zipBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="buffet-menu-documents.zip"'
      }
    });
  }

  const out =
    exportMode === "display"
      ? { bytes: display, filename: "buffet-menu-display.pdf" as const }
      : exportMode === "matrix"
        ? { bytes: matrix, filename: "buffet-allergen-matrix.pdf" as const }
        : exportMode === "labelsA7"
          ? { bytes: labelsA7, filename: "buffet-labels-a7.pdf" as const }
          : { bytes: labelsA6, filename: "buffet-labels-a6.pdf" as const };
  return new NextResponse(Buffer.from(out.bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${out.filename}"`
    }
  });
}
