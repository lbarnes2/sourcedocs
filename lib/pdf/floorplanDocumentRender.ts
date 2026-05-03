import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { FloorplanCanvasObject, FloorplanDocument } from "@/types";
import { pdfPageDimensions } from "@/lib/paperSizes";
import { normalizeForCormorantLigatureSafe } from "@/lib/buffetMenu/cormorantNormalize";
import { hexToRgb } from "@/lib/pdf/color";
import type { PDFFont } from "pdf-lib";

function pickColor(type: FloorplanCanvasObject["type"]) {
  if (type === "table") return rgb(0.67, 0.76, 0.83);
  if (type === "rect") return rgb(0.84, 0.88, 0.92);
  if (type === "circle") return rgb(0.82, 0.9, 0.86);
  return rgb(0.2, 0.25, 0.3);
}

const LIB_FONTS = path.join(process.cwd(), "lib", "fonts");
const PDF_FONT_SOURCES = {
  body: path.join(LIB_FONTS, "NotoSans-Regular.ttf"),
  bodyBold: path.join(LIB_FONTS, "NotoSans-Bold.ttf"),
  title: path.join(LIB_FONTS, "CormorantGaramond-wght.ttf")
} as const;

let cachedFontBytes: { body: Uint8Array; bodyBold: Uint8Array; title: Uint8Array } | null = null;

async function loadFontBytes() {
  if (cachedFontBytes) return cachedFontBytes;
  const [body, bodyBold, title] = await Promise.all([
    readFile(PDF_FONT_SOURCES.body),
    readFile(PDF_FONT_SOURCES.bodyBold),
    readFile(PDF_FONT_SOURCES.title)
  ]);
  cachedFontBytes = { body, bodyBold, title };
  return cachedFontBytes;
}

/** Outer radius from table centre including chair ring (matches draw loop). */
function tableCanvasOuterRadius(radius: number): number {
  const chairRadius = Math.max(2, radius * 0.18);
  const chairGap = Math.max(2, radius * 0.14);
  const chairRingRadius = radius + chairGap + chairRadius;
  return chairRingRadius + chairRadius;
}

/** Shrink font until the full string fits on one line; at min size, truncate with an ellipsis. */
function fitTextSingleLine(
  font: PDFFont,
  raw: string,
  maxWidth: number,
  maxSize: number,
  minSize: number
): { size: number; line: string } {
  const text = raw.replace(/\s+/g, " ").trim() || " ";
  let size = maxSize;
  while (size > minSize && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 0.25;
  }
  let line = text;
  if (font.widthOfTextAtSize(line, size) > maxWidth) {
    const ell = "…";
    let low = 0;
    let high = line.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      const candidate = line.slice(0, mid) + ell;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) low = mid;
      else high = mid - 1;
    }
    line = line.slice(0, low) + ell;
  }
  return { size, line };
}

async function embedLogoFromDataUrl(
  doc: PDFDocument,
  page: import("pdf-lib").PDFPage,
  logoDataUrl: string | undefined,
  options: { x: number; centerY: number; width: number }
) {
  if (!logoDataUrl) return;
  const split = logoDataUrl.split(",");
  if (split.length !== 2) return;
  const mime = split[0];
  const bytes = Uint8Array.from(Buffer.from(split[1], "base64"));
  try {
    const image = mime.includes("png") ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const width = options.width;
    const height = (image.height / image.width) * width;
    page.drawImage(image, {
      x: options.x,
      y: options.centerY - height / 2,
      width,
      height
    });
  } catch {
    // Ignore invalid image payloads.
  }
}

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function includePoint(bounds: Bounds, x: number, y: number): Bounds {
  return {
    minX: Math.min(bounds.minX, x),
    minY: Math.min(bounds.minY, y),
    maxX: Math.max(bounds.maxX, x),
    maxY: Math.max(bounds.maxY, y)
  };
}

