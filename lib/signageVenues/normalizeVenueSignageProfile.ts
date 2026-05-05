import { defaultSignageTheme } from "@/lib/defaults";
import { PAPER_SIZE_VALUES } from "@/lib/paperSizes";
import type {
  SignageArrowDirection,
  SignageDualEventArrangement,
  VenueSignageProfile,
  VenueSignageSlot
} from "@/types";

const ARROWS: SignageArrowDirection[] = [
  "none",
  "up",
  "down",
  "left",
  "right",
  "upLeft",
  "upRight",
  "downLeft",
  "downRight",
  "cornerUpLeft",
  "cornerUpRight",
  "cornerRightUp",
  "cornerRightDown",
  "cornerDownRight",
  "cornerDownLeft",
  "cornerLeftDown",
  "cornerLeftUp",
  "turnAround"
];

function normalizeArrow(value: unknown): SignageArrowDirection {
  if (typeof value === "string" && (ARROWS as string[]).includes(value)) {
    return value as SignageArrowDirection;
  }
  return "none";
}

function normalizeDualArrangement(value: unknown): SignageDualEventArrangement | undefined {
  if (value === "stacked" || value === "sideBySide") {
    return value;
  }
  return undefined;
}

function normalizeSlot(raw: unknown): VenueSignageSlot {
  if (!raw || typeof raw !== "object") {
    return { count: 1, paperSize: "A4", orientation: "portrait", arrow: "none" };
  }
  const o = raw as Record<string, unknown>;
  const count = Math.max(1, Math.min(500, Math.floor(Number(o.count) || 1)));
  const paperSize =
    typeof o.paperSize === "string" && (PAPER_SIZE_VALUES as readonly string[]).includes(o.paperSize)
      ? (o.paperSize as VenueSignageSlot["paperSize"])
      : "A4";
  const orientation = o.orientation === "landscape" ? "landscape" : "portrait";
  const secName =
    typeof o.secondaryEventName === "string" && o.secondaryEventName.trim()
      ? o.secondaryEventName.trim()
      : undefined;
  const secArrowRaw = o.secondaryArrow;
  const secondaryArrow =
    typeof secArrowRaw === "string" && (ARROWS as string[]).includes(secArrowRaw) && secArrowRaw !== "none"
      ? (secArrowRaw as SignageArrowDirection)
      : undefined;
  const dualEventArrangement = normalizeDualArrangement(o.dualEventArrangement);
  const secVenue =
    typeof o.secondaryVenueLabel === "string" && o.secondaryVenueLabel.trim()
      ? o.secondaryVenueLabel.trim()
      : undefined;
  const secSubVenue =
    typeof o.secondarySubVenueLabel === "string" && o.secondarySubVenueLabel.trim()
      ? o.secondarySubVenueLabel.trim()
      : undefined;
  const secDate =
    typeof o.secondaryEventDate === "string" && o.secondaryEventDate.trim()
      ? o.secondaryEventDate.trim()
      : undefined;
  return {
    count,
    paperSize,
    orientation,
    arrow: normalizeArrow(o.arrow),
    ...(secName ? { secondaryEventName: secName } : {}),
    ...(secondaryArrow ? { secondaryArrow } : {}),
    ...(dualEventArrangement ? { dualEventArrangement } : {}),
    ...(secVenue ? { secondaryVenueLabel: secVenue } : {}),
    ...(secSubVenue ? { secondarySubVenueLabel: secSubVenue } : {}),
    ...(secDate ? { secondaryEventDate: secDate } : {})
  };
}

export function normalizeVenueSignageProfile(raw: unknown): VenueSignageProfile {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid venue signage profile.");
  }
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  const name = typeof o.name === "string" ? o.name.trim() : "";
  const slotsRaw = Array.isArray(o.slots) ? o.slots : [];
  const slots = slotsRaw.map(normalizeSlot);
  const themeRaw = o.theme && typeof o.theme === "object" ? (o.theme as Record<string, unknown>) : {};
  const theme = {
    primaryColor: typeof themeRaw.primaryColor === "string" ? themeRaw.primaryColor : defaultSignageTheme.primaryColor,
    accentColor: typeof themeRaw.accentColor === "string" ? themeRaw.accentColor : defaultSignageTheme.accentColor,
    textColor: typeof themeRaw.textColor === "string" ? themeRaw.textColor : defaultSignageTheme.textColor
  };
  const defaultVenueLabel =
    typeof o.defaultVenueLabel === "string" && o.defaultVenueLabel.trim()
      ? o.defaultVenueLabel.trim()
      : undefined;
  const defaultSubVenueLabel =
    typeof o.defaultSubVenueLabel === "string" && o.defaultSubVenueLabel.trim()
      ? o.defaultSubVenueLabel.trim()
      : undefined;
  const defaultVenueLogoKey =
    typeof o.defaultVenueLogoKey === "string" && o.defaultVenueLogoKey.trim()
      ? o.defaultVenueLogoKey.trim()
      : undefined;
  const defaultClientLogoKey =
    typeof o.defaultClientLogoKey === "string" && o.defaultClientLogoKey.trim()
      ? o.defaultClientLogoKey.trim()
      : undefined;
  const defaultSecondaryVenueLabel =
    typeof o.defaultSecondaryVenueLabel === "string" && o.defaultSecondaryVenueLabel.trim()
      ? o.defaultSecondaryVenueLabel.trim()
      : undefined;
  const defaultSecondarySubVenueLabel =
    typeof o.defaultSecondarySubVenueLabel === "string" && o.defaultSecondarySubVenueLabel.trim()
      ? o.defaultSecondarySubVenueLabel.trim()
      : undefined;
  const defaultSecondaryEventDate =
    typeof o.defaultSecondaryEventDate === "string" && o.defaultSecondaryEventDate.trim()
      ? o.defaultSecondaryEventDate.trim()
      : undefined;

  return {
    id,
    name,
    slots,
    theme,
    defaultVenueLabel,
    defaultSubVenueLabel,
    defaultSecondaryVenueLabel,
    defaultSecondarySubVenueLabel,
    defaultSecondaryEventDate,
    defaultVenueLogoKey,
    defaultClientLogoKey
  };
}
