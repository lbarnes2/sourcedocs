import type { PaperOrientation, PaperSize } from "@/types";

export const PAPER_SIZE_VALUES = ["A4", "A3", "16:9"] as const;

export const PAPER_SIZE_OPTIONS: ReadonlyArray<{ value: PaperSize; label: string }> = [
  { value: "A4", label: "A4" },
  { value: "A3", label: "A3" },
  { value: "16:9", label: "16:9 display" }
];

export function paperSizeFileSuffix(paperSize: PaperSize): string {
  return paperSize === "16:9" ? "16x9" : paperSize;
}

export function pdfPageDimensions(paperSize: PaperSize, orientation: PaperOrientation): [number, number] {
  const sizes: Record<PaperSize, [number, number]> = {
    A4: [mmToPt(210), mmToPt(297)],
    A3: [mmToPt(297), mmToPt(420)],
    "16:9": [540, 960]
  };
  const base = sizes[paperSize];
  if (orientation === "landscape") return [base[1], base[0]];
  return base;
}

function mmToPt(mm: number): number {
  return (mm * 72) / 25.4;
}
