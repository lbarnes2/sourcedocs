import {
  Accessibility,
  Armchair,
  Baby,
  Ban,
  BatteryCharging,
  BellOff,
  Bike,
  Camera,
  CameraOff,
  Car,
  Cigarette,
  CigaretteOff,
  Clock,
  Coffee,
  Construction,
  Cross,
  Dog,
  DoorClosed,
  DoorClosedLocked,
  DoorOpen,
  Droplets,
  Flame,
  Footprints,
  Gift,
  Hand,
  Info,
  Lock,
  Luggage,
  MapPin,
  Music,
  PhoneOff,
  Shirt,
  Smartphone,
  SquareParking,
  Ticket,
  Toilet,
  TriangleAlert,
  Users,
  Utensils,
  Volume2,
  VolumeX,
  Wifi,
  Wine,
  Zap
} from "lucide";
import type { LucideIconNode } from "@/lib/pdf/lucideIconPath";

/**
 * Pictograms drawn for this app where Lucide has no equivalent. Same grammar as Lucide: 24×24 viewBox,
 * 2px round-capped strokes, no fills, so they sit alongside Lucide icons on a sign.
 */
const TOILET_MEN: LucideIconNode = [
  ["circle", { cx: 12, cy: 4, r: 2 }],
  ["path", { d: "M10 22v-6" }],
  ["path", { d: "M14 22v-6" }],
  ["path", { d: "M7 15v-4a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v4" }],
  ["path", { d: "M10 16h4" }]
];

const TOILET_WOMEN: LucideIconNode = [
  ["circle", { cx: 12, cy: 4, r: 2 }],
  ["path", { d: "M10 22v-4" }],
  ["path", { d: "M14 22v-4" }],
  ["path", { d: "M7 18h10l-2.3-7.7A3 3 0 0 0 11.8 8h.4a3 3 0 0 0-2.9 2.3Z" }]
];

/** Bare exclamation mark — for use inside the caution triangle, where Lucide's own triangle would double up. */
const EXCLAMATION: LucideIconNode = [
  ["path", { d: "M12 5v10" }],
  ["path", { d: "M12 19.5h.01" }]
];

const SYMBOL_DEFS = {
  toiletMen: { label: "Gents", node: TOILET_MEN },
  toiletWomen: { label: "Ladies", node: TOILET_WOMEN },
  accessible: { label: "Accessible", node: Accessibility },
  babyChange: { label: "Baby change", node: Baby },
  toilet: { label: "Toilet", node: Toilet },
  wifi: { label: "Wi-Fi", node: Wifi },
  cloakroom: { label: "Cloakroom", node: Shirt },
  luggage: { label: "Luggage", node: Luggage },
  coffee: { label: "Coffee", node: Coffee },
  food: { label: "Food", node: Utensils },
  bar: { label: "Bar", node: Wine },
  seating: { label: "Seating", node: Armchair },
  firstAid: { label: "First aid", node: Cross },
  charging: { label: "Charging", node: BatteryCharging },
  info: { label: "Information", node: Info },
  meetingPoint: { label: "Location", node: MapPin },
  tickets: { label: "Tickets", node: Ticket },
  registration: { label: "Guests", node: Users },
  time: { label: "Time", node: Clock },
  gifts: { label: "Gifts", node: Gift },
  music: { label: "Music", node: Music },
  photo: { label: "Photos", node: Camera },
  parking: { label: "Parking", node: SquareParking },
  car: { label: "Car", node: Car },
  bike: { label: "Bikes", node: Bike },
  doorClosed: { label: "Door closed", node: DoorClosed },
  doorOpen: { label: "Door open", node: DoorOpen },
  doorLocked: { label: "Door locked", node: DoorClosedLocked },
  hand: { label: "Hand / push", node: Hand },
  lock: { label: "Lock", node: Lock },
  exclamation: { label: "Exclamation", node: EXCLAMATION },
  warning: { label: "Warning", node: TriangleAlert },
  tripHazard: { label: "Trip / step", node: Footprints },
  wetFloor: { label: "Wet floor", node: Droplets },
  electrical: { label: "Electrical", node: Zap },
  hot: { label: "Hot", node: Flame },
  works: { label: "Works", node: Construction },
  loud: { label: "Loud", node: Volume2 },
  quiet: { label: "Quiet", node: VolumeX },
  phone: { label: "Phone", node: Smartphone },
  phoneOff: { label: "No phones", node: PhoneOff },
  cameraOff: { label: "No photos", node: CameraOff },
  smoking: { label: "Smoking", node: Cigarette },
  noSmoking: { label: "No smoking", node: CigaretteOff },
  silent: { label: "Silent", node: BellOff },
  dog: { label: "Dog", node: Dog },
  ban: { label: "No entry", node: Ban }
} satisfies Record<string, { label: string; node: LucideIconNode }>;

export type SignSymbolId = keyof typeof SYMBOL_DEFS;

export const SIGN_SYMBOL_IDS = Object.keys(SYMBOL_DEFS) as [SignSymbolId, ...SignSymbolId[]];

export function signSymbolNode(id: SignSymbolId): LucideIconNode {
  return SYMBOL_DEFS[id].node as LucideIconNode;
}

export function signSymbolLabel(id: SignSymbolId): string {
  return SYMBOL_DEFS[id].label;
}

export const SIGN_SYMBOL_SECTIONS: { title: string; symbols: SignSymbolId[] }[] = [
  { title: "Toilets", symbols: ["toiletMen", "toiletWomen", "accessible", "babyChange", "toilet"] },
  {
    title: "Facilities",
    symbols: [
      "wifi",
      "cloakroom",
      "luggage",
      "coffee",
      "food",
      "bar",
      "seating",
      "firstAid",
      "charging",
      "info",
      "meetingPoint",
      "tickets",
      "registration",
      "time",
      "gifts",
      "music",
      "photo",
      "parking",
      "car",
      "bike"
    ]
  },
  { title: "Doors", symbols: ["doorClosed", "doorOpen", "doorLocked", "hand", "lock"] },
  {
    title: "Caution",
    symbols: ["exclamation", "warning", "tripHazard", "wetFloor", "electrical", "hot", "works", "loud"]
  },
  {
    title: "Restrictions",
    symbols: ["quiet", "phone", "phoneOff", "cameraOff", "smoking", "noSmoking", "silent", "dog", "ban"]
  }
];
