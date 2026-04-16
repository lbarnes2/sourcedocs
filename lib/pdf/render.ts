import { readFile } from "node:fs/promises";
import path from "node:path";
import { degrees, PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type {
  DocumentType,
  EventModel,
  MenuBookletSettings,
  PlaceCardSettings,
  TablePlanSettings,
  ThemeSettings
} from "@/types";
import { buildByPersonDocument } from "@/lib/docs/byPerson";
import { buildByTableDocument } from "@/lib/docs/byTable";
import { buildMenuBookletDocument } from "@/lib/docs/menuCards";
import { buildPlaceCardDocument, type PlaceCardData } from "@/lib/docs/placeCards";
import { buildServicePlanDocument } from "@/lib/docs/servicePlan";
import type { PDFFont } from "pdf-lib";

function mmToPt(mm: number): number {
  return (mm * 72) / 25.4;
}

/**
 * Place-card sheet layout measured from the Word-export PDF (card `re` rects + MediaBox).
 * Do not derive from mm margins — the export page is slightly taller than ISO A4 height in pt.
 */
const PLACE_CARD_STOCK = {
  pageWidthPt: 595.44,
  pageHeightPt: 846.24,
  /** Left column lower-left x (pt). */
  leftColXPt: 42,
  /** Right column lower-left x (pt). */
  rightColXPt: 312,
  cardWidthPt: 242,
  /** Visual top → bottom; PDF y is bottom-left of each card. */
  rowBottomPt: [683, 553, 423, 292, 162, 32] as const,
  /** Last row is 130 pt in the template; others 131 pt. */
  rowHeightPt: [131, 131, 131, 131, 131, 130] as const,
  /** Guest info panels per sheet (rows 2,4,6 × 2 columns); rows 1,3,5 are tent backs (logos). */
  frontSlotsPerPage: 6
} as const;

const LIB_FONTS = path.join(process.cwd(), "lib", "fonts");

/**
 * Body: Noto Sans (hinted TTF) — broad Latin / Greek / Cyrillic; use for all “must render” copy.
 * Titles: Cormorant Garamond VF (single stable source to avoid tofu from split webfont subsets).
 */
const PDF_FONT_SOURCES = {
  body: path.join(LIB_FONTS, "NotoSans-Regular.ttf"),
  bodyBold: path.join(LIB_FONTS, "NotoSans-Bold.ttf"),
  title: path.join(LIB_FONTS, "CormorantGaramond-wght.ttf")
} as const;

const CORMORANT_CHAR_REPLACEMENTS: Record<string, string> = {
  "’": "'",
  "‘": "'",
  "“": "\"",
  "”": "\"",
  "–": "-",
  "—": "-",
  "…": "...",
  "ß": "ss",
  "Æ": "AE",
  "æ": "ae",
  "Œ": "OE",
  "œ": "oe",
  "Ø": "O",
  "ø": "o",
  "Đ": "D",
  "đ": "d",
  "Ł": "L",
  "ł": "l",
  "Þ": "Th",
  "þ": "th"
};

function normalizeForCormorant(text: string): string {
  if (!text) return "";
  const remapped = Array.from(text)
    .map((char) => CORMORANT_CHAR_REPLACEMENTS[char] ?? char)
    .join("");
  return remapped.normalize("NFKD").replace(/\p{M}+/gu, "");
}

export type EmbeddedPdfFonts = {
  body: PDFFont;
  bodyBold: PDFFont;
  title: PDFFont;
  titleBold: PDFFont;
};

type PdfFontBytesCache = {
  body: Uint8Array;
  bodyBold: Uint8Array;
  title: Uint8Array;
};

let cachedPdfFontBytes: PdfFontBytesCache | null = null;

async function loadPdfFontBytes(): Promise<PdfFontBytesCache> {
  if (cachedPdfFontBytes) return cachedPdfFontBytes;
  const [body, bodyBold, cormorant] = await Promise.all([
    readFile(PDF_FONT_SOURCES.body),
    readFile(PDF_FONT_SOURCES.bodyBold),
    readFile(PDF_FONT_SOURCES.title)
  ]);
  cachedPdfFontBytes = { body, bodyBold, title: cormorant };
  return cachedPdfFontBytes;
}

async function createDocWithFonts(): Promise<{ doc: PDFDocument } & EmbeddedPdfFonts> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const bytes = await loadPdfFontBytes();
  const [body, bodyBold] = await Promise.all([
    doc.embedFont(bytes.body, { subset: true }),
    doc.embedFont(bytes.bodyBold, { subset: true })
  ]);
  const cormorant = await doc.embedFont(bytes.title, { subset: false });
  return { doc, body, bodyBold, title: cormorant, titleBold: cormorant };
}

