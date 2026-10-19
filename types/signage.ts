import type { SignSymbolId } from "@/lib/signage/symbols";
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
   * Fixed free text printed on every copy of this sign, whatever the event
   * (e.g. "Please use the left hand entrance"). Shown above the arrow.
   */
  message?: string;
  // Two-event signs are single-sign only (ad-hoc generator); pack slots are always one event.
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
  /** Shown below the event name on signs (Open Sans bold); optional default for pack generation. */
  defaultVenueLabel?: string;
  /** Optional line under the venue (Open Sans regular, same size as venue); pack default. */
  defaultSubVenueLabel?: string;
  /** R2 object key under logos/venue/ — optional default for pack generation. */
  defaultVenueLogoKey?: string;
  /** R2 key if you store client logos; optional. */
  defaultClientLogoKey?: string;
}

/**
 * Colour treatment for general (non-event) signs.
 * `plain` / `info` follow the sign's theme colours; `caution` and `prohibition` use fixed safety colours
 * (yellow-and-black triangle, red ring-and-slash) so they read as warnings whatever the event branding.
 */
export type GeneralSignTone = "plain" | "info" | "caution" | "prohibition";

export type WifiSecurity = "WPA" | "WEP" | "nopass";

export interface GeneralSignWifi {
  network: string;
  password?: string;
  security: WifiSecurity;
  /** Print a QR code that joins the network when scanned with a phone camera. */
  showQr: boolean;
}

/**
 * Saved starting point for a general sign: everything on the sign except branding (colours, logos),
 * which belongs to the event. Stored as one ordered, team-wide list.
 */
export interface GeneralSignTemplate {
  id: string;
  label: string;
  tone: GeneralSignTone;
  symbols: SignSymbolId[];
  heading: string;
  body?: string;
  arrow: SignageArrowDirection;
  footer?: string;
  /** Wi-Fi details; `network` may be blank in a template that is filled in per event. */
  wifi?: GeneralSignWifi;
  paperSize?: PaperSize;
  orientation?: PaperOrientation;
}
