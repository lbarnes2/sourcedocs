import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/http/errorMessage";
import { getAppSettings, saveAppSettings } from "@/lib/appSettings/store";
import {
  BUILTIN_DISPLAY_BACKGROUND_KEY,
  deleteDisplayBackground,
  listDisplayBackgrounds,
  saveDisplayBackgroundUpload
} from "@/lib/displayBackgrounds/store";

export async function GET() {
  try {
    return NextResponse.json({ items: await listDisplayBackgrounds() });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error, "Could not list backgrounds.") }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Expected multipart field \"file\" with image data." }, { status: 400 });
    }
    const { key, warning } = await saveDisplayBackgroundUpload(Buffer.from(await file.arrayBuffer()), file.name);
    return NextResponse.json({ ok: true, key, warning });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error, "Upload failed.") }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing key query parameter." }, { status: 400 });
  }
  try {
    await deleteDisplayBackground(key);
    /* Menus that chose this background fall back to the default when printed; the default itself goes back to the built-in. */
    const settings = await getAppSettings();
    if (settings.defaultDisplayBackgroundKey === key) {
      await saveAppSettings({ ...settings, defaultDisplayBackgroundKey: BUILTIN_DISPLAY_BACKGROUND_KEY });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error, "Delete failed.") }, { status: 400 });
  }
}
