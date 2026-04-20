import { NextResponse } from "next/server";
import { isR2Configured } from "@/lib/storage/r2";
import { deleteClientLogo, listClientLogos, saveClientLogoUpload } from "@/lib/logos/clientR2";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);

export async function GET() {
  if (!isR2Configured()) {
    return NextResponse.json({ configured: false, items: [] as { key: string; label: string; assetUrl: string }[] });
  }
  const items = (await listClientLogos()).map((item) => ({
    key: item.key,
    label: item.label,
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
    const contentType = (file.type || "application/octet-stream").toLowerCase();
    if (!ALLOWED_TYPES.has(contentType)) {
      return NextResponse.json(
        { error: "Unsupported type. Use PNG, JPEG, WebP, or GIF." },
        { status: 400 }
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const { key } = await saveClientLogoUpload(buffer, {
      contentType: contentType === "image/jpg" ? "image/jpeg" : contentType,
      originalName: file.name
    });
    return NextResponse.json({
      ok: true,
      key,
      assetUrl: `/api/logos/client/asset?key=${encodeURIComponent(key)}`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
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
    await deleteClientLogo(key);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delete failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
