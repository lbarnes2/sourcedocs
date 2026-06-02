import { readFile } from "node:fs/promises";
import path from "node:path";
import { degrees, PDFDocument, rgb } from "pdf-lib";
import { pdfPageDimensions } from "@/lib/paperSizes";
import { hexToRgb } from "@/lib/pdf/color";
import fontkit from "@pdf-lib/fontkit";
import type {
  DishMenuDuplicateGroup,
  DocumentType,
  EventModel,
  FloorplanSettings,
  MenuBookletSettings,
  PlaceCardSettings,
  TablePlanSettings,
  ThemeSettings
} from "@/types";
import { buildFloorplanPlacedCells } from "@/lib/docs/floorplanLayout";
import { sortedTableNumbers } from "@/lib/event/model";
import { buildByPersonDocument } from "@/lib/docs/byPerson";
import { buildByTableDocument } from "@/lib/docs/byTable";
import { buildMenuBookletDocument } from "@/lib/docs/menuCards";
import { buildPlaceCardDocument, type PlaceCardData } from "@/lib/docs/placeCards";
import { buildServicePlanDocument, SERVICE_COURSE_LABEL } from "@/lib/docs/servicePlan";
import { normalizeForCormorantLigatureSafe } from "@/lib/buffetMenu/cormorantNormalize";
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

function pageDimensions(settings: Pick<TablePlanSettings, "paperSize" | "orientation">): [number, number] {
  return pdfPageDimensions(settings.paperSize, settings.orientation);
}