function hexToRgb(hex: string) {
  const cleaned = hex.replace("#", "");
  const full = cleaned.length === 3 ? cleaned.split("").map((c) => c + c).join("") : cleaned;
  const value = parseInt(full, 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

function pageDimensions(settings: TablePlanSettings): [number, number] {
  const A4: [number, number] = [mmToPt(210), mmToPt(297)];
  const A3: [number, number] = [mmToPt(297), mmToPt(420)];
  const base = settings.paperSize === "A3" ? A3 : A4;
  if (settings.orientation === "landscape") return [base[1], base[0]];
  return base;
}

function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) return [items];
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

function resolveTablesPerSheet(settings: TablePlanSettings): number {
  if (settings.tablesPerSheetMode === "manual") {
    return Math.max(1, settings.tablesPerSheet);
  }

  if (settings.paperSize === "A3" && settings.orientation === "landscape") return 12;
  if (settings.paperSize === "A3") return 10;
  if (settings.orientation === "landscape") return 8;
  return 6;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function estimateGrid(tablesPerSheet: number, pageWidth: number, pageHeight: number) {
  const margin = 24;
  const gap = 12;
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2 - 26;
  const approxCols = Math.max(
    1,
    Math.round(Math.sqrt((tablesPerSheet * usableWidth) / Math.max(1, usableHeight)))
  );
  const cols = clamp(approxCols, 1, tablesPerSheet);
  const rows = Math.ceil(tablesPerSheet / cols);
  const boxWidth = (usableWidth - (cols - 1) * gap) / cols;
  const boxHeight = (usableHeight - (rows - 1) * gap) / rows;
  return { margin, gap, cols, rows, boxWidth, boxHeight };
}

function pickAdaptiveTablesPerSheet(
  tableGuestCounts: number[],
  settings: TablePlanSettings,
  pageWidth: number,
  pageHeight: number
) {
  if (settings.tablesPerSheetMode === "manual") {
    return Math.max(1, settings.tablesPerSheet);
  }

  const maxPreset = resolveTablesPerSheet(settings);
  const maxGuests = Math.max(1, ...tableGuestCounts);
  for (let candidate = maxPreset; candidate >= 1; candidate -= 1) {
    const grid = estimateGrid(candidate, pageWidth, pageHeight);
    const headerHeight = 28;
    const innerPad = 10;
    const available = grid.boxHeight - headerHeight - innerPad * 2;
    const lineHeight = available / maxGuests;
    const estimatedFontSize = lineHeight * 0.78;
    if (estimatedFontSize >= settings.minFontSizePt) {
      return candidate;
    }
  }
  return 1;
}

function wrapTextToWidth(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = words[0];

  for (let index = 1; index < words.length; index += 1) {
    const candidate = `${current} ${words[index]}`;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[index];
    }
  }

  lines.push(current);
  return lines;
}

function truncateToWidth(text: string, font: PDFFont, fontSize: number, maxWidth: number): string {
  if (!text || maxWidth <= 0) return "";
  if (font.widthOfTextAtSize(text, fontSize) <= maxWidth) return text;
  const ell = "…";
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = text.slice(0, mid) + ell;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return text.slice(0, low) + ell;
}

function wrapTextToWidthClamped(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const wrapped = wrapTextToWidth(text, font, fontSize, maxWidth);
  return wrapped.map((line) => truncateToWidth(line, font, fontSize, maxWidth));
}

function drawPseudoBoldText(
  page: import("pdf-lib").PDFPage,
  text: string,
  options: {
    x: number;
    y: number;
    font: PDFFont;
    size: number;
    color?: ReturnType<typeof rgb>;
    maxWidth?: number;
  }
) {
  page.drawText(text, options);
  page.drawText(text, { ...options, x: options.x + 0.22 });
}

type PlaceCardLine = { text: string; fontRef: PDFFont; size: number; color: ReturnType<typeof rgb> };

function placeCardLinesHeight(lines: PlaceCardLine[], lineGap: number): number {
  if (lines.length === 0) return 0;
  return lines.reduce((sum, line) => sum + line.size + lineGap, 0) - lineGap;
}

function buildPlaceCardLines(options: {
  card: PlaceCardData;
  theme: ThemeSettings;
  nameSize: number;
  detailSize: number;
  nameColor: ReturnType<typeof rgb>;
  subtitleColor: ReturnType<typeof rgb>;
  mutedGrey: ReturnType<typeof rgb>;
  dietaryColor: ReturnType<typeof rgb>;
  maxTextW: number;
  font: PDFFont;
  bold: PDFFont;
}): PlaceCardLine[] {
  const {
    card,
    theme,
    nameSize,
    detailSize,
    nameColor,
    subtitleColor,
    mutedGrey,
    dietaryColor,
    maxTextW,
    font,
    bold
  } = options;
  const bodyColor = rgb(0.1, 0.12, 0.17);
  const flatLines: PlaceCardLine[] = [];

  wrapTextToWidthClamped(card.name, bold, nameSize, maxTextW).forEach((line) => {
    flatLines.push({ text: line, fontRef: bold, size: nameSize, color: nameColor });
  });

  if (theme.eventSubtitle?.trim()) {
    wrapTextToWidthClamped(theme.eventSubtitle.trim(), font, detailSize, maxTextW).forEach((line) => {
      flatLines.push({ text: line, fontRef: font, size: detailSize, color: subtitleColor });
    });
  }

  wrapTextToWidthClamped(`Table ${card.tableNumber}`, font, detailSize, maxTextW).forEach((line) => {
    flatLines.push({ text: line, fontRef: font, size: detailSize, color: mutedGrey });
  });

  if (card.courses.starter) {
    wrapTextToWidthClamped(`Starter: ${card.courses.starter}`, font, detailSize, maxTextW).forEach((line) => {
      flatLines.push({ text: line, fontRef: font, size: detailSize, color: bodyColor });
    });
  }
  if (card.courses.main) {
    wrapTextToWidthClamped(`Main: ${card.courses.main}`, font, detailSize, maxTextW).forEach((line) => {
      flatLines.push({ text: line, fontRef: font, size: detailSize, color: bodyColor });
    });
  }
  if (card.courses.dessert) {
    wrapTextToWidthClamped(`Dessert: ${card.courses.dessert}`, font, detailSize, maxTextW).forEach((line) => {
      flatLines.push({ text: line, fontRef: font, size: detailSize, color: bodyColor });
    });
  }

  if (card.dietary.length) {
    wrapTextToWidthClamped(card.dietary.join(", "), bold, detailSize, maxTextW).forEach((line) => {
      flatLines.push({ text: line, fontRef: bold, size: detailSize, color: dietaryColor });
    });
  }

  return flatLines;
}

async function embedLogoFromDataUrl(
  doc: PDFDocument,
  page: import("pdf-lib").PDFPage,
  logoDataUrl: string | undefined,
  options?: {
    x?: number;
    y?: number;
    width?: number;
    centerY?: number;
    rotate?: ReturnType<typeof degrees>;
  }
) {
  if (!logoDataUrl) return;
  const split = logoDataUrl.split(",");
  if (split.length !== 2) return;
  const mime = split[0];
  const bytes = Uint8Array.from(Buffer.from(split[1], "base64"));
  try {
    const image = mime.includes("png") ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const width = options?.width ?? 80;
    const height = (image.height / image.width) * width;
    const x = options?.x ?? page.getWidth() - width - 30;
    const y = options?.centerY != null ? options.centerY - height / 2 : options?.y ?? page.getHeight() - height - 20;
    page.drawImage(image, {
      x,
      y,
      width,
      height,
      rotate: options?.rotate ?? degrees(0)
    });
  } catch {
    // Ignore invalid image data and continue rendering text output.
  }
}

async function embedLogoIfPresent(
  doc: PDFDocument,
  page: import("pdf-lib").PDFPage,
  theme: ThemeSettings,
  options?: {
    x?: number;
    y?: number;
    width?: number;
  }
) {
  await embedLogoFromDataUrl(doc, page, theme.clientLogoDataUrl || theme.venueLogoDataUrl, options);
}

export async function renderTablePlanByTablePdf(
  model: EventModel,
  settings: TablePlanSettings,
  theme: ThemeSettings
): Promise<Uint8Array> {
  const { doc, body: font, bodyBold: bold, title, titleBold } = await createDocWithFonts();
  const [width, height] = pageDimensions(settings);
  const titleColor = hexToRgb(theme.primaryColor || "#012f43");
  const data = buildByTableDocument(model);
  const tablesPerSheet = pickAdaptiveTablesPerSheet(
    data.tables.map((table) => table.guests.length),
    settings,
    width,
    height
  );
  const pages = chunk(data.tables, tablesPerSheet);
  const headerBandHeight = 96;
  const grid = estimateGrid(tablesPerSheet, width, height - headerBandHeight);
  const contentTopOffset = headerBandHeight;
  const safeSideWidth = 104;
  const logoWidth = 68;
  const accentColor = hexToRgb(theme.accentColor || "#acc1cb");

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const tables = pages[pageIndex];
    const page = doc.addPage([width, height]);
    // Protected header band: title and logos live here, table boxes start below.
    page.drawRectangle({
      x: 0,
      y: height - headerBandHeight,
      width,
      height: headerBandHeight,
      color: rgb(1, 1, 1)
    });

    const eventTitle = normalizeForCormorant(theme.eventName || "Event");
    const maxTitleWidth = Math.max(100, width - safeSideWidth * 2 - 20);
    let titleSize = 30;
    let titleLines = wrapTextToWidth(eventTitle, title, titleSize, maxTitleWidth);
    while (titleLines.length > 2 && titleSize > 18) {
      titleSize -= 1;
      titleLines = wrapTextToWidth(eventTitle, title, titleSize, maxTitleWidth);
    }
    const titleLineHeight = titleSize + 3;
    const titleBlockHeight = titleLines.length * titleLineHeight;
    let titleY = height - 16 - titleSize - (2 - Math.min(2, titleLines.length)) * 4;
    if (titleBlockHeight > 44) {
      titleY -= (titleBlockHeight - 44) / 2;
    }
    const titleCenterY = titleY - ((Math.min(2, titleLines.length) - 1) * titleLineHeight) / 2 + titleSize * 0.35;
    titleLines.slice(0, 2).forEach((line, lineIndex) => {
      const lineWidth = title.widthOfTextAtSize(line, titleSize);
      page.drawText(line, {
        x: (width - lineWidth) / 2,
        y: titleY - lineIndex * titleLineHeight,
        font: title,
        size: titleSize,
        color: titleColor
      });
    });

    tables.forEach((table, idx) => {
      const row = Math.floor(idx / grid.cols);
      const col = idx % grid.cols;
      const x = grid.margin + col * (grid.boxWidth + grid.gap);
      const topY =
        height -
        contentTopOffset -
        grid.margin -
        row * (grid.boxHeight + grid.gap);
      const y = topY - grid.boxHeight;
      const headerHeight = 28;
      const innerPad = 10;

      page.drawRectangle({
        x: x + 1.6,
        y: y - 1.8,
        width: grid.boxWidth,
        height: grid.boxHeight,
        color: rgb(0.88, 0.9, 0.95),
        opacity: 0.55
      });
      page.drawRectangle({
        x,
        y,
        width: grid.boxWidth,
        height: grid.boxHeight,
        borderColor: rgb(0.79, 0.82, 0.9),
        borderWidth: 0.8,
        color: rgb(0.99, 0.995, 1)
      });
      page.drawRectangle({
        x,
        y: y + grid.boxHeight - headerHeight,
        width: grid.boxWidth,
        height: headerHeight,
        color: accentColor,
        borderColor: rgb(0.79, 0.82, 0.9),
        borderWidth: 0.8
      });

      const tableLabel = `Table ${table.tableNumber}`;
      const tableLabelSize = 12;
      const titleWidth = bold.widthOfTextAtSize(tableLabel, tableLabelSize);
      page.drawText(tableLabel, {
        x: x + (grid.boxWidth - titleWidth) / 2,
        y: y + grid.boxHeight - headerHeight + 8,
        font: bold,
        size: tableLabelSize,
        color: rgb(1, 1, 1)
      });

      const maxNames = Math.max(1, table.guests.length);
      const available = grid.boxHeight - headerHeight - innerPad * 2;
      const lineHeight = available / maxNames;
      const nameSize = clamp(lineHeight * 0.8, settings.minFontSizePt, 12);
      let cursorY = y + grid.boxHeight - headerHeight - innerPad - nameSize;

      table.guests.forEach((guestName) => {
        page.drawText(guestName, {
          x: x + innerPad,
          y: cursorY,
          font,
          size: nameSize,
          maxWidth: grid.boxWidth - innerPad * 2
        });
        cursorY -= lineHeight;
      });
    });

    await embedLogoFromDataUrl(doc, page, theme.clientLogoDataUrl, {
      x: 24,
      centerY: titleCenterY,
      width: logoWidth
    });
    await embedLogoFromDataUrl(doc, page, theme.venueLogoDataUrl, {
      x: width - 24 - logoWidth,
      centerY: titleCenterY,
      width: logoWidth
    });
  }
  return doc.save();
}

