/**
 * Tables can be numbered ("12", "12A") or named ("Top Table", "Rose"). We store numbers bare so they
 * sort numerically and print as "Table 12"; names are stored and printed as entered.
 */

const TABLE_PREFIX = /^table\s*(?:no\.?|number|#)?\s*[:#.\-–]?\s*/i;
const NUMBERED_TABLE = /^\d+[a-z]?$/i;

/** True for a value that reads as a table heading, e.g. "Table 4", "TABLE: 12", "Table Rose". */
export function looksLikeTableHeading(value: string): boolean {
  return /^table\b/i.test(value.trim()) && value.trim().length > "table".length;
}

/** "Table 4" / "table no. 4" → "4"; "Table Rose" and "Top Table" stay as written. */
export function normalizeTableValue(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  const withoutPrefix = trimmed.replace(TABLE_PREFIX, "");
  if (withoutPrefix !== trimmed && NUMBERED_TABLE.test(withoutPrefix)) return withoutPrefix;
  return trimmed;
}

/** How a table is printed: "Table 12" for numbers, the name itself otherwise. */
export function formatTableLabel(table: string): string {
  const trimmed = table.trim();
  if (!trimmed) return "";
  if (NUMBERED_TABLE.test(trimmed)) return `Table ${trimmed}`;
  return trimmed;
}

/**
 * Print order for tables: numbered tables first by number ("2" < "10" < "12" < "12A" < "13"), then
 * named tables A–Z. Used everywhere so every document lists tables in the same order.
 */
export function compareTables(a: string, b: string): number {
  const lead = (value: string) => {
    const match = /^\d+(?:\.\d+)?/.exec(value.trim());
    return match ? Number(match[0]) : null;
  };
  const na = lead(a);
  const nb = lead(b);
  if (na !== null && nb !== null && na !== nb) return na - nb;
  if ((na === null) !== (nb === null)) return na === null ? 1 : -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }) || a.localeCompare(b);
}
