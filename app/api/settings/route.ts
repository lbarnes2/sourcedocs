import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/http/errorMessage";
import { getAppSettings, saveAppSettings } from "@/lib/appSettings/store";
import { appSettingsSchema } from "@/lib/validation/appSettingsSchemas";
import { authorize } from "@/lib/auth/currentUser";

export async function GET() {
  try {
    return NextResponse.json(await getAppSettings());
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error, "Could not load settings.") }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await authorize(request);
  if (auth instanceof Response) return auth;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = appSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: `Invalid settings — ${errorMessage(parsed.error, "check the fields")}` }, { status: 400 });
  }
  try {
    await saveAppSettings(parsed.data);
    return NextResponse.json(parsed.data);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error, "Could not save settings.") }, { status: 500 });
  }
}