export async function renderTablePlanByPersonPdf(
  model: EventModel,
  settings: TablePlanSettings,
  theme: ThemeSettings
): Promise<Uint8Array> {
  const { doc, body: font, bodyBold: bold, title, titleBold } = await createDocWithFonts();
  const [width, height] = pageDimensions(settings);
  const headerBandHeight = 96;
  const tableMargin = 24;
  const tableTopGap = 16;
  const tableBottomMargin = 20;
  const usableTableHeight =
    height - headerBandHeight - tableTopGap - tableBottomMargin;
  const rowHeight = 20;
  const headerRowHeight = 24;
  const rowsPerPage = Math.max(
    12,
    Math.floor((usableTableHeight - headerRowHeight) / rowHeight)
  );
  const people = buildByPersonDocument(model).people;
  const pages = chunk(people, rowsPerPage);
  const titleColor = hexToRgb(theme.primaryColor || "#012f43");
  const accentColor = hexToRgb(theme.accentColor || "#acc1cb");
  const safeSideWidth = 104;
  const logoWidth = 68;
  const tableX = Math.round(tableMargin);
  const tableYTop = Math.round(height - headerBandHeight - tableTopGap);
  const tableWidth = Math.round(width - tableMargin * 2);
  const tableHeight = Math.round(usableTableHeight);
  const tableRight = tableX + tableWidth;
  const tableColSplit = Math.round(tableX + tableWidth * 0.78);
  const gridColor = rgb(0.72, 0.76, 0.84);
  const borderColor = rgb(0.65, 0.7, 0.8);

  for (let index = 0; index < pages.length; index += 1) {
    const peoplePage = pages[index];
    const page = doc.addPage([width, height]);

    page.drawRectangle({
      x: 0,
      y: height - headerBandHeight,
      width,
      height: headerBandHeight,
      color: rgb(1, 1, 1)
    });

    const eventTitle = normalizeForCormorant(theme.eventName || "Event");
    const maxTitleWidth = Math.max(100, width - safeSideWidth * 2 - 20);
    let titleSize = 30;
    let titleLines = wrapTextToWidth(eventTitle, title, titleSize, maxTitleWidth);
    while (titleLines.length > 2 && titleSize > 18) {
      titleSize -= 1;
      titleLines = wrapTextToWidth(eventTitle, title, titleSize, maxTitleWidth);
    }
    const titleLineHeight = titleSize + 3;
    const titleBlockHeight = titleLines.length * titleLineHeight;
    let titleY = height - 16 - titleSize - (2 - Math.min(2, titleLines.length)) * 4;
    if (titleBlockHeight > 44) {
      titleY -= (titleBlockHeight - 44) / 2;
    }
    const titleCenterY = titleY - ((Math.min(2, titleLines.length) - 1) * titleLineHeight) / 2 + titleSize * 0.35;
    titleLines.slice(0, 2).forEach((line, lineIndex) => {
      const lineWidth = title.widthOfTextAtSize(line, titleSize);
      page.drawText(line, {
        x: (width - lineWidth) / 2,
        y: titleY - lineIndex * titleLineHeight,
        font: title,
        size: titleSize,
        color: titleColor
      });
    });

    await embedLogoFromDataUrl(doc, page, theme.clientLogoDataUrl, {
      x: 24,
      centerY: titleCenterY,
      width: logoWidth
    });
    await embedLogoFromDataUrl(doc, page, theme.venueLogoDataUrl, {
      x: width - 24 - logoWidth,
      centerY: titleCenterY,
      width: logoWidth
    });

    const tableBottom = Math.round(tableYTop - tableHeight);
    page.drawRectangle({
      x: tableX,
      y: tableBottom,
      width: tableWidth,
      height: tableHeight,
      color: rgb(1, 1, 1)
    });

    page.drawRectangle({
      x: tableX,
      y: Math.round(tableYTop - headerRowHeight),
      width: tableWidth,
      height: headerRowHeight,
      color: accentColor
    });

    page.drawText("Guest Name", {
      x: tableX + 10,
      y: tableYTop - 16,
      font: bold,
      size: 11,
      color: rgb(1, 1, 1)
    });
    page.drawText("Table", {
      x: tableColSplit + 10,
      y: tableYTop - 16,
      font: bold,
      size: 11,
      color: rgb(1, 1, 1)
    });

    const bodyTop = Math.round(tableYTop - headerRowHeight);
    const rowH = rowHeight;
    const stripeFill = rgb(0.96, 0.97, 0.99);

    peoplePage.forEach((person, rowIndex) => {
      const rowBottom = Math.round(bodyTop - (rowIndex + 1) * rowH);
      if (rowIndex % 2 === 1) {
        const leftStripeW = tableColSplit - tableX;
        page.drawRectangle({
          x: tableX,
          y: rowBottom,
          width: leftStripeW,
          height: rowH,
          color: stripeFill,
          borderWidth: 0
        });
        page.drawRectangle({
          x: tableColSplit,
          y: rowBottom,
          width: tableRight - tableColSplit,
          height: rowH,
          color: stripeFill,
          borderWidth: 0
        });
      }

      page.drawText(person.name, {
        x: tableX + 10,
        y: rowBottom + 6,
        font,
        size: 10.5,
        maxWidth: tableColSplit - tableX - 16
      });
      page.drawText(`Table ${person.tableNumber}`, {
        x: tableColSplit + 10,
        y: rowBottom + 6,
        font: bold,
        size: 10.5,
        color: titleColor
      });
    });

    const rowCount = peoplePage.length;
    const horizontalLineYs = new Set<number>();
    for (let k = 0; k <= rowCount; k += 1) {
      horizontalLineYs.add(Math.round(bodyTop - k * rowH));
    }
    horizontalLineYs.add(Math.round(tableBottom));
    horizontalLineYs.forEach((lineY) => {
      if (lineY < tableBottom || lineY > bodyTop) return;
      page.drawLine({
        start: { x: tableX, y: lineY },
        end: { x: tableRight, y: lineY },
        thickness: 1,
        color: gridColor
      });
    });

    page.drawLine({
      start: { x: tableColSplit, y: tableBottom },
      end: { x: tableColSplit, y: bodyTop },
      thickness: 1,
      color: gridColor
    });

    page.drawLine({
      start: { x: tableX, y: tableBottom },
      end: { x: tableRight, y: tableBottom },
      thickness: 1,
      color: borderColor
    });
    page.drawLine({
      start: { x: tableX, y: tableYTop },
      end: { x: tableRight, y: tableYTop },
      thickness: 1,
      color: borderColor
    });
    page.drawLine({
      start: { x: tableX, y: tableBottom },
      end: { x: tableX, y: tableYTop },
      thickness: 1,
      color: borderColor
    });
    page.drawLine({
      start: { x: tableRight, y: tableBottom },
      end: { x: tableRight, y: tableYTop },
      thickness: 1,
      color: borderColor
    });
  }

  return doc.save();
}

