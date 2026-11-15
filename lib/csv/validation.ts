import type { GuestRecord, ValidationIssue, ValidationReport } from "@/types";

/**
 * Split when the source clearly lists multiple dietaries. We intentionally do **not** split on
 * "and" / "&" so phrases like "vegetarian and no eggs" stay one literal requirement.
 */
const DIETARY_SEGMENT_SEPARATOR = /[,;\n]/;

/**
 * Splits on commas / semicolons / new lines, but never inside brackets and never on "/":
 * "No dairy / gluten" must not become a bare "gluten", and "Vegetarian (no eggs, no milk)" is one item.
 */
function splitDietarySegments(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of input) {
    if (char === "(" || char === "[") depth += 1;
    else if ((char === ")" || char === "]") && depth > 0) depth -= 1;
    if (depth === 0 && DIETARY_SEGMENT_SEPARATOR.test(char)) {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

/** Whole-segment only: safe spelling unification, no substring inference. */
const GLUTEN_FREE_WHOLE =
  /^(gf|g\.?\s*f\.?|gluten\s*free|gluten-free|glutenfree|coeliac|celiac|coeliacs?)$/i;
const DAIRY_FREE_WHOLE = /^(df|d\.?\s*f\.?|dairy\s*free|dairy-free|dairyfree)$/i;

function collapseSpaces(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeDietarySegment(segment: string): string {
  const t = collapseSpaces(segment);
  if (!t) return t;
  if (GLUTEN_FREE_WHOLE.test(t)) return "Gluten Free";
  if (DAIRY_FREE_WHOLE.test(t)) return "Dairy Free";
  return t;
}

/**
 * Dietary requirements are safety-critical. We only unify a **small** set of obvious spelling
 * variants when the entire segment is one of those labels. Everything else is kept exactly as
 * entered (aside from trim / whitespace collapse).
 */
export function normalizeDietary(input: string): string[] {
  const trimmed = collapseSpaces(input);
  if (!trimmed) return [];

  if (/^(none|n\/a|na|no dietary|no dietaries|-)$/i.test(trimmed)) {
    return [];
  }

  const NONE = /^(none|n\/a|na|no dietary|no dietaries|-)$/i;
  const segments = splitDietarySegments(input)
    .map((s) => collapseSpaces(s))
    .filter((s) => s && !NONE.test(s))
    // "GF/DF" is a list of one-word labels; anything with a phrase in it ("No dairy / gluten") stays whole.
    .flatMap((s) => {
      const parts = s.split("/").map((part) => part.trim());
      return parts.length > 1 && parts.every((part) => part && !/\s/.test(part)) ? parts : [s];
    });
  const out: string[] = [];
  const seen = new Set<string>();

  for (const segment of segments) {
    const normalized = normalizeDietarySegment(segment);
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }

  return out;
}

interface ValidationOptions {
  requiredCourses: Array<"starter" | "main" | "dessert">;
}

export function validateGuests(guests: GuestRecord[], options: ValidationOptions): ValidationReport {
  const issues: ValidationIssue[] = [];
  const seenNames = new Map<string, number>();

  // A course column that's blank for everyone (e.g. a 1-1-1 dinner) gets one note, not one per guest.
  const emptyCourses = options.requiredCourses.filter((course) => !guests.some((guest) => guest[course].trim()));
  if (guests.length && emptyCourses.length) {
    issues.push({
      code: "missing_choice",
      severity: "warning",
      message: `No ${emptyCourses.join(", ")} choices in the guest list. For a set menu, enter the dishes under Set menu.`
    });
  }
  const requiredCourses = options.requiredCourses.filter((course) => !emptyCourses.includes(course));

  guests.forEach((guest, index) => {
    if (!guest.tableNumber) {
      issues.push({
        code: "missing_table",
        severity: "error",
        message: `Missing table for ${guest.name || `row ${index + 1}`} — map a table column, or add a "Table x" row above their table.`,
        rowIndex: index
      });
    }

    if (!guest.name) {
      issues.push({
        code: "missing_required",
        severity: "error",
        message: `Missing guest name at row ${index + 1}.`,
        rowIndex: index
      });
    }

    const missingCourses = requiredCourses.filter((course) => !guest[course]);
    if (missingCourses.length > 0) {
      issues.push({
        code: "missing_choice",
        severity: "warning",
        message: `Missing ${missingCourses.join(", ")} choice for ${guest.name || `row ${index + 1}`}.`,
        rowIndex: index
      });
    }

    if (guest.name) {
      const key = guest.name.toLowerCase();
      if (seenNames.has(key)) {
        issues.push({
          code: "duplicate_name",
          severity: "warning",
          message: `Duplicate name detected: ${guest.name}.`,
          rowIndex: index
        });
      } else {
        seenNames.set(key, index);
      }
    }
  });

  return { issues };
}
