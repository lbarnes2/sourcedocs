export type CanonicalColumn =
  | "table"
  | "name"
  | "firstName"
  | "lastName"
  | "starter"
  | "main"
  | "dessert"
  | "dietary";

export type ColumnMapping = Partial<Record<CanonicalColumn, string>>;

export type RawCsvRow = Record<string, string>;

export interface GuestRecord {
  id: string;
  tableNumber: string;
  name: string;
  starter: string;
  main: string;
  dessert: string;
  dietaryOriginal: string;
  dietaryNormalized: string[];
}

export interface ValidationIssue {
  code:
    | "missing_required"
    | "duplicate_name"
    | "missing_choice"
    | "missing_table";
  severity: "error" | "warning";
  message: string;
  rowIndex?: number;
}

export interface ValidationReport {
  issues: ValidationIssue[];
}

export interface ThemeSettings {
  primaryColor: string;
  accentColor: string;
  textColor: string;
  eventName: string;
  eventDate?: string;
  eventSubtitle?: string;
  clientName?: string;
  clientLogoDataUrl?: string;
  venueLogoDataUrl?: string;
}

export interface TablePlanSettings {
  paperSize: "A4" | "A3";
  orientation: "portrait" | "landscape";
  tablesPerSheetMode: "auto" | "manual";
  tablesPerSheet: number;
  minFontSizePt: number;
}

export interface PlaceCardSettings {
  stockName: string;
  /** Reference size only; place-card PDF layout uses fixed stock coordinates. */
  cardWidthMm: number;
  /** Reference size only; place-card PDF layout uses fixed stock coordinates. */
  cardHeightMm: number;
  foldOffsetMm: number;
  textOffsetXmm: number;
  textOffsetYmm: number;
  safeMarginMm: number;
  fontScale: number;
}

export interface MenuBookletSettings {
  headingFontPt: number;
  bodyFontPt: number;
  lineHeight: number;
}

export interface ProfileSettings {
  id: string;
  name: string;
  theme: ThemeSettings;
  tablePlan: TablePlanSettings;
  placeCard: PlaceCardSettings;
  menuBooklet: MenuBookletSettings;
}

export type DocumentType =
  | "tablePlanByTable"
  | "tablePlanByPerson"
  | "placeCards"
  | "menuBooklet"
  | "servicePlan";

export interface GenerationRequest {
  documents: DocumentType[];
  bundleMode: "single" | "zip";
  theme: ThemeSettings;
  tablePlan: TablePlanSettings;
  placeCard: PlaceCardSettings;
  menuBooklet: MenuBookletSettings;
  menuLongNames?: Record<string, string>;
}

export interface EventModel {
  guests: GuestRecord[];
  byTable: Record<string, GuestRecord[]>;
  sortedByName: GuestRecord[];
}
