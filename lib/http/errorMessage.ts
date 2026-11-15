import { ZodError } from "zod";

/** Plain-English names for settings people can actually change on screen. */
const FIELD_LABELS: Record<string, string> = {
  "tablePlan.tablesPerSheet": "Tables per sheet (table plan by table)",
  "tablePlanByPerson.tablesPerSheet": "Rows per page (table plan by person)",
  "placeCard.cardWidthMm": "Place card width",
  "placeCard.cardHeightMm": "Place card height",
  "theme.eventName": "Event name",
  "theme.primaryColor": "Primary colour",
  "theme.accentColor": "Accent colour",
  "theme.textColor": "Text colour"
};

/** Turns a thrown value into a short, user-readable message (Zod errors become "field: problem"). */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    if (!issue) return fallback;
    const key = issue.path.join(".");
    const friendly = FIELD_LABELS[key.replace(/^request\./, "")];
    if (friendly) return `${friendly}: ${issue.message.replace(/^Number must be /, "must be ")}`;
    const where = issue.path.length ? `${key}: ` : "";
    return `${where}${issue.message}`;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
