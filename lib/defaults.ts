import type {
  MenuBookletSettings,
  PlaceCardSettings,
  ProfileSettings,
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

export function defaultProfile(name = "Default Profile"): ProfileSettings {
  return {
    id: "default",
    name,
    theme: { ...defaultThemeSettings },
    tablePlan: { ...defaultTablePlanSettings },
    placeCard: { ...defaultPlaceCardSettings },
    menuBooklet: { ...defaultMenuBookletSettings }
  };
}