function estimateObjectBounds(item: FloorplanCanvasObject, textFontSizeFallback = 16): Bounds {
  if (item.type === "table") {
    const outer = tableCanvasOuterRadius(item.radius);
    return {
      minX: item.x - outer,
      minY: item.y - outer,
      maxX: item.x + outer,
      maxY: item.y + outer
    };
  }
  if (item.type === "rect") {
    return {
      minX: item.x,
      minY: item.y,
      maxX: item.x + item.width,
      maxY: item.y + item.height
    };
  }
  if (item.type === "circle") {
    return {
      minX: item.x - item.radius,
      minY: item.y - item.radius,
      maxX: item.x + item.radius,
      maxY: item.y + item.radius
    };
  }
  const fontSize = item.fontSize || textFontSizeFallback;
  const approxW = Math.max(40, item.text.length * fontSize * 0.58);
  const approxH = Math.max(12, fontSize * 1.25);
  return {
    minX: item.x,
    minY: item.y,
    maxX: item.x + approxW,
    maxY: item.y + approxH
  };
}

function objectBounds(items: FloorplanCanvasObject[]): Bounds | null {
  if (!items.length) return null;
  let bounds: Bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };
  for (const item of items) {
    const b = estimateObjectBounds(item);
    bounds = includePoint(bounds, b.minX, b.minY);
    bounds = includePoint(bounds, b.maxX, b.maxY);
  }
  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY)) return null;
  return bounds;
}

