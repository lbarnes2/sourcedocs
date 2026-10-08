import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/http/errorMessage";
import { getBuffetMenuSettings, saveBuffetMenuSettings } from "@/lib/buffetMenu/settingsStore";
import { buffetMenuSettingsSchema } from "@/lib/validation/buffetMenuSchemas";

export async function GET() {
  try {
    return NextResponse.json(await getBuffetMenuSettings());
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error, "Could not load buffet settings.") }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = buffetMenuSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: `Invalid settings — ${errorMessage(parsed.error, "check the fields")}` }, { status: 400 });
  }
  try {
    await saveBuffetMenuSettings(parsed.data);
    return NextResponse.json(parsed.data);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error, "Could not save buffet settings.") }, { status: 500 });
  }
}
