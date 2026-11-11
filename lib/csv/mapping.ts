import type { CanonicalColumn, ColumnMapping } from "@/types";

const COLUMN_ALIASES: Record<CanonicalColumn, string[]> = {
  table: ["table", "table_number", "table number", "table no", "tablenumber", "table name", "table_name", "table no."],
  name: ["name", "guest_name", "guest name", "full_name", "full name"],
  firstName: ["firstname", "first_name", "first name", "forename"],
  lastName: ["lastname", "last_name", "last name", "surname"],
  starter: ["starter", "starter choice", "starter_choice"],
  main: ["main", "main choice", "main_course", "main course"],
  dessert: ["dessert", "dessert choice", "dessert_course", "dessert course"],
  dietary: [
    "dietary",
    "dietary requirement",
    "dietary requirements",
    "dietary_requirement",
    "allergies",
    "allergy"
  ]
};

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function autoDetectMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const normalized = headers.map((h) => ({
    original: h,
    normalized: normalizeHeader(h)
  }));

  (Object.keys(COLUMN_ALIASES) as CanonicalColumn[]).forEach((canonical) => {
    const aliases = COLUMN_ALIASES[canonical];
    const matched = normalized.find((header) => aliases.includes(header.normalized));
    if (matched) {
      mapping[canonical] = matched.original;
    }
  });

  return mapping;
}

export function getRequiredMappingIssues(mapping: ColumnMapping): string[] {
  // Table and course columns are optional: tables can come from "Table x" heading rows, and a
  // set menu (1-1-1) can be entered on the page instead of per guest.
  const missing: string[] = [];
  if (!mapping.name && !(mapping.firstName && mapping.lastName)) {
    missing.push("Provide either Name or First Name + Last Name mapping.");
  }
  return missing;
}

export function canonicalColumns(): CanonicalColumn[] {
  return [
    "table",
    "name",
    "firstName",
    "lastName",
    "starter",
    "main",
    "dessert",
    "dietary"
  ];
}
