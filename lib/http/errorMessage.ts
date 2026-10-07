import { ZodError } from "zod";

/** Turns a thrown value into a short, user-readable message (Zod errors become "field: problem"). */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    if (!issue) return fallback;
    const where = issue.path.length ? `${issue.path.join(".")}: ` : "";
    return `${where}${issue.message}`;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
