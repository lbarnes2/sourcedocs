import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { FloorplanCanvasObject, FloorplanDocument } from "@/types";
import { pdfPageDimensions } from "@/lib/paperSizes";
import { normalizeForCormorantLigatureSafe } from "@/lib/buffetMenu/cormorantNormalize";
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
  title: path.join(LIB_FONTS, "CormorantGaramond-wght.ttf")
} as const;

let cachedFontBytes: { body: Uint8Array; title: Uint8Array } | null = null;

async function loadFontBytes() {
  if (cachedFontBytes) return cachedFontBytes;
  const [body, title] = await Promise.all([readFile(PDF_FONT_SOURCES.body), readFile(PDF_FONT_SOURCES.title)]);
  cachedFontBytes = { body, title };
  return cachedFontBytes;
}

function wrapTextToWidth(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = words[0];
  for (let index = 1; index < words.length; index += 1) {
    const candidate = `${current} ${words[index]}`;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) current = candidate;
    else {
      lines.push(current);
      current = words[index];
    }
  }
  lines.push(current);
  return lines;
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
    return {
      minX: item.x - item.radius,
      minY: item.y - item.radius,
      maxX: item.x + item.radius,
      maxY: item.y + item.radius
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
  const titleFont = await pdf.embedFont(fonts.title, { subset: false });
  const [width, height] = pdfPageDimensions(docInput.canvas.paperSize, docInput.canvas.orientation);
  const page = pdf.addPage([width, height]);
  const margin = 28;
  const headerH = 96;
  const bodyTop = height - headerH - margin;
  const grid = docInput.canvas.gridSize || 24;
  const safeSideWidth = 104;
  const logoWidth = 68;

  page.drawRectangle({ x: 0, y: height - headerH, width, height: headerH, color: rgb(1, 1, 1) });
  const titleText = normalizeForCormorantLigatureSafe(
    docInput.metadata.title || docInput.themeSnapshot.eventName || "Floorplan"
  );
  let titleSize = 30;
  const titleMaxW = Math.max(100, width - safeSideWidth * 2 - 20);
  let titleLines = wrapTextToWidth(titleText, titleFont, titleSize, titleMaxW);
  while (titleLines.length > 2 && titleSize > 18) {
    titleSize -= 1;
    titleLines = wrapTextToWidth(titleText, titleFont, titleSize, titleMaxW);
  }
  const lineHeight = titleSize + 3;
  const titleBlockHeight = titleLines.length * lineHeight;
  let startY = height - 16 - titleSize - (2 - Math.min(2, titleLines.length)) * 4;
  if (titleBlockHeight > 44) {
    startY -= (titleBlockHeight - 44) / 2;
  }
  const titleCenterY = startY - ((Math.min(2, titleLines.length) - 1) * lineHeight) / 2 + titleSize * 0.35;
  titleLines.slice(0, 2).forEach((line, index) => {
    const lineWidth = titleFont.widthOfTextAtSize(line, titleSize);
    page.drawText(line, {
      x: (width - lineWidth) / 2,
      y: startY - index * lineHeight,
      size: titleSize,
      font: titleFont,
      color: rgb(0.04, 0.18, 0.26)
    });
  });

  if (docInput.metadata.subtitle || docInput.themeSnapshot.eventSubtitle) {
    const subtitle = (docInput.metadata.subtitle || docInput.themeSnapshot.eventSubtitle || "").trim();
    if (subtitle) {
      const subtitleSize = 11;
      const subtitleMaxW = Math.max(100, width - safeSideWidth * 2 - 20);
      const line = wrapTextToWidth(subtitle, bodyFont, subtitleSize, subtitleMaxW)[0] ?? "";
      const subtitleWidth = bodyFont.widthOfTextAtSize(line, subtitleSize);
      const subtitleY = Math.max(height - headerH + 10, startY - Math.min(2, titleLines.length) * lineHeight - 6);
      page.drawText(line, {
        x: (width - subtitleWidth) / 2,
        y: subtitleY,
        size: subtitleSize,
        font: bodyFont,
        color: rgb(0.26, 0.33, 0.4)
      });
    }
  }
  await embedLogoFromDataUrl(pdf, page, docInput.themeSnapshot.clientLogoDataUrl, {
    x: 24,
    centerY: titleCenterY,
    width: logoWidth
  });
  await embedLogoFromDataUrl(pdf, page, docInput.themeSnapshot.venueLogoDataUrl, {
    x: width - 24 - logoWidth,
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

  const contentLeft = margin + 10;
  const contentBottom = margin + 10;
  const contentWidth = width - (margin + 10) * 2;
  const contentHeight = bodyTop - (margin + 10) - contentBottom;
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
      page.drawText(`Table ${item.tableNumber}`, {
        x: x - radius + Math.max(3, 4 * scale),
        y: y - Math.max(4, 4 * scale),
        size: Math.max(7, Math.min(13, 8 * scale)),
        font: bodyFont,
        color: rgb(0.11, 0.15, 0.2)
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

