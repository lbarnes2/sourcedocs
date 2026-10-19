import type { GeneralSignTemplate } from "@/types";

/**
 * The template list a fresh install starts with (and what "Restore built-in templates" brings back).
 * Prohibition templates use the positive pictogram (camera, cigarette) because the red slash already says "no".
 */
export const DEFAULT_GENERAL_SIGN_TEMPLATES: GeneralSignTemplate[] = [
  {
    id: "wifi",
    label: "Wi-Fi",
    tone: "info",
    symbols: ["wifi"],
    heading: "Wi-Fi",
    arrow: "none",
    wifi: { network: "", security: "WPA", showQr: true }
  },
  { id: "toilets", label: "Toilets", tone: "plain", symbols: ["toiletMen", "toiletWomen", "accessible"], heading: "Toilets", arrow: "none" },
  { id: "ladies", label: "Ladies", tone: "plain", symbols: ["toiletWomen"], heading: "Ladies", arrow: "none" },
  { id: "gents", label: "Gents", tone: "plain", symbols: ["toiletMen"], heading: "Gents", arrow: "none" },
  { id: "accessible", label: "Accessible toilet", tone: "plain", symbols: ["accessible"], heading: "Accessible toilet", arrow: "none" },
  { id: "babyChange", label: "Baby changing", tone: "plain", symbols: ["babyChange"], heading: "Baby changing", arrow: "none" },
  { id: "cloakroom", label: "Cloakroom", tone: "plain", symbols: ["cloakroom"], heading: "Cloakroom", arrow: "none" },
  { id: "firstAid", label: "First aid", tone: "info", symbols: ["firstAid"], heading: "First aid", arrow: "none" },
  {
    id: "photography",
    label: "Photography notice",
    tone: "info",
    symbols: ["photo"],
    heading: "Photographs will be taken at this event",
    body:
      "Photographs and video taken today may be used in our publications and online. If you would prefer not to be photographed, please speak to a member of staff.",
    arrow: "none"
  },
  {
    id: "tripHazard",
    label: "Trip hazard",
    tone: "caution",
    symbols: ["tripHazard"],
    heading: "Trip hazard",
    body: "Please mind the step",
    arrow: "none"
  },
  { id: "mindStep", label: "Mind the step", tone: "caution", symbols: ["exclamation"], heading: "Mind the step", arrow: "none" },
  { id: "wetFloor", label: "Wet floor", tone: "caution", symbols: ["wetFloor"], heading: "Caution", body: "Wet floor", arrow: "none" },
  {
    id: "doNotUseDoor",
    label: "Do not use this door",
    tone: "prohibition",
    symbols: ["doorClosed"],
    heading: "Do not use this door",
    arrow: "none"
  },
  { id: "staffOnly", label: "Staff only", tone: "prohibition", symbols: ["hand"], heading: "No entry", body: "Staff only", arrow: "none" },
  { id: "noSmoking", label: "No smoking", tone: "prohibition", symbols: ["smoking"], heading: "No smoking", arrow: "none" },
  { id: "noPhotos", label: "No photography", tone: "prohibition", symbols: ["photo"], heading: "No photography", arrow: "none" },
  {
    id: "phonesOff",
    label: "Phones off",
    tone: "prohibition",
    symbols: ["phone"],
    heading: "Please switch off your phone",
    arrow: "none"
  },
  {
    id: "closeDoor",
    label: "Close the door",
    tone: "info",
    symbols: ["doorClosed"],
    heading: "Please close the door",
    body: "Thank you",
    arrow: "none"
  },
  {
    id: "doorSlam",
    label: "Door slam",
    tone: "info",
    symbols: ["doorClosed"],
    heading: "Please don't let the door slam",
    body: "Event in progress",
    arrow: "none"
  },
  { id: "quiet", label: "Quiet please", tone: "info", symbols: ["quiet"], heading: "Quiet please", body: "Event in progress", arrow: "none" }
];
