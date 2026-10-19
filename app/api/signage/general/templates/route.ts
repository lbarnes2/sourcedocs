import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/http/errorMessage";
import { listGeneralSignTemplates, saveGeneralSignTemplates } from "@/lib/signage/generalTemplateStore";
import * as limits from "@/lib/validation/limits";
import { generalSignTemplateListSchema, generalSignTemplateSchema } from "@/lib/validation/signageSchemas";
import { authorize } from "@/lib/auth/currentUser";

export async function GET() {
  return NextResponse.json({ templates: await listGeneralSignTemplates() });
}

/** Create or update one template (matched by id); new templates go to the end of the list. */
export async function POST(request: Request) {
  const auth = await authorize(request);
  if (auth instanceof Response) return auth;
  try {
    const template = generalSignTemplateSchema.parse(await request.json());
    const templates = await listGeneralSignTemplates();
    const index = templates.findIndex((t) => t.id === template.id);
    if (index >= 0) {
      templates[index] = template;
    } else {
      if (templates.length >= limits.MAX_GENERAL_SIGN_TEMPLATES) {
        throw new Error(`You can keep at most ${limits.MAX_GENERAL_SIGN_TEMPLATES} templates.`);
      }
      templates.push(template);
    }
    await saveGeneralSignTemplates(templates);
    return NextResponse.json({ templates });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error, "Failed to save template.") }, { status: 400 });
  }
}

/** Replace the whole list — used for reordering, renaming, and restoring built-ins. */
export async function PUT(request: Request) {
  const auth = await authorize(request);
  if (auth instanceof Response) return auth;
  try {
    const body = (await request.json()) as { templates?: unknown };
    const templates = generalSignTemplateListSchema.parse(body.templates);
    await saveGeneralSignTemplates(templates);
    return NextResponse.json({ templates });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error, "Failed to save templates.") }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const auth = await authorize(request);
  if (auth instanceof Response) return auth;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 });
  try {
    const templates = (await listGeneralSignTemplates()).filter((t) => t.id !== id);
    await saveGeneralSignTemplates(templates);
    return NextResponse.json({ templates });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error, "Failed to delete template.") }, { status: 400 });
  }
}
