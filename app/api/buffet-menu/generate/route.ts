import JSZip from "jszip";
import { NextResponse } from "next/server";
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
      { error: "Invalid payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { menu, venueLogoKey, venueLogoDataUrl } = parsed.data;
  const logo = await resolveVenueLogo(venueLogoKey ?? null, venueLogoDataUrl);

  const { display, matrix, labels } = await renderAllBuffetPdfs(menu, logo);

  const zip = new JSZip();
  zip.file("buffet-menu-display.pdf", display);
  zip.file("buffet-allergen-matrix.pdf", matrix);
  zip.file("buffet-labels.pdf", labels);
  const zipBytes = await zip.generateAsync({ type: "uint8array" });

  return new NextResponse(Buffer.from(zipBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="buffet-menu-documents.zip"'
    }
  });
}
