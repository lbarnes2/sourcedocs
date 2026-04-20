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
  | "downRight";

export interface VenueSignageSlot {
  /** Repeat this page N times in pack order. */
  count: number;
  paperSize: "A3" | "A4";
  orientation: "portrait" | "landscape";
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
  /** R2 object key under logos/venue/ — optional default for pack generation. */
  defaultVenueLogoKey?: string;
  /** R2 key if you store client logos; optional. */
  defaultClientLogoKey?: string;
}
