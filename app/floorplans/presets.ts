import {
  DEFAULT_UNITS_PER_METRE,
  ROUND_TABLE_SIZES,
  nextTableNumber,
  recommendedRectSize,
  roundTableRadius,
  type RoundTableSize
} from "@/lib/floorplans/geometry";
import type { FloorplanCanvasObject } from "@/types";

export interface ObjectPreset {
  id: string;
  label: string;
  /** Floor furniture is inserted underneath existing objects so tables stay clickable on top. */
  behind: boolean;
  /** `upm` is canvas units per metre, so furniture is created at its real-world size. */
  build: (centre: { x: number; y: number }, existing: FloorplanCanvasObject[], upm: number) => FloorplanCanvasObject;
}

/** Real-world size in metres. */
/** `recommendedRectSize` is expressed at the default 24 units/m; rescale for the plan's scale. */
function scaledRect(size: { width: number; height: number }, upm: number) {
  const k = upm / DEFAULT_UNITS_PER_METRE;
  return { width: Math.max(6, Math.round(size.width * k)), height: Math.max(6, Math.round(size.height * k)) };
}

function rectPreset(
  id: string,
  label: string,
  widthM: number,
  heightM: number,
  fill: string,
  behind = false
): ObjectPreset {
  return {
    id,
    label,
    behind,
    build: (c, _existing, upm) => {
      const width = Math.max(6, Math.round(widthM * upm));
      const height = Math.max(6, Math.round(heightM * upm));
      return {
        id: crypto.randomUUID(),
        type: "rect",
        x: c.x - width / 2,
        y: c.y - height / 2,
        width,
        height,
        label,
        fill
      };
    }
  };
}

function roundTablePreset(id: string, label: string, size: RoundTableSize): ObjectPreset {
  return {
    id,
    label,
    behind: false,
    build: (c, existing, upm) => ({
      id: crypto.randomUUID(),
      type: "table",
      tableNumber: nextTableNumber(existing),
      x: c.x,
      y: c.y,
      radius: roundTableRadius(size, upm),
      seats: ROUND_TABLE_SIZES[size].seats
    })
  };
}

export const OBJECT_PRESETS: ObjectPreset[] = [
  roundTablePreset("round-6ft", "6 ft round", "6ft"),
  roundTablePreset("round-5ft", "5 ft round", "5ft"),
  {
    id: "rect-table",
    label: "Rectangular table",
    behind: false,
    build: (c, existing, upm) => {
      const size = scaledRect(recommendedRectSize(6, false), upm);
      return {
        id: crypto.randomUUID(),
        type: "table",
        tableNumber: nextTableNumber(existing),
        shape: "rect",
        x: c.x,
        y: c.y,
        radius: size.height / 2,
        width: size.width,
        height: size.height,
        seats: 6
      };
    }
  },
  {
    id: "top-table",
    label: "Top table",
    behind: false,
    build: (c, _existing, upm) => {
      const size = scaledRect(recommendedRectSize(10, true), upm);
      return {
        id: crypto.randomUUID(),
        type: "table",
        tableNumber: "Top",
        label: "Top table",
        shape: "rect",
        x: c.x,
        y: c.y,
        radius: size.height / 2,
        width: size.width,
        height: size.height,
        seats: 10,
        seatsOneSide: true
      };
    }
  },
  rectPreset("stage", "Stage", 6, 3, "#8a96a3", true),
  rectPreset("dance-floor", "Dance floor", 5, 5, "#d6cbe8", true),
  rectPreset("bar", "Bar", 4, 0.8, "#ecdcb4"),
  rectPreset("buffet", "Buffet", 4.8, 0.9, "#c3dfc9"),
  rectPreset("entrance", "Entrance", 2, 0.5, "#efc4c4"),
  rectPreset("av-desk", "AV desk", 1.8, 0.8, "#d9dde2"),
  {
    id: "pillar",
    label: "Pillar",
    behind: false,
    build: (c, _existing, upm) => ({
      id: crypto.randomUUID(),
      type: "circle",
      x: c.x,
      y: c.y,
      radius: Math.max(4, Math.round(0.25 * upm)),
      fill: "#8a96a3"
    })
  },
  {
    id: "room",
    label: "Room outline",
    behind: true,
    build: (c, _existing, upm) => {
      const width = Math.round(18 * upm);
      const height = Math.round(12 * upm);
      return { id: crypto.randomUUID(), type: "rect", x: c.x - width / 2, y: c.y - height / 2, width, height, fill: "none" };
    }
  },
  {
    id: "text",
    label: "Text label",
    behind: false,
    build: (c) => ({ id: crypto.randomUUID(), type: "text", x: c.x - 24, y: c.y - 10, text: "Label", fontSize: 16 })
  }
];
