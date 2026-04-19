/**
 * Excel → CSV text for the existing Papa Parse pipeline (first sheet only).
 * Loads SheetJS only when an Excel file is imported.
 */

export function isExcelFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return true;
  const t = file.type.toLowerCase();
  return (
    t === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    t === "application/vnd.ms-excel"
  );
}

export async function excelFileToCsvText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("That workbook has no sheets.");
  }
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error("Could not read the first sheet.");
  }
  return XLSX.utils.sheet_to_csv(sheet);
}