function floorplanCellWidth(usableW: number, cols: number, gap: number, staggered: boolean): number {
  if (!staggered || cols <= 1) {
    return (usableW - (cols - 1) * gap) / cols;
  }
  /** Odd rows offset by (w+gap)/2; solve so rightmost cell stays within usable width. */
  return (usableW - gap * (cols - 0.5)) / (cols + 0.5);
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

  if (settings.paperSize === "16:9" && settings.orientation === "landscape") return 10;
  if (settings.paperSize === "16:9") return 8;
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
  const titleColor = hexToRgb(theme.primaryColor, "#012f43");
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
  const accentColor = hexToRgb(theme.accentColor, "#acc1cb");

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

    const eventTitle = normalizeForCormorantLigatureSafe(theme.eventName || "Event");
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
  const rowsPerColumn = Math.max(
    12,
    Math.floor((usableTableHeight - headerRowHeight) / rowHeight)
  );
  const people = buildByPersonDocument(model).people;
  const isLandscape = settings.orientation === "landscape";
  const columns = isLandscape ? 2 : 1;
  const rowsPerPage = rowsPerColumn * columns;
  const pages = chunk(people, rowsPerPage);
  const titleColor = hexToRgb(theme.primaryColor, "#012f43");
  const accentColor = hexToRgb(theme.accentColor, "#acc1cb");
  const safeSideWidth = 104;
  const logoWidth = 68;
  const tableX = Math.round(tableMargin);
  const tableYTop = Math.round(height - headerBandHeight - tableTopGap);
  const tableWidth = Math.round(width - tableMargin * 2);
  const tableHeight = Math.round(usableTableHeight);
  const tableRight = tableX + tableWidth;
  const tableColSplitFull = Math.round(tableX + tableWidth * 0.78);
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

    const eventTitle = normalizeForCormorantLigatureSafe(theme.eventName || "Event");
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
    const bodyTop = Math.round(tableYTop - headerRowHeight);
    const rowH = rowHeight;
    const stripeFill = rgb(0.96, 0.97, 0.99);
    const columnGap = isLandscape ? 18 : 0;
    const singleTableWidth = isLandscape ? Math.round((tableWidth - columnGap) / 2) : tableWidth;

    for (let col = 0; col < columns; col += 1) {
      const colPeople = peoplePage.slice(col * rowsPerColumn, (col + 1) * rowsPerColumn);
      if (!colPeople.length) continue;
      const colX = isLandscape ? tableX + col * (singleTableWidth + columnGap) : tableX;
      const colRight = colX + singleTableWidth;
      const tableColSplit = Math.round(colX + singleTableWidth * 0.78);

      page.drawRectangle({
        x: colX,
        y: tableBottom,
        width: singleTableWidth,
        height: tableHeight,
        color: rgb(1, 1, 1)
      });

      page.drawRectangle({
        x: colX,
        y: Math.round(tableYTop - headerRowHeight),
        width: singleTableWidth,
        height: headerRowHeight,
        color: accentColor
      });

      page.drawText("Guest Name", {
        x: colX + 10,
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

      colPeople.forEach((person, rowIndex) => {
        const rowBottom = Math.round(bodyTop - (rowIndex + 1) * rowH);
        if (rowIndex % 2 === 1) {
          const leftStripeW = tableColSplit - colX;
          page.drawRectangle({
            x: colX,
            y: rowBottom,
            width: leftStripeW,
            height: rowH,
            color: stripeFill,
            borderWidth: 0
          });
          page.drawRectangle({
            x: tableColSplit,
            y: rowBottom,
            width: colRight - tableColSplit,
            height: rowH,
            color: stripeFill,
            borderWidth: 0
          });
        }

        page.drawText(person.name, {
          x: colX + 10,
          y: rowBottom + 6,
          font,
          size: 10.5,
          maxWidth: tableColSplit - colX - 16
        });
        page.drawText(`Table ${person.tableNumber}`, {
          x: tableColSplit + 10,
          y: rowBottom + 6,
          font: bold,
          size: 10.5,
          color: titleColor
        });
      });

      const rowCount = colPeople.length;
      const horizontalLineYs = new Set<number>();
      for (let k = 0; k <= rowCount; k += 1) {
        horizontalLineYs.add(Math.round(bodyTop - k * rowH));
      }
      horizontalLineYs.add(Math.round(tableBottom));
      horizontalLineYs.forEach((lineY) => {
        if (lineY < tableBottom || lineY > bodyTop) return;
        page.drawLine({
          start: { x: colX, y: lineY },
          end: { x: colRight, y: lineY },
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
        start: { x: colX, y: tableBottom },
        end: { x: colRight, y: tableBottom },
        thickness: 1,
        color: borderColor
      });
      page.drawLine({
        start: { x: colX, y: tableYTop },
        end: { x: colRight, y: tableYTop },
        thickness: 1,
        color: borderColor
      });
    }
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

  /** Inset from physical stock / cut line so borders print safely inside the panel (tent stock). */
  const placeCardCutLineInsetPt = mmToPt(3);
  const innerFrameGapPt = 4;
  const borderInset = placeCardCutLineInsetPt + innerFrameGapPt;
  const innerPadH = 5;
  const innerPadV = 5;
  /** Smaller bottom pad so the text block can sit a touch closer to the bottom border. */
  const innerPadVBottom = 2;
  const safeEdge = Math.max(mmToPt(settings.safeMarginMm), 2);

  const primary = hexToRgb(theme.primaryColor, "#012f43");
  const accent = hexToRgb(theme.accentColor, "#acc1cb");
  const nameColor = hexToRgb(theme.textColor, "#595959");
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
          x: x + placeCardCutLineInsetPt,
          y: y + placeCardCutLineInsetPt,
          width: cardWidth - 2 * placeCardCutLineInsetPt,
          height: cardHeight - 2 * placeCardCutLineInsetPt,
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
        const textBottom = y + borderInset + innerPadVBottom + safeEdge;
        const textTop = y + cardHeight - borderInset - innerPadV - safeEdge;
        const maxTextW = Math.max(40, textRight - textLeft);
        const innerH = textTop - textBottom;

        // Shrink the whole block together (name + every detail line) rather than
        // collapsing only the name. Both sizes are derived from a single scale so
        // the name keeps its relative prominence even on dense cards (table +
        // starter + main + dessert + wrapping dietary).
        const nameStart = Math.min(18 * settings.fontScale, 20);
        const detailStart = detailSizeBase;
        const minNameSize = 6;
        const minDetailSize = 6;
        let chosenLines: PlaceCardLine[] = [];
        let chosenGap = 3;

        outer: for (let scalePct = 100; scalePct >= 36; scalePct -= 2) {
          const scale = scalePct / 100;
          const ns = Math.max(minNameSize, Math.round(nameStart * scale));
          const ds = Math.max(minDetailSize, Math.round(detailStart * scale));
          for (let g = 4; g >= 1; g -= 1) {
            const lines = buildPlaceCardLines({
              card,
              theme,
              nameSize: ns,
              detailSize: ds,
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

        if (chosenLines.length === 0) {
          chosenLines = buildPlaceCardLines({
            card,
            theme,
            nameSize: minNameSize,
            detailSize: minDetailSize,
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
  menuLongNames: Record<string, string> = {},
  dishMenuDuplicateGroups: DishMenuDuplicateGroup[] = []
): Promise<Uint8Array> {
  const { doc, body: font, bodyBold: bold, title, titleBold } = await createDocWithFonts();
  const pageWidth = mmToPt(297);
  const pageHeight = mmToPt(210);
  const halfW = pageWidth / 2;
  const foldGutter = 6;
  const outerMargin = 14;
  /** Gap between primary outer stroke and accent inner stroke (pt). */
  const borderInsetOuter = 8;
  /** Pull both outer and inner frames in from the panel edge at the center fold (pt). */
  const borderInsetExtraTowardFold = 10;
  const primary = hexToRgb(theme.primaryColor, "#012f43");
  const accent = hexToRgb(theme.accentColor, "#acc1cb");
  const menu = buildMenuBookletDocument(model, menuLongNames, dishMenuDuplicateGroups);
  const white = rgb(1, 1, 1);

  type MenuHalfSide = "left" | "right";

  type BorderRect = { x: number; y: number; width: number; height: number };

  /** Primary (outer) border frame: same fold inset as before, now explicit for both strokes. */
  const outerBorderFrame = (
    x: number,
    y: number,
    width: number,
    height: number,
    side: MenuHalfSide
  ): BorderRect => {
    const fold = borderInsetExtraTowardFold;
    if (side === "left") {
      return { x, y, width: width - fold, height };
    }
    return { x: x + fold, y, width: width - fold, height };
  };

  /** Accent (inner) border: uniform inset from the outer frame. */
  const innerBorderFromOuter = (outer: BorderRect): BorderRect => {
    const p = borderInsetOuter;
    return {
      x: outer.x + p,
      y: outer.y + p,
      width: outer.width - 2 * p,
      height: outer.height - 2 * p
    };
  };

  const drawFancyBorder = (
    page: import("pdf-lib").PDFPage,
    options: {
      x: number;
      y: number;
      width: number;
      height: number;
      primaryColor: ReturnType<typeof rgb>;
      accentColor: ReturnType<typeof rgb>;
      halfSide: MenuHalfSide;
    }
  ) => {
    const outer = outerBorderFrame(options.x, options.y, options.width, options.height, options.halfSide);
    page.drawRectangle({
      x: outer.x,
      y: outer.y,
      width: outer.width,
      height: outer.height,
      borderColor: options.primaryColor,
      borderWidth: 1.8
    });
    const inner = innerBorderFromOuter(outer);
    page.drawRectangle({
      x: inner.x,
      y: inner.y,
      width: inner.width,
      height: inner.height,
      borderColor: options.accentColor,
      borderWidth: 1.2
    });
  };

  const drawFancyBorderOnDark = (
    page: import("pdf-lib").PDFPage,
    options: { x: number; y: number; width: number; height: number; halfSide: MenuHalfSide }
  ) => {
    const outer = outerBorderFrame(options.x, options.y, options.width, options.height, options.halfSide);
    page.drawRectangle({
      x: outer.x,
      y: outer.y,
      width: outer.width,
      height: outer.height,
      borderColor: white,
      borderWidth: 1.6
    });
    const inner = innerBorderFromOuter(outer);
    page.drawRectangle({
      x: inner.x,
      y: inner.y,
      width: inner.width,
      height: inner.height,
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

  /** Inset toward fold — use for cover content + menu text so it lines up with the border frames. */
  const leftCoverOuter = outerBorderFrame(leftPanelX, panelY, leftPanelW, panelH, "left");
  const rightCoverOuter = outerBorderFrame(rightPanelX, panelY, rightPanelW, panelH, "right");

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
    accentColor: accent,
    halfSide: "left"
  });
  const venueLogoW = 118;
  await embedLogoFromDataUrl(doc, sheet1, theme.venueLogoDataUrl, {
    width: venueLogoW,
    x: leftCoverOuter.x + (leftCoverOuter.width - venueLogoW) / 2,
    y: pageHeight / 2 + 18
  });
  drawCenteredInPanel(sheet1, "0117 428 4000", pageHeight / 2 - 6, bold, 16, primary, leftCoverOuter.x, leftCoverOuter.width);
  drawCenteredInPanel(
    sheet1,
    "bristol.ac.uk/venues | bristol.ac.uk/catering",
    pageHeight / 2 - 32,
    font,
    11,
    rgb(0.23, 0.27, 0.35),
    leftCoverOuter.x,
    leftCoverOuter.width
  );

  // Right half: front cover (solid primary, white text)
  sheet1.drawRectangle({
    x: rightCoverOuter.x,
    y: rightCoverOuter.y,
    width: rightCoverOuter.width,
    height: rightCoverOuter.height,
    color: primary
  });
  drawFancyBorderOnDark(sheet1, {
    x: rightPanelX,
    y: panelY,
    width: rightPanelW,
    height: panelH,
    halfSide: "right"
  });
  const clientLogoW = 88;
  await embedLogoFromDataUrl(doc, sheet1, theme.clientLogoDataUrl, {
    width: clientLogoW,
    x: rightCoverOuter.x + (rightCoverOuter.width - clientLogoW) / 2,
    y: pageHeight - panelY - clientLogoW - 18
  });
  const titleMaxW = rightCoverOuter.width - 36;
  const titleToDateGap = 52;
  const logoImgBottomY = pageHeight - panelY - clientLogoW - 18;
  const titleTopMaxY = logoImgBottomY - 12;
  const panelCenterY = panelY + panelH / 2;
  const minTextBottomY = panelY + 32;
  let titleFontSize = 26;
  const coverTitle = normalizeForCormorantLigatureSafe(theme.eventName || "Event");
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
      rightCoverOuter.x,
      rightCoverOuter.width
    );
  });
  if (theme.eventDate?.trim()) {
    drawCenteredInPanel(
      sheet1,
      normalizeForCormorantLigatureSafe(theme.eventDate.trim()),
      dateBaseline,
      title,
      14,
      white,
      rightCoverOuter.x,
      rightCoverOuter.width,
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
    accentColor: accent,
    halfSide: "left"
  });

  drawFancyBorder(sheet2, {
    x: rightPanelX,
    y: panelY,
    width: rightPanelW,
    height: panelH,
    primaryColor: primary,
    accentColor: accent,
    halfSide: "right"
  });
  type MenuSection = { heading: string; lines: string[] };
  const sections: MenuSection[] = [];
  if (menu.starters.length) sections.push({ heading: "Starter", lines: menu.starters });
  if (menu.mains.length) sections.push({ heading: "Main Course", lines: menu.mains });
  if (menu.desserts.length) sections.push({ heading: "Dessert", lines: menu.desserts });

  const innerPad = 18;
  const innerLeft = rightCoverOuter.x + innerPad;
  const innerW = rightCoverOuter.width - innerPad * 2;
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
  const hasCoreCourses = sections.length > 0;

  const wrapAddonText = (rawText?: string): string[] => {
    const text = (rawText ?? "").trim();
    if (!text) return [];
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => wrapTextToWidth(line, font, bodySize, innerW - 8));
  };
  const preMealLines = wrapAddonText(settings.preMealText);
  const postMealLines = wrapAddonText(settings.postMealText);

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
  const measureAddonBlock = (lines: string[]): number => lines.length * lineGap + gapAfterLines;

  let totalMenuHeight = 0;
  if (preMealLines.length) {
    totalMenuHeight += measureAddonBlock(preMealLines);
    if (hasCoreCourses) totalMenuHeight += dividerTrailing;
  }
  sections.forEach((section, index) => {
    totalMenuHeight += measureSectionBlock(section, index === sections.length - 1);
  });
  if (postMealLines.length) {
    if (hasCoreCourses) totalMenuHeight += dividerTrailing;
    totalMenuHeight += measureAddonBlock(postMealLines);
  }

  let cursorY = innerTop - (innerHeight - totalMenuHeight) / 2;

  if (preMealLines.length) {
    preMealLines.forEach((line) => {
      drawCenteredInPanel(
        sheet2,
        line,
        cursorY,
        font,
        bodySize,
        rgb(0.12, 0.14, 0.2),
        innerLeft,
        innerW
      );
      cursorY -= lineGap;
    });
    cursorY -= gapAfterLines;
    if (hasCoreCourses) {
      sheet2.drawLine({
        start: { x: innerLeft + dividerPad, y: cursorY },
        end: { x: innerLeft + innerW - dividerPad, y: cursorY },
        thickness: 1,
        color: accent
      });
      cursorY -= dividerTrailing;
    }
  }

  sections.forEach((section, sectionIndex) => {
    drawCenteredInPanel(
      sheet2,
      normalizeForCormorantLigatureSafe(section.heading),
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

  if (postMealLines.length) {
    if (hasCoreCourses) {
      sheet2.drawLine({
        start: { x: innerLeft + dividerPad, y: cursorY },
        end: { x: innerLeft + innerW - dividerPad, y: cursorY },
        thickness: 1,
        color: accent
      });
      cursorY -= dividerTrailing;
    }
    postMealLines.forEach((line) => {
      drawCenteredInPanel(
        sheet2,
        line,
        cursorY,
        font,
        bodySize,
        rgb(0.12, 0.14, 0.2),
        innerLeft,
        innerW
      );
      cursorY -= lineGap;
    });
    cursorY -= gapAfterLines;
  }

  return doc.save();
}

export async function renderServicePlanPdf(model: EventModel, theme: ThemeSettings): Promise<Uint8Array> {
  const { doc, body: font, bodyBold: bold, title, titleBold } = await createDocWithFonts();
  // Kitchen copy: always portrait A4 for clipboard use.
  const width = mmToPt(210);
  const height = mmToPt(297);
  const data = buildServicePlanDocument(model);
  const coursesSubtitle = data.coursesOnPlan.map((key) => SERVICE_COURSE_LABEL[key]).join(" · ");
  let page = doc.addPage([width, height]);
  let y = height - 28;

  drawPseudoBoldText(page, normalizeForCormorantLigatureSafe(`${theme.eventName} - Service Plan`), {
    x: 22,
    y,
    font: titleBold,
    size: 17,
    color: hexToRgb(theme.primaryColor, "#012f43")
  });
  y -= 21;
  page.drawText(`Courses: ${coursesSubtitle}`, {
    x: 24,
    y,
    font: bold,
    size: 11,
    color: rgb(0.1, 0.12, 0.17)
  });
  y -= 16;

  const ensureSpace = (required: number) => {
    if (y - required > 20) return;
    page = doc.addPage([width, height]);
    y = height - 28;
  };

  const drawCourseCheckboxes = (x: number, topY: number) => {
    const size = 9;
    const gap = 7;
    (["Starter", "Main", "Dessert"] as const).forEach((label, index) => {
      const itemX = x + index * 62;
      page.drawRectangle({
        x: itemX,
        y: topY - size,
        width: size,
        height: size,
        borderWidth: 1,
        borderColor: rgb(0.45, 0.5, 0.58)
      });
      page.drawText(label, {
        x: itemX + size + gap,
        y: topY - size,
        font,
        size: 9.5,
        color: rgb(0.16, 0.2, 0.26)
      });
    });
  };

  const drawScribbleArea = (x: number, topY: number, boxWidth: number, boxHeight: number) => {
    page.drawRectangle({
      x,
      y: topY - boxHeight,
      width: boxWidth,
      height: boxHeight,
      borderColor: rgb(0.78, 0.81, 0.88),
      borderWidth: 1
    });
    page.drawText("Notes", {
      x: x + 6,
      y: topY - 12,
      font: bold,
      size: 9,
      color: rgb(0.36, 0.41, 0.5)
    });
    let lineY = topY - 22;
    while (lineY > topY - boxHeight + 10) {
      page.drawLine({
        start: { x: x + 6, y: lineY },
        end: { x: x + boxWidth - 6, y: lineY },
        thickness: 0.6,
        color: rgb(0.9, 0.91, 0.95)
      });
      lineY -= 12;
    }
  };

  data.tables.forEach((table) => {
    const pax =
      table.courseBlocks[0]?.groupedByDish.reduce((sum, group) => sum + group.guests.length, 0) ?? 0;
    const outerX = 18;
    const outerW = width - 36;
    const leftX = 24;
    const splitX = width - 170;
    const notesW = width - splitX - 24;
    const guestLines = table.courseBlocks.reduce((sum, block) => {
      const dishLines = block.groupedByDish.reduce((acc, group) => acc + 1 + group.guests.length, 0);
      return sum + 1 + 1 + dishLines + 1;
    }, 0);
    const leftContentH = 46 + guestLines * 10 + 12;
    const rowHeight = Math.max(120, leftContentH);
    ensureSpace(rowHeight + 8);
    const rowTop = y;
    const rowBottom = y - rowHeight;
    const headerY = rowTop - 14;
    const headerDividerY = rowTop - 20;
    const bodyStartY = rowTop - 36;

    page.drawRectangle({
      x: outerX,
      y: rowBottom,
      width: outerW,
      height: rowHeight,
      borderWidth: 1.1,
      borderColor: rgb(0.74, 0.78, 0.86)
    });
    page.drawLine({
      start: { x: splitX - 8, y: rowBottom + 8 },
      end: { x: splitX - 8, y: rowTop - 8 },
      thickness: 0.8,
      color: rgb(0.83, 0.86, 0.92)
    });
    page.drawLine({
      start: { x: outerX + 1, y: headerDividerY },
      end: { x: splitX - 10, y: headerDividerY },
      thickness: 0.8,
      color: rgb(0.86, 0.88, 0.93)
    });

    page.drawText(`Table ${table.tableNumber}`, {
      x: leftX,
      y: headerY,
      font: bold,
      size: 13,
      color: rgb(0.11, 0.13, 0.18)
    });
    page.drawText(`PAX: ${pax}`, {
      x: leftX + 102,
      y: headerY,
      font: bold,
      size: 10,
      color: rgb(0.16, 0.2, 0.26)
    });
    drawCourseCheckboxes(leftX + 150, headerY + 9);

    let localY = bodyStartY;
    table.courseBlocks.forEach((block) => {
      page.drawText(block.label, {
        x: leftX,
        y: localY,
        font: bold,
        size: 10.5,
        color: rgb(0.11, 0.13, 0.18)
      });
      localY -= 11;
      page.drawText(
        `Dish totals: ${block.dishCounts.map((entry) => `${entry.dish} (${entry.count})`).join(", ")}`,
        {
          x: leftX,
          y: localY,
          font,
          size: 9.3,
          color: rgb(0.33, 0.37, 0.45),
          maxWidth: splitX - leftX - 16
        }
      );
      localY -= 10;
      block.groupedByDish.forEach((group) => {
        page.drawText(`${block.label}: ${group.dish}`, {
          x: leftX + 4,
          y: localY,
          font: bold,
          size: 10
        });
        localY -= 11;
        group.guests.forEach((guest) => {
          const dietary = guest.dietary.length ? ` [${guest.dietary.join(", ")}]` : "";
          page.drawText(`- ${guest.name}${dietary}`, {
            x: leftX + 14,
            y: localY,
            font,
            size: 9.2,
            color: guest.dietary.length ? rgb(0.66, 0.2, 0.06) : rgb(0.1, 0.12, 0.17),
            maxWidth: splitX - leftX - 26
          });
          localY -= 10;
        });
        localY -= 2;
      });
      localY -= 4;
    });

    drawScribbleArea(splitX, rowTop - 10, notesW, rowHeight - 16);
    y -= rowHeight + 8;
  });

  const prettyDietaryLabel = (raw: string): string => {
    const t = raw.trim();
    if (!t) return t;
    /** Already a normalized compound from `normalizeDietary` — do not re-tokenize. */
    if (t.includes("·")) return t;
    return t
      .split(/[\s-]+/)
      .filter(Boolean)
      .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  };

  const comboLabel = (dietary: string[]): string =>
    dietary
      .slice()
      .sort((a, b) => a.localeCompare(b))
      .map((item) => prettyDietaryLabel(item))
      .join(" / ");

  const makeCourseSummary = (course: "starter" | "main" | "dessert") => {
    const dishTotals = new Map<string, number>();
    const dietaryComboByDish = new Map<string, Map<string, number>>();
    model.guests.forEach((guest) => {
      const dish = guest[course]?.trim() || `No ${course} selected`;
      dishTotals.set(dish, (dishTotals.get(dish) ?? 0) + 1);
      if (guest.dietaryNormalized.length) {
        const combo = comboLabel(guest.dietaryNormalized);
        if (!dietaryComboByDish.has(dish)) dietaryComboByDish.set(dish, new Map<string, number>());
        const perDish = dietaryComboByDish.get(dish)!;
        perDish.set(combo, (perDish.get(combo) ?? 0) + 1);
      }
    });
    return {
      dishTotals: Array.from(dishTotals.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
      dietaryByDish: Array.from(dietaryComboByDish.entries())
        .map(([dish, combos]) => ({
          dish,
          combos: Array.from(combos.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        }))
        .sort((a, b) => a.dish.localeCompare(b.dish))
    };
  };

  page = doc.addPage([width, height]);
  y = height - 28;
  drawPseudoBoldText(page, normalizeForCormorantLigatureSafe("Service Summary"), {
    x: 24,
    y,
    font: titleBold,
    size: 14,
    color: hexToRgb(theme.primaryColor, "#012f43")
  });
  y -= 16;
  page.drawText(`Total tables: ${data.tables.length}`, { x: 26, y, font: bold, size: 10.5 });
  page.drawText(`Total guests: ${model.guests.length}`, { x: 160, y, font: bold, size: 10.5 });
  y -= 14;

  const ensureSummarySpace = (required: number) => {
    if (y - required > 20) return;
    page = doc.addPage([width, height]);
    y = height - 28;
  };

  const drawSummaryCourse = (
    label: string,
    summary: {
      dishTotals: Array<[string, number]>;
      dietaryByDish: Array<{ dish: string; combos: Array<[string, number]> }>;
    }
  ) => {
    ensureSummarySpace(28);
    page.drawText(label, { x: 24, y, font: bold, size: 12, color: rgb(0.11, 0.13, 0.18) });
    y -= 12;
    page.drawText("Total dishes:", { x: 28, y, font: bold, size: 10, color: rgb(0.3, 0.34, 0.42) });
    y -= 10;
    summary.dishTotals.forEach(([dish, count]) => {
      ensureSummarySpace(10);
      page.drawText(`- ${dish} (${count})`, { x: 34, y, font, size: 9.3, maxWidth: width - 54 });
      y -= 9.5;
    });
    ensureSummarySpace(14);
    y -= 2;
    page.drawText("Total dietaries per dish:", {
      x: 28,
      y,
      font: bold,
      size: 10,
      color: rgb(0.3, 0.34, 0.42)
    });
    y -= 10;
    if (!summary.dietaryByDish.length) {
      ensureSummarySpace(10);
      page.drawText("- None", { x: 34, y, font, size: 9.3 });
      y -= 9.5;
    } else {
      summary.dietaryByDish.forEach(({ dish, combos }) => {
        ensureSummarySpace(10);
        page.drawText(`- ${dish}:`, {
          x: 34,
          y,
          font: bold,
          size: 9.3,
          maxWidth: width - 54
        });
        y -= 9.5;
        combos.forEach(([combo, count]) => {
          ensureSummarySpace(10);
          page.drawText(`  • ${combo} (${count})`, {
            x: 40,
            y,
            font,
            size: 9.2,
            color: rgb(0.63, 0.23, 0.07),
            maxWidth: width - 60
          });
          y -= 9.2;
        });
      });
    }
    y -= 6;
  };

  data.coursesOnPlan.forEach((course) => {
    drawSummaryCourse(SERVICE_COURSE_LABEL[course], makeCourseSummary(course));
  });

  await embedLogoIfPresent(doc, doc.getPages()[0], theme);
  return doc.save();
}

export async function renderFloorplanPdf(
  model: EventModel,
  settings: FloorplanSettings,
  theme: ThemeSettings
): Promise<Uint8Array> {
  const { doc, bodyBold: bold, title } = await createDocWithFonts();
  const [width, height] = pageDimensions(settings);
  const titleColor = hexToRgb(theme.primaryColor, "#012f43");
  const accentColor = hexToRgb(theme.accentColor, "#acc1cb");
  const headerBandHeight = 96;
  const sideMargin = 24;
  const gap = 12;
  const outerPad = 8;
  const safeSideWidth = 104;
  const logoWidth = 68;

  const rows = settings.rows;
  const cols = settings.columns;
  const tables = sortedTableNumbers(model);
  const placed = buildFloorplanPlacedCells(settings, tables);

  const innerTop = height - headerBandHeight - sideMargin;
  const innerBottom = sideMargin;
  const usableH = innerTop - innerBottom;
  const cellH = (usableH - (rows - 1) * gap) / rows;

  const innerLeft = sideMargin;
  const usableW = width - 2 * sideMargin;
  const cellW = floorplanCellWidth(usableW, cols, gap, settings.tableLayout === "staggered");

  const cellRect = (row: number, col: number) => {
    const rowOffsetX =
      settings.tableLayout === "staggered" && cols > 1 && row % 2 === 1 ? (cellW + gap) / 2 : 0;
    const x = innerLeft + rowOffsetX + col * (cellW + gap);
    const y = innerTop - (row + 1) * cellH - row * gap;
    return { x, y, w: cellW, h: cellH };
  };

  /** pdf-lib circles use (x,y) as center; `size` is the radius (semi-axis). */
  const floorplanRoundLayout = (w: number, h: number) => {
    const cellR = Math.min(w, h) / 2 - 1;
    const chairR = clamp(cellR * 0.065, 1.9, 4);
    const ringGap = 2.4;
    /** Outer edge of chair must stay inside the cell: tableR + gap + 2·chairR ≤ cellR. */
    const maxTableR = Math.max(7, cellR - 0.5 - ringGap - 2 * chairR);
    let tableR = Math.min(cellR * 0.62, maxTableR);
    let chairDist = tableR + ringGap + chairR;
    while (chairDist + chairR > cellR - 0.4 && tableR > 7) {
      tableR -= 0.6;
      chairDist = tableR + ringGap + chairR;
    }
    const nChairs = 8;
    return { cellR, tableR, chairR, chairDist, nChairs };
  };

  let boundMinX = Infinity;
  let boundMaxX = -Infinity;
  let boundMinY = Infinity;
  let boundMaxY = -Infinity;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const { x, y, w, h } = cellRect(r, c);
      const cx = x + w / 2;
      const cy = y + h / 2;
      const { cellR } = floorplanRoundLayout(w, h);
      boundMinX = Math.min(boundMinX, cx - cellR);
      boundMaxX = Math.max(boundMaxX, cx + cellR);
      boundMinY = Math.min(boundMinY, cy - cellR);
      boundMaxY = Math.max(boundMaxY, cy + cellR);
    }
  }

  const page = doc.addPage([width, height]);
  page.drawRectangle({
    x: 0,
    y: height - headerBandHeight,
    width,
    height: headerBandHeight,
    color: rgb(1, 1, 1)
  });

  const eventTitle = normalizeForCormorantLigatureSafe(theme.eventName || "Event");
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

  page.drawRectangle({
    x: boundMinX - outerPad,
    y: boundMinY - outerPad,
    width: boundMaxX - boundMinX + 2 * outerPad,
    height: boundMaxY - boundMinY + 2 * outerPad,
    borderColor: rgb(0.55, 0.6, 0.68),
    borderWidth: 1.2,
    color: rgb(0.98, 0.99, 1)
  });

  const mutedFill = rgb(0.93, 0.94, 0.96);
  const mutedBorder = rgb(0.78, 0.81, 0.88);
  const mutedChair = rgb(0.72, 0.75, 0.82);
  const chairBorder = rgb(0.55, 0.6, 0.68);
  const tableBorder = rgb(0.79, 0.82, 0.9);
  const tableFill = rgb(0.99, 0.995, 1);
  const labelColor = hexToRgb(theme.textColor, "#1a2430");

  placed.forEach((cell) => {
    const { x, y, w, h } = cellRect(cell.row, cell.col);
    const filled = cell.tableNumber != null && cell.tableNumber !== "";
    const cx = x + w / 2;
    const cy = y + h / 2;
    const { tableR, chairR, chairDist, nChairs } = floorplanRoundLayout(w, h);

    for (let i = 0; i < nChairs; i += 1) {
      const angle = (i / nChairs) * Math.PI * 2 - Math.PI / 2;
      const chx = cx + chairDist * Math.cos(angle);
      const chy = cy + chairDist * Math.sin(angle);
      page.drawCircle({
        x: chx,
        y: chy,
        size: chairR,
        color: filled ? accentColor : mutedChair,
        opacity: filled ? 0.45 : 0.35,
        borderColor: filled ? tableBorder : chairBorder,
        borderWidth: 0.55
      });
    }

    page.drawCircle({
      x: cx,
      y: cy,
      size: tableR,
      color: filled ? tableFill : mutedFill,
      opacity: filled ? 1 : 0.85,
      borderColor: filled ? tableBorder : mutedBorder,
      borderWidth: 1
    });

    if (filled) {
      const label = `Table ${cell.tableNumber}`;
      let tableLabelSize = Math.min(15, Math.max(8, (tableR * 2) / 6.5));
      let labelWidth = bold.widthOfTextAtSize(label, tableLabelSize);
      const maxW = (tableR * 2 - 5) * 0.95;
      while (labelWidth > maxW && tableLabelSize > 6) {
        tableLabelSize -= 0.5;
        labelWidth = bold.widthOfTextAtSize(label, tableLabelSize);
      }
      page.drawText(label, {
        x: cx - labelWidth / 2,
        y: cy - tableLabelSize * 0.35,
        font: bold,
        size: tableLabelSize,
        color: labelColor
      });
    }
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

  return doc.save();
}

export async function renderDocumentPdf(
  documentType: DocumentType,
  model: EventModel,
  options: {
    tablePlan: TablePlanSettings;
    tablePlanByPerson?: TablePlanSettings;
    placeCard: PlaceCardSettings;
    menuBooklet: MenuBookletSettings;
    floorplan: FloorplanSettings;
    theme: ThemeSettings;
    menuLongNames?: Record<string, string>;
    dishMenuDuplicateGroups?: DishMenuDuplicateGroup[];
  }
): Promise<Uint8Array> {
  if (documentType === "tablePlanByTable") {
    return renderTablePlanByTablePdf(model, options.tablePlan, options.theme);
  }
  if (documentType === "tablePlanByPerson") {
    return renderTablePlanByPersonPdf(
      model,
      options.tablePlanByPerson ?? options.tablePlan,
      options.theme
    );
  }
  if (documentType === "placeCards") {
    return renderPlaceCardsPdf(model, options.placeCard, options.theme);
  }
  if (documentType === "menuBooklet") {
    return renderMenuBookletPdf(
      model,
      options.menuBooklet,
      options.theme,
      options.menuLongNames ?? {},
      options.dishMenuDuplicateGroups ?? []
    );
  }
  if (documentType === "floorplan") {
    return renderFloorplanPdf(model, options.floorplan, options.theme);
  }
  return renderServicePlanPdf(model, options.theme);
}
