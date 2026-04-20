import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, radians, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { hexToRgb } from "@/lib/pdf/color";
import type { SignageArrowDirection, SignageThemeColors } from "@/types";
import type { PDFFont, PDFImage, PDFPage } from "pdf-lib";

function mmToPt(mm: number): number {
  return (mm * 72) / 25.4;
}

const LIB_FONTS = path.join(process.cwd(), "lib", "fonts");
const PDF_FONT_SOURCES = {
  title: path.join(LIB_FONTS, "CormorantGaramond-wght.ttf")
} as const;

type PdfFontBytesCache = {
  title: Uint8Array;
};

let cachedPdfFontBytes: PdfFontBytesCache | null = null;

async function loadTitleFontBytes(): Promise<Uint8Array> {
  if (cachedPdfFontBytes) return cachedPdfFontBytes.title;
  const title = await readFile(PDF_FONT_SOURCES.title);
  cachedPdfFontBytes = { title };
  return title;
}

async function createDocWithFonts(): Promise<{ doc: PDFDocument; title: PDFFont }> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const bytes = await loadTitleFontBytes();
  const title = await doc.embedFont(bytes, { subset: false });
  return { doc, title };
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
  const inset = mmToPt(2.5);
  page.drawRectangle({
    x: x + inset,
    y: y + inset,
    width: width - 2 * inset,
    height: height - 2 * inset,
    borderColor: accent,
    borderWidth: 1.2
  });
}

const PHI = (1 + Math.sqrt(5)) / 2;

/**
 * Block arrow in SVG space (y down), shaft along +x, centred at origin.
 * Design rules: ~60/40 stem-to-head length; shoulder span 1.8× shaft height (middle of 1.6–2×);
 * notch depth 25% of head length (middle of 20–30%); bounding box width:height ≈ φ:1 (golden).
 * Built as stem rect + shaft–notch quad + notched head quad + flare quads; fills then one outer stroke.
 */
function drawBlockArrow(
  page: PDFPage,
  cx: number,
  cy: number,
  length: number,
  angleRad: number,
  fillColor: ReturnType<typeof rgb>
): void {
  const L = length;
  const stemFrac = 0.6;
  const headFrac = 0.4;
  const x0 = -L / 2 + stemFrac * L;
  const notchDepth = 0.25 * headFrac * L;
  const xL = -L / 2;
  const tip = L / 2;

  /** Overall height 2·hh ≈ L/φ → width:length ratio ~ φ:1 for the arrow silhouette. */
  const hh = L / (2 * PHI);
  /** Shoulder half-width ≈ 1.8× stem half-height (notch wider than shaft). */
  const hs = hh / 1.8;

  const delta = Math.max(0.4, L * 0.0018);

  const stemPath = `M ${xL} ${hs} L ${x0} ${hs} L ${x0} ${-hs} L ${xL} ${-hs} Z`;
  /** Fills shaft–V gap along head edges (chord-only triangle looked like a second arrow). */
  const stemNotchBridgePath = `M ${x0} ${hs} L ${x0} ${hh} L ${x0 + notchDepth} 0 L ${x0} ${-hs} Z`;
  const headPath = `M ${x0} ${hh} L ${tip} 0 L ${x0} ${-hh} L ${x0 + notchDepth} 0 Z`;
  const flareBottomPath = `M ${x0} ${hs} L ${x0 + delta} ${hs} L ${x0 + delta} ${hh} L ${x0} ${hh} Z`;
  const flareTopPath = `M ${x0} ${-hh} L ${x0 + delta} ${-hh} L ${x0 + delta} ${-hs} L ${x0} ${-hs} Z`;

  /** Outer silhouette only (notch is interior); avoids stacked strokes on shared edges. */
  const outerOutlinePath = `M ${tip} 0 L ${x0} ${hh} L ${x0 + delta} ${hh} L ${x0 + delta} ${hs} L ${x0} ${hs} L ${xL} ${hs} L ${xL} ${-hs} L ${x0} ${-hs} L ${x0 + delta} ${-hs} L ${x0 + delta} ${-hh} L ${x0} ${-hh} L ${tip} 0 Z`;

  const outlineStroke = Math.max(0.75, L * 0.0022);
  const fillOpts = {
    x: cx,
    y: cy,
    rotate: radians(angleRad),
    color: fillColor,
    borderWidth: 0
  } as const;
  const strokeOpts = {
    x: cx,
    y: cy,
    rotate: radians(angleRad),
    borderColor: rgb(0, 0, 0),
    borderWidth: outlineStroke
  } as const;

  page.drawSvgPath(stemPath, fillOpts);
  page.drawSvgPath(stemNotchBridgePath, fillOpts);
  page.drawSvgPath(headPath, fillOpts);
  page.drawSvgPath(flareBottomPath, fillOpts);
  page.drawSvgPath(flareTopPath, fillOpts);
  page.drawSvgPath(outerOutlinePath, strokeOpts);
}