export async function renderFloorplanDocumentPdf(docInput: FloorplanDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fonts = await loadFontBytes();
  const bodyFont = await pdf.embedFont(fonts.body, { subset: true });
  const bodyBold = await pdf.embedFont(fonts.bodyBold, { subset: true });
  const titleFont = await pdf.embedFont(fonts.title, { subset: false });
  const [width, height] = pdfPageDimensions(docInput.canvas.paperSize, docInput.canvas.orientation);
  const page = pdf.addPage([width, height]);
  /** Extra room so scaled tables + chairs stay inside the frame (left/right/bottom). */
  const margin = 40;
  const bodyPad = 22;
  const headerH = 96;
  const bodyTop = height - headerH - margin;
  const grid = docInput.canvas.gridSize || 24;
  const logoXInset = 24;
  const logoGap = 16;
  const logoWidth = 86;
  const titleBandMaxW = Math.max(100, width - 2 * (logoXInset + logoWidth + logoGap));

  page.drawRectangle({ x: 0, y: height - headerH, width, height: headerH, color: rgb(1, 1, 1) });
  const titleText = normalizeForCormorantLigatureSafe(
    docInput.metadata.title || docInput.themeSnapshot.eventName || "Floorplan"
  );
  const titleFit = fitTextSingleLine(titleFont, titleText, titleBandMaxW, 30, 12);
  const titleBaselineY = height - 22;
  const titleWidth = titleFont.widthOfTextAtSize(titleFit.line, titleFit.size);
  page.drawText(titleFit.line, {
    x: (width - titleWidth) / 2,
    y: titleBaselineY,
    size: titleFit.size,
    font: titleFont,
    color: rgb(0.04, 0.18, 0.26)
  });

  const subtitleRaw = (docInput.metadata.subtitle || docInput.themeSnapshot.eventSubtitle || "").trim();
  let subtitleBaselineY = titleBaselineY - 10;
  if (subtitleRaw) {
    const subtitleFit = fitTextSingleLine(bodyFont, subtitleRaw, titleBandMaxW, 12, 7);
    subtitleBaselineY = titleBaselineY - titleFit.size * 0.85 - subtitleFit.size * 0.35;
    const subtitleWidth = bodyFont.widthOfTextAtSize(subtitleFit.line, subtitleFit.size);
    page.drawText(subtitleFit.line, {
      x: (width - subtitleWidth) / 2,
      y: Math.max(height - headerH + 8, subtitleBaselineY),
      size: subtitleFit.size,
      font: bodyFont,
      color: rgb(0.26, 0.33, 0.4)
    });
  }
  const titleCenterY =
    subtitleRaw && subtitleBaselineY < titleBaselineY
      ? (titleBaselineY + titleFit.size * 0.35 + subtitleBaselineY + 2) / 2
      : titleBaselineY - titleFit.size * 0.15;
  await embedLogoFromDataUrl(pdf, page, docInput.themeSnapshot.clientLogoDataUrl, {
    x: logoXInset,
    centerY: titleCenterY,
    width: logoWidth
  });
  await embedLogoFromDataUrl(pdf, page, docInput.themeSnapshot.venueLogoDataUrl, {
    x: width - logoXInset - logoWidth,
    centerY: titleCenterY,
    width: logoWidth
  });

  page.drawRectangle({
    x: margin,
    y: margin,
    width: width - margin * 2,
    height: bodyTop - margin,
    borderWidth: 1.3,
    borderColor: rgb(0.58, 0.64, 0.72),
    color: rgb(0.99, 0.995, 1)
  });

  const contentLeft = margin + bodyPad;
  const contentBottom = margin + bodyPad;
  const contentWidth = width - (margin + bodyPad) * 2;
  const contentHeight = bodyTop - (margin + bodyPad) - contentBottom;
  const bounds = objectBounds(docInput.objects);
  const sourceMinX = bounds?.minX ?? 0;
  const sourceMinY = bounds?.minY ?? 0;
  const sourceWidth = Math.max(1, (bounds?.maxX ?? 1) - sourceMinX);
  const sourceHeight = Math.max(1, (bounds?.maxY ?? 1) - sourceMinY);

  // Auto-fit: scale up sparse plans and scale down dense plans.
  const fitScale = Math.min(contentWidth / sourceWidth, contentHeight / sourceHeight);
  const scale = Math.max(0.2, Math.min(8, fitScale));
  const drawnWidth = sourceWidth * scale;
  const drawnHeight = sourceHeight * scale;
  const offsetX = contentLeft + (contentWidth - drawnWidth) / 2;
  const offsetY = contentBottom + (contentHeight - drawnHeight) / 2;

  const mapX = (x: number) => offsetX + (x - sourceMinX) * scale;
  const mapYTop = (y: number) => offsetY + (y - sourceMinY) * scale;

  for (const item of docInput.objects) {
    const x = mapX(item.x);
    const yTop = mapYTop(item.y);
    const y = bodyTop - yTop;
    if (item.type === "table") {
      const radius = item.radius * scale;
      const chairRadius = Math.max(2, radius * 0.18);
      const chairGap = Math.max(2, radius * 0.14);
      const chairRingRadius = radius + chairGap + chairRadius;
      const chairCount = 8;
      for (let i = 0; i < chairCount; i += 1) {
        const angle = (i / chairCount) * Math.PI * 2 - Math.PI / 2;
        const chx = x + chairRingRadius * Math.cos(angle);
        const chy = y + chairRingRadius * Math.sin(angle);
        page.drawCircle({
          x: chx,
          y: chy,
          size: chairRadius,
          color: rgb(0.83, 0.9, 0.95),
          borderWidth: Math.max(0.45, scale * 0.65),
          borderColor: rgb(0.5, 0.57, 0.66)
        });
      }
      page.drawCircle({
        x,
        y,
        size: radius,
        color: pickColor("table"),
        borderWidth: Math.max(0.7, scale),
        borderColor: rgb(0.5, 0.57, 0.66)
      });
      const label = `Table ${item.tableNumber}`;
      const labelColor = hexToRgb(docInput.themeSnapshot.textColor, "#1a2430");
      let tableLabelSize = Math.min(15, Math.max(8, (radius * 2) / 6.5));
      let labelWidth = bodyBold.widthOfTextAtSize(label, tableLabelSize);
      const maxLabelW = (radius * 2 - 5) * 0.95;
      while (labelWidth > maxLabelW && tableLabelSize > 6) {
        tableLabelSize -= 0.5;
        labelWidth = bodyBold.widthOfTextAtSize(label, tableLabelSize);
      }
      page.drawText(label, {
        x: x - labelWidth / 2,
        y: y - tableLabelSize * 0.35,
        font: bodyBold,
        size: tableLabelSize,
        color: labelColor
      });
      continue;
    }
    if (item.type === "rect") {
      page.drawRectangle({
        x,
        y: y - item.height * scale,
        width: item.width * scale,
        height: item.height * scale,
        color: pickColor("rect"),
        borderWidth: Math.max(0.7, scale),
        borderColor: rgb(0.5, 0.57, 0.66)
      });
      continue;
    }
    if (item.type === "circle") {
      page.drawCircle({
        x,
        y,
        size: item.radius * scale,
        color: pickColor("circle"),
        borderWidth: Math.max(0.7, scale),
        borderColor: rgb(0.5, 0.57, 0.66)
      });
      continue;
    }
    page.drawText(item.text, {
      x,
      y,
      size: Math.max(7, Math.min(48, item.fontSize * scale)),
      font: bodyFont,
      color: pickColor("text"),
      maxWidth: Math.max(grid * 8, 160) * scale
    });
  }
  return pdf.save();
}

