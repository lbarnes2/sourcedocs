import type { SignageArrowDirection } from "@/types";

export type SignageArrowOption = { value: SignageArrowDirection; label: string };

/** Flat list (API order) — none, 8 move arrows, 8 Lucide corner icons, U-turn. */
export const ARROW_OPTIONS: SignageArrowOption[] = [
  { value: "none", label: "No arrow" },
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "upLeft", label: "Up + left" },
  { value: "upRight", label: "Up + right" },
  { value: "downLeft", label: "Down + left" },
  { value: "downRight", label: "Down + right" },
  { value: "cornerUpLeft", label: "Corner up–left" },
  { value: "cornerUpRight", label: "Corner up–right" },
  { value: "cornerRightUp", label: "Corner right–up" },
  { value: "cornerRightDown", label: "Corner right–down" },
  { value: "cornerDownRight", label: "Corner down–right" },
  { value: "cornerDownLeft", label: "Corner down–left" },
  { value: "cornerLeftDown", label: "Corner left–down" },
  { value: "cornerLeftUp", label: "Corner left–up" },
  { value: "turnAround", label: "U turn" }
];

const labelByValue = new Map(ARROW_OPTIONS.map((o) => [o.value, o.label] as const));

export function labelForArrow(value: SignageArrowDirection): string {
  return labelByValue.get(value) ?? value;
}

export const ARROW_PICKER_SECTIONS: { title: string; options: SignageArrowOption[] }[] = [
  {
    title: "None",
    options: [ARROW_OPTIONS[0]!]
  },
  {
    title: "Arrows",
    options: ARROW_OPTIONS.slice(1, 1 + 8)
  },
  {
    title: "Corners (Lucide)",
    options: ARROW_OPTIONS.slice(1 + 8, 1 + 8 + 8)
  },
  {
    title: "Other",
    options: [ARROW_OPTIONS[ARROW_OPTIONS.length - 1]!]
  }
];