export async function renderPlaceCardsPdf(
  model: EventModel,
  settings: PlaceCardSettings,
  theme: ThemeSettings
): Promise<Uint8Array> {
  const { doc, body: font, bodyBold: bold, title, titleBold } = await createDocWithFonts();
  const pageWidth = PLACE_CARD_STOCK.pageWidthPt;
  const pageHeight = PLACE_CARD_STOCK.pageHeightPt;
  const cardWidth = PLACE_CARD_STOCK.cardWidthPt;
  const calibrationX = mmToPt(settings.textOffsetXmm);
  const calibrationY = mmToPt(settings.textOffsetYmm);
  const cards = buildPlaceCardDocument(model);

  const borderInset = 4;
  const innerPadH = 5;
  const innerPadV = 5;
  const safeEdge = Math.max(mmToPt(settings.safeMarginMm), 2);

  const primary = hexToRgb(theme.primaryColor || "#012f43");
  const accent = hexToRgb(theme.accentColor || "#acc1cb");
  const nameColor = hexToRgb(theme.textColor || "#595959");
  const subtitleColor = accent;
  const mutedGrey = rgb(0.5, 0.52, 0.55);
  const dietaryColor = rgb(0.1, 0.12, 0.17);

  const cardsPerPage = PLACE_CARD_STOCK.frontSlotsPerPage;
  const detailSizeBase = clamp(10 * settings.fontScale, 9, 10);

  const batches = chunk(cards, cardsPerPage);
  for (const batch of batches) {
    const page = doc.addPage([pageWidth, pageHeight]);
    for (let row = 0; row < 6; row += 1) {
      const cardHeight = PLACE_CARD_STOCK.rowHeightPt[row];
      const y = Math.round(PLACE_CARD_STOCK.rowBottomPt[row]);
      const isBackRow = row % 2 === 0;

      for (let col = 0; col < 2; col += 1) {
        const x = Math.round(col === 0 ? PLACE_CARD_STOCK.leftColXPt : PLACE_CARD_STOCK.rightColXPt);

        page.drawRectangle({
          x,
          y,
          width: cardWidth,
          height: cardHeight,
          color: rgb(1, 1, 1),
          borderColor: primary,
          borderWidth: 2
        });
        page.drawRectangle({
          x: x + borderInset,
          y: y + borderInset,
          width: cardWidth - 2 * borderInset,
          height: cardHeight - 2 * borderInset,
          borderColor: accent,
          borderWidth: 1.1
        });

        const panelCenterX = x + cardWidth / 2 + calibrationX;

        if (isBackRow) {
          const logoCenterX = x + cardWidth / 2;
          const logoCenterY = y + cardHeight / 2;
          const logoData = theme.clientLogoDataUrl;
          if (logoData) {
            const split = logoData.split(",");
            if (split.length === 2) {
              const mime = split[0];
              const bytes = Uint8Array.from(Buffer.from(split[1], "base64"));
              try {
                const image = mime.includes("png") ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
                const maxW = cardWidth - 2 * borderInset - 2 * innerPadH;
                const maxH = cardHeight - 2 * borderInset - 2 * innerPadV;
                const cap = Math.min(maxW, maxH, mmToPt(42));
                let logoW = cap;
                let logoH = (image.height / image.width) * logoW;
                if (logoH > cap) {
                  logoH = cap;
                  logoW = (image.width / image.height) * logoH;
                }
                page.drawImage(image, {
                  x: logoCenterX + logoW / 2,
                  y: logoCenterY + logoH / 2,
                  width: logoW,
                  height: logoH,
                  rotate: degrees(180)
                });
              } catch {
                // skip invalid logo
              }
            }
          }
          continue;
        }

        const guestIndex = Math.floor((row - 1) / 2) * 2 + col;
        const card = batch[guestIndex];
        if (!card) continue;

        const textLeft = x + borderInset + innerPadH + safeEdge;
        const textRight = x + cardWidth - borderInset - innerPadH - safeEdge;
        const textBottom = y + borderInset + innerPadV + safeEdge;
        const textTop = y + cardHeight - borderInset - innerPadV - safeEdge;
        const maxTextW = Math.max(40, textRight - textLeft);
        const innerH = textTop - textBottom;

        const maxNameStart = Math.min(18 * settings.fontScale, 20);
        let chosenLines: PlaceCardLine[] = [];
        let chosenGap = 3;

        outer: for (let d = Math.floor(detailSizeBase); d >= 8; d -= 1) {
          for (let g = 4; g >= 1; g -= 1) {
            for (let ns = Math.floor(maxNameStart); ns >= 6; ns -= 1) {
              const lines = buildPlaceCardLines({
                card,
                theme,
                nameSize: ns,
                detailSize: d,
                nameColor,
                subtitleColor,
                mutedGrey,
                dietaryColor,
                maxTextW,
                font,
                bold
              });
              if (placeCardLinesHeight(lines, g) <= innerH) {
                chosenLines = lines;
                chosenGap = g;
                break outer;
              }
            }
          }
        }

        if (chosenLines.length === 0) {
          chosenLines = buildPlaceCardLines({
            card,
            theme,
            nameSize: 7,
            detailSize: 8,
            nameColor,
            subtitleColor,
            mutedGrey,
            dietaryColor,
            maxTextW,
            font,
            bold
          });
          chosenGap = 1;
        }

        while (chosenLines.length > 0 && placeCardLinesHeight(chosenLines, chosenGap) > innerH) {
          if (chosenLines.length > 1) {
            chosenLines = chosenLines.slice(0, -1);
          } else {
            chosenLines[0].text = truncateToWidth(
              chosenLines[0].text,
              chosenLines[0].fontRef,
              chosenLines[0].size,
              maxTextW
            );
            break;
          }
        }

        const totalBlockHeight = placeCardLinesHeight(chosenLines, chosenGap);
        let cursorY = textTop - (innerH - totalBlockHeight) / 2 + calibrationY * 0.08;
        chosenLines.forEach((line) => {
          const w = line.fontRef.widthOfTextAtSize(line.text, line.size);
          const drawX = clamp(panelCenterX - w / 2, textLeft, Math.max(textLeft, textRight - w));
          page.drawText(line.text, {
            x: drawX,
            y: cursorY,
            font: line.fontRef,
            size: line.size,
            color: line.color
          });
          cursorY -= line.size + chosenGap;
        });
      }
    }
  }

  return doc.save();
}

