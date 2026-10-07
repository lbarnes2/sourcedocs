import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/http/errorMessage";
import { isR2Configured } from "@/lib/storage/r2";
import { deleteClientLogo, listClientLogos, renameClientLogo, saveClientLogoUpload } from "@/lib/logos/clientR2";
import { isPrintableLogoKey, logoContentTypeFromBytes } from "@/lib/logos/logoUpload";
import { findLogoKeyReferences } from "@/lib/logos/replaceLogoKeyRefs";

export async function GET() {
  if (!isR2Configured()) {
    return NextResponse.json({ configured: false, items: [] as { key: string; label: string; printable: boolean; assetUrl: string }[] });
  }
  const items = (await listClientLogos()).map((item) => ({
    key: item.key,
    label: item.label,
    printable: isPrintableLogoKey(item.key),
    assetUrl: `/api/logos/client/asset?key=${encodeURIComponent(item.key)}`
  }));
  return NextResponse.json({ configured: true, items });
}

export async function POST(request: Request) {
  if (!isR2Configured()) {
    return NextResponse.json({ error: "R2 is not configured." }, { status: 503 });
  }
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Expected multipart field \"file\" with image data." }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const contentType = logoContentTypeFromBytes(buffer);
    const { key } = await saveClientLogoUpload(buffer, {
      contentType,
      originalName: file.name
    });
    return NextResponse.json({
      ok: true,
      key,
      assetUrl: `/api/logos/client/asset?key=${encodeURIComponent(key)}`
    });
  } catch (error) {
    const message = errorMessage(error, "Upload failed.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  if (!isR2Configured()) {
    return NextResponse.json({ error: "R2 is not configured." }, { status: 503 });
  }
  try {
    const body = (await request.json()) as { key?: unknown; name?: unknown };
    const key = typeof body.key === "string" ? body.key.trim() : "";
    const name = typeof body.name === "string" ? body.name : "";
    if (!key) {
      return NextResponse.json({ error: "Missing key." }, { status: 400 });
    }
    const { key: newKey } = await renameClientLogo(key, name);
    return NextResponse.json({
      ok: true,
      key: newKey,
      assetUrl: `/api/logos/client/asset?key=${encodeURIComponent(newKey)}`
    });
  } catch (error) {
    const message = errorMessage(error, "Rename failed.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  if (!isR2Configured()) {
    return NextResponse.json({ error: "R2 is not configured." }, { status: 503 });
  }
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing key query parameter." }, { status: 400 });
  }
  try {
    if (url.searchParams.get("force") !== "1") {
      const references = await findLogoKeyReferences(key);
      if (references.length) {
        return NextResponse.json(
          { error: "This logo is still in use.", references },
          { status: 409 }
        );
      }
    }
    await deleteClientLogo(key);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = errorMessage(error, "Delete failed.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
