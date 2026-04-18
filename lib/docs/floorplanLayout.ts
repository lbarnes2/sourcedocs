import type { FloorplanSettings } from "@/types";

/** Visual row index 0 = top of content; column 0 = left. */
export type FloorplanCellCoord = { row: number; col: number };

/**
 * Visit order for assigning table numbers: first sorted table → first coordinate, etc.
 * See plan: straight = same horizontal direction every row; snaked = alternate per row.
 */
export function getFloorplanVisitOrder(
  rows: number,
  cols: number,
  startCorner: FloorplanSettings["startCorner"],
  numbering: FloorplanSettings["numbering"]
): FloorplanCellCoord[] {
  const visualRows =
    startCorner === "topLeft" || startCorner === "topRight"
      ? Array.from({ length: rows }, (_, i) => i)
      : Array.from({ length: rows }, (_, i) => rows - 1 - i);

  const baseLtr = startCorner === "topLeft" || startCorner === "bottomLeft";
  const indices = Array.from({ length: cols }, (_, c) => c);
  const reversed = [...indices].reverse();

  const colOrderForRow = (k: number): number[] => {
    const forward = baseLtr ? indices : reversed;
    const backward = baseLtr ? reversed : indices;
    if (numbering === "straight") return forward;
    return k % 2 === 0 ? forward : backward;
  };

  const out: FloorplanCellCoord[] = [];
  visualRows.forEach((r, k) => {
    colOrderForRow(k).forEach((c) => {
      out.push({ row: r, col: c });
    });
  });
  return out;
}

export type FloorplanPlacedCell = FloorplanCellCoord & { tableNumber: string | null };

/**
 * Pairs visit order with table numbers in event sort order. If the grid has more cells than
 * tables, remaining cells get `tableNumber: null` (empty slots). If it has fewer cells than
 * tables, only the first `rows × columns` tables are placed; the rest are omitted from the floorplan.
 */
export function buildFloorplanPlacedCells(
  settings: Pick<FloorplanSettings, "rows" | "columns" | "startCorner" | "numbering">,
  sortedTableNumbers: string[]
): FloorplanPlacedCell[] {
  const { rows, columns, startCorner, numbering } = settings;
  const visit = getFloorplanVisitOrder(rows, columns, startCorner, numbering);
  return visit.map((coord, i) => ({
    ...coord,
    tableNumber: i < sortedTableNumbers.length ? sortedTableNumbers[i] : null
  }));
}
