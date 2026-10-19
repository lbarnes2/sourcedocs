import type { SavedBy } from "./auth";
import type { PaperOrientation, PaperSize } from "./paper";
import type { ThemeSettings } from "./index";

export type FloorplanObjectType = "table" | "rect" | "circle" | "text";

export interface FloorplanBaseObject {
  id: string;
  type: FloorplanObjectType;
  x: number;
  y: number;
}

export type FloorplanTableShape = "round" | "rect";

/**
 * A table. `x`/`y` is the table centre. Every field after `radius` is optional so plans saved
 * before they existed still load: a missing `shape` is round, missing `seats` is 8.
 */
export interface FloorplanTableObject extends FloorplanBaseObject {
  type: "table";
  tableNumber: string;
  /** Round tables: the radius. Rectangular tables: kept at half the shorter side. */
  radius: number;
  shape?: FloorplanTableShape;
  seats?: number;
  /** Rectangular tables only. */
  width?: number;
  height?: number;
  /** Degrees, clockwise, about the table centre. */
  rotation?: number;
  /** Round tables only: degrees of the ring that carry chairs (360 = all the way round, cabaret < 360). */
  seatSpan?: number;
  /** Rectangular tables only: chairs on the front (lower) side only, e.g. a top table. */
  seatsOneSide?: boolean;
  /** Printed instead of "Table N", e.g. "Top table". */
  label?: string;
  /** Hex colour overriding the default table fill. */
  fill?: string;
}

/** `x`/`y` is the top-left corner of the unrotated rectangle. */
export interface FloorplanRectObject extends FloorplanBaseObject {
  type: "rect";
  width: number;
  height: number;
  rotation?: number;
  label?: string;
  /** Hex colour, or "none" for an outline only. */
  fill?: string;
}

export interface FloorplanCircleObject extends FloorplanBaseObject {
  type: "circle";
  radius: number;
  label?: string;
  fill?: string;
}

/** `x`/`y` is the top-left corner of the unrotated text box. */
export interface FloorplanTextObject extends FloorplanBaseObject {
  type: "text";
  text: string;
  fontSize: number;
  rotation?: number;
  bold?: boolean;
  color?: string;
}

export type FloorplanCanvasObject =
  | FloorplanTableObject
  | FloorplanRectObject
  | FloorplanCircleObject
  | FloorplanTextObject;

export interface FloorplanMetadata {
  title: string;
  subtitle: string;
}

export interface FloorplanCanvasSettings {
  paperSize: PaperSize;
  orientation: PaperOrientation;
  gridSize: number;
  /** Canvas units per metre; enables the scale bar and metre readouts. */
  unitsPerMetre?: number | null;
}

export interface FloorplanPrintOptions {
  /** Footer with table / seat / guest totals (plus keys for the options below). */
  legend: boolean;
  /** "8/10" guest count under each table label. Needs a linked guest list. */
  guestCounts: boolean;
  /** Tint tables by how full they are. Needs a linked guest list. */
  colorByOccupancy: boolean;
  /** Extra page(s) listing every table's guests. Needs a linked guest list. */
  guestListPage: boolean;
  /** Needs `canvas.unitsPerMetre`. */
  scaleBar: boolean;
  /** Print at a true 1:N scale (needs `canvas.unitsPerMetre`); null fits the plan to the page. */
  fixedScale?: number | null;
}

export interface FloorplanAutoLayoutSettings {
  paperSize: PaperSize;
  orientation: PaperOrientation;
  rows: number;
  columns: number;
  tableLayout: "aligned" | "staggered";
  /**
   * When `tableLayout` is `staggered` (brick): offset odd rows horizontally, or odd columns vertically.
   * Defaults to horizontal when omitted (matches classic brick / banqueting floorplan).
   */
  staggerAxis?: "horizontal" | "vertical";
  numbering: "straight" | "snaked";
  startCorner: "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
}

export interface FloorplanDocument {
  version: 1;
  id: string;
  name: string;
  savedAt: string;
  /** Absent on floorplans saved before accounts existed. */
  savedBy?: SavedBy;
  metadata: FloorplanMetadata;
  canvas: FloorplanCanvasSettings;
  objects: FloorplanCanvasObject[];
  autoLayout: FloorplanAutoLayoutSettings;
  themeSnapshot: ThemeSettings;
  selectedClientLogoKey?: string | null;
  selectedVenueLogoKey?: string | null;
  /** Saved event project whose guest list drives guest counts and checks. */
  projectId?: string | null;
  print?: FloorplanPrintOptions;
}

export interface FloorplanListItem {
  id: string;
  name: string;
  savedAt: string;
  savedBy?: SavedBy;
  title: string;
}

