import JSZip from "jszip";
import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/http/errorMessage";
import { getAppSettings } from "@/lib/appSettings/store";
import { resolveDisplayBackgroundBytes } from "@/lib/displayBackgrounds/store";
import { renderAllBuffetPdfs, type BuffetPdfKind } from "@/lib/pdf/buffetMenuPdf";
import { flattenForDisplayMenu } from "@/lib/buffetMenu/flattenMenu";
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
  const { menu, venueLogoKey, venueLogoDataUrl, displayBackgroundKey, allergenStatement, export: exportMode } =
    parsed.data;
  if (!flattenForDisplayMenu(menu).some((line) => line.kind === "item")) {
    return NextResponse.json({ error: "Give at least one dish a name before downloading." }, { status: 400 });
  }

  const pdfFiles: Record<BuffetPdfKind, string> = {
    display: "buffet-menu-display.pdf",
    matrix: "buffet-allergen-matrix.pdf",
    labelsA6: "buffet-labels-a6.pdf",
    labelsA7: "buffet-labels-a7.pdf"
  };
  const kindForExport: Record<Exclude<typeof exportMode, "zip">, BuffetPdfKind> = {
    display: "display",
    matrix: "matrix",
    labels: "labelsA6",
    labelsA7: "labelsA7"
  };
  // Render only what was asked for: a single download no longer builds all four documents.
  const only = exportMode === "zip" ? undefined : [kindForExport[exportMode]];

  let rendered: Awaited<ReturnType<typeof renderAllBuffetPdfs>>;
  try {
    const logo = await resolveVenueLogo(venueLogoKey ?? null, venueLogoDataUrl);
    const { defaultDisplayBackgroundKey } = await getAppSettings();
    const displayBackground = await resolveDisplayBackgroundBytes([displayBackgroundKey, defaultDisplayBackgroundKey]);
    rendered = await renderAllBuffetPdfs(menu, logo, { allergenStatement, displayBackground, only });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error, "Generation failed.") }, { status: 500 });
  }

  if (exportMode === "zip") {
    const zip = new JSZip();
    (Object.keys(pdfFiles) as BuffetPdfKind[]).forEach((kind) => {
      const bytes = rendered[kind];
      if (bytes) zip.file(pdfFiles[kind], bytes);
    });
    const zipBytes = await zip.generateAsync({ type: "uint8array" });
    return new NextResponse(Buffer.from(zipBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="buffet-menu-documents.zip"'
      }
    });
  }

  const kind = kindForExport[exportMode];
  const bytes = rendered[kind];
  if (!bytes) {
    return NextResponse.json({ error: "Generation failed." }, { status: 500 });
  }
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdfFiles[kind]}"`
    }
  });
}