function arrowAngleRad(direction: SignageArrowDirection): number | null {
  switch (direction) {
    case "none":
      return null;
    case "right":
      return 0;
    case "up":
      return Math.PI / 2;
    case "left":
      return Math.PI;
    case "down":
      return -Math.PI / 2;
    case "upRight":
      return Math.PI / 4;
    case "upLeft":
      return (3 * Math.PI) / 4;
    case "downLeft":
      return (-3 * Math.PI) / 4;
    case "downRight":
      return -Math.PI / 4;
    default:
      return null;
  }
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

export interface SignagePageInput {
  paperSize: "A3" | "A4";
  orientation: "portrait" | "landscape";
  arrow: SignageArrowDirection;
  eventName: string;
  theme: SignageThemeColors;
}

export async function renderSignagePdf(
  pages: SignagePageInput[],
  options: {
    venueBytes?: { bytes: Uint8Array; contentType?: string } | null;
    clientBytes?: { bytes: Uint8Array; contentType?: string } | null;
  }
): Promise<Uint8Array> {
  const { doc, title } = await createDocWithFonts();
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

    const titleMaxW = borderW - mmToPt(24);
    let titleSize = Math.min(44, pageHeight * 0.09);
    const name = spec.eventName.trim() || "Event";
    while (titleSize > 12 && title.widthOfTextAtSize(name, titleSize) > titleMaxW) {
      titleSize -= 0.5;
    }
    const titleW = title.widthOfTextAtSize(name, titleSize);
    const titleX = margin + (borderW - titleW) / 2;
    /** Vertically centre the title in the top half of the page (PDF y increases upward). */
    const topHalfBottom = pageHeight / 2;
    const topHalfMidY = (topHalfBottom + pageHeight) / 2;
    const titleY = topHalfMidY - titleSize * 0.28;
    page.drawText(name, {
      x: titleX,
      y: titleY,
      font: title,
      size: titleSize,
      color: textColor,
      maxWidth: titleMaxW
    });

    const logoBox = Math.min(mmToPt(42), borderW * 0.22);
    const logoPad = mmToPt(8);
    if (logos.venue) {
      const iw = logos.venue.width;
      const ih = logos.venue.height;
      const scale = Math.min(logoBox / iw, logoBox / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      page.drawImage(logos.venue, {
        x: margin + logoPad,
        y: pageHeight - margin - logoPad - dh,
        width: dw,
        height: dh
      });
    }
    if (logos.client) {
      const iw = logos.client.width;
      const ih = logos.client.height;
      const scale = Math.min(logoBox / iw, logoBox / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      page.drawImage(logos.client, {
        x: pageWidth - margin - logoPad - dw,
        y: pageHeight - margin - logoPad - dh,
        width: dw,
        height: dh
      });
    }

    const angle = arrowAngleRad(spec.arrow);
    if (angle !== null) {
      const minDim = Math.min(pageWidth, pageHeight);
      const arrowLen = minDim * 0.28;
      const cx = pageWidth / 2;
      const cy = margin + borderH * 0.4;
      drawBlockArrow(page, cx, cy, arrowLen, angle, primary);
    }
  }

  return new Uint8Array(await doc.save());
}

