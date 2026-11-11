import Papa from "papaparse";
import type { ColumnMapping, GuestRecord, RawCsvRow, ValidationIssue } from "@/types";
import { normalizeDietary, validateGuests } from "@/lib/csv/validation";
import { looksLikeTableHeading, normalizeTableValue } from "@/lib/event/tableLabel";

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

/** Spreadsheet row number for a data row (row 1 is the header line). */
function sheetRow(index: number): number {
  return index + 2;
}

function nonEmptyCells(row: RawCsvRow): string[] {
  return Object.values(row)
    .map((value) => (value ?? "").trim())
    .filter(Boolean);
}

/**
 * A row that only names a table, e.g. "Table 4" on its own line above that table's guests,
 * or a table-column value with nothing else filled in.
 */
function tableHeadingFor(
  row: RawCsvRow,
  mapping: ColumnMapping
): { table: string; fromTableColumn: boolean } | null {
  const cells = nonEmptyCells(row);
  if (cells.length === 0) return null;
  const distinct = Array.from(new Set(cells));
  if (distinct.length === 1 && looksLikeTableHeading(distinct[0])) {
    return { table: distinct[0], fromTableColumn: false };
  }

  // "Table 4" typed into the name column, perhaps with a note beside it ("10 guests").
  const nameCell = safeValue(row, mapping.name ?? mapping.firstName);
  if (looksLikeTableHeading(nameCell)) return { table: nameCell, fromTableColumn: false };
  const name = composeName(row, mapping);
  if (/^table\s*\d+[a-z]?$/i.test(name)) return { table: name, fromTableColumn: false };

  if (!name) {
    // e.g. "Table 4" | "10 guests" in other columns.
    const headingCell = cells.find(looksLikeTableHeading);
    if (headingCell) return { table: headingCell, fromTableColumn: false };
    const tableValue = safeValue(row, mapping.table);
    if (tableValue && distinct.length === 1 && distinct[0] === tableValue) {
      return { table: tableValue, fromTableColumn: true };
    }
  }
  return null;
}

export interface NormalizeResult {
  guests: GuestRecord[];
  /** Rows left out of the guest list (no name), reported as warnings. */
  skipped: ValidationIssue[];
}

/**
 * Builds guests from spreadsheet rows. Handles two layouts:
 * - a table column on every guest row, and
 * - "Table x" heading rows, where following guests inherit the table until the next heading.
 * Rows with no name are dropped with a warning rather than blocking export.
 */
export function normalizeRowsWithNotices(rows: RawCsvRow[], mapping: ColumnMapping): NormalizeResult {
  const guests: GuestRecord[] = [];
  const skipped: ValidationIssue[] = [];
  let currentTable = "";

  rows.forEach((row, index) => {
    const heading = tableHeadingFor(row, mapping);
    if (heading !== null) {
      currentTable = normalizeTableValue(heading.table);
      // A bare number in the table column is more likely a guest with no details than a heading.
      if (heading.fromTableColumn) {
        skipped.push({
          code: "skipped_row",
          severity: "warning",
          message: `Skipped row ${sheetRow(index)}: table ${currentTable} with no guest name.`,
          rowIndex: index
        });
      }
      return;
    }

    const name = composeName(row, mapping);
    if (!name) {
      const cells = nonEmptyCells(row);
      if (cells.length === 0) return;
      const preview = cells.slice(0, 4).join(", ");
      skipped.push({
        code: "skipped_row",
        severity: "warning",
        message: `Skipped row ${sheetRow(index)}: no guest name (${preview.length > 80 ? `${preview.slice(0, 77)}…` : preview}).`,
        rowIndex: index
      });
      return;
    }

    const ownTable = normalizeTableValue(safeValue(row, mapping.table));
    const dietaryOriginal = safeValue(row, mapping.dietary);
    guests.push({
      id: `guest-${index + 1}`,
      tableNumber: ownTable || currentTable,
      name,
      starter: safeValue(row, mapping.starter),
      main: safeValue(row, mapping.main),
      dessert: safeValue(row, mapping.dessert),
      dietaryOriginal,
      dietaryNormalized: normalizeDietary(dietaryOriginal)
    });
  });

  return { guests, skipped };
}

export function normalizeRows(rows: RawCsvRow[], mapping: ColumnMapping): GuestRecord[] {
  return normalizeRowsWithNotices(rows, mapping).guests;
}

export function normalizeAndValidate(rows: RawCsvRow[], mapping: ColumnMapping) {
  const { guests, skipped } = normalizeRowsWithNotices(rows, mapping);
  const requiredCourses = (["starter", "main", "dessert"] as const).filter(
    (course) => Boolean(mapping[course])
  );
  const validation = validateGuests(guests, { requiredCourses });
  return { guests, validation: { issues: [...skipped, ...validation.issues] } };
}
