import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
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
import { hexToRgb } from "@/lib/pdf/color";
import { lucideIconPathDs, type LucideIconNode } from "@/lib/pdf/lucideIconPath";
import type { SignageArrowDirection, SignageThemeColors } from "@/types";

export interface SignagePageInput {
  paperSize: "A3" | "A4";
  orientation: "portrait" | "landscape";
  arrow: SignageArrowDirection;
  eventName: string;
  /** Shown below the event name (Noto Sans Bold); optional. */
  venueLine?: string;
  /** Optional line under the venue (Noto Sans Regular, same size as venue). */
  subVenueLine?: string;
  /** Shown below venue / sub-venue (Noto Sans Regular); optional. */
  dateLine?: string;
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

export function signagePageDimensions(paperSize: "A3" | "A4", orientation: "portrait" | "landscape"): [number, number] {
  const A4: [number, number] = [mmToPt(210), mmToPt(297)];
  const A3: [number, number] = [mmToPt(297), mmToPt(420)];
  const base = paperSize === "A3" ? A3 : A4;
  if (orientation === "landscape") return [base[1], base[0]];
  return base;
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
    case "cornerUpRight":
      return { node: CornerUpRight as LucideIconNode, extraRotationRad: 0 };
    case "cornerUpLeft":
        return { node: CornerUpLeft as LucideIconNode, extraRotationRad: 0 };
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

type SignageLayout = {
  titleSize: number;
  titleLines: string[];
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
  cy: number | null;
  arrowSize: number;
};

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
  paperSize: "A3" | "A4",
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
        cy,
        arrowSize: asz
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

    const layout = layoutSignageContent(
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

    if (layout.venueLines.length > 0) {
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

    if (layout.subVenueLines.length > 0) {
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

    if (layout.dateLines.length > 0) {
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

    if (layout.cy !== null && spec.arrow !== "none") {
      const cx = pageWidth / 2;
      drawSignageLucideArrow(page, cx, layout.cy, layout.arrowSize, spec.arrow, primary);
    }
  }

  return new Uint8Array(await doc.save());
}