export async function renderMenuBookletPdf(
  model: EventModel,
  settings: MenuBookletSettings,
  theme: ThemeSettings,
  menuLongNames: Record<string, string> = {}
): Promise<Uint8Array> {
  const { doc, body: font, bodyBold: bold, title, titleBold } = await createDocWithFonts();
  const pageWidth = mmToPt(297);
  const pageHeight = mmToPt(210);
  const halfW = pageWidth / 2;
  const foldGutter = 6;
  const outerMargin = 14;
  const primary = hexToRgb(theme.primaryColor || "#012f43");
  const accent = hexToRgb(theme.accentColor || "#acc1cb");
  const menu = buildMenuBookletDocument(model, menuLongNames);
  const white = rgb(1, 1, 1);

  const drawFancyBorder = (
    page: import("pdf-lib").PDFPage,
    options: { x: number; y: number; width: number; height: number; primaryColor: ReturnType<typeof rgb>; accentColor: ReturnType<typeof rgb> }
  ) => {
    page.drawRectangle({
      x: options.x,
      y: options.y,
      width: options.width,
      height: options.height,
      borderColor: options.primaryColor,
      borderWidth: 1.8
    });
    page.drawRectangle({
      x: options.x + 8,
      y: options.y + 8,
      width: options.width - 16,
      height: options.height - 16,
      borderColor: options.accentColor,
      borderWidth: 1.2
    });
  };

  const drawFancyBorderOnDark = (
    page: import("pdf-lib").PDFPage,
    options: { x: number; y: number; width: number; height: number }
  ) => {
    page.drawRectangle({
      x: options.x,
      y: options.y,
      width: options.width,
      height: options.height,
      borderColor: white,
      borderWidth: 1.6
    });
    page.drawRectangle({
      x: options.x + 8,
      y: options.y + 8,
      width: options.width - 16,
      height: options.height - 16,
      borderColor: accent,
      borderWidth: 1.1
    });
  };

  const drawCenteredInPanel = (
    page: import("pdf-lib").PDFPage,
    text: string,
    y: number,
    fontRef: PDFFont,
    size: number,
    color: ReturnType<typeof rgb>,
    panelLeft: number,
    panelWidth: number,
    opacity = 1,
    pseudoBold = false
  ) => {
    const textWidth = fontRef.widthOfTextAtSize(text, size);
    const x = panelLeft + (panelWidth - textWidth) / 2;
    if (pseudoBold) {
      drawPseudoBoldText(page, text, {
        x,
        y,
        font: fontRef,
        size,
        color
      });
      return;
    }
    page.drawText(text, { x, y, font: fontRef, size, color, opacity });
  };

  const leftPanelX = outerMargin;
  const leftPanelW = halfW - outerMargin - foldGutter / 2;
  const rightPanelX = halfW + foldGutter / 2;
  const rightPanelW = halfW - outerMargin - foldGutter / 2;
  const panelY = outerMargin;
  const panelH = pageHeight - outerMargin * 2;

  // --- Sheet 1: [ Back cover | Front cover ] ---
  const sheet1 = doc.addPage([pageWidth, pageHeight]);
  sheet1.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: rgb(1, 1, 1) });

  // Left half: back cover
  drawFancyBorder(sheet1, {
    x: leftPanelX,
    y: panelY,
    width: leftPanelW,
    height: panelH,
    primaryColor: primary,
    accentColor: accent
  });
  const venueLogoW = 118;
  await embedLogoFromDataUrl(doc, sheet1, theme.venueLogoDataUrl, {
    width: venueLogoW,
    x: leftPanelX + (leftPanelW - venueLogoW) / 2,
    y: pageHeight / 2 + 18
  });
  drawCenteredInPanel(sheet1, "0117 428 4000", pageHeight / 2 - 6, bold, 16, primary, leftPanelX, leftPanelW);
  drawCenteredInPanel(
    sheet1,
    "bristol.ac.uk/venues | bristol.ac.uk/catering",
    pageHeight / 2 - 32,
    font,
    11,
    rgb(0.23, 0.27, 0.35),
    leftPanelX,
    leftPanelW
  );

  // Right half: front cover (solid primary, white text)
  sheet1.drawRectangle({
    x: rightPanelX,
    y: panelY,
    width: rightPanelW,
    height: panelH,
    color: primary
  });
  drawFancyBorderOnDark(sheet1, {
    x: rightPanelX,
    y: panelY,
    width: rightPanelW,
    height: panelH
  });
  const clientLogoW = 88;
  await embedLogoFromDataUrl(doc, sheet1, theme.clientLogoDataUrl, {
    width: clientLogoW,
    x: rightPanelX + (rightPanelW - clientLogoW) / 2,
    y: pageHeight - panelY - clientLogoW - 18
  });
  const titleMaxW = rightPanelW - 36;
  const titleToDateGap = 52;
  const logoImgBottomY = pageHeight - panelY - clientLogoW - 18;
  const titleTopMaxY = logoImgBottomY - 12;
  const panelCenterY = panelY + panelH / 2;
  const minTextBottomY = panelY + 32;
  let titleFontSize = 26;
  const coverTitle = normalizeForCormorant(theme.eventName || "Event");
  let titleLines = wrapTextToWidth(coverTitle, title, titleFontSize, titleMaxW);
  let titleLineHeight = titleFontSize + 5;
  const minTitleFont = 16;
  const hasEventDate = Boolean(theme.eventDate?.trim());
  const fitTitleBlock = (): { firstTitleBaseline: number; dateBaseline: number } => {
    while (titleFontSize >= minTitleFont) {
      titleLines = wrapTextToWidth(coverTitle, title, titleFontSize, titleMaxW);
      titleLineHeight = titleFontSize + 5;
      const n = Math.max(1, titleLines.length);
      let dateBaseline: number;
      let firstTitleBaseline: number;
      if (hasEventDate) {
        dateBaseline =
          (2 * panelCenterY - titleToDateGap - (n - 1) * titleLineHeight) / 2;
        const lastTitleBaseline = dateBaseline + titleToDateGap;
        firstTitleBaseline = lastTitleBaseline + (n - 1) * titleLineHeight;
      } else {
        const lastTitleBaseline = panelCenterY - ((n - 1) * titleLineHeight) / 2;
        firstTitleBaseline = lastTitleBaseline + (n - 1) * titleLineHeight;
        dateBaseline = panelY;
      }
      const fitsLogo = firstTitleBaseline <= titleTopMaxY;
      const fitsBottom = !hasEventDate || dateBaseline >= minTextBottomY;
      if (fitsLogo && fitsBottom) return { firstTitleBaseline, dateBaseline };
      titleFontSize -= 1;
    }
    titleLines = wrapTextToWidth(coverTitle, title, titleFontSize, titleMaxW);
    titleLineHeight = titleFontSize + 5;
    const n = Math.max(1, titleLines.length);
    let dateBaseline: number;
    let firstTitleBaseline: number;
    if (hasEventDate) {
      dateBaseline =
        (2 * panelCenterY - titleToDateGap - (n - 1) * titleLineHeight) / 2;
      const lastTitleBaseline = dateBaseline + titleToDateGap;
      firstTitleBaseline = lastTitleBaseline + (n - 1) * titleLineHeight;
    } else {
      const lastTitleBaseline = panelCenterY - ((n - 1) * titleLineHeight) / 2;
      firstTitleBaseline = lastTitleBaseline + (n - 1) * titleLineHeight;
      dateBaseline = panelY;
    }
    return { firstTitleBaseline, dateBaseline };
  };
  const { firstTitleBaseline, dateBaseline } = fitTitleBlock();
  titleLines.forEach((line, index) => {
    drawCenteredInPanel(
      sheet1,
      line,
      firstTitleBaseline - index * titleLineHeight,
      title,
      titleFontSize,
      white,
      rightPanelX,
      rightPanelW
    );
  });
  if (theme.eventDate?.trim()) {
    drawCenteredInPanel(
      sheet1,
      normalizeForCormorant(theme.eventDate.trim()),
      dateBaseline,
      title,
      14,
      white,
      rightPanelX,
      rightPanelW,
      0.62
    );
  }

  // --- Sheet 2: [ Inside page 1 (border) | Inside page 2 (menu) ] ---
  const sheet2 = doc.addPage([pageWidth, pageHeight]);
  sheet2.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: rgb(1, 1, 1) });

  drawFancyBorder(sheet2, {
    x: leftPanelX,
    y: panelY,
    width: leftPanelW,
    height: panelH,
    primaryColor: primary,
    accentColor: accent
  });

  drawFancyBorder(sheet2, {
    x: rightPanelX,
    y: panelY,
    width: rightPanelW,
    height: panelH,
    primaryColor: primary,
    accentColor: accent
  });
  type MenuSection = { heading: string; lines: string[] };
  const sections: MenuSection[] = [];
  if (menu.starters.length) sections.push({ heading: "Starter", lines: menu.starters });
  if (menu.mains.length) sections.push({ heading: "Main Course", lines: menu.mains });
  if (menu.desserts.length) sections.push({ heading: "Dessert", lines: menu.desserts });

  const innerPad = 18;
  const innerLeft = rightPanelX + innerPad;
  const innerW = rightPanelW - innerPad * 2;
  const innerBottom = panelY + innerPad;
  const innerTop = panelY + panelH - innerPad;
  const innerHeight = innerTop - innerBottom;

  const headingSize = settings.headingFontPt + 2;
  const bodySize = settings.bodyFontPt;
  const lineGap = settings.lineHeight;
  const sectionGapAfterHeading = 10;
  const gapAfterLines = 10;
  const dividerPad = 22;
  const dividerTrailing = 32;

  const measureSectionBlock = (section: MenuSection, isLast: boolean): number => {
    let h = headingSize + sectionGapAfterHeading;
    section.lines.forEach((line) => {
      const wrapped = wrapTextToWidth(line, font, bodySize, innerW - 8);
      h += wrapped.length * lineGap;
    });
    h += gapAfterLines;
    if (!isLast) h += dividerTrailing;
    return h;
  };

  let totalMenuHeight = 0;
  sections.forEach((section, index) => {
    totalMenuHeight += measureSectionBlock(section, index === sections.length - 1);
  });

  let cursorY = innerTop - (innerHeight - totalMenuHeight) / 2;

  sections.forEach((section, sectionIndex) => {
    drawCenteredInPanel(
      sheet2,
      normalizeForCormorant(section.heading),
      cursorY,
      titleBold,
      headingSize,
      primary,
      innerLeft,
      innerW,
      1,
      true
    );
    cursorY -= headingSize + sectionGapAfterHeading;
    section.lines.forEach((line) => {
      const wrapped = wrapTextToWidth(line, font, bodySize, innerW - 8);
      wrapped.forEach((wrappedLine) => {
        drawCenteredInPanel(
          sheet2,
          wrappedLine,
          cursorY,
          font,
          bodySize,
          rgb(0.12, 0.14, 0.2),
          innerLeft,
          innerW
        );
        cursorY -= lineGap;
      });
    });
    cursorY -= gapAfterLines;
    if (sectionIndex < sections.length - 1) {
      sheet2.drawLine({
        start: { x: innerLeft + dividerPad, y: cursorY },
        end: { x: innerLeft + innerW - dividerPad, y: cursorY },
        thickness: 1,
        color: accent
      });
      cursorY -= dividerTrailing;
    }
  });

  return doc.save();
}

