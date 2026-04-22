import { Check, Square, SquareCheck } from "lucide";
import { LineCapStyle, type PDFPage, radians, rgb } from "pdf-lib";
import { lucideIconPathDs, type LucideIconNode } from "@/lib/pdf/lucideIconPath";

/** Lucide icons use a 24×24 viewBox; default stroke width is 2. */
const LUCIDE_VIEWBOX = 24;
const LUCIDE_STROKE = 2;

/**
 * pdf-lib `drawSvgPath` applies translate → rotate → scale(s,-s). Rotation is around the origin
 * before translate, so we adjust (x,y) so the Lucide viewBox centre (12,12) lands at (cx, cy).
 */
function svgPathTranslateForCenteredLucideIcon(
  cx: number,
  cy: number,
  scale: number,
  rotationRad: number
): { x: number; y: number } {
  const px = 12 * scale;
  const py = -12 * scale;
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  const rx = cos * px - sin * py;
  const ry = sin * px + cos * py;
  return { x: cx - rx, y: cy - ry };
}

/** Stroke-only Lucide icon, centred on (cx, cy) in PDF coordinates. */
export function drawLucideIconStroke(
  page: PDFPage,
  node: LucideIconNode,
  cx: number,
  cy: number,
  sizePt: number,
  strokeColor: ReturnType<typeof rgb>
): void {
  const segments = lucideIconPathDs(node);
  const scale = sizePt / LUCIDE_VIEWBOX;
  const rot = 0;
  const { x, y } = svgPathTranslateForCenteredLucideIcon(cx, cy, scale, rot);

  const strokeOpts = {
    x,
    y,
    scale,
    rotate: radians(rot),
    borderColor: strokeColor,
    borderWidth: LUCIDE_STROKE,
    borderLineCap: LineCapStyle.Round
  } as const;

  for (const d of segments) {
    page.drawSvgPath(d, strokeOpts);
  }
}

export const lucideCheck = Check as LucideIconNode;
export const lucideSquare = Square as LucideIconNode;
export const lucideSquareCheck = SquareCheck as LucideIconNode;
