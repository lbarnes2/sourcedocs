import type {
  FloorplanCanvasSettings,
  FloorplanMetadata,
  FloorplanSettings,
  MenuBookletSettings,
  PlaceCardSettings,
  ProfileSettings,
  SignageThemeColors,
  TablePlanSettings,
  ThemeSettings
} from "@/types";

export const defaultThemeSettings: ThemeSettings = {
  primaryColor: "#012f43",
  accentColor: "#acc1cb",
  textColor: "#0d1f28",
  eventName: "",
  eventDate: "",
  eventSubtitle: "",
  clientName: ""
};

/** Default colours for event signage PDFs (distinct from banqueting but same structure). */
export const defaultSignageTheme: SignageThemeColors = {
  primaryColor: "#0d5c5f",
  accentColor: "#9dd3d5",
  textColor: "#0a2425"
};

export const defaultTablePlanSettings: TablePlanSettings = {
  paperSize: "A4",
  orientation: "portrait",
  tablesPerSheetMode: "auto",
  tablesPerSheet: 6,
  minFontSizePt: 10
};

export const defaultPlaceCardSettings: PlaceCardSettings = {
  stockName: "Word export PDF (595.44×846.24 pt): 6 guests/sheet, rows 2·4·6 info / 1·3·5 logo backs",
  cardWidthMm: 85.37,
  cardHeightMm: 46.21,
  foldOffsetMm: 0,
  textOffsetXmm: 0,
  textOffsetYmm: 0,
  safeMarginMm: 4,
  fontScale: 1
};

export const defaultMenuBookletSettings: MenuBookletSettings = {
  headingFontPt: 15,
  bodyFontPt: 10,
  lineHeight: 14,
  preMealText: "",
  postMealText: ""
};

export const defaultFloorplanSettings: FloorplanSettings = {
  paperSize: "A4",
  orientation: "landscape",
  rows: 3,
  columns: 4,
  tableLayout: "aligned",
  numbering: "snaked",
  startCorner: "topLeft"
};

export const defaultFloorplanCanvasSettings: FloorplanCanvasSettings = {
  paperSize: "A4",
  orientation: "landscape",
  gridSize: 24
};

export const defaultFloorplanMetadata: FloorplanMetadata = {
  title: "",
  subtitle: ""
};

export function defaultProfile(name = "Default Profile"): ProfileSettings {
  return {
    id: "default",
    name,
    theme: { ...defaultThemeSettings },
    tablePlan: { ...defaultTablePlanSettings },
    tablePlanByPerson: { ...defaultTablePlanSettings },
    placeCard: { ...defaultPlaceCardSettings },
    menuBooklet: { ...defaultMenuBookletSettings },
    floorplan: { ...defaultFloorplanSettings }
  };
}
