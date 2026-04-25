import type { PaperOrientation, PaperSize } from "./paper";

/** Cardinal + intercardinal, plus none for welcome-style signs. */
export type SignageArrowDirection =
  | "none"
  | "up"
  | "down"
  | "left"
  | "right"
  | "upLeft"
  | "upRight"
  | "downLeft"
  | "downRight"
  /** Lucide `corner-up-left` … `corner-left-up` — thin double-segment turns */
  | "cornerUpLeft"
  | "cornerUpRight"
  | "cornerRightUp"
  | "cornerRightDown"
  | "cornerDownRight"
  | "cornerDownLeft"
  | "cornerLeftDown"
  | "cornerLeftUp"
  /** Lucide `redo-2` rotated −90° — curved “turn back / go around” for wayfinding */
  | "turnAround";

export interface VenueSignageSlot {
  /** Repeat this page N times in pack order. */
  count: number;
  paperSize: PaperSize;
  orientation: PaperOrientation;
  arrow: SignageArrowDirection;
}

/** Theme for PDF output (mirrors banqueting ThemeSettings colour fields). */
export interface SignageThemeColors {
  primaryColor: string;
  accentColor: string;
  textColor: string;
}

export interface VenueSignageProfile {
  id: string;
  name: string;
  slots: VenueSignageSlot[];
  theme: SignageThemeColors;
  /** Shown below the event name on signs (Noto bold); optional default for pack generation. */
  defaultVenueLabel?: string;
  /** Optional line under the venue (Noto regular, same size as venue); pack default. */
  defaultSubVenueLabel?: string;
  /** R2 object key under logos/venue/ — optional default for pack generation. */
  defaultVenueLogoKey?: string;
  /** R2 key if you store client logos; optional. */
  defaultClientLogoKey?: string;
}
