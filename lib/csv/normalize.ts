import Papa from "papaparse";
import type { ColumnMapping, GuestRecord, RawCsvRow } from "@/types";
import { normalizeDietary, validateGuests } from "@/lib/csv/validation";

function safeValue(row: RawCsvRow, columnName?: string): string {
  if (!columnName) return "";
  return (row[columnName] ?? "").trim();
}

function composeName(row: RawCsvRow, mapping: ColumnMapping): string {
  if (mapping.name) return safeValue(row, mapping.name);
  const first = safeValue(row, mapping.firstName);
  const last = safeValue(row, mapping.lastName);
  return `${first} ${last}`.trim();
}

export function parseCsv(csvText: string): { headers: string[]; rows: RawCsvRow[] } {
  const parsed = Papa.parse<RawCsvRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim()
  });

  if (parsed.errors.length) {
    throw new Error(parsed.errors.map((error) => error.message).join("; "));
  }

  const headers = parsed.meta.fields ?? [];
  return { headers, rows: parsed.data };
}

export function normalizeRows(rows: RawCsvRow[], mapping: ColumnMapping): GuestRecord[] {
  return rows.map((row, index) => {
    const dietaryOriginal = safeValue(row, mapping.dietary);
    return {
      id: `guest-${index + 1}`,
      tableNumber: safeValue(row, mapping.table),
      name: composeName(row, mapping),
      starter: safeValue(row, mapping.starter),
      main: safeValue(row, mapping.main),
      dessert: safeValue(row, mapping.dessert),
      dietaryOriginal,
      dietaryNormalized: normalizeDietary(dietaryOriginal)
    };
  });
}

export function normalizeAndValidate(rows: RawCsvRow[], mapping: ColumnMapping) {
  const guests = normalizeRows(rows, mapping);
  const requiredCourses = (["starter", "main", "dessert"] as const).filter(
    (course) => Boolean(mapping[course])
  );
  const validation = validateGuests(guests, { requiredCourses });
  return { guests, validation };
}
