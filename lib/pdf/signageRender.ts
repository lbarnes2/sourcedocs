import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  CornerDownLeft,
  CornerDownRight,
  CornerLeftDown,
  CornerLeftUp,
  CornerRightDown,
  CornerRightUp,
  CornerUpLeft,
  CornerUpRight,
  MoveDown,
  MoveDownLeft,
  MoveDownRight,
  MoveLeft,
  MoveRight,
  MoveUp,
  MoveUpLeft,
  MoveUpRight,
  Redo2
} from "lucide";
import {
  LineCapStyle,
  PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  radians,
  rgb
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { normalizeForCormorantLigatureSafe } from "@/lib/buffetMenu/cormorantNormalize";
import { pdfPageDimensions } from "@/lib/paperSizes";
import { hexToRgb } from "@/lib/pdf/color";
import { lucideIconPathDs, type LucideIconNode } from "@/lib/pdf/lucideIconPath";
import type {
  PaperOrientation,
  PaperSize,
  SignageArrowDirection,
  SignageDualEventArrangement,
  SignageThemeColors
} from "@/types";

export interface SignagePageInput {
  paperSize: PaperSize;
  orientation: PaperOrientation;
  arrow: SignageArrowDirection;
  eventName: string;
  /** Second event title when `secondaryArrow` is active (split sign). */
  secondaryEventName?: string;
  /**
   * Second arrow column. When set and not `"none"`, PDF uses a dual layout; each event can have its own venue lines
   * (`venueLine` / `subVenueLine` / `dateLine` vs `secondaryVenueLine` / …), with omission falling back to the primary lines.
   */
  secondaryArrow?: SignageArrowDirection;
  /**
   * When dual-event mode is active: `sideBySide` (columns, arrows under each title) or `stacked`
   * (portrait: divider between sections, arrows below each title; landscape: arrow beside each block).
   */
  dualEventArrangement?: SignageDualEventArrangement;
  /** Shown below the event name (Noto Sans Bold); optional. */
  venueLine?: string;
  /** Optional line under the venue (Noto Sans Regular, same size as venue). */
  subVenueLine?: string;
  /** Shown below venue / sub-venue (Noto Sans Regular); optional. */
  dateLine?: string;
  /** Event 2 venue lines (dual signs); API usually fills from slot/pack/ad-hoc with fallback to event 1 lines. */
  secondaryVenueLine?: string;
  secondarySubVenueLine?: string;
  secondaryDateLine?: string;
  theme: SignageThemeColors;
}

function mmToPt(mm: number): number {
  return (mm * 72) / 25.4;
}

const INNER_BORDER_INSET = mmToPt(2.5);

/** Greedy word wrap to maxWidth; long words split by character. */
function breakSignageTitleIntoLines(
  text: string,
  measure: (t: string) => number,
  maxWidth: number
): string[] {
  const raw = text.replace(/\t|\u0085|\u2028|\u2029/g, "    ").trim();
  if (!raw) return [""];
  const words = raw.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (measure(trial) <= maxWidth) {
      line = trial;
      continue;
    }
    if (line) lines.push(line);
    if (measure(word) <= maxWidth) {
      line = word;
    } else {
      let wchunk = "";
      for (const ch of word) {
        const t = wchunk + ch;
        if (measure(t) <= maxWidth) {
          wchunk = t;
        } else {
          if (wchunk) lines.push(wchunk);
          wchunk = ch;
        }
      }
      line = wchunk;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

const LIB_FONTS = path.join(process.cwd(), "lib", "fonts");
const PDF_FONT_SOURCES = {
  title: path.join(LIB_FONTS, "CormorantGaramond-wght.ttf"),
  body: path.join(LIB_FONTS, "NotoSans-Regular.ttf"),
  bodyBold: path.join(LIB_FONTS, "NotoSans-Bold.ttf")
} as const;

type PdfFontBytesCache = {
  title: Uint8Array;
  body: Uint8Array;
  bodyBold: Uint8Array;
};

let cachedPdfFontBytes: PdfFontBytesCache | null = null;

async function loadSignageFontBytes(): Promise<PdfFontBytesCache> {
  if (cachedPdfFontBytes) return cachedPdfFontBytes;
  const [title, body, bodyBold] = await Promise.all([
    readFile(PDF_FONT_SOURCES.title),
    readFile(PDF_FONT_SOURCES.body),
    readFile(PDF_FONT_SOURCES.bodyBold)
  ]);
  cachedPdfFontBytes = { title, body, bodyBold };
  return cachedPdfFontBytes;
}

type SignagePdfFonts = {
  doc: PDFDocument;
  title: PDFFont;
  body: PDFFont;
  bodyBold: PDFFont;
};

async function createDocWithFonts(): Promise<SignagePdfFonts> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const bytes = await loadSignageFontBytes();
  const [title, body, bodyBold] = await Promise.all([
    doc.embedFont(bytes.title, { subset: false }),
    doc.embedFont(bytes.body, { subset: false }),
    doc.embedFont(bytes.bodyBold, { subset: false })
  ]);
  return { doc, title, body, bodyBold };
}

export function signagePageDimensions(paperSize: PaperSize, orientation: PaperOrientation): [number, number] {
  return pdfPageDimensions(paperSize, orientation);
}

function drawSignageBorder(
  page: PDFPage,
  options: {
    x: number;
    y: number;
    width: number;
    height: number;
    primary: ReturnType<typeof rgb>;
    accent: ReturnType<typeof rgb>;
  }
): void {
  const { x, y, width, height, primary, accent } = options;
  page.drawRectangle({
    x,
    y,
    width,
    height,
    borderColor: primary,
    borderWidth: 1.8
  });
  page.drawRectangle({
    x: x + INNER_BORDER_INSET,
    y: y + INNER_BORDER_INSET,
    width: width - 2 * INNER_BORDER_INSET,
    height: height - 2 * INNER_BORDER_INSET,
    borderColor: accent,
    borderWidth: 1.2
  });
}

/** Lucide icons use a 24×24 viewBox; default stroke width is 2. */
const LUCIDE_VIEWBOX = 24;
const LUCIDE_STROKE = 2;

function lucideForSignageArrow(
  direction: SignageArrowDirection
): { node: LucideIconNode; extraRotationRad: number } | null {
  switch (direction) {
    case "none":
      return null;
    case "up":
      return { node: MoveUp as LucideIconNode, extraRotationRad: 0 };
    case "down":
      return { node: MoveDown as LucideIconNode, extraRotationRad: 0 };
    case "left":
      return { node: MoveLeft as LucideIconNode, extraRotationRad: 0 };
    case "right":
      return { node: MoveRight as LucideIconNode, extraRotationRad: 0 };
    case "upLeft":
      return { node: MoveUpLeft as LucideIconNode, extraRotationRad: 0 };
    case "upRight":
      return { node: MoveUpRight as LucideIconNode, extraRotationRad: 0 };
    case "downLeft":
      return { node: MoveDownLeft as LucideIconNode, extraRotationRad: 0 };
    case "downRight":
      return { node: MoveDownRight as LucideIconNode, extraRotationRad: 0 };
    case "cornerUpLeft":
      return { node: CornerUpLeft as LucideIconNode, extraRotationRad: 0 };
    case "cornerUpRight":
      return { node: CornerUpRight as LucideIconNode, extraRotationRad: 0 };
    case "cornerRightUp":
      return { node: CornerRightUp as LucideIconNode, extraRotationRad: 0 };
    case "cornerRightDown":
      return { node: CornerRightDown as LucideIconNode, extraRotationRad: 0 };
    case "cornerDownRight":
      return { node: CornerDownRight as LucideIconNode, extraRotationRad: 0 };
    case "cornerDownLeft":
      return { node: CornerDownLeft as LucideIconNode, extraRotationRad: 0 };
    case "cornerLeftDown":
      return { node: CornerLeftDown as LucideIconNode, extraRotationRad: 0 };
    case "cornerLeftUp":
      return { node: CornerLeftUp as LucideIconNode, extraRotationRad: 0 };
    case "turnAround":
      return { node: Redo2 as LucideIconNode, extraRotationRad: -Math.PI / 2 };
    default:
      return null;
  }
}

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
function drawSignageLucideArrow(
  page: PDFPage,
  cx: number,
  cy: number,
  sizePt: number,
  direction: SignageArrowDirection,
  strokeColor: ReturnType<typeof rgb>
): void {
  const spec = lucideForSignageArrow(direction);
  if (!spec) return;

  const segments = lucideIconPathDs(spec.node);
  const scale = sizePt / LUCIDE_VIEWBOX;
  const rot = spec.extraRotationRad;
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

type LogoPlaceResult = {
  dw: number;
  dh: number;
  x: number;
  /** PDF y of image bottom edge (lower y = further down page). */
  bottomY: number;
};

function computeLogoPlacement(
  pageWidth: number,
  pageHeight: number,
  margin: number,
  logoPad: number,
  logoBox: number,
  img: PDFImage | null,
  corner: "tl" | "tr"
): LogoPlaceResult | null {
  if (!img) return null;
  const iw = img.width;
  const ih = img.height;
  const scale = Math.min(logoBox / iw, logoBox / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const bottomY = pageHeight - margin - logoPad - dh;
  const x =
    corner === "tl"
      ? margin + logoPad
      : pageWidth - margin - logoPad - dw;
  return { dw, dh, bottomY, x };
}

async function embedRasterImage(
  doc: PDFDocument,
  bytes: Uint8Array,
  contentType?: string
): Promise<PDFImage | null> {
  const ct = (contentType || "").toLowerCase();
  try {
    if (ct.includes("png") || bytes[0] === 0x89) {
      return await doc.embedPng(bytes);
    }
    if (ct.includes("jpeg") || ct.includes("jpg") || (bytes[0] === 0xff && bytes[1] === 0xd8)) {
      return await doc.embedJpg(bytes);
    }
    if (bytes[0] === 0x89) {
      return await doc.embedPng(bytes);
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      return await doc.embedJpg(bytes);
    }
  } catch {
    return null;
  }
  return null;
}

/** Approximate cap-height / descender for Cormorant embedded at size s (PDF baseline metrics). */
function titleMetricsAtSize(s: number): { capH: number; desc: number; lineHeight: number } {
  return {
    capH: s * 0.72,
    desc: s * 0.24,
    /** Baseline-to-baseline step = 100% of font size (tight multi-line titles). */
    lineHeight: s * 1.05
  };
}

/** Noto Sans metrics for venue (bold) and date (regular) lines. */
function bodyMetricsAtSize(s: number): { capH: number; desc: number; lineHeight: number } {
  return {
    capH: s * 0.72,
    desc: s * 0.23,
    lineHeight: s * 1.05
  };
}

/** Geometry for drawing dual-event content; `null` when `dualColumn` is false. */
type DualDrawPlan =
  | {
      kind: "sideBySide";
      firstLineY: number;
      lineHeight: number;
      arrowCyLeft: number | null;
      arrowCyRight: number | null;
    }
  | {
      kind: "stackedPortrait";
      lineHeight: number;
      event1FirstLineY: number;
      event2FirstLineY: number;
      centerX: number;
      arrowCy1: number | null;
      arrowCy2: number | null;
      dividerLineY: number;
      dividerX1: number;
      dividerX2: number;
      dividerThickness: number;
    }
  | {
      kind: "stackedLandscape";
      lineHeight: number;
      event1FirstLineY: number;
      event2FirstLineY: number;
      textX: number;
      arrow1Cx: number;
      arrow1Cy: number;
      arrow2Cx: number;
      arrow2Cy: number;
      dividerLineY: number;
      dividerX1: number;
      dividerX2: number;
      dividerThickness: number;
    };

type SignageLayout = {
  titleSize: number;
  titleLines: string[];
  /** When true, use `leftTitleLines` / `rightTitleLines` and `dualDraw` for dual-event signs. */
  dualColumn: boolean;
  leftTitleLines: string[];
  rightTitleLines: string[];
  cxLeft: number;
  cxRight: number;
  firstLineY: number;
  lineHeight: number;
  venueLines: string[];
  venueSize: number;
  venueLineHeight: number;
  venueFirstBaselineY: number;
  subVenueLines: string[];
  subVenueFirstBaselineY: number;
  dateLines: string[];
  dateSize: number;
  dateLineHeight: number;
  dateFirstBaselineY: number;
  /** Event 2 meta (dual signs only). Uses the same `venueSize` / `dateSize` / line heights as event 1. */
  rightVenueLines: string[];
  rightSubVenueLines: string[];
  rightDateLines: string[];
  rightVenueFirstBaselineY: number;
  rightSubVenueFirstBaselineY: number;
  rightDateFirstBaselineY: number;
  /** Single-column arrow centre y; always `null` when `dualColumn`. */
  cy: number | null;
  arrowSize: number;
  /** Left column arrow (single mode: only arrow drawn when not `"none"`). */
  arrow: SignageArrowDirection;
  /** Right column (dual mode only; `"none"` in single mode). */
  rightArrow: SignageArrowDirection;
  dualDraw: DualDrawPlan | null;
};

function computeMetaBaselinesFromContentFloor(
  floorY: number,
  vn: number,
  sn: number,
  dn: number,
  gapAfterTitle: number,
  gapVenueSub: number,
  gapVenueDate: number,
  vCap: number,
  vLh: number,
  vDesc: number,
  dCap: number,
  dLh: number,
  dDesc: number
): {
  venueFirstBaselineY: number;
  subVenueFirstBaselineY: number;
  dateFirstBaselineY: number;
  metaLowestY: number;
} {
  let bottomAfterTitle = floorY;
  let venueFirstBaselineY = 0;
  let subVenueFirstBaselineY = 0;
  let dateFirstBaselineY = 0;

  if (vn > 0) {
    venueFirstBaselineY = bottomAfterTitle - gapAfterTitle - vCap;
    const lastVenueBaseline = venueFirstBaselineY - (vn - 1) * vLh;
    bottomAfterTitle = lastVenueBaseline - vDesc;
  }

  if (sn > 0) {
    const g = vn > 0 ? gapVenueSub : gapAfterTitle;
    subVenueFirstBaselineY = bottomAfterTitle - g - vCap;
    const lastSubBaseline = subVenueFirstBaselineY - (sn - 1) * vLh;
    bottomAfterTitle = lastSubBaseline - vDesc;
  }

  if (dn > 0) {
    const g = vn > 0 || sn > 0 ? gapVenueDate : gapAfterTitle;
    dateFirstBaselineY = bottomAfterTitle - g - dCap;
    bottomAfterTitle = dateFirstBaselineY - (dn - 1) * dLh - dDesc;
  }

  return { venueFirstBaselineY, subVenueFirstBaselineY, dateFirstBaselineY, metaLowestY: bottomAfterTitle };
}

/** Centre venue / sub-venue / date under `cx` (each line’s bounding box centred). */
function drawSignageMetaCentered(
  page: PDFPage,
  cx: number,
  layout: {
    venueLines: string[];
    subVenueLines: string[];
    dateLines: string[];
    venueSize: number;
    dateSize: number;
    venueLineHeight: number;
    dateLineHeight: number;
    venueFirstBaselineY: number;
    subVenueFirstBaselineY: number;
    dateFirstBaselineY: number;
  },
  fonts: { body: PDFFont; bodyBold: PDFFont },
  textColor: ReturnType<typeof rgb>
): void {
  const { body, bodyBold } = fonts;
  if (layout.venueLines.length > 0) {
    for (let i = 0; i < layout.venueLines.length; i++) {
      const line = layout.venueLines[i]!;
      const lw = bodyBold.widthOfTextAtSize(line, layout.venueSize);
      page.drawText(line, {
        x: cx - lw / 2,
        y: layout.venueFirstBaselineY - i * layout.venueLineHeight,
        font: bodyBold,
        size: layout.venueSize,
        color: textColor
      });
    }
  }
  if (layout.subVenueLines.length > 0) {
    for (let i = 0; i < layout.subVenueLines.length; i++) {
      const line = layout.subVenueLines[i]!;
      const lw = body.widthOfTextAtSize(line, layout.venueSize);
      page.drawText(line, {
        x: cx - lw / 2,
        y: layout.subVenueFirstBaselineY - i * layout.venueLineHeight,
        font: body,
        size: layout.venueSize,
        color: textColor
      });
    }
  }
  if (layout.dateLines.length > 0) {
    for (let i = 0; i < layout.dateLines.length; i++) {
      const line = layout.dateLines[i]!;
      const lw = body.widthOfTextAtSize(line, layout.dateSize);
      page.drawText(line, {
        x: cx - lw / 2,
        y: layout.dateFirstBaselineY - i * layout.dateLineHeight,
        font: body,
        size: layout.dateSize,
        color: textColor
      });
    }
  }
}

function layoutSignageContent(
  pageWidth: number,
  pageHeight: number,
  margin: number,
  borderH: number,
  borderW: number,
  eventName: string,
  venueLine: string,
  subVenueLine: string,
  dateLine: string,
  titleFont: PDFFont,
  bodyFont: PDFFont,
  bodyBoldFont: PDFFont,
  paperSize: PaperSize,
  arrow: SignageArrowDirection,
  /** Min PDF y across placed logo bottoms; when no logos, top inner band reference. */
  logoRowBottomY: number
): SignageLayout {
  const titleMaxW = borderW - mmToPt(24);
  /** Large signage type; layout shrinks down to minTitleSize when space is tight. */
  const titleSizeCap = 110;
  const preferredTitleSize = Math.min(
    titleSizeCap,
    Math.max(22, pageHeight * (paperSize === "A3" ? 0.093 : 0.132))
  );
  /** A3 only: nudge the title block down from the logo band — extra vertical room on large sheets. */
  const titleDropFromCeiling = paperSize === "A3" ? mmToPt(12) : 0;
  const gapBelowLogo = mmToPt(10);
  const gapTitleArrow = mmToPt(14);
  const arrowEdgePad = mmToPt(6);
  const textBottomPad = mmToPt(8);
  const gapAfterTitle = mmToPt(10);
  /** Between main venue block and sub-venue line. */
  const gapVenueSub = mmToPt(4);
  const gapVenueDate = mmToPt(5);

  const innerBottom = margin + INNER_BORDER_INSET;
  const innerTop = margin + borderH - INNER_BORDER_INSET;

  const hasArrow = arrow !== "none";
  const minDim = Math.min(pageWidth, pageHeight);
  const arrowSize = hasArrow ? minDim * 0.28 : 0;
  const arrowHalf = arrowSize * 0.52;

  const cyMin = hasArrow ? innerBottom + arrowHalf + arrowEdgePad : 0;
  const cyMax = hasArrow ? innerTop - arrowHalf - arrowEdgePad : 0;
  /** Preferred arrow centre: ¼ of inner height above inner bottom (pinned low on the sign). */
  const innerSpan = innerTop - innerBottom;
  const cyTarget = hasArrow ? innerBottom + innerSpan * 0.25 : 0;

  const name = normalizeForCormorantLigatureSafe(eventName.trim() || "Event");
  const vRaw = venueLine.trim();
  const sRaw = subVenueLine.trim();
  const dRaw = dateLine.trim();

  const tryLayoutAtSize = (titleSize: number): SignageLayout | null => {
    const measure = (t: string) => titleFont.widthOfTextAtSize(t, titleSize);
    const titleLines = breakSignageTitleIntoLines(name, measure, titleMaxW);
    const n = titleLines.length;
    const { capH, desc, lineHeight } = titleMetricsAtSize(titleSize);

    /** Signage-scale body lines: ~2× previous sizing so venue/date read from a distance. */
    const venueSize = Math.min(40, Math.max(20, Math.round(titleSize * 0.52)));
    const dateSize = Math.min(28, Math.max(16, Math.round(titleSize * 0.38)));
    const { capH: vCap, desc: vDesc, lineHeight: vLh } = bodyMetricsAtSize(venueSize);
    const { capH: dCap, desc: dDesc, lineHeight: dLh } = bodyMetricsAtSize(dateSize);
    const metaMaxW = borderW - mmToPt(28);
    const venueLines = vRaw
      ? breakSignageTitleIntoLines(vRaw, (t) => bodyBoldFont.widthOfTextAtSize(t, venueSize), metaMaxW)
      : [];
    const subVenueLines = sRaw
      ? breakSignageTitleIntoLines(sRaw, (t) => bodyFont.widthOfTextAtSize(t, venueSize), metaMaxW)
      : [];
    const dateLines = dRaw
      ? breakSignageTitleIntoLines(dRaw, (t) => bodyFont.widthOfTextAtSize(t, dateSize), metaMaxW)
      : [];

    const vn = venueLines.length;
    const sn = subVenueLines.length;
    const dn = dateLines.length;

    const computeK0 = (): number => {
      let k = (n - 1) * lineHeight + desc;
      if (vn > 0) {
        k += gapAfterTitle + vCap + (vn - 1) * vLh + vDesc;
      }
      if (sn > 0) {
        const g = vn > 0 ? gapVenueSub : gapAfterTitle;
        k += g + vCap + (sn - 1) * vLh + vDesc;
      }
      if (dn > 0) {
        const g = vn > 0 || sn > 0 ? gapVenueDate : gapAfterTitle;
        k += g + dCap + (dn - 1) * dLh + dDesc;
      }
      return k;
    };

    const computeBaselines = (
      firstLineY: number
    ): { venueFirstBaselineY: number; subVenueFirstBaselineY: number; dateFirstBaselineY: number } => {
      const titleBottom = firstLineY - (n - 1) * lineHeight - desc;
      let venueFirstBaselineY = 0;
      let subVenueFirstBaselineY = 0;
      let dateFirstBaselineY = 0;

      let bottomAfterTitle = titleBottom;
      if (vn > 0) {
        venueFirstBaselineY = bottomAfterTitle - gapAfterTitle - vCap;
        const lastVenueBaseline = venueFirstBaselineY - (vn - 1) * vLh;
        bottomAfterTitle = lastVenueBaseline - vDesc;
      }

      if (sn > 0) {
        const g = vn > 0 ? gapVenueSub : gapAfterTitle;
        subVenueFirstBaselineY = bottomAfterTitle - g - vCap;
        const lastSubBaseline = subVenueFirstBaselineY - (sn - 1) * vLh;
        bottomAfterTitle = lastSubBaseline - vDesc;
      }

      if (dn > 0) {
        const g = vn > 0 || sn > 0 ? gapVenueDate : gapAfterTitle;
        dateFirstBaselineY = bottomAfterTitle - g - dCap;
      }

      return { venueFirstBaselineY, subVenueFirstBaselineY, dateFirstBaselineY };
    };

    const buildLayout = (
      firstLineY: number,
      cy: number | null,
      asz: number
    ): SignageLayout => {
      const { venueFirstBaselineY, subVenueFirstBaselineY, dateFirstBaselineY } = computeBaselines(firstLineY);
      return {
        titleSize,
        titleLines,
        dualColumn: false,
        leftTitleLines: [],
        rightTitleLines: [],
        cxLeft: 0,
        cxRight: 0,
        firstLineY,
        lineHeight,
        venueLines,
        venueSize,
        venueLineHeight: vLh,
        venueFirstBaselineY,
        subVenueLines,
        subVenueFirstBaselineY,
        dateLines,
        dateSize,
        dateLineHeight: dLh,
        dateFirstBaselineY,
        rightVenueLines: [],
        rightSubVenueLines: [],
        rightDateLines: [],
        rightVenueFirstBaselineY: 0,
        rightSubVenueFirstBaselineY: 0,
        rightDateFirstBaselineY: 0,
        cy,
        arrowSize: asz,
        arrow,
        rightArrow: "none",
        dualDraw: null
      };
    };

    /** Highest baseline allowed so cap height stays below logo band. */
    const firstLineYMax = logoRowBottomY - gapBelowLogo - capH;
    /** Top / bottom of the inner vertical band for title placement (PDF y; larger = higher on page). */
    const titleBandTop = logoRowBottomY - gapBelowLogo;
    const titleBandBottom = innerBottom + textBottomPad;

    if (hasArrow && cyMin > cyMax) {
      return null;
    }

    const K0 = computeK0();

    if (!hasArrow) {
      const mid = (titleBandTop + titleBandBottom) / 2;
      const firstLineYCentered = mid - (capH - K0) / 2;
      const firstLineYMin = titleBandBottom + K0;
      if (firstLineYMin > firstLineYMax + 1e-6) {
        return null;
      }
      const firstLineY = Math.max(firstLineYMin, Math.min(firstLineYMax, firstLineYCentered));
      return buildLayout(firstLineY, null, 0);
    }

    const firstLineY = firstLineYMax - titleDropFromCeiling;
    const metaBottom = firstLineY - K0;
    const cyUpper = metaBottom - gapTitleArrow - arrowHalf;
    if (cyUpper < cyMin) {
      return null;
    }

    const cyIdeal = Math.min(cyTarget, cyUpper, cyMax);
    const cy = Math.max(cyMin, cyIdeal);
    if (cy > cyUpper + 1e-6) {
      return null;
    }

    return buildLayout(firstLineY, cy, arrowSize);
  };

  let titleSize = preferredTitleSize;
  const minTitleSize = 12;
  let layout: SignageLayout | null = tryLayoutAtSize(titleSize);

  while (!layout && titleSize > minTitleSize) {
    titleSize -= 1;
    layout = tryLayoutAtSize(titleSize);
  }

  if (!layout) {
    layout = tryLayoutAtSize(minTitleSize);
  }
  if (!layout) {
    for (let s = minTitleSize - 1; s >= 8; s -= 1) {
      layout = tryLayoutAtSize(s);
      if (layout) break;
    }
  }

  if (!layout) {
    throw new Error("Signage: event title cannot be laid out on this page (logos + title + arrow).");
  }
  return layout;
}

function layoutDualSideBySide(
  pageWidth: number,
  pageHeight: number,
  margin: number,
  borderH: number,
  borderW: number,
  eventNameLeft: string,
  eventNameRight: string,
  venueLine: string,
  subVenueLine: string,
  dateLine: string,
  venueLineR: string,
  subVenueLineR: string,
  dateLineR: string,
  titleFont: PDFFont,
  bodyFont: PDFFont,
  bodyBoldFont: PDFFont,
  paperSize: PaperSize,
  leftArrow: SignageArrowDirection,
  rightArrow: SignageArrowDirection,
  logoRowBottomY: number
): SignageLayout {
  const titleGutter = mmToPt(10);
  const colW = (borderW - titleGutter) / 2;
  const titleMaxWCol = colW - mmToPt(8);
  const metaMaxWColVenue = colW - mmToPt(12);
  const cxLeft = margin + colW / 2;
  const cxRight = margin + colW + titleGutter + colW / 2;

  const titleSizeCap = 110;
  const preferredTitleSize = Math.min(
    titleSizeCap,
    Math.max(20, pageHeight * (paperSize === "A3" ? 0.086 : 0.122))
  );
  const titleDropFromCeiling = paperSize === "A3" ? mmToPt(12) : 0;
  const gapBelowLogo = mmToPt(10);
  const gapTitleArrow = mmToPt(14);
  const arrowEdgePad = mmToPt(6);
  const textBottomPad = mmToPt(8);
  const gapAfterTitle = mmToPt(10);
  const gapVenueSub = mmToPt(4);
  const gapVenueDate = mmToPt(5);

  const innerBottom = margin + INNER_BORDER_INSET;
  const innerTop = margin + borderH - INNER_BORDER_INSET;

  const hasArrow = leftArrow !== "none" || rightArrow !== "none";
  const minDim = Math.min(pageWidth, pageHeight);
  const arrowSize = hasArrow ? minDim * 0.22 : 0;
  const arrowHalf = arrowSize * 0.52;

  const nameL = normalizeForCormorantLigatureSafe(eventNameLeft.trim() || "Event");
  const nameR = normalizeForCormorantLigatureSafe(eventNameRight.trim() || "Event");
  const vRawL = venueLine.trim();
  const sRawL = subVenueLine.trim();
  const dRawL = dateLine.trim();
  const vRawR = venueLineR.trim();
  const sRawR = subVenueLineR.trim();
  const dRawR = dateLineR.trim();

  const tryLayoutAtSize = (titleSize: number): SignageLayout | null => {
    const measure = (t: string) => titleFont.widthOfTextAtSize(t, titleSize);
    const leftTitleLines = breakSignageTitleIntoLines(nameL, measure, titleMaxWCol);
    const rightTitleLines = breakSignageTitleIntoLines(nameR, measure, titleMaxWCol);
    const nL = leftTitleLines.length;
    const nR = rightTitleLines.length;
    const nRows = Math.max(nL, nR);
    const { capH, desc, lineHeight } = titleMetricsAtSize(titleSize);

    const venueSize = Math.min(40, Math.max(20, Math.round(titleSize * 0.52)));
    const dateSize = Math.min(28, Math.max(16, Math.round(titleSize * 0.38)));
    const { capH: vCap, desc: vDesc, lineHeight: vLh } = bodyMetricsAtSize(venueSize);
    const { capH: dCap, desc: dDesc, lineHeight: dLh } = bodyMetricsAtSize(dateSize);
    const venueLinesL = vRawL
      ? breakSignageTitleIntoLines(vRawL, (t) => bodyBoldFont.widthOfTextAtSize(t, venueSize), metaMaxWColVenue)
      : [];
    const subVenueLinesL = sRawL
      ? breakSignageTitleIntoLines(sRawL, (t) => bodyFont.widthOfTextAtSize(t, venueSize), metaMaxWColVenue)
      : [];
    const dateLinesL = dRawL
      ? breakSignageTitleIntoLines(dRawL, (t) => bodyFont.widthOfTextAtSize(t, dateSize), metaMaxWColVenue)
      : [];
    const venueLinesR = vRawR
      ? breakSignageTitleIntoLines(vRawR, (t) => bodyBoldFont.widthOfTextAtSize(t, venueSize), metaMaxWColVenue)
      : [];
    const subVenueLinesR = sRawR
      ? breakSignageTitleIntoLines(sRawR, (t) => bodyFont.widthOfTextAtSize(t, venueSize), metaMaxWColVenue)
      : [];
    const dateLinesR = dRawR
      ? breakSignageTitleIntoLines(dRawR, (t) => bodyFont.widthOfTextAtSize(t, dateSize), metaMaxWColVenue)
      : [];

    const vnL = venueLinesL.length;
    const snL = subVenueLinesL.length;
    const dnL = dateLinesL.length;
    const vnR = venueLinesR.length;
    const snR = subVenueLinesR.length;
    const dnR = dateLinesR.length;

    const metaDepthBelowFloor = (floorY: number, vn: number, sn: number, dn: number): number => {
      const m = computeMetaBaselinesFromContentFloor(
        floorY,
        vn,
        sn,
        dn,
        gapAfterTitle,
        gapVenueSub,
        gapVenueDate,
        vCap,
        vLh,
        vDesc,
        dCap,
        dLh,
        dDesc
      );
      return floorY - m.metaLowestY;
    };

    const refFly = 1000;
    const tbl0 = refFly - (nL - 1) * lineHeight - desc;
    const tbr0 = refFly - (nR - 1) * lineHeight - desc;
    const K0 = Math.max(
      (nL - 1) * lineHeight + desc + metaDepthBelowFloor(tbl0, vnL, snL, dnL),
      (nR - 1) * lineHeight + desc + metaDepthBelowFloor(tbr0, vnR, snR, dnR)
    );

    const buildDualSideLayout = (
      firstLineY: number,
      metaL: ReturnType<typeof computeMetaBaselinesFromContentFloor>,
      metaR: ReturnType<typeof computeMetaBaselinesFromContentFloor>,
      asz: number,
      arrowCyLeft: number | null,
      arrowCyRight: number | null
    ): SignageLayout | null => {
      if (Math.min(metaL.metaLowestY, metaR.metaLowestY) < innerBottom + textBottomPad) {
        return null;
      }
      return {
        titleSize,
        titleLines: [],
        dualColumn: true,
        leftTitleLines,
        rightTitleLines,
        cxLeft,
        cxRight,
        firstLineY,
        lineHeight,
        venueLines: venueLinesL,
        venueSize,
        venueLineHeight: vLh,
        venueFirstBaselineY: metaL.venueFirstBaselineY,
        subVenueLines: subVenueLinesL,
        subVenueFirstBaselineY: metaL.subVenueFirstBaselineY,
        dateLines: dateLinesL,
        dateSize,
        dateLineHeight: dLh,
        dateFirstBaselineY: metaL.dateFirstBaselineY,
        rightVenueLines: venueLinesR,
        rightSubVenueLines: subVenueLinesR,
        rightDateLines: dateLinesR,
        rightVenueFirstBaselineY: metaR.venueFirstBaselineY,
        rightSubVenueFirstBaselineY: metaR.subVenueFirstBaselineY,
        rightDateFirstBaselineY: metaR.dateFirstBaselineY,
        cy: null,
        arrowSize: asz,
        arrow: leftArrow,
        rightArrow,
        dualDraw: {
          kind: "sideBySide",
          firstLineY,
          lineHeight,
          arrowCyLeft,
          arrowCyRight
        }
      };
    };

    const firstLineYMax = logoRowBottomY - gapBelowLogo - capH;
    const titleBandTop = logoRowBottomY - gapBelowLogo;
    const titleBandBottom = innerBottom + textBottomPad;

    if (!hasArrow) {
      const mid = (titleBandTop + titleBandBottom) / 2;
      const firstLineYCentered = mid - (capH - K0) / 2;
      const firstLineYMin = titleBandBottom + K0;
      if (firstLineYMin > firstLineYMax + 1e-6) {
        return null;
      }
      const firstLineY = Math.max(firstLineYMin, Math.min(firstLineYMax, firstLineYCentered));
      const titleBottomL = firstLineY - (nL - 1) * lineHeight - desc;
      const titleBottomR = firstLineY - (nR - 1) * lineHeight - desc;
      const metaL = computeMetaBaselinesFromContentFloor(
        titleBottomL,
        vnL,
        snL,
        dnL,
        gapAfterTitle,
        gapVenueSub,
        gapVenueDate,
        vCap,
        vLh,
        vDesc,
        dCap,
        dLh,
        dDesc
      );
      const metaR = computeMetaBaselinesFromContentFloor(
        titleBottomR,
        vnR,
        snR,
        dnR,
        gapAfterTitle,
        gapVenueSub,
        gapVenueDate,
        vCap,
        vLh,
        vDesc,
        dCap,
        dLh,
        dDesc
      );
      return buildDualSideLayout(firstLineY, metaL, metaR, 0, null, null);
    }

    const firstLineY = firstLineYMax - titleDropFromCeiling;
    const leftTitleBottom = firstLineY - (nL - 1) * lineHeight - desc;
    const rightTitleBottom = firstLineY - (nR - 1) * lineHeight - desc;
    const arrowCyLeft = leftArrow !== "none" ? leftTitleBottom - gapTitleArrow - arrowHalf : null;
    const arrowCyRight = rightArrow !== "none" ? rightTitleBottom - gapTitleArrow - arrowHalf : null;

    if (arrowCyLeft != null && arrowCyLeft - arrowHalf < innerBottom + arrowEdgePad) {
      return null;
    }
    if (arrowCyRight != null && arrowCyRight - arrowHalf < innerBottom + arrowEdgePad) {
      return null;
    }

    const floorL = arrowCyLeft != null ? arrowCyLeft - arrowHalf : leftTitleBottom;
    const floorR = arrowCyRight != null ? arrowCyRight - arrowHalf : rightTitleBottom;
    const metaL = computeMetaBaselinesFromContentFloor(
      floorL,
      vnL,
      snL,
      dnL,
      gapAfterTitle,
      gapVenueSub,
      gapVenueDate,
      vCap,
      vLh,
      vDesc,
      dCap,
      dLh,
      dDesc
    );
    const metaR = computeMetaBaselinesFromContentFloor(
      floorR,
      vnR,
      snR,
      dnR,
      gapAfterTitle,
      gapVenueSub,
      gapVenueDate,
      vCap,
      vLh,
      vDesc,
      dCap,
      dLh,
      dDesc
    );
    return buildDualSideLayout(firstLineY, metaL, metaR, arrowSize, arrowCyLeft, arrowCyRight);
  };

  let titleSize = preferredTitleSize;
  const minTitleSize = 12;
  let layout: SignageLayout | null = tryLayoutAtSize(titleSize);

  while (!layout && titleSize > minTitleSize) {
    titleSize -= 1;
    layout = tryLayoutAtSize(titleSize);
  }
  if (!layout) {
    layout = tryLayoutAtSize(minTitleSize);
  }
  if (!layout) {
    for (let s = minTitleSize - 1; s >= 8; s -= 1) {
      layout = tryLayoutAtSize(s);
      if (layout) break;
    }
  }
  if (!layout) {
    throw new Error("Signage: dual event titles cannot be laid out on this page (logos + titles + arrows).");
  }
  return layout;
}

function layoutDualStackedPortrait(
  _pageWidth: number,
  pageHeight: number,
  margin: number,
  borderH: number,
  borderW: number,
  eventNameLeft: string,
  eventNameRight: string,
  venueLine: string,
  subVenueLine: string,
  dateLine: string,
  venueLineR: string,
  subVenueLineR: string,
  dateLineR: string,
  titleFont: PDFFont,
  bodyFont: PDFFont,
  bodyBoldFont: PDFFont,
  paperSize: PaperSize,
  leftArrow: SignageArrowDirection,
  rightArrow: SignageArrowDirection,
  logoRowBottomY: number
): SignageLayout {
  const titleMaxW = borderW - mmToPt(24);
  const centerX = margin + borderW / 2;
  const dividerInset = mmToPt(10);
  const dividerX1 = margin + INNER_BORDER_INSET + dividerInset;
  const dividerX2 = margin + borderW - INNER_BORDER_INSET - dividerInset;
  const dividerThickness = 1.2;

  const titleSizeCap = 110;
  const preferredTitleSize = Math.min(
    titleSizeCap,
    Math.max(20, pageHeight * (paperSize === "A3" ? 0.084 : 0.118))
  );
  const titleDropFromCeiling = paperSize === "A3" ? mmToPt(12) : 0;
  const gapBelowLogo = mmToPt(10);
  const gapTitleArrow = mmToPt(14);
  const arrowEdgePad = mmToPt(6);
  const textBottomPad = mmToPt(8);
  const gapAfterTitle = mmToPt(10);
  const gapVenueSub = mmToPt(4);
  const gapVenueDate = mmToPt(5);
  const gapAroundRule = mmToPt(10);

  const innerBottom = margin + INNER_BORDER_INSET;

  const hasArrow = leftArrow !== "none" || rightArrow !== "none";
  const minDim = Math.min(_pageWidth, pageHeight);
  const arrowSize = hasArrow ? minDim * 0.2 : 0;
  const arrowHalf = arrowSize * 0.52;

  const nameL = normalizeForCormorantLigatureSafe(eventNameLeft.trim() || "Event");
  const nameR = normalizeForCormorantLigatureSafe(eventNameRight.trim() || "Event");
  const vRawL = venueLine.trim();
  const sRawL = subVenueLine.trim();
  const dRawL = dateLine.trim();
  const vRawR = venueLineR.trim();
  const sRawR = subVenueLineR.trim();
  const dRawR = dateLineR.trim();

  const tryLayoutAtSize = (titleSize: number): SignageLayout | null => {
    const measure = (t: string) => titleFont.widthOfTextAtSize(t, titleSize);
    const leftTitleLines = breakSignageTitleIntoLines(nameL, measure, titleMaxW);
    const rightTitleLines = breakSignageTitleIntoLines(nameR, measure, titleMaxW);
    const n1 = leftTitleLines.length;
    const n2 = rightTitleLines.length;
    const { capH, desc, lineHeight } = titleMetricsAtSize(titleSize);

    const venueSize = Math.min(40, Math.max(20, Math.round(titleSize * 0.52)));
    const dateSize = Math.min(28, Math.max(16, Math.round(titleSize * 0.38)));
    const { capH: vCap, desc: vDesc, lineHeight: vLh } = bodyMetricsAtSize(venueSize);
    const { capH: dCap, desc: dDesc, lineHeight: dLh } = bodyMetricsAtSize(dateSize);
    const metaMaxW = borderW - mmToPt(28);
    const venueLinesL = vRawL
      ? breakSignageTitleIntoLines(vRawL, (t) => bodyBoldFont.widthOfTextAtSize(t, venueSize), metaMaxW)
      : [];
    const subVenueLinesL = sRawL
      ? breakSignageTitleIntoLines(sRawL, (t) => bodyFont.widthOfTextAtSize(t, venueSize), metaMaxW)
      : [];
    const dateLinesL = dRawL
      ? breakSignageTitleIntoLines(dRawL, (t) => bodyFont.widthOfTextAtSize(t, dateSize), metaMaxW)
      : [];
    const venueLinesR = vRawR
      ? breakSignageTitleIntoLines(vRawR, (t) => bodyBoldFont.widthOfTextAtSize(t, venueSize), metaMaxW)
      : [];
    const subVenueLinesR = sRawR
      ? breakSignageTitleIntoLines(sRawR, (t) => bodyFont.widthOfTextAtSize(t, venueSize), metaMaxW)
      : [];
    const dateLinesR = dRawR
      ? breakSignageTitleIntoLines(dRawR, (t) => bodyFont.widthOfTextAtSize(t, dateSize), metaMaxW)
      : [];

    const vnL = venueLinesL.length;
    const snL = subVenueLinesL.length;
    const dnL = dateLinesL.length;
    const vnR = venueLinesR.length;
    const snR = subVenueLinesR.length;
    const dnR = dateLinesR.length;

    const firstLineYMax = logoRowBottomY - gapBelowLogo - capH;
    const firstLineY1 = firstLineYMax - titleDropFromCeiling;
    const bottom1 = firstLineY1 - (n1 - 1) * lineHeight - desc;
    const arrowCy1 = leftArrow !== "none" ? bottom1 - gapTitleArrow - arrowHalf : null;
    const afterArrow1 = arrowCy1 != null ? arrowCy1 - arrowHalf : bottom1;
    const meta1 = computeMetaBaselinesFromContentFloor(
      afterArrow1,
      vnL,
      snL,
      dnL,
      gapAfterTitle,
      gapVenueSub,
      gapVenueDate,
      vCap,
      vLh,
      vDesc,
      dCap,
      dLh,
      dDesc
    );
    const dividerLineY = meta1.metaLowestY - gapAroundRule - dividerThickness / 2;
    const firstLineY2 = dividerLineY - dividerThickness / 2 - gapAroundRule - capH;

    if (firstLineY2 >= firstLineY1 - mmToPt(1)) {
      return null;
    }

    const bottom2 = firstLineY2 - (n2 - 1) * lineHeight - desc;
    const arrowCy2 = rightArrow !== "none" ? bottom2 - gapTitleArrow - arrowHalf : null;
    const afterArrow2 = arrowCy2 != null ? arrowCy2 - arrowHalf : bottom2;
    const meta2 = computeMetaBaselinesFromContentFloor(
      afterArrow2,
      vnR,
      snR,
      dnR,
      gapAfterTitle,
      gapVenueSub,
      gapVenueDate,
      vCap,
      vLh,
      vDesc,
      dCap,
      dLh,
      dDesc
    );

    if (arrowCy1 != null && arrowCy1 - arrowHalf < innerBottom + arrowEdgePad) {
      return null;
    }
    if (arrowCy2 != null && arrowCy2 - arrowHalf < innerBottom + arrowEdgePad) {
      return null;
    }

    if (meta2.metaLowestY < innerBottom + textBottomPad) {
      return null;
    }

    return {
      titleSize,
      titleLines: [],
      dualColumn: true,
      leftTitleLines,
      rightTitleLines,
      cxLeft: centerX,
      cxRight: centerX,
      firstLineY: firstLineY1,
      lineHeight,
      venueLines: venueLinesL,
      venueSize,
      venueLineHeight: vLh,
      venueFirstBaselineY: meta1.venueFirstBaselineY,
      subVenueLines: subVenueLinesL,
      subVenueFirstBaselineY: meta1.subVenueFirstBaselineY,
      dateLines: dateLinesL,
      dateSize,
      dateLineHeight: dLh,
      dateFirstBaselineY: meta1.dateFirstBaselineY,
      rightVenueLines: venueLinesR,
      rightSubVenueLines: subVenueLinesR,
      rightDateLines: dateLinesR,
      rightVenueFirstBaselineY: meta2.venueFirstBaselineY,
      rightSubVenueFirstBaselineY: meta2.subVenueFirstBaselineY,
      rightDateFirstBaselineY: meta2.dateFirstBaselineY,
      cy: null,
      arrowSize,
      arrow: leftArrow,
      rightArrow,
      dualDraw: {
        kind: "stackedPortrait",
        lineHeight,
        event1FirstLineY: firstLineY1,
        event2FirstLineY: firstLineY2,
        centerX,
        arrowCy1,
        arrowCy2,
        dividerLineY,
        dividerX1,
        dividerX2,
        dividerThickness
      }
    };
  };

  let titleSize = preferredTitleSize;
  const minTitleSize = 12;
  let layout: SignageLayout | null = tryLayoutAtSize(titleSize);

  while (!layout && titleSize > minTitleSize) {
    titleSize -= 1;
    layout = tryLayoutAtSize(titleSize);
  }
  if (!layout) {
    layout = tryLayoutAtSize(minTitleSize);
  }
  if (!layout) {
    for (let s = minTitleSize - 1; s >= 8; s -= 1) {
      layout = tryLayoutAtSize(s);
      if (layout) break;
    }
  }
  if (!layout) {
    throw new Error("Signage: stacked portrait dual titles cannot be laid out on this page.");
  }
  return layout;
}

function layoutDualStackedLandscape(
  _pageWidth: number,
  pageHeight: number,
  margin: number,
  borderH: number,
  borderW: number,
  eventNameLeft: string,
  eventNameRight: string,
  venueLine: string,
  subVenueLine: string,
  dateLine: string,
  venueLineR: string,
  subVenueLineR: string,
  dateLineR: string,
  titleFont: PDFFont,
  bodyFont: PDFFont,
  bodyBoldFont: PDFFont,
  paperSize: PaperSize,
  leftArrow: SignageArrowDirection,
  rightArrow: SignageArrowDirection,
  logoRowBottomY: number
): SignageLayout {
  const textMaxW = borderW * 0.58;
  const textX = margin + mmToPt(14);
  const arrowCx = margin + borderW * 0.84;
  const cxMid = margin + borderW / 2;

  const titleSizeCap = 110;
  const preferredTitleSize = Math.min(
    titleSizeCap,
    Math.max(18, pageHeight * (paperSize === "A3" ? 0.08 : 0.11))
  );
  const titleDropFromCeiling = paperSize === "A3" ? mmToPt(10) : 0;
  const gapBelowLogo = mmToPt(10);
  const arrowEdgePad = mmToPt(6);
  const textBottomPad = mmToPt(8);
  const gapAfterTitle = mmToPt(10);
  const gapVenueSub = mmToPt(4);
  const gapVenueDate = mmToPt(5);
  const gapAroundRule = mmToPt(10);
  const dividerInset = mmToPt(10);
  const dividerX1 = margin + INNER_BORDER_INSET + dividerInset;
  const dividerX2 = margin + borderW - INNER_BORDER_INSET - dividerInset;
  const dividerThickness = 1.2;

  const innerBottom = margin + INNER_BORDER_INSET;
  const innerTop = margin + borderH - INNER_BORDER_INSET;

  const hasArrow = leftArrow !== "none" || rightArrow !== "none";
  const minDim = Math.min(_pageWidth, pageHeight);
  const arrowSize = hasArrow ? minDim * 0.2 : 0;
  const arrowHalf = arrowSize * 0.52;

  const nameL = normalizeForCormorantLigatureSafe(eventNameLeft.trim() || "Event");
  const nameR = normalizeForCormorantLigatureSafe(eventNameRight.trim() || "Event");
  const vRawL = venueLine.trim();
  const sRawL = subVenueLine.trim();
  const dRawL = dateLine.trim();
  const vRawR = venueLineR.trim();
  const sRawR = subVenueLineR.trim();
  const dRawR = dateLineR.trim();

  const tryLayoutAtSize = (titleSize: number): SignageLayout | null => {
    const measure = (t: string) => titleFont.widthOfTextAtSize(t, titleSize);
    const leftTitleLines = breakSignageTitleIntoLines(nameL, measure, textMaxW);
    const rightTitleLines = breakSignageTitleIntoLines(nameR, measure, textMaxW);
    const n1 = leftTitleLines.length;
    const n2 = rightTitleLines.length;
    const { capH, desc, lineHeight } = titleMetricsAtSize(titleSize);

    const venueSize = Math.min(40, Math.max(20, Math.round(titleSize * 0.52)));
    const dateSize = Math.min(28, Math.max(16, Math.round(titleSize * 0.38)));
    const { capH: vCap, desc: vDesc, lineHeight: vLh } = bodyMetricsAtSize(venueSize);
    const { capH: dCap, desc: dDesc, lineHeight: dLh } = bodyMetricsAtSize(dateSize);
    const metaMaxW = borderW - mmToPt(28);
    const venueLinesL = vRawL
      ? breakSignageTitleIntoLines(vRawL, (t) => bodyBoldFont.widthOfTextAtSize(t, venueSize), metaMaxW)
      : [];
    const subVenueLinesL = sRawL
      ? breakSignageTitleIntoLines(sRawL, (t) => bodyFont.widthOfTextAtSize(t, venueSize), metaMaxW)
      : [];
    const dateLinesL = dRawL
      ? breakSignageTitleIntoLines(dRawL, (t) => bodyFont.widthOfTextAtSize(t, dateSize), metaMaxW)
      : [];
    const venueLinesR = vRawR
      ? breakSignageTitleIntoLines(vRawR, (t) => bodyBoldFont.widthOfTextAtSize(t, venueSize), metaMaxW)
      : [];
    const subVenueLinesR = sRawR
      ? breakSignageTitleIntoLines(sRawR, (t) => bodyFont.widthOfTextAtSize(t, venueSize), metaMaxW)
      : [];
    const dateLinesR = dRawR
      ? breakSignageTitleIntoLines(dRawR, (t) => bodyFont.widthOfTextAtSize(t, dateSize), metaMaxW)
      : [];

    const vnL = venueLinesL.length;
    const snL = subVenueLinesL.length;
    const dnL = dateLinesL.length;
    const vnR = venueLinesR.length;
    const snR = subVenueLinesR.length;
    const dnR = dateLinesR.length;

    const firstLineYMax = logoRowBottomY - gapBelowLogo - capH;
    const firstLineY1 = firstLineYMax - titleDropFromCeiling;
    const textSpan1 = (Math.max(1, n1) - 1) * lineHeight + desc;
    const arrowCy1 = firstLineY1 - textSpan1 / 2;
    const row1TextBottom = firstLineY1 - (n1 - 1) * lineHeight - desc;
    const row1Bottom =
      leftArrow !== "none" ? Math.min(row1TextBottom, arrowCy1 - arrowHalf) : row1TextBottom;

    const meta1 = computeMetaBaselinesFromContentFloor(
      row1Bottom,
      vnL,
      snL,
      dnL,
      gapAfterTitle,
      gapVenueSub,
      gapVenueDate,
      vCap,
      vLh,
      vDesc,
      dCap,
      dLh,
      dDesc
    );
    const dividerLineY = meta1.metaLowestY - gapAroundRule - dividerThickness / 2;
    const firstLineY2 = dividerLineY - dividerThickness / 2 - gapAroundRule - capH;
    const textSpan2 = (Math.max(1, n2) - 1) * lineHeight + desc;
    const arrowCy2 = firstLineY2 - textSpan2 / 2;
    const row2TextBottom = firstLineY2 - (n2 - 1) * lineHeight - desc;
    const floorY =
      rightArrow !== "none" ? Math.min(row2TextBottom, arrowCy2 - arrowHalf) : row2TextBottom;

    if (firstLineY2 >= firstLineY1 - mmToPt(1)) {
      return null;
    }

    if (leftArrow !== "none") {
      if (arrowCy1 - arrowHalf < innerBottom + arrowEdgePad || arrowCy1 + arrowHalf > innerTop - arrowEdgePad) {
        return null;
      }
    }
    if (rightArrow !== "none") {
      if (arrowCy2 - arrowHalf < innerBottom + arrowEdgePad || arrowCy2 + arrowHalf > innerTop - arrowEdgePad) {
        return null;
      }
    }

    const meta2 = computeMetaBaselinesFromContentFloor(
      floorY,
      vnR,
      snR,
      dnR,
      gapAfterTitle,
      gapVenueSub,
      gapVenueDate,
      vCap,
      vLh,
      vDesc,
      dCap,
      dLh,
      dDesc
    );

    if (meta2.metaLowestY < innerBottom + textBottomPad) {
      return null;
    }

    return {
      titleSize,
      titleLines: [],
      dualColumn: true,
      leftTitleLines,
      rightTitleLines,
      cxLeft: cxMid,
      cxRight: cxMid,
      firstLineY: firstLineY1,
      lineHeight,
      venueLines: venueLinesL,
      venueSize,
      venueLineHeight: vLh,
      venueFirstBaselineY: meta1.venueFirstBaselineY,
      subVenueLines: subVenueLinesL,
      subVenueFirstBaselineY: meta1.subVenueFirstBaselineY,
      dateLines: dateLinesL,
      dateSize,
      dateLineHeight: dLh,
      dateFirstBaselineY: meta1.dateFirstBaselineY,
      rightVenueLines: venueLinesR,
      rightSubVenueLines: subVenueLinesR,
      rightDateLines: dateLinesR,
      rightVenueFirstBaselineY: meta2.venueFirstBaselineY,
      rightSubVenueFirstBaselineY: meta2.subVenueFirstBaselineY,
      rightDateFirstBaselineY: meta2.dateFirstBaselineY,
      cy: null,
      arrowSize,
      arrow: leftArrow,
      rightArrow,
      dualDraw: {
        kind: "stackedLandscape",
        lineHeight,
        event1FirstLineY: firstLineY1,
        event2FirstLineY: firstLineY2,
        textX,
        arrow1Cx: arrowCx,
        arrow1Cy: arrowCy1,
        arrow2Cx: arrowCx,
        arrow2Cy: arrowCy2,
        dividerLineY,
        dividerX1,
        dividerX2,
        dividerThickness
      }
    };
  };

  let titleSize = preferredTitleSize;
  const minTitleSize = 12;
  let layout: SignageLayout | null = tryLayoutAtSize(titleSize);

  while (!layout && titleSize > minTitleSize) {
    titleSize -= 1;
    layout = tryLayoutAtSize(titleSize);
  }
  if (!layout) {
    layout = tryLayoutAtSize(minTitleSize);
  }
  if (!layout) {
    for (let s = minTitleSize - 1; s >= 8; s -= 1) {
      layout = tryLayoutAtSize(s);
      if (layout) break;
    }
  }
  if (!layout) {
    throw new Error("Signage: stacked landscape dual titles cannot be laid out on this page.");
  }
  return layout;
}

function layoutSignageContentDual(
  pageWidth: number,
  pageHeight: number,
  margin: number,
  borderH: number,
  borderW: number,
  eventNameLeft: string,
  eventNameRight: string,
  venueLine: string,
  subVenueLine: string,
  dateLine: string,
  venueLineR: string,
  subVenueLineR: string,
  dateLineR: string,
  titleFont: PDFFont,
  bodyFont: PDFFont,
  bodyBoldFont: PDFFont,
  paperSize: PaperSize,
  orientation: PaperOrientation,
  leftArrow: SignageArrowDirection,
  rightArrow: SignageArrowDirection,
  logoRowBottomY: number,
  arrangement: SignageDualEventArrangement
): SignageLayout {
  if (arrangement === "stacked") {
    return orientation === "portrait"
      ? layoutDualStackedPortrait(
          pageWidth,
          pageHeight,
          margin,
          borderH,
          borderW,
          eventNameLeft,
          eventNameRight,
          venueLine,
          subVenueLine,
          dateLine,
          venueLineR,
          subVenueLineR,
          dateLineR,
          titleFont,
          bodyFont,
          bodyBoldFont,
          paperSize,
          leftArrow,
          rightArrow,
          logoRowBottomY
        )
      : layoutDualStackedLandscape(
          pageWidth,
          pageHeight,
          margin,
          borderH,
          borderW,
          eventNameLeft,
          eventNameRight,
          venueLine,
          subVenueLine,
          dateLine,
          venueLineR,
          subVenueLineR,
          dateLineR,
          titleFont,
          bodyFont,
          bodyBoldFont,
          paperSize,
          leftArrow,
          rightArrow,
          logoRowBottomY
        );
  }
  return layoutDualSideBySide(
    pageWidth,
    pageHeight,
    margin,
    borderH,
    borderW,
    eventNameLeft,
    eventNameRight,
    venueLine,
    subVenueLine,
    dateLine,
    venueLineR,
    subVenueLineR,
    dateLineR,
    titleFont,
    bodyFont,
    bodyBoldFont,
    paperSize,
    leftArrow,
    rightArrow,
    logoRowBottomY
  );
}
function isDualSignagePage(spec: SignagePageInput): boolean {
  return spec.secondaryArrow != null && spec.secondaryArrow !== "none";
}

export async function renderSignagePdf(
  pages: SignagePageInput[],
  options: {
    venueBytes?: { bytes: Uint8Array; contentType?: string } | null;
    clientBytes?: { bytes: Uint8Array; contentType?: string } | null;
  }
): Promise<Uint8Array> {
  const { doc, title, body, bodyBold } = await createDocWithFonts();
  let venueImg: PDFImage | null = null;
  let clientImg: PDFImage | null = null;
  if (options.venueBytes) {
    venueImg = await embedRasterImage(doc, options.venueBytes.bytes, options.venueBytes.contentType);
  }
  if (options.clientBytes) {
    clientImg = await embedRasterImage(doc, options.clientBytes.bytes, options.clientBytes.contentType);
  }
  const logos = { venue: venueImg, client: clientImg };

  for (const spec of pages) {
    const [pageWidth, pageHeight] = signagePageDimensions(spec.paperSize, spec.orientation);
    const page = doc.addPage([pageWidth, pageHeight]);
    const theme = spec.theme;
    const primary = hexToRgb(theme.primaryColor, "#012f43");
    const accent = hexToRgb(theme.accentColor, "#acc1cb");
    const textColor = hexToRgb(theme.textColor, "#0d1f28");

    page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: rgb(1, 1, 1) });

    const margin = mmToPt(14);
    const borderW = pageWidth - 2 * margin;
    const borderH = pageHeight - 2 * margin;
    drawSignageBorder(page, { x: margin, y: margin, width: borderW, height: borderH, primary, accent });

    const logoBox = Math.min(mmToPt(42), borderW * 0.22);
    const logoPad = mmToPt(8);
    const venuePl = computeLogoPlacement(
      pageWidth,
      pageHeight,
      margin,
      logoPad,
      logoBox,
      logos.venue,
      "tl"
    );
    const clientPl = computeLogoPlacement(
      pageWidth,
      pageHeight,
      margin,
      logoPad,
      logoBox,
      logos.client,
      "tr"
    );
    /** Lowermost logo bottom (smallest y); without logos, top header band (same rule as dh→0). */
    let logoRowBottomY = pageHeight - margin - logoPad;
    if (venuePl) logoRowBottomY = Math.min(logoRowBottomY, venuePl.bottomY);
    if (clientPl) logoRowBottomY = Math.min(logoRowBottomY, clientPl.bottomY);

    const venueLineR = spec.secondaryVenueLine ?? spec.venueLine ?? "";
    const subVenueLineR = spec.secondarySubVenueLine ?? spec.subVenueLine ?? "";
    const dateLineR = spec.secondaryDateLine ?? spec.dateLine ?? "";

    const layout = isDualSignagePage(spec)
      ? layoutSignageContentDual(
          pageWidth,
          pageHeight,
          margin,
          borderH,
          borderW,
          spec.eventName,
          spec.secondaryEventName ?? "",
          spec.venueLine ?? "",
          spec.subVenueLine ?? "",
          spec.dateLine ?? "",
          venueLineR,
          subVenueLineR,
          dateLineR,
          title,
          body,
          bodyBold,
          spec.paperSize,
          spec.orientation,
          spec.arrow,
          spec.secondaryArrow!,
          logoRowBottomY,
          spec.dualEventArrangement ?? "sideBySide"
        )
      : layoutSignageContent(
          pageWidth,
          pageHeight,
          margin,
          borderH,
          borderW,
          spec.eventName,
          spec.venueLine ?? "",
          spec.subVenueLine ?? "",
          spec.dateLine ?? "",
          title,
          body,
          bodyBold,
          spec.paperSize,
          spec.arrow,
          logoRowBottomY
        );

    if (venuePl && logos.venue) {
      page.drawImage(logos.venue, {
        x: venuePl.x,
        y: venuePl.bottomY,
        width: venuePl.dw,
        height: venuePl.dh
      });
    }
    if (clientPl && logos.client) {
      page.drawImage(logos.client, {
        x: clientPl.x,
        y: clientPl.bottomY,
        width: clientPl.dw,
        height: clientPl.dh
      });
    }

    if (layout.dualColumn && layout.dualDraw) {
      const d = layout.dualDraw;
      if (d.kind === "sideBySide") {
        const fl = d.firstLineY;
        const nRows = Math.max(layout.leftTitleLines.length, layout.rightTitleLines.length);
        for (let i = 0; i < nRows; i++) {
          const y = fl - i * d.lineHeight;
          if (i < layout.leftTitleLines.length) {
            const line = layout.leftTitleLines[i]!;
            const lw = title.widthOfTextAtSize(line, layout.titleSize);
            page.drawText(line, {
              x: layout.cxLeft - lw / 2,
              y,
              font: title,
              size: layout.titleSize,
              color: textColor
            });
          }
          if (i < layout.rightTitleLines.length) {
            const line = layout.rightTitleLines[i]!;
            const lw = title.widthOfTextAtSize(line, layout.titleSize);
            page.drawText(line, {
              x: layout.cxRight - lw / 2,
              y,
              font: title,
              size: layout.titleSize,
              color: textColor
            });
          }
        }
        if (d.arrowCyLeft !== null && layout.arrow !== "none") {
          drawSignageLucideArrow(page, layout.cxLeft, d.arrowCyLeft, layout.arrowSize, layout.arrow, primary);
        }
        if (d.arrowCyRight !== null && layout.rightArrow !== "none") {
          drawSignageLucideArrow(page, layout.cxRight, d.arrowCyRight, layout.arrowSize, layout.rightArrow, primary);
        }
        drawSignageMetaCentered(
          page,
          layout.cxLeft,
          {
            venueLines: layout.venueLines,
            subVenueLines: layout.subVenueLines,
            dateLines: layout.dateLines,
            venueSize: layout.venueSize,
            dateSize: layout.dateSize,
            venueLineHeight: layout.venueLineHeight,
            dateLineHeight: layout.dateLineHeight,
            venueFirstBaselineY: layout.venueFirstBaselineY,
            subVenueFirstBaselineY: layout.subVenueFirstBaselineY,
            dateFirstBaselineY: layout.dateFirstBaselineY
          },
          { body, bodyBold },
          textColor
        );
        drawSignageMetaCentered(
          page,
          layout.cxRight,
          {
            venueLines: layout.rightVenueLines,
            subVenueLines: layout.rightSubVenueLines,
            dateLines: layout.rightDateLines,
            venueSize: layout.venueSize,
            dateSize: layout.dateSize,
            venueLineHeight: layout.venueLineHeight,
            dateLineHeight: layout.dateLineHeight,
            venueFirstBaselineY: layout.rightVenueFirstBaselineY,
            subVenueFirstBaselineY: layout.rightSubVenueFirstBaselineY,
            dateFirstBaselineY: layout.rightDateFirstBaselineY
          },
          { body, bodyBold },
          textColor
        );
      } else if (d.kind === "stackedPortrait") {
        const cx = d.centerX;
        const lh = d.lineHeight;
        for (let i = 0; i < layout.leftTitleLines.length; i++) {
          const line = layout.leftTitleLines[i]!;
          const lw = title.widthOfTextAtSize(line, layout.titleSize);
          page.drawText(line, {
            x: cx - lw / 2,
            y: d.event1FirstLineY - i * lh,
            font: title,
            size: layout.titleSize,
            color: textColor
          });
        }
        if (d.arrowCy1 !== null && layout.arrow !== "none") {
          drawSignageLucideArrow(page, cx, d.arrowCy1, layout.arrowSize, layout.arrow, primary);
        }
        drawSignageMetaCentered(
          page,
          cx,
          {
            venueLines: layout.venueLines,
            subVenueLines: layout.subVenueLines,
            dateLines: layout.dateLines,
            venueSize: layout.venueSize,
            dateSize: layout.dateSize,
            venueLineHeight: layout.venueLineHeight,
            dateLineHeight: layout.dateLineHeight,
            venueFirstBaselineY: layout.venueFirstBaselineY,
            subVenueFirstBaselineY: layout.subVenueFirstBaselineY,
            dateFirstBaselineY: layout.dateFirstBaselineY
          },
          { body, bodyBold },
          textColor
        );
        page.drawLine({
          start: { x: d.dividerX1, y: d.dividerLineY },
          end: { x: d.dividerX2, y: d.dividerLineY },
          thickness: d.dividerThickness,
          color: accent
        });
        for (let i = 0; i < layout.rightTitleLines.length; i++) {
          const line = layout.rightTitleLines[i]!;
          const lw = title.widthOfTextAtSize(line, layout.titleSize);
          page.drawText(line, {
            x: cx - lw / 2,
            y: d.event2FirstLineY - i * lh,
            font: title,
            size: layout.titleSize,
            color: textColor
          });
        }
        if (d.arrowCy2 !== null && layout.rightArrow !== "none") {
          drawSignageLucideArrow(page, cx, d.arrowCy2, layout.arrowSize, layout.rightArrow, primary);
        }
        drawSignageMetaCentered(
          page,
          cx,
          {
            venueLines: layout.rightVenueLines,
            subVenueLines: layout.rightSubVenueLines,
            dateLines: layout.rightDateLines,
            venueSize: layout.venueSize,
            dateSize: layout.dateSize,
            venueLineHeight: layout.venueLineHeight,
            dateLineHeight: layout.dateLineHeight,
            venueFirstBaselineY: layout.rightVenueFirstBaselineY,
            subVenueFirstBaselineY: layout.rightSubVenueFirstBaselineY,
            dateFirstBaselineY: layout.rightDateFirstBaselineY
          },
          { body, bodyBold },
          textColor
        );
      } else {
        const lh = d.lineHeight;
        const tx = d.textX;
        for (let i = 0; i < layout.leftTitleLines.length; i++) {
          const line = layout.leftTitleLines[i]!;
          const lw = title.widthOfTextAtSize(line, layout.titleSize);
          page.drawText(line, {
            x: tx,
            y: d.event1FirstLineY - i * lh,
            font: title,
            size: layout.titleSize,
            color: textColor
          });
        }
        if (layout.arrow !== "none") {
          drawSignageLucideArrow(page, d.arrow1Cx, d.arrow1Cy, layout.arrowSize, layout.arrow, primary);
        }
        drawSignageMetaCentered(
          page,
          margin + borderW / 2,
          {
            venueLines: layout.venueLines,
            subVenueLines: layout.subVenueLines,
            dateLines: layout.dateLines,
            venueSize: layout.venueSize,
            dateSize: layout.dateSize,
            venueLineHeight: layout.venueLineHeight,
            dateLineHeight: layout.dateLineHeight,
            venueFirstBaselineY: layout.venueFirstBaselineY,
            subVenueFirstBaselineY: layout.subVenueFirstBaselineY,
            dateFirstBaselineY: layout.dateFirstBaselineY
          },
          { body, bodyBold },
          textColor
        );
        page.drawLine({
          start: { x: d.dividerX1, y: d.dividerLineY },
          end: { x: d.dividerX2, y: d.dividerLineY },
          thickness: d.dividerThickness,
          color: accent
        });
        for (let i = 0; i < layout.rightTitleLines.length; i++) {
          const line = layout.rightTitleLines[i]!;
          const lw = title.widthOfTextAtSize(line, layout.titleSize);
          page.drawText(line, {
            x: tx,
            y: d.event2FirstLineY - i * lh,
            font: title,
            size: layout.titleSize,
            color: textColor
          });
        }
        if (layout.rightArrow !== "none") {
          drawSignageLucideArrow(page, d.arrow2Cx, d.arrow2Cy, layout.arrowSize, layout.rightArrow, primary);
        }
        drawSignageMetaCentered(
          page,
          margin + borderW / 2,
          {
            venueLines: layout.rightVenueLines,
            subVenueLines: layout.rightSubVenueLines,
            dateLines: layout.rightDateLines,
            venueSize: layout.venueSize,
            dateSize: layout.dateSize,
            venueLineHeight: layout.venueLineHeight,
            dateLineHeight: layout.dateLineHeight,
            venueFirstBaselineY: layout.rightVenueFirstBaselineY,
            subVenueFirstBaselineY: layout.rightSubVenueFirstBaselineY,
            dateFirstBaselineY: layout.rightDateFirstBaselineY
          },
          { body, bodyBold },
          textColor
        );
      }
    } else if (!layout.dualColumn) {
      for (let i = 0; i < layout.titleLines.length; i++) {
        const line = layout.titleLines[i]!;
        const lw = title.widthOfTextAtSize(line, layout.titleSize);
        const titleX = margin + (borderW - lw) / 2;
        page.drawText(line, {
          x: titleX,
          y: layout.firstLineY - i * layout.lineHeight,
          font: title,
          size: layout.titleSize,
          color: textColor
        });
      }
    }

    if (!layout.dualColumn && layout.venueLines.length > 0) {
      for (let i = 0; i < layout.venueLines.length; i++) {
        const line = layout.venueLines[i]!;
        const lw = bodyBold.widthOfTextAtSize(line, layout.venueSize);
        const x = margin + (borderW - lw) / 2;
        page.drawText(line, {
          x,
          y: layout.venueFirstBaselineY - i * layout.venueLineHeight,
          font: bodyBold,
          size: layout.venueSize,
          color: textColor
        });
      }
    }

    if (!layout.dualColumn && layout.subVenueLines.length > 0) {
      for (let i = 0; i < layout.subVenueLines.length; i++) {
        const line = layout.subVenueLines[i]!;
        const lw = body.widthOfTextAtSize(line, layout.venueSize);
        const x = margin + (borderW - lw) / 2;
        page.drawText(line, {
          x,
          y: layout.subVenueFirstBaselineY - i * layout.venueLineHeight,
          font: body,
          size: layout.venueSize,
          color: textColor
        });
      }
    }

    if (!layout.dualColumn && layout.dateLines.length > 0) {
      for (let i = 0; i < layout.dateLines.length; i++) {
        const line = layout.dateLines[i]!;
        const lw = body.widthOfTextAtSize(line, layout.dateSize);
        const x = margin + (borderW - lw) / 2;
        page.drawText(line, {
          x,
          y: layout.dateFirstBaselineY - i * layout.dateLineHeight,
          font: body,
          size: layout.dateSize,
          color: textColor
        });
      }
    }

    if (!layout.dualColumn && layout.cy !== null && layout.arrow !== "none") {
      const cx = pageWidth / 2;
      drawSignageLucideArrow(page, cx, layout.cy, layout.arrowSize, layout.arrow, primary);
    }
  }

  return new Uint8Array(await doc.save());
}

