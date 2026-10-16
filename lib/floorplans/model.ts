import { buildFloorplanPlacedCells } from "@/lib/docs/floorplanLayout";
import {
  DEFAULT_PRINT_OPTIONS,
  DEFAULT_UNITS_PER_METRE,
  ROUND_TABLE_SIZES,
  roundTableRadius,
  type RoundTableSize,
  objectPrintBounds,
  recommendedRadius,
  recommendedRectSize
} from "@/lib/floorplans/geometry";
import { defaultFloorplanCanvasSettings, defaultFloorplanMetadata, defaultFloorplanSettings, defaultThemeSettings } from "@/lib/defaults";
import type {
  FloorplanAutoLayoutSettings,
  FloorplanCanvasObject,
  FloorplanDocument,
  FloorplanSettings,
  FloorplanTableObject,
  ThemeSettings
} from "@/types";

function makeTableNumbers(count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => String(index + 1));
}

export type TableStyle = "round" | "cabaret" | "long";

export interface AutoLayoutOptions {
  /** Table numbers to place, in visit order. Defaults to 1..tableCount. */
  tableNumbers?: string[];
  seats?: number;
  style?: TableStyle;
  /** Add a one-sided "Top table" above the grid. */
  topTable?: boolean;
  /** Standard round table size for round and cabaret styles. */
  roundSize?: RoundTableSize;
  /** Plan scale; table sizes follow it so a table is the same real-world size at any scale. */
  unitsPerMetre?: number | null;
}

const TABLE_GAP = 18;

function tableTemplate(
  seats: number,
  style: TableStyle,
  k: number,
  roundSize: RoundTableSize
): Omit<FloorplanTableObject, "id" | "type" | "tableNumber" | "x" | "y"> {
  if (style === "long") {
    const size = recommendedRectSize(seats, false);
    const width = size.width * k;
    const height = size.height * k;
    return { radius: height / 2, shape: "rect", seats, width, height };
  }
  const radius = roundTableRadius(roundSize, k * DEFAULT_UNITS_PER_METRE);
  if (style === "cabaret") return { radius, seats, seatSpan: 220 };
  return { radius, seats };
}

export function buildTablesFromAutoLayout(
  autoLayout: FloorplanAutoLayoutSettings,
  tableCount: number,
  options: AutoLayoutOptions = {}
): FloorplanCanvasObject[] {
  const tableNumbers = options.tableNumbers ?? makeTableNumbers(tableCount);
  const placed = buildFloorplanPlacedCells(autoLayout as FloorplanSettings, tableNumbers);
  const seats = options.seats ?? ROUND_TABLE_SIZES[options.roundSize ?? "6ft"].seats;
  const k = (options.unitsPerMetre ?? DEFAULT_UNITS_PER_METRE) / DEFAULT_UNITS_PER_METRE;
  const template = tableTemplate(seats, options.style ?? "round", k, options.roundSize ?? "6ft");
  const sample = { id: "", type: "table", tableNumber: "", x: 0, y: 0, ...template } as FloorplanTableObject;
  const bounds = objectPrintBounds(sample);
  const cellW = bounds.maxX - bounds.minX + TABLE_GAP;
  const cellH = bounds.maxY - bounds.minY + TABLE_GAP;
  const stagger = autoLayout.tableLayout === "staggered";
  const axis = autoLayout.staggerAxis ?? "horizontal";
  const originX = cellW * 0.8;
  const originY = cellH * 0.8 + (options.topTable ? cellH : 0);

  const tables: FloorplanCanvasObject[] = placed
    .filter((cell) => Boolean(cell.tableNumber))
    .map((cell) => {
      const rowOff = stagger && axis === "horizontal" && autoLayout.columns > 1 && cell.row % 2 === 1 ? cellW / 2 : 0;
      const colOff = stagger && axis === "vertical" && autoLayout.rows > 1 && cell.col % 2 === 1 ? cellH / 2 : 0;
      return {
        id: `table-${cell.tableNumber}`,
        type: "table" as const,
        tableNumber: String(cell.tableNumber),
        x: originX + cell.col * cellW + rowOff,
        y: originY + cell.row * cellH + colOff,
        ...template
      };
    });

  if (options.topTable && tables.length) {
    const topSeats = Math.max(6, Math.min(16, autoLayout.columns * 2));
    const base = recommendedRectSize(topSeats, true);
    const size = { width: base.width * k, height: base.height * k };
    const gridWidth = (autoLayout.columns - 1) * cellW + (stagger && axis === "horizontal" ? cellW / 2 : 0);
    tables.unshift({
      id: "table-top",
      type: "table",
      tableNumber: "Top",
      label: "Top table",
      shape: "rect",
      seats: topSeats,
      seatsOneSide: true,
      width: size.width,
      height: size.height,
      radius: size.height / 2,
      x: originX + gridWidth / 2,
      y: originY - cellH * 0.9
    });
  }
  return tables;
}

export function buildEmptyFloorplanDraft(name = "Untitled floorplan"): FloorplanDocument {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: crypto.randomUUID(),
    name,
    savedAt: now,
    metadata: { ...defaultFloorplanMetadata },
    canvas: { ...defaultFloorplanCanvasSettings, unitsPerMetre: DEFAULT_UNITS_PER_METRE },
    objects: [],
    print: { ...DEFAULT_PRINT_OPTIONS, legend: true, scaleBar: true },
    projectId: null,
    autoLayout: { ...defaultFloorplanSettings },
    themeSnapshot: { ...defaultThemeSettings },
    selectedClientLogoKey: null,
    selectedVenueLogoKey: null
  };
}

export function copyForDuplicate(doc: FloorplanDocument): FloorplanDocument {
  const now = new Date().toISOString();
  return {
    ...doc,
    id: crypto.randomUUID(),
    name: `${doc.name} (copy)`,
    savedAt: now
  };
}

export function applyLegacyFloorplanTheme(doc: FloorplanDocument, theme: ThemeSettings): FloorplanDocument {
  return {
    ...doc,
    metadata: {
      title: doc.metadata.title || theme.eventName || "",
      subtitle: doc.metadata.subtitle || theme.eventSubtitle || ""
    },
    themeSnapshot: {
      ...theme
    }
  };
}

export function fromLegacyFloorplanSettings(
  settings: FloorplanSettings,
  tableCount: number,
  name = "Migrated floorplan"
): FloorplanDocument {
  const seeded = buildEmptyFloorplanDraft(name);
  const objects = buildTablesFromAutoLayout(settings, tableCount);
  return {
    ...seeded,
    autoLayout: { ...settings },
    canvas: {
      ...seeded.canvas,
      paperSize: settings.paperSize,
      orientation: settings.orientation
    },
    objects
  };
}

