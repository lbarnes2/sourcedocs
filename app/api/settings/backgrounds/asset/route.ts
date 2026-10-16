import { NextResponse } from "next/server";
import { getDisplayBackgroundBytes } from "@/lib/displayBackgrounds/store";

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing key." }, { status: 400 });
  }
  let got: Awaited<ReturnType<typeof getDisplayBackgroundBytes>>;
  try {
    got = await getDisplayBackgroundBytes(key);
  } catch {
    return NextResponse.json({ error: "Invalid key." }, { status: 400 });
  }
  if (!got) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return new NextResponse(Buffer.from(got.bytes), {
    status: 200,
    headers: { "Content-Type": got.contentType, "Cache-Control": "private, max-age=3600" }
  });
}
