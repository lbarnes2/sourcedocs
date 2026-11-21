import type { PaperOrientation, PaperSize } from "./paper";
import type { ThemeSettings } from "./index";

export type FloorplanObjectType = "table" | "rect" | "circle" | "text" | "seating";

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
  /** An exit (fire exit or main doors); its longer side counts towards total exit width. */
  exit?: boolean;
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

/**
 * A block of theatre-style chairs in straight rows, drawn from these settings rather than stored chair
 * by chair. `x`/`y` is the block centre. Unrotated, the block faces up the page: row 0 is the front row
 * at the top (nearest the stage) and each chair's back is on its lower edge. Lengths are canvas units.
 */
export interface FloorplanSeatingObject extends FloorplanBaseObject {
  type: "seating";
  name?: string;
  rows: number;
  seatsPerRow: number;
  chairWidth: number;
  chairDepth: number;
  /** Centre to centre across a row. */
  seatSpacing: number;
  /** Front of one row to the front of the next. The seatway (clear gap between rows) is rowPitch − chairDepth. */
  rowPitch: number;
  /** Aisles inside the block, as "after this many seats" (e.g. [7] puts an aisle after the 7th seat). */
  aisles?: number[];
  /** Clear width of the aisles inside the block, chair edge to chair edge. */
  aisleWidth?: number;
  rotation?: number;
  /** Seats taken out of the block, as "row:seat" (both from 0). */
  removed?: string[];
  /** Chair positions kept clear as wheelchair spaces, as "row:seat". Not counted as chairs. */
  wheelchair?: string[];
  /** The chair preset the size came from, if any. */
  chairPreset?: string;
}

export type FloorplanCanvasObject =
  | FloorplanTableObject
  | FloorplanRectObject
  | FloorplanCircleObject
  | FloorplanTextObject
  | FloorplanSeatingObject;

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

/** The theatre-seating generator's form, saved with the plan. Lengths in metres. */
export interface FloorplanTheatreSettings {
  totalSeats?: number;
  seatsPerRow?: number;
  aisles?: number;
  aisleWidthM?: number;
  /** Make each section between aisles its own block (easier to move), rather than one block with aisles in it. */
  splitAtAisles?: boolean;
  /** Start a new block (with a cross-aisle) every N rows; 0 or missing for none. */
  crossAisleEvery?: number;
  chairPreset?: string;
  seatwayM?: number;
  frontDistanceM?: number;
  facing?: "up" | "down" | "left" | "right";
  /** Filling an area: the most seats allowed between aisles (aisles are added to keep within it). */
  maxRun?: number;
}

/** The user's own figures to compare the plan's measurements against (metres, seats). Nothing is a rule. */
export interface FloorplanLimits {
  minAisleM?: number | null;
  minSeatwayM?: number | null;
  maxSeatsBetweenAisles?: number | null;
  minFrontDistanceM?: number | null;
  maxCapacity?: number | null;
  minExitWidthM?: number | null;
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
  /* The rest of the generator form, saved so a plan reopens with the settings it was made with. */
  tableCount?: number;
  tableStyle?: "round" | "cabaret" | "long";
  roundSize?: "6ft" | "5ft";
  seatsPerTable?: number;
  topTable?: boolean;
  useGuestNumbers?: boolean;
  /** Which generator the Auto layout form shows. */
  generator?: "tables" | "theatre";
  theatre?: FloorplanTheatreSettings;
}

export interface FloorplanDocument {
  version: 1;
  id: string;
  name: string;
  savedAt: string;
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
  limits?: FloorplanLimits;
}

export interface FloorplanListItem {
  id: string;
  name: string;
  savedAt: string;
  title: string;
}

