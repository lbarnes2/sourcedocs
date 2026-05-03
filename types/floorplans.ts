import type { PaperOrientation, PaperSize } from "./paper";
import type { ThemeSettings } from "./index";

export type FloorplanObjectType = "table" | "rect" | "circle" | "text";

export interface FloorplanBaseObject {
  id: string;
  type: FloorplanObjectType;
  x: number;
  y: number;
}

export interface FloorplanTableObject extends FloorplanBaseObject {
  type: "table";
  tableNumber: string;
  radius: number;
}

export interface FloorplanRectObject extends FloorplanBaseObject {
  type: "rect";
  width: number;
  height: number;
}

export interface FloorplanCircleObject extends FloorplanBaseObject {
  type: "circle";
  radius: number;
}

export interface FloorplanTextObject extends FloorplanBaseObject {
  type: "text";
  text: string;
  fontSize: number;
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
  metadata: FloorplanMetadata;
  canvas: FloorplanCanvasSettings;
  objects: FloorplanCanvasObject[];
  autoLayout: FloorplanAutoLayoutSettings;
  themeSnapshot: ThemeSettings;
  selectedClientLogoKey?: string | null;
  selectedVenueLogoKey?: string | null;
}

export interface FloorplanListItem {
  id: string;
  name: string;
  savedAt: string;
  title: string;
}

