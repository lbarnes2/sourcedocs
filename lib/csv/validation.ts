import type { GuestRecord, ValidationIssue, ValidationReport } from "@/types";

const DIETARY_MAP: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(coeliac|celiac)\b/i, label: "Gluten Free" },
  { pattern: /\b(gluten\s*free|gf)\b/i, label: "Gluten Free" },
  { pattern: /\b(vegan)\b/i, label: "Vegan" },
  { pattern: /\b(vegetarian|veggie)\b/i, label: "Vegetarian" },
  { pattern: /\b(dairy\s*free|df)\b/i, label: "Dairy Free" },
  { pattern: /\b(nut\s*allergy|nuts?)\b/i, label: "Nut Allergy" },
  { pattern: /\b(shellfish)\b/i, label: "Shellfish Allergy" },
  { pattern: /\b(halal)\b/i, label: "Halal" },
  { pattern: /\b(kosher)\b/i, label: "Kosher" }
];

export function normalizeDietary(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  const labels = new Set<string>();
  DIETARY_MAP.forEach(({ pattern, label }) => {
    if (pattern.test(trimmed)) labels.add(label);
  });

  if (labels.size === 0) {
    return trimmed
      .split(/[;,/]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }

  return Array.from(labels);
}

interface ValidationOptions {
  requiredCourses: Array<"starter" | "main" | "dessert">;
}

export function validateGuests(guests: GuestRecord[], options: ValidationOptions): ValidationReport {
  const issues: ValidationIssue[] = [];
  const seenNames = new Map<string, number>();

  guests.forEach((guest, index) => {
    if (!guest.tableNumber) {
      issues.push({
        code: "missing_table",
        severity: "error",
        message: `Missing table number for ${guest.name || `row ${index + 1}`}.`,
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

    const missingCourses = options.requiredCourses.filter((course) => !guest[course]);
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
