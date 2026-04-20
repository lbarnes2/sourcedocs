import { NextResponse } from "next/server";
import { isR2Configured } from "@/lib/storage/r2";
import { assertClientLogoKey, getClientLogoBytes } from "@/lib/logos/clientR2";

export async function GET(request: Request) {
  if (!isR2Configured()) {
    return NextResponse.json({ error: "R2 is not configured." }, { status: 503 });
  }
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing key." }, { status: 400 });
  }
  try {
    assertClientLogoKey(key);
  } catch {
    return NextResponse.json({ error: "Invalid key." }, { status: 400 });
  }
  const got = await getClientLogoBytes(key);
  if (!got) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const contentType = got.contentType || "application/octet-stream";
  return new NextResponse(new Uint8Array(got.body), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600"
    }
  });
}
