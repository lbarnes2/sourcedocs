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

/** How two events are arranged when `secondaryArrow` is active */
export type SignageDualEventArrangement = "sideBySide" | "stacked";
export interface VenueSignageSlot {
  /** Repeat this page N times in pack order. */
  count: number;
  paperSize: PaperSize;
  orientation: PaperOrientation;
  arrow: SignageArrowDirection;
  /**
   * Optional second event on the same physical sign: split titles + split arrows (+ optional separate venue lines below each).
   * When `secondaryArrow` is set and not `"none"`, PDF uses a dual layout (see `dualEventArrangement`).
   */
  secondaryEventName?: string;
  secondaryArrow?: SignageArrowDirection;
  /**
   * Two-event layout: `sideBySide` (columns, arrows under each title) or `stacked` (portrait: sections + divider +
   * arrows below each title; landscape: arrows beside each block). Defaults to `sideBySide` when omitted.
   */
  dualEventArrangement?: SignageDualEventArrangement;
  /** Lines for event 2 when dual mode is active; fall back to primary venue lines in the PDF when unset. */
  secondaryVenueLabel?: string;
  secondarySubVenueLabel?: string;
  secondaryEventDate?: string;
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
  /** Pack default lines for the second event on dual signs (when the slot does not set its own). */
  defaultSecondaryVenueLabel?: string;
  defaultSecondarySubVenueLabel?: string;
  defaultSecondaryEventDate?: string;
  /** R2 object key under logos/venue/ — optional default for pack generation. */
  defaultVenueLogoKey?: string;
  /** R2 key if you store client logos; optional. */
  defaultClientLogoKey?: string;
}
