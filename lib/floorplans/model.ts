import { buildFloorplanPlacedCells } from "@/lib/docs/floorplanLayout";
import { defaultFloorplanCanvasSettings, defaultFloorplanMetadata, defaultFloorplanSettings, defaultThemeSettings } from "@/lib/defaults";
import type {
  FloorplanAutoLayoutSettings,
  FloorplanCanvasObject,
  FloorplanDocument,
  FloorplanSettings,
  ThemeSettings
} from "@/types";

function makeTableNumbers(count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => String(index + 1));
}

export function buildTablesFromAutoLayout(autoLayout: FloorplanAutoLayoutSettings, tableCount: number): FloorplanCanvasObject[] {
  const tableNumbers = makeTableNumbers(tableCount);
  const placed = buildFloorplanPlacedCells(autoLayout as FloorplanSettings, tableNumbers);
  const tableRadius = 22;
  const chairRadius = 5;
  const chairGap = 4;
  const chairRingRadius = tableRadius + chairGap + chairRadius;
  const tableFootprint = chairRingRadius + chairRadius;
  const step = Math.max(defaultFloorplanCanvasSettings.gridSize * 3, Math.round(tableFootprint * 2 + 18));
  const stagger = autoLayout.tableLayout === "staggered";
  const axis = autoLayout.staggerAxis ?? "horizontal";

  return placed
    .filter((cell) => Boolean(cell.tableNumber))
    .map((cell) => {
      const rowOff =
        stagger && axis === "horizontal" && autoLayout.columns > 1 && cell.row % 2 === 1 ? step / 2 : 0;
      const colOff =
        stagger && axis === "vertical" && autoLayout.rows > 1 && cell.col % 2 === 1 ? step / 2 : 0;
      return {
        id: `table-${cell.tableNumber}`,
        type: "table" as const,
        tableNumber: String(cell.tableNumber),
        x: cell.col * step + step * 1.4 + rowOff,
        y: cell.row * step + step * 1.4 + colOff,
        radius: tableRadius
      };
    });
}

export function buildEmptyFloorplanDraft(name = "Untitled floorplan"): FloorplanDocument {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: crypto.randomUUID(),
    name,
    savedAt: now,
    metadata: { ...defaultFloorplanMetadata },
    canvas: { ...defaultFloorplanCanvasSettings },
    objects: [],
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

