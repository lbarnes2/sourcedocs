import { readFile } from "node:fs/promises";
import { embedRasterDataUrl } from "@/lib/pdf/imageFormat";
import path from "node:path";
import { PDFDocument, degrees, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { FloorplanCanvasObject, FloorplanDocument } from "@/types";
import { pdfPageDimensions } from "@/lib/paperSizes";
import { normalizeForCormorantLigatureSafe } from "@/lib/buffetMenu/cormorantNormalize";
import { hexToRgb } from "@/lib/pdf/color";
import type { PDFFont, PDFPage } from "pdf-lib";
import {
  DEFAULT_FILLS,
  OCCUPANCY_COLORS,
  OCCUPANCY_LABELS,
  OUTLINE_COLOR,
  TEXT_DEFAULT_COLOR,
  chairMetrics,
  estimateTextSize,
  fixedPointsPerUnit,
  ratioForScale,
  objectBox,
  objectsPrintBounds,
  occupancyStatus,
  printFit,
  printLayout,
  resolvePrintOptions,
  rotatePoint,
  seatOffsets,
  tableSeatCount,
  tableShape,
  type OccupancyStatus
} from "@/lib/floorplans/geometry";
import { planTotals } from "@/lib/floorplans/checks";
import { guestCountFor, naturalTableCompare, tableKey, type TableGuestMap } from "@/lib/floorplans/guests";

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
  const image = await embedRasterDataUrl(doc, logoDataUrl);
  if (!image) return;
  try {
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

export interface FloorplanRenderOptions {
  /** Guest list for the linked project; enables counts, occupancy colours and the guest list page. */
  tableGuests?: TableGuestMap | null;
}

type Rgb = ReturnType<typeof rgb>;

const FRAME_BORDER: Rgb = rgb(0.58, 0.64, 0.72);
const OUTLINE: Rgb = hexToRgb(OUTLINE_COLOR, "#8092a8");

/** Polygon through PDF-space points; pdf-lib's SVG path origin is y-flipped, so negate y. */
function drawPolygon(
  page: PDFPage,
  points: Array<{ x: number; y: number }>,
  style: { color?: Rgb; borderColor: Rgb; borderWidth: number }
) {
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(3)} ${(-p.y).toFixed(3)}`).join(" ") + " Z";
  page.drawSvgPath(d, { x: 0, y: 0, ...style });
}

function parseFill(value: string | undefined, fallbackHex: string): Rgb | null {
  if (value === "none") return null;
  return hexToRgb(value, fallbackHex);
}

/** Centre text in a box; shrinks to fit `maxWidth`. Returns the size used. */
function drawCentered(
  page: PDFPage,
  font: PDFFont,
  text: string,
  cx: number,
  baselineY: number,
  maxWidth: number,
  maxSize: number,
  minSize: number,
  color: Rgb
): number {
  const fit = fitTextSingleLine(font, text, Math.max(8, maxWidth), maxSize, minSize);
  const w = font.widthOfTextAtSize(fit.line, fit.size);
  page.drawText(fit.line, { x: cx - w / 2, y: baselineY, size: fit.size, font, color });
  return fit.size;
}

function drawLegend(
  page: PDFPage,
  fonts: { body: PDFFont; bold: PDFFont },
  layout: ReturnType<typeof printLayout>,
  opts: {
    summary: string;
    occupancyKey: boolean;
    scaleBar: { points: number; label: string } | null;
    scaleNote: string | null;
  }
) {
  const left = layout.margin + 14;
  const right = layout.width - layout.margin - 14;
  const base = layout.margin + layout.footerH / 2 - 3;
  page.drawLine({
    start: { x: layout.margin, y: layout.margin + layout.footerH },
    end: { x: layout.width - layout.margin, y: layout.margin + layout.footerH },
    thickness: 0.6,
    color: FRAME_BORDER
  });
  const textColor = rgb(0.2, 0.26, 0.33);
  page.drawText(opts.summary, { x: left, y: base, size: 9.5, font: fonts.bold, color: textColor });
  let cursor = left + fonts.bold.widthOfTextAtSize(opts.summary, 9.5) + 22;

  if (opts.occupancyKey) {
    (Object.keys(OCCUPANCY_COLORS) as Array<keyof typeof OCCUPANCY_COLORS>).forEach((status) => {
      page.drawRectangle({
        x: cursor,
        y: base - 1.5,
        width: 9,
        height: 9,
        color: hexToRgb(OCCUPANCY_COLORS[status], "#cccccc"),
        borderColor: OUTLINE,
        borderWidth: 0.5
      });
      const label = OCCUPANCY_LABELS[status];
      page.drawText(label, { x: cursor + 13, y: base, size: 8.5, font: fonts.body, color: textColor });
      cursor += 13 + fonts.body.widthOfTextAtSize(label, 8.5) + 12;
    });
  }

  let rightEdge = right;
  if (opts.scaleNote) {
    const noteW = fonts.bold.widthOfTextAtSize(opts.scaleNote, 8.5);
    page.drawText(opts.scaleNote, { x: right - noteW, y: base, size: 8.5, font: fonts.bold, color: textColor });
    rightEdge = right - noteW - 14;
  }

  if (opts.scaleBar) {
    const { points, label } = opts.scaleBar;
    const labelW = fonts.body.widthOfTextAtSize(label, 8.5);
    const x1 = rightEdge - labelW - 8;
    const x0 = x1 - points;
    const y = base + 3;
    page.drawLine({ start: { x: x0, y }, end: { x: x1, y }, thickness: 1.2, color: textColor });
    page.drawLine({ start: { x: x0, y: y - 3.5 }, end: { x: x0, y: y + 3.5 }, thickness: 1, color: textColor });
    page.drawLine({ start: { x: x1, y: y - 3.5 }, end: { x: x1, y: y + 3.5 }, thickness: 1, color: textColor });
    page.drawText(label, { x: x1 + 6, y: base, size: 8.5, font: fonts.body, color: textColor });
  }
}

const SCALE_BAR_STEPS_M = [0.5, 1, 2, 5, 10, 20, 50, 100];

function pickScaleBar(unitsPerMetre: number, scale: number): { points: number; label: string } | null {
  const pointsPerMetre = unitsPerMetre * scale;
  if (!Number.isFinite(pointsPerMetre) || pointsPerMetre <= 0) return null;
  let chosen: number | null = null;
  for (const metres of SCALE_BAR_STEPS_M) {
    if (metres * pointsPerMetre <= 150) chosen = metres;
  }
  if (chosen == null) chosen = SCALE_BAR_STEPS_M[0];
  return { points: chosen * pointsPerMetre, label: `${chosen} m` };
}

function drawGuestListPages(
  pdf: PDFDocument,
  fonts: { body: PDFFont; bold: PDFFont; title: PDFFont },
  doc: FloorplanDocument,
  guests: TableGuestMap,
  seatsByTable: Map<string, number>
) {
  const [width, height] = pdfPageDimensions(doc.canvas.paperSize, doc.canvas.orientation);
  const margin = 40;
  const gutter = 22;
  const columns = width > 1000 ? 4 : width > 700 ? 3 : 2;
  const colW = (width - margin * 2 - gutter * (columns - 1)) / columns;
  const top = height - margin - 38;
  const bottom = margin;
  const lineH = 11.5;
  const headingSize = 10.5;
  const nameSize = 8.5;

  const keys = Object.keys(guests).sort(naturalTableCompare);
  const heading = `${doc.metadata.title || doc.themeSnapshot.eventName || "Floorplan"} — guest list`;
  const title = normalizeForCormorantLigatureSafe(heading);

  let page: PDFPage | null = null;
  let column = 0;
  let y = top;

  const newPage = () => {
    page = pdf.addPage([width, height]);
    const fit = fitTextSingleLine(fonts.title, title, width - margin * 2, 22, 11);
    page.drawText(fit.line, { x: margin, y: height - margin - 14, size: fit.size, font: fonts.title, color: rgb(0.04, 0.18, 0.26) });
    page.drawLine({
      start: { x: margin, y: height - margin - 24 },
      end: { x: width - margin, y: height - margin - 24 },
      thickness: 0.8,
      color: FRAME_BORDER
    });
    column = 0;
    y = top;
  };
  const advance = () => {
    column += 1;
    if (column >= columns) newPage();
    else y = top;
  };
  newPage();

  for (const key of keys) {
    const info = guests[key];
    // Keep a heading with at least its first few guests.
    if (y - (lineH + 2 + Math.min(info.guests.length, 3) * lineH) < bottom) advance();
    const seats = seatsByTable.get(key);
    const headText = `Table ${key} · ${info.count}${seats != null ? `/${seats}` : ""}`;
    const x = margin + column * (colW + gutter);
    page!.drawText(headText, { x, y, size: headingSize, font: fonts.bold, color: rgb(0.04, 0.18, 0.26) });
    y -= lineH + 2;
    for (const guest of info.guests) {
      if (y < bottom) {
        advance();
        const cx = margin + column * (colW + gutter);
        page!.drawText(`Table ${key} (cont.)`, { x: cx, y, size: headingSize - 1, font: fonts.bold, color: rgb(0.4, 0.46, 0.54) });
        y -= lineH + 2;
      }
      const cx = margin + column * (colW + gutter);
      const name = fitTextSingleLine(fonts.body, guest.name || "—", colW, nameSize, 6.5);
      page!.drawText(name.line, { x: cx, y, size: nameSize, font: fonts.body, color: rgb(0.12, 0.16, 0.2) });
      if (guest.dietary) {
        const used = fonts.body.widthOfTextAtSize(name.line, name.size) + 5;
        const room = colW - used;
        if (room > 24) {
          const note = fitTextSingleLine(fonts.body, guest.dietary, room, 7, 5.5);
          page!.drawText(note.line, { x: cx + used, y: y + 0.4, size: note.size, font: fonts.body, color: rgb(0.7, 0.28, 0.2) });
        }
      }
      y -= lineH;
    }
    y -= 8;
  }
}

export async function renderFloorplanDocumentPdf(
  docInput: FloorplanDocument,
  renderOptions: FloorplanRenderOptions = {}
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fontBytes = await loadFontBytes();
  const bodyFont = await pdf.embedFont(fontBytes.body, { subset: true });
  const bodyBold = await pdf.embedFont(fontBytes.bodyBold, { subset: true });
  const titleFont = await pdf.embedFont(fontBytes.title, { subset: false });

  const print = resolvePrintOptions(docInput.print);
  const guests = renderOptions.tableGuests ?? null;
  const layout = printLayout(docInput.canvas.paperSize, docInput.canvas.orientation, print.legend);
  const { width, height, margin, bodyTop } = layout;
  const page = pdf.addPage([width, height]);
  const logoXInset = 24;
  const logoGap = 16;
  const logoWidth = 86;
  const titleBandMaxW = Math.max(100, width - 2 * (logoXInset + logoWidth + logoGap));
  const headerH = layout.headerH;

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
    borderColor: FRAME_BORDER,
    color: rgb(0.99, 0.995, 1)
  });

  const unitsPerMetre = docInput.canvas.unitsPerMetre && docInput.canvas.unitsPerMetre > 0 ? docInput.canvas.unitsPerMetre : null;
  const wantedScale = fixedPointsPerUnit(print.fixedScale, unitsPerMetre);
  const fit = printFit(objectsPrintBounds(docInput.objects), layout, wantedScale);
  const { scale, frame } = fit;
  const toX = (x: number) => layout.contentLeft + (x - frame.minX) * scale;
  const toY = (y: number) => layout.contentBottom + layout.contentHeight - (y - frame.minY) * scale;
  const strokeWidth = Math.max(0.7, Math.min(1.6, scale));
  const textColor = hexToRgb(docInput.themeSnapshot.textColor, "#1a2430");
  const seatsByTable = new Map<string, number>();

  for (const item of docInput.objects) {
    const box = objectBox(item);
    const cx = toX(box.cx);
    const cy = toY(box.cy);

    if (item.type === "table") {
      const seats = tableSeatCount(item);
      const key = tableKey(item.tableNumber);
      if (!seatsByTable.has(key)) seatsByTable.set(key, seats);
      const guestCount = guestCountFor(key, guests);

      const chair = chairMetrics(item);
      for (const off of seatOffsets(item)) {
        page.drawCircle({
          x: toX(item.x + off.x),
          y: toY(item.y + off.y),
          size: chair.radius * scale,
          color: rgb(0.83, 0.9, 0.95),
          borderWidth: Math.max(0.45, strokeWidth * 0.65),
          borderColor: rgb(0.5, 0.57, 0.66)
        });
      }

      const status: OccupancyStatus =
        print.colorByOccupancy && guestCount != null ? occupancyStatus(seats, guestCount) : "none";
      const fill = hexToRgb(
        item.fill ?? (status !== "none" ? OCCUPANCY_COLORS[status] : DEFAULT_FILLS.table),
        DEFAULT_FILLS.table
      );
      const style = { color: fill, borderColor: rgb(0.5, 0.57, 0.66), borderWidth: strokeWidth };
      if (tableShape(item) === "round") {
        page.drawCircle({ x: cx, y: cy, size: item.radius * scale, ...style });
      } else {
        const corners = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1]
        ].map(([sx, sy]) => {
          const p = rotatePoint({ x: (sx * box.w) / 2, y: (sy * box.h) / 2 }, box.rotation);
          return { x: toX(box.cx + p.x), y: toY(box.cy + p.y) };
        });
        drawPolygon(page, corners, style);
      }

      const customLabel = item.label?.trim();
      let label = customLabel || `Table ${item.tableNumber}`;
      const showCount = print.guestCounts && guestCount != null;
      const innerW = tableShape(item) === "round" ? box.w * scale : Math.min(box.w, box.h * 2.6) * scale;
      const mainMax = Math.min(15, Math.max(8, innerW / 6.5));
      const maxLabelW = (innerW - 5) * 0.95;
      // At small print scales "Table 12" can't fit legibly; the number alone still can.
      if (!customLabel && bodyBold.widthOfTextAtSize(label, 6) > maxLabelW) label = item.tableNumber;
      if (showCount) {
        const sub = `${guestCount}/${seats}`;
        const mainSize = fitTextSingleLine(bodyBold, label, maxLabelW, mainMax, 4.5).size;
        const subSize = Math.max(5.5, mainSize * 0.78);
        const total = mainSize + subSize * 1.15;
        drawCentered(page, bodyBold, label, cx, cy + total / 2 - mainSize * 0.78, maxLabelW, mainMax, 4.5, textColor);
        drawCentered(page, bodyFont, sub, cx, cy + total / 2 - mainSize - subSize * 0.95, maxLabelW, subSize, 5, textColor);
      } else {
        drawCentered(page, bodyBold, label, cx, cy - mainMax * 0.35, maxLabelW, mainMax, 4.5, textColor);
      }
      continue;
    }

    if (item.type === "rect" || item.type === "circle") {
      const fill = parseFill(item.fill, item.type === "rect" ? DEFAULT_FILLS.rect : DEFAULT_FILLS.circle);
      const style = { ...(fill ? { color: fill } : {}), borderColor: rgb(0.5, 0.57, 0.66), borderWidth: strokeWidth };
      if (item.type === "circle") {
        page.drawCircle({ x: cx, y: cy, size: item.radius * scale, ...style, ...(fill ? {} : { color: undefined }) });
      } else {
        const corners = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1]
        ].map(([sx, sy]) => {
          const p = rotatePoint({ x: (sx * box.w) / 2, y: (sy * box.h) / 2 }, box.rotation);
          return { x: toX(box.cx + p.x), y: toY(box.cy + p.y) };
        });
        drawPolygon(page, corners, style);
      }
      const label = item.label?.trim();
      if (label) {
        const sideways = Math.abs(Math.sin((box.rotation * Math.PI) / 180)) > 0.7;
        const usable = (sideways ? box.h : box.w) * scale;
        const tall = (sideways ? box.w : box.h) * scale;
        const maxSize = Math.max(7, Math.min(16, tall * 0.4));
        const size = fitTextSingleLine(bodyBold, label, usable - 6, maxSize, 5).size;
        drawCentered(page, bodyBold, label, cx, cy - size * 0.35, usable - 6, maxSize, 5, textColor);
      }
      continue;
    }

    // Text: rotates about the centre of its box.
    const size = Math.max(4, Math.min(120, item.fontSize * scale));
    const font = item.bold ? bodyBold : bodyFont;
    const color = hexToRgb(item.color, TEXT_DEFAULT_COLOR);
    const lines = (item.text || "").split("\n");
    const { w, h } = estimateTextSize(item);
    lines.forEach((line, index) => {
      if (!line) return;
      const local = rotatePoint({ x: -w / 2, y: -h / 2 + index * item.fontSize * 1.25 + item.fontSize * 0.98 }, box.rotation);
      page.drawText(line, {
        x: toX(box.cx + local.x),
        y: toY(box.cy + local.y),
        size,
        font,
        color,
        rotate: degrees(-box.rotation)
      });
    });
  }

  if (print.legend) {
    const totals = planTotals(docInput.objects, guests);
    const parts = [`${totals.tables} table${totals.tables === 1 ? "" : "s"}`, `${totals.seats} seats`];
    if (totals.guests != null) parts.push(`${totals.guests} guests`);
    let scaleNote: string | null = null;
    if (unitsPerMetre) {
      if (wantedScale != null && fit.fits) scaleNote = `1:${print.fixedScale}`;
      else {
        const approx = Math.round(ratioForScale(scale, unitsPerMetre) / 5) * 5 || 1;
        scaleNote = wantedScale != null ? `approx. 1:${approx} (too big for 1:${print.fixedScale})` : `approx. 1:${approx}`;
      }
    }
    drawLegend(page, { body: bodyFont, bold: bodyBold }, layout, {
      summary: parts.join("  ·  "),
      occupancyKey: print.colorByOccupancy && guests != null,
      scaleBar: print.scaleBar && unitsPerMetre ? pickScaleBar(unitsPerMetre, scale) : null,
      scaleNote: print.scaleBar || print.fixedScale ? scaleNote : null
    });
  }

  if (print.guestListPage && guests && Object.keys(guests).length) {
    drawGuestListPages(pdf, { body: bodyFont, bold: bodyBold, title: titleFont }, docInput, guests, seatsByTable);
  }

  return pdf.save();
}