export async function renderServicePlanPdf(model: EventModel, theme: ThemeSettings): Promise<Uint8Array> {
  const { doc, body: font, bodyBold: bold, title, titleBold } = await createDocWithFonts();
  const width = mmToPt(297);
  const height = mmToPt(210);
  const data = buildServicePlanDocument(model);
  const serviceCourseLabel =
    data.serviceCourse.slice(0, 1).toUpperCase() + data.serviceCourse.slice(1);
  let page = doc.addPage([width, height]);
  let y = height - 28;

  drawPseudoBoldText(page, normalizeForCormorant(`${theme.eventName} - Service Plan`), {
    x: 22,
    y,
    font: titleBold,
    size: 18,
    color: hexToRgb(theme.primaryColor || "#012f43")
  });
  y -= 24;

  const ensureSpace = (required: number) => {
    if (y - required > 20) return;
    page = doc.addPage([width, height]);
    y = height - 28;
  };

  data.tables.forEach((table) => {
    ensureSpace(40);
    drawPseudoBoldText(page, normalizeForCormorant(`Table ${table.tableNumber}`), {
      x: 24,
      y,
      font: titleBold,
      size: 13
    });
    y -= 16;
    table.groupedByMain.forEach((group) => {
      ensureSpace(24 + group.guests.length * 12);
      page.drawText(`${serviceCourseLabel}: ${group.dish}`, { x: 34, y, font: bold, size: 11 });
      y -= 12;
      group.guests.forEach((guest) => {
        const dietary = guest.dietary.length ? ` [${guest.dietary.join(", ")}]` : "";
        page.drawText(`- ${guest.name}${dietary}`, {
          x: 46,
          y,
          font,
          size: 10,
          color: guest.dietary.length ? rgb(0.66, 0.2, 0.06) : rgb(0.1, 0.12, 0.17),
          maxWidth: width - 60
        });
        y -= 11;
      });
      y -= 4;
    });
    ensureSpace(26);
    page.drawText(
      `Dish totals: ${table.dishCounts.map((count) => `${count.dish} (${count.count})`).join(", ")}`,
      { x: 34, y, font, size: 10, maxWidth: width - 50 }
    );
    y -= 18;
  });

  await embedLogoIfPresent(doc, doc.getPages()[0], theme);
  return doc.save();
}

export async function renderDocumentPdf(
  documentType: DocumentType,
  model: EventModel,
  options: {
    tablePlan: TablePlanSettings;
    placeCard: PlaceCardSettings;
    menuBooklet: MenuBookletSettings;
    theme: ThemeSettings;
    menuLongNames?: Record<string, string>;
  }
): Promise<Uint8Array> {
  if (documentType === "tablePlanByTable") {
    return renderTablePlanByTablePdf(model, options.tablePlan, options.theme);
  }
  if (documentType === "tablePlanByPerson") {
    return renderTablePlanByPersonPdf(model, options.tablePlan, options.theme);
  }
  if (documentType === "placeCards") {
    return renderPlaceCardsPdf(model, options.placeCard, options.theme);
  }
  if (documentType === "menuBooklet") {
    return renderMenuBookletPdf(
      model,
      options.menuBooklet,
      options.theme,
      options.menuLongNames ?? {}
    );
  }
  return renderServicePlanPdf(model, options.theme);
}
