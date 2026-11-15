import { readFile } from "node:fs/promises";
import path from "node:path";
import { degrees, PDFDocument, rgb } from "pdf-lib";
import { pdfPageDimensions } from "@/lib/paperSizes";
import { hexToRgb, inkOnWhite, textOnColor } from "@/lib/pdf/color";
import { embedRasterDataUrl } from "@/lib/pdf/imageFormat";
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
import { fitTextToFont, fontCanDraw, titleFontFor } from "@/lib/pdf/fontText";
import { formatTableLabel } from "@/lib/event/tableLabel";
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
 * Body: Open Sans (static TTF) — Latin / Greek / Cyrillic; use for all “must render” copy.
 * Titles: Sora SemiBold (static TTF, Latin only — run titles through {@link fitTextToFont}).
 */
const PDF_FONT_SOURCES = {
  body: path.join(LIB_FONTS, "OpenSans-Regular.ttf"),
  bodyBold: path.join(LIB_FONTS, "OpenSans-Bold.ttf"),
  title: path.join(LIB_FONTS, "Sora-SemiBold.ttf")
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
  const [body, bodyBold, title] = await Promise.all([
    readFile(PDF_FONT_SOURCES.body),
    readFile(PDF_FONT_SOURCES.bodyBold),
    readFile(PDF_FONT_SOURCES.title)
  ]);
  cachedPdfFontBytes = { body, bodyBold, title };
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
  const title = await doc.embedFont(bytes.title, { subset: false });
  return { doc, body, bodyBold, title, titleBold: title };
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

/** One line that always fits: shrinks towards `minSize` first, then truncates with an ellipsis. */
function fitLine(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
  minSize = size * 0.7
): { text: string; size: number } {
  let s = size;
  while (s > minSize && font.widthOfTextAtSize(text, s) > maxWidth) s -= 0.25;
  return { text: truncateToWidth(text, font, s, maxWidth), size: s };
}

function wrapTextToWidthClamped(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const wrapped = wrapTextToWidth(text, font, fontSize, maxWidth);
  return wrapped.map((line) => truncateToWidth(line, font, fontSize, maxWidth));
}

type PlaceCardLineKind = "name" | "subtitle" | "table" | "course" | "dietary";

type PlaceCardLine = {
  text: string;
  fontRef: PDFFont;
  size: number;
  color: ReturnType<typeof rgb>;
  kind: PlaceCardLineKind;
  /** Lines from one wrapped entry (e.g. a single course) share a group so they are dropped together. */
  group: string;
};

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
  /** Drop the event subtitle (decorative) before anything safety-relevant. */
  omitSubtitle?: boolean;
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
    bold,
    omitSubtitle
  } = options;
  const bodyColor = rgb(0.1, 0.12, 0.17);
  const flatLines: PlaceCardLine[] = [];

  // A single long word (e.g. a triple-barrelled surname) shrinks the name before it is ever cut short.
  const cardName = fitTextToFont(card.name, bold);
  const nameFloor = Math.min(nameSize, 9);
  let fittedNameSize = nameSize;
  const nameWords = cardName.trim().split(/\s+/).filter(Boolean);
  while (
    fittedNameSize > nameFloor &&
    nameWords.some((word) => bold.widthOfTextAtSize(word, fittedNameSize) > maxTextW)
  ) {
    fittedNameSize -= 0.5;
  }
  wrapTextToWidthClamped(cardName, bold, fittedNameSize, maxTextW).forEach((line) => {
    flatLines.push({ text: line, fontRef: bold, size: fittedNameSize, color: nameColor, kind: "name", group: "name" });
  });

  if (!omitSubtitle && theme.eventSubtitle?.trim()) {
    wrapTextToWidthClamped(theme.eventSubtitle.trim(), font, detailSize, maxTextW).forEach((line) => {
      flatLines.push({ text: line, fontRef: font, size: detailSize, color: subtitleColor, kind: "subtitle", group: "subtitle" });
    });
  }

  if (card.tableNumber) {
    wrapTextToWidthClamped(formatTableLabel(card.tableNumber), font, detailSize, maxTextW).forEach((line) => {
      flatLines.push({ text: line, fontRef: font, size: detailSize, color: mutedGrey, kind: "table", group: "table" });
    });
  }

  if (card.courses.starter) {
    wrapTextToWidthClamped(`Starter: ${card.courses.starter}`, font, detailSize, maxTextW).forEach((line) => {
      flatLines.push({ text: line, fontRef: font, size: detailSize, color: bodyColor, kind: "course", group: "starter" });
    });
  }
  if (card.courses.main) {
    wrapTextToWidthClamped(`Main: ${card.courses.main}`, font, detailSize, maxTextW).forEach((line) => {
      flatLines.push({ text: line, fontRef: font, size: detailSize, color: bodyColor, kind: "course", group: "main" });
    });
  }
  if (card.courses.dessert) {
    wrapTextToWidthClamped(`Dessert: ${card.courses.dessert}`, font, detailSize, maxTextW).forEach((line) => {
      flatLines.push({ text: line, fontRef: font, size: detailSize, color: bodyColor, kind: "course", group: "dessert" });
    });
  }

  if (card.dietary.length) {
    wrapTextToWidthClamped(card.dietary.join(", "), bold, detailSize, maxTextW).forEach((line) => {
      flatLines.push({ text: line, fontRef: bold, size: detailSize, color: dietaryColor, kind: "dietary", group: "dietary" });
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
  const image = await embedRasterDataUrl(doc, logoDataUrl);
  if (!image) return;
  try {
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

export async function renderTablePlanByTablePdf(
  model: EventModel,
  settings: TablePlanSettings,
  theme: ThemeSettings
): Promise<Uint8Array> {
  const { doc, body: font, bodyBold: bold, title, titleBold } = await createDocWithFonts();
  const [width, height] = pageDimensions(settings);
  const titleColor = inkOnWhite(theme.primaryColor, "#012f43");
  const data = buildByTableDocument(model);
  const headerBandHeight = 96;
  // Size the grid against the space actually left under the header band.
  const tablesPerSheet = pickAdaptiveTablesPerSheet(
    data.tables.map((table) => table.guests.length),
    settings,
    width,
    height - headerBandHeight
  );
  const pages = chunk(data.tables, tablesPerSheet);
  const grid = estimateGrid(tablesPerSheet, width, height - headerBandHeight);
  const contentTopOffset = headerBandHeight;
  const safeSideWidth = 104;
  const logoWidth = 68;
  const accentColor = hexToRgb(theme.accentColor, "#acc1cb");
  const onAccent = textOnColor(theme.accentColor, "#acc1cb");

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

    const eventTitleFont = titleFontFor([theme.eventName || "Event"], title, bold);
    const eventTitle = fitTextToFont(theme.eventName || "Event", eventTitleFont);
    const maxTitleWidth = Math.max(100, width - safeSideWidth * 2 - 20);
    let titleSize = 30;
    let titleLines = wrapTextToWidth(eventTitle, eventTitleFont, titleSize, maxTitleWidth);
    while (titleLines.length > 2 && titleSize > 18) {
      titleSize -= 1;
      titleLines = wrapTextToWidth(eventTitle, eventTitleFont, titleSize, maxTitleWidth);
    }
    const titleLineHeight = titleSize + 3;
    const titleBlockHeight = titleLines.length * titleLineHeight;
    let titleY = height - 16 - titleSize - (2 - Math.min(2, titleLines.length)) * 4;
    if (titleBlockHeight > 44) {
      titleY -= (titleBlockHeight - 44) / 2;
    }
    const titleCenterY = titleY - ((Math.min(2, titleLines.length) - 1) * titleLineHeight) / 2 + titleSize * 0.35;
    titleLines.slice(0, 2).forEach((line, lineIndex) => {
      const lineWidth = eventTitleFont.widthOfTextAtSize(line, titleSize);
      page.drawText(line, {
        x: (width - lineWidth) / 2,
        y: titleY - lineIndex * titleLineHeight,
        font: eventTitleFont,
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

      const tableLabel = fitLine(fitTextToFont(formatTableLabel(table.tableNumber), bold), bold, 12, grid.boxWidth - 12, 8);
      const titleWidth = bold.widthOfTextAtSize(tableLabel.text, tableLabel.size);
      page.drawText(tableLabel.text, {
        x: x + (grid.boxWidth - titleWidth) / 2,
        y: y + grid.boxHeight - headerHeight + 8,
        font: bold,
        size: tableLabel.size,
        color: onAccent
      });

      const maxNames = Math.max(1, table.guests.length);
      const available = grid.boxHeight - headerHeight - innerPad * 2;
      const lineHeight = available / maxNames;
      // Never let the type be taller than its line (manual "tables per sheet" can squeeze a big table).
      const nameSize = Math.min(clamp(lineHeight * 0.8, settings.minFontSizePt, 12), lineHeight * 0.92);
      let cursorY = y + grid.boxHeight - headerHeight - innerPad - nameSize;

      table.guests.forEach((guestName) => {
        // One line per guest: a long name shrinks, then truncates, rather than wrapping over the next guest.
        const fitted = fitLine(fitTextToFont(guestName, font), font, nameSize, grid.boxWidth - innerPad * 2);
        page.drawText(fitted.text, {
          x: x + innerPad,
          y: cursorY,
          font,
          size: fitted.size
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
  const headerRowHeight = 24;
  const isLandscape = settings.orientation === "landscape";
  const columns = isLandscape ? 2 : 1;
  const rowsThatFit = Math.max(12, Math.floor((usableTableHeight - headerRowHeight) / 20));
  // Manual mode: "rows per page" is the page total, shared across both columns in landscape.
  const manualRows = settings.tablesPerSheetMode === "manual";
  const rowsPerColumn = manualRows
    ? clamp(Math.ceil(settings.tablesPerSheet / columns), 1, rowsThatFit)
    : rowsThatFit;
  // Fewer rows get taller rows (up to a point) so the list still fills the page comfortably.
  const rowHeight = manualRows ? Math.min(34, (usableTableHeight - headerRowHeight) / rowsPerColumn) : 20;
  const people = buildByPersonDocument(model).people;
  const rowsPerPage = rowsPerColumn * columns;
  const pages = chunk(people, rowsPerPage);
  const titleColor = inkOnWhite(theme.primaryColor, "#012f43");
  const accentColor = hexToRgb(theme.accentColor, "#acc1cb");
  const onAccent = textOnColor(theme.accentColor, "#acc1cb");
  const safeSideWidth = 104;
  const logoWidth = 68;
  const tableX = Math.round(tableMargin);
  const tableYTop = Math.round(height - headerBandHeight - tableTopGap);
  const tableWidth = Math.round(width - tableMargin * 2);
  const tableHeight = Math.round(manualRows ? headerRowHeight + rowsPerColumn * rowHeight : usableTableHeight);
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

    const eventTitleFont = titleFontFor([theme.eventName || "Event"], title, bold);
    const eventTitle = fitTextToFont(theme.eventName || "Event", eventTitleFont);
    const maxTitleWidth = Math.max(100, width - safeSideWidth * 2 - 20);
    let titleSize = 30;
    let titleLines = wrapTextToWidth(eventTitle, eventTitleFont, titleSize, maxTitleWidth);
    while (titleLines.length > 2 && titleSize > 18) {
      titleSize -= 1;
      titleLines = wrapTextToWidth(eventTitle, eventTitleFont, titleSize, maxTitleWidth);
    }
    const titleLineHeight = titleSize + 3;
    const titleBlockHeight = titleLines.length * titleLineHeight;
    let titleY = height - 16 - titleSize - (2 - Math.min(2, titleLines.length)) * 4;
    if (titleBlockHeight > 44) {
      titleY -= (titleBlockHeight - 44) / 2;
    }
    const titleCenterY = titleY - ((Math.min(2, titleLines.length) - 1) * titleLineHeight) / 2 + titleSize * 0.35;
    titleLines.slice(0, 2).forEach((line, lineIndex) => {
      const lineWidth = eventTitleFont.widthOfTextAtSize(line, titleSize);
      page.drawText(line, {
        x: (width - lineWidth) / 2,
        y: titleY - lineIndex * titleLineHeight,
        font: eventTitleFont,
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
        color: onAccent
      });
      page.drawText("Table", {
        x: tableColSplit + 10,
        y: tableYTop - 16,
        font: bold,
        size: 11,
        color: onAccent
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

        const textY = rowBottom + (rowH - 8) / 2;
        const nameFit = fitLine(fitTextToFont(person.name, font), font, 10.5, tableColSplit - colX - 16, 7.5);
        page.drawText(nameFit.text, {
          x: colX + 10,
          y: textY,
          font,
          size: nameFit.size
        });
        const tableFit = fitLine(
          fitTextToFont(formatTableLabel(person.tableNumber), bold),
          bold,
          10.5,
          colRight - tableColSplit - 16,
          7
        );
        page.drawText(tableFit.text, {
          x: tableColSplit + 10,
          y: textY,
          font: bold,
          size: tableFit.size,
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
  theme: ThemeSettings,
  options: { warnings?: string[] } = {}
): Promise<Uint8Array> {
  const { doc, body: font, bodyBold: bold, title, titleBold } = await createDocWithFonts();
  const pageWidth = PLACE_CARD_STOCK.pageWidthPt;
  const pageHeight = PLACE_CARD_STOCK.pageHeightPt;
  const cardWidth = PLACE_CARD_STOCK.cardWidthPt;
  const calibrationX = mmToPt(settings.textOffsetXmm);
  const calibrationY = mmToPt(settings.textOffsetYmm);
  const cards = buildPlaceCardDocument(model, settings);

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

  // Embed the back-of-card logo once and reuse it on every card (avoids one copy per card).
  let backLogo: Awaited<ReturnType<typeof embedRasterDataUrl>> | undefined;
  const getBackLogo = async () => {
    if (backLogo === undefined) backLogo = await embedRasterDataUrl(doc, theme.clientLogoDataUrl);
    return backLogo;
  };

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
          const image = await getBackLogo();
          if (image) {
            {
              try {
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
          // Nothing fits at the normal minimum: go smaller and drop the decorative subtitle
          // before ever touching dietary / allergy text.
          const fallbackSize = 5;
          chosenLines = buildPlaceCardLines({
            card,
            theme,
            nameSize: fallbackSize,
            detailSize: fallbackSize,
            nameColor,
            subtitleColor,
            mutedGrey,
            dietaryColor,
            maxTextW,
            font,
            bold,
            omitSubtitle: true
          });
          chosenGap = 1;
        }

        // Still overflowing: remove lowest-priority lines first. Dietary lines are never
        // removed while anything else can go; the overflow is reported to the caller.
        const dropOrder: PlaceCardLineKind[] = ["subtitle", "course", "name", "table"];
        let droppedSomething = false;
        for (const kind of dropOrder) {
          while (placeCardLinesHeight(chosenLines, chosenGap) > innerH) {
            const candidates = chosenLines
              .map((line, index) => ({ line, index }))
              .filter(({ line }) => line.kind === kind);
            // Keep the first name line and the table line so the card still identifies the guest.
            const removable = kind === "name" ? candidates.slice(1) : kind === "table" ? [] : candidates;
            if (!removable.length) break;
            const { line: victim, index } = removable[removable.length - 1];
            // Courses go whole (never half a dish name); extra name lines go one at a time.
            chosenLines =
              kind === "course"
                ? chosenLines.filter((line) => line.group !== victim.group)
                : chosenLines.filter((_, lineIndex) => lineIndex !== index);
            droppedSomething = true;
          }
        }
        if (placeCardLinesHeight(chosenLines, chosenGap) > innerH) {
          // Only dietary text remains too tall: draw it anyway (it may touch the border) rather than hide it.
          options.warnings?.push(
            `Place card for ${card.name}${card.tableNumber ? ` (${formatTableLabel(card.tableNumber)})` : ""}: dietary text is too long for the card and may overlap the border — check the printed card.`
          );
        } else if (droppedSomething) {
          options.warnings?.push(
            `Place card for ${card.name}${card.tableNumber ? ` (${formatTableLabel(card.tableNumber)})` : ""}: some menu lines were left off so the dietary requirements fit.`
          );
        }

        if (chosenLines.some((line) => line.kind === "name" && line.text.endsWith("…")) && !card.name.trim().endsWith("…")) {
          options.warnings?.push(
            `Place card for ${card.name}${card.tableNumber ? ` (${formatTableLabel(card.tableNumber)})` : ""}: the name is too long for the card and has been cut short.`
          );
        }

        const totalBlockHeight = placeCardLinesHeight(chosenLines, chosenGap);
        let cursorY = textTop - (innerH - totalBlockHeight) / 2 + calibrationY;
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

export type MenuCardContact = { phone: string; websites: string };

export async function renderMenuBookletPdf(
  model: EventModel,
  settings: MenuBookletSettings,
  theme: ThemeSettings,
  menuLongNames: Record<string, string> = {},
  dishMenuDuplicateGroups: DishMenuDuplicateGroup[] = [],
  /** Back cover lines from the Settings page; blank lines are left off. */
  contact: MenuCardContact = { phone: "", websites: "" },
  options: { warnings?: string[] } = {}
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
  /** Primary as text on white paper (falls back to dark ink for pale brand colours). */
  const primaryInk = inkOnWhite(theme.primaryColor, "#012f43");
  const accent = hexToRgb(theme.accentColor, "#acc1cb");
  const menu = buildMenuBookletDocument(model, menuLongNames, dishMenuDuplicateGroups);
  /** Cover text: white on a dark cover, dark ink on a pale one. */
  const white = textOnColor(theme.primaryColor, "#012f43");

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

  /** Double frame for the white panels; both strokes in the light blue "water" accent. */
  const drawFancyBorder = (
    page: import("pdf-lib").PDFPage,
    options: { x: number; y: number; width: number; height: number; halfSide: MenuHalfSide }
  ) => {
    const outer = outerBorderFrame(options.x, options.y, options.width, options.height, options.halfSide);
    page.drawRectangle({
      x: outer.x,
      y: outer.y,
      width: outer.width,
      height: outer.height,
      borderColor: accent,
      borderWidth: 1.8
    });
    const inner = innerBorderFromOuter(outer);
    page.drawRectangle({
      x: inner.x,
      y: inner.y,
      width: inner.width,
      height: inner.height,
      borderColor: accent,
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
      borderColor: accent,
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
    opacity = 1
  ) => {
    const textWidth = fontRef.widthOfTextAtSize(text, size);
    const x = panelLeft + (panelWidth - textWidth) / 2;
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
    halfSide: "left"
  });
  const venueLogoW = 118;
  await embedLogoFromDataUrl(doc, sheet1, theme.venueLogoDataUrl, {
    width: venueLogoW,
    x: leftCoverOuter.x + (leftCoverOuter.width - venueLogoW) / 2,
    y: pageHeight / 2 + 18
  });
  const contactPhone = contact.phone.trim();
  const contactWebsites = contact.websites.trim();
  if (contactPhone) {
    drawCenteredInPanel(sheet1, contactPhone, pageHeight / 2 - 6, bold, 16, primaryInk, leftCoverOuter.x, leftCoverOuter.width);
  }
  if (contactWebsites) {
    /* Long web address lines shrink to fit inside the frame rather than running over it. */
    const maxW = leftCoverOuter.width - 40;
    const size = Math.max(7, Math.min(11, (11 * maxW) / font.widthOfTextAtSize(contactWebsites, 11)));
    drawCenteredInPanel(
      sheet1,
      contactWebsites,
      pageHeight / 2 - (contactPhone ? 32 : 6),
      font,
      size,
      rgb(0.23, 0.27, 0.35),
      leftCoverOuter.x,
      leftCoverOuter.width
    );
  }

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
  const coverTitleFont = titleFontFor([theme.eventName || "Event"], title, bold);
  const coverTitle = fitTextToFont(theme.eventName || "Event", coverTitleFont);
  let titleLines = wrapTextToWidth(coverTitle, coverTitleFont, titleFontSize, titleMaxW);
  let titleLineHeight = titleFontSize + 5;
  const minTitleFont = 16;
  const hasEventDate = Boolean(theme.eventDate?.trim());
  const fitTitleBlock = (): { firstTitleBaseline: number; dateBaseline: number } => {
    while (titleFontSize >= minTitleFont) {
      titleLines = wrapTextToWidth(coverTitle, coverTitleFont, titleFontSize, titleMaxW);
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
    titleLines = wrapTextToWidth(coverTitle, coverTitleFont, titleFontSize, titleMaxW);
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
      coverTitleFont,
      titleFontSize,
      white,
      rightCoverOuter.x,
      rightCoverOuter.width
    );
  });
  if (theme.eventDate?.trim()) {
    const dateFont = titleFontFor([theme.eventDate.trim()], title, bold);
    drawCenteredInPanel(
      sheet1,
      fitTextToFont(theme.eventDate.trim(), dateFont),
      dateBaseline,
      dateFont,
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
    halfSide: "left"
  });

  drawFancyBorder(sheet2, {
    x: rightPanelX,
    y: panelY,
    width: rightPanelW,
    height: panelH,
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

  const hasCoreCourses = sections.length > 0;

  // Everything below scales together so a long menu shrinks to fit the panel instead of running over the frame.
  let headingSize = settings.headingFontPt + 2;
  let bodySize = settings.bodyFontPt;
  let lineGap = settings.lineHeight;
  let sectionGapAfterHeading = 10;
  let gapAfterLines = 10;
  let dividerTrailing = 32;
  const dividerPad = 22;
  let preMealLines: string[] = [];
  let postMealLines: string[] = [];
  let totalMenuHeight = 0;

  const wrapMenuLine = (line: string): string[] => wrapTextToWidthClamped(fitTextToFont(line, font), font, bodySize, innerW - 8);
  const wrapAddonText = (rawText?: string): string[] => {
    const text = (rawText ?? "").trim();
    if (!text) return [];
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => wrapMenuLine(line));
  };

  const layoutAtScale = (scale: number): number => {
    headingSize = (settings.headingFontPt + 2) * scale;
    bodySize = settings.bodyFontPt * scale;
    lineGap = settings.lineHeight * scale;
    sectionGapAfterHeading = 10 * scale;
    gapAfterLines = 10 * scale;
    dividerTrailing = 32 * scale;
    preMealLines = wrapAddonText(settings.preMealText);
    postMealLines = wrapAddonText(settings.postMealText);
    const addonHeight = (lines: string[]) => lines.length * lineGap + gapAfterLines;
    let total = 0;
    if (preMealLines.length) {
      total += addonHeight(preMealLines);
      if (hasCoreCourses) total += dividerTrailing;
    }
    sections.forEach((section, index) => {
      total += headingSize + sectionGapAfterHeading;
      section.lines.forEach((line) => {
        total += wrapMenuLine(line).length * lineGap;
      });
      total += gapAfterLines;
      if (index < sections.length - 1) total += dividerTrailing;
    });
    if (postMealLines.length) {
      if (hasCoreCourses) total += dividerTrailing;
      total += addonHeight(postMealLines);
    }
    return total;
  };

  const MIN_MENU_SCALE = 0.55;
  let menuScale = 1;
  totalMenuHeight = layoutAtScale(menuScale);
  while (totalMenuHeight > innerHeight && menuScale > MIN_MENU_SCALE) {
    menuScale = Math.max(MIN_MENU_SCALE, menuScale - 0.05);
    totalMenuHeight = layoutAtScale(menuScale);
  }
  if (totalMenuHeight > innerHeight) {
    options.warnings?.push(
      "Menu card: there is too much text to fit inside the frame even at the smallest size — shorten the long dish names or the before/after lines, then check the printed card."
    );
  } else if (menuScale < 0.8) {
    options.warnings?.push(
      `Menu card: the text was reduced to ${Math.round(bodySize * 10) / 10}pt to fit — check it is still readable.`
    );
  }

  let cursorY = innerTop - Math.max(0, (innerHeight - totalMenuHeight) / 2) - bodySize * 0.8;

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
    const headingFont = titleFontFor([section.heading], titleBold, bold);
    drawCenteredInPanel(
      sheet2,
      fitTextToFont(section.heading, headingFont),
      cursorY,
      headingFont,
      headingSize,
      primaryInk,
      innerLeft,
      innerW
    );
    cursorY -= headingSize + sectionGapAfterHeading;
    section.lines.forEach((line) => {
      const wrapped = wrapMenuLine(line);
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

  // The logo sits in a fixed slot at the top right, clear of the first table's notes box.
  const logoSlot = { width: 64, height: 36, right: 22, top: 8 };
  const headerLogo = await embedRasterDataUrl(doc, theme.clientLogoDataUrl || theme.venueLogoDataUrl);
  const titleMaxW = width - 44 - (headerLogo ? logoSlot.width + 12 : 0);
  const planEventName = theme.eventName.trim() || "Event";
  const planTitleFont = titleFontFor([planEventName], titleBold, bold);
  const planTitleRaw = fitTextToFont(`${planEventName} - Service Plan`, planTitleFont);
  let planTitleSize = 17;
  while (planTitleSize > 10 && planTitleFont.widthOfTextAtSize(planTitleRaw, planTitleSize) > titleMaxW) planTitleSize -= 0.5;
  const planTitle = truncateToWidth(planTitleRaw, planTitleFont, planTitleSize, titleMaxW);
  page.drawText(planTitle, {
    x: 22,
    y,
    font: planTitleFont,
    size: planTitleSize,
    color: inkOnWhite(theme.primaryColor, "#012f43")
  });
  if (headerLogo) {
    const scale = Math.min(logoSlot.width / headerLogo.width, logoSlot.height / headerLogo.height);
    const logoW = headerLogo.width * scale;
    const logoH = headerLogo.height * scale;
    page.drawImage(headerLogo, {
      x: width - logoSlot.right - logoW,
      y: height - logoSlot.top - logoSlot.height + (logoSlot.height - logoH) / 2,
      width: logoW,
      height: logoH
    });
  }
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

  const checkboxPitch = 62;
  const checkboxLabels = data.coursesOnPlan.map((key) => SERVICE_COURSE_LABEL[key]);
  const drawCourseCheckboxes = (x: number, topY: number) => {
    const size = 9;
    const gap = 7;
    checkboxLabels.forEach((label, index) => {
      const itemX = x + index * checkboxPitch;
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

  type ServiceLine = {
    text: string;
    x: number;
    font: PDFFont;
    size: number;
    color: ReturnType<typeof rgb>;
    /** Vertical advance after drawing this line. */
    step: number;
    /**
     * Set on the first line of an entry: the height that must fit before starting it, so wrapped
     * entries never split across boxes and headings are not stranded without a following line.
     */
    keepHeight?: number;
  };

  const outerX = 18;
  const outerW = width - 36;
  const leftX = 24;
  const splitX = width - 170;
  const notesW = width - splitX - 24;
  const leftColW = splitX - leftX - 16;
  const headerBlockH = 36;
  const boxBottomPad = 12;
  const pageBottom = 20;
  const minBoxH = 120;

  /** Pre-wraps every left-column entry so row heights reflect the real number of printed lines. */
  const buildTableLines = (table: (typeof data.tables)[number]): ServiceLine[] => {
    const lines: ServiceLine[] = [];
    const push = (
      text: string,
      opts: {
        x: number;
        font: PDFFont;
        size: number;
        color: ReturnType<typeof rgb>;
        step: number;
        maxW: number;
        /** Headings reserve room for at least one line of what follows them. */
        isHeading?: boolean;
      }
    ) => {
      const wrapped = wrapTextToWidthClamped(text, opts.font, opts.size, opts.maxW);
      const continuationStep = opts.size * 1.12;
      const entryHeight = (wrapped.length - 1) * continuationStep + opts.size;
      wrapped.forEach((line, index) => {
        lines.push({
          text: line,
          x: index === 0 ? opts.x : opts.x + 8,
          font: opts.font,
          size: opts.size,
          color: opts.color,
          step: index === wrapped.length - 1 ? opts.step : continuationStep,
          keepHeight: index === 0 ? entryHeight + (opts.isHeading ? opts.step + 10 : 0) : undefined
        });
      });
    };
    const addGap = (gap: number) => {
      if (lines.length) lines[lines.length - 1].step += gap;
    };

    table.courseBlocks.forEach((block) => {
      push(block.label, {
        x: leftX,
        font: bold,
        size: 10.5,
        color: rgb(0.11, 0.13, 0.18),
        step: 11,
        maxW: leftColW,
        isHeading: true
      });
      push(`Dish totals: ${block.dishCounts.map((entry) => `${entry.dish} (${entry.count})`).join(", ")}`, {
        x: leftX,
        font,
        size: 9.3,
        color: rgb(0.33, 0.37, 0.45),
        step: 10,
        maxW: leftColW
      });
      block.groupedByDish.forEach((group) => {
        push(`${block.label}: ${group.dish}`, {
          x: leftX + 4,
          font: bold,
          size: 10,
          color: rgb(0, 0, 0),
          step: 11,
          maxW: leftColW - 4,
          isHeading: true
        });
        group.guests.forEach((guest) => {
          const dietary = guest.dietary.length ? ` [${guest.dietary.join(", ")}]` : "";
          push(`- ${guest.name}${dietary}`, {
            x: leftX + 14,
            font,
            size: 9.2,
            color: guest.dietary.length ? rgb(0.66, 0.2, 0.06) : rgb(0.1, 0.12, 0.17),
            step: 10,
            maxW: leftColW - 22
          });
        });
        addGap(2);
      });
      addGap(4);
    });
    return lines;
  };

  data.tables.forEach((table) => {
    const pax =
      table.courseBlocks[0]?.groupedByDish.reduce((sum, group) => sum + group.guests.length, 0) ?? 0;
    const lines = buildTableLines(table);
    let lineIndex = 0;
    let part = 0;

    // A table that does not fit on the current page continues in a new box on the next page.
    while (part === 0 || lineIndex < lines.length) {
      const remainingH = lines.slice(lineIndex).reduce((sum, line) => sum + line.step, 0);
      const wantedH = Math.max(minBoxH, headerBlockH + remainingH + boxBottomPad);
      const minUsefulH = Math.min(wantedH, headerBlockH + 6 * 10 + boxBottomPad);
      if (y - minUsefulH < pageBottom) {
        page = doc.addPage([width, height]);
        y = height - 28;
      }
      const rowHeight = Math.min(wantedH, y - pageBottom);
      const rowTop = y;
      const rowBottom = y - rowHeight;
      const headerY = rowTop - 14;
      const headerDividerY = rowTop - 20;

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

      // PAX and the course tick-boxes follow the table name, so a long named table never overprints them.
      const paxText = `PAX: ${pax}`;
      const paxW = bold.widthOfTextAtSize(paxText, 10);
      const trailingW = part === 0 ? 14 + paxW + 16 + checkboxLabels.length * checkboxPitch : 0;
      const headerLabel = fitLine(
        fitTextToFont(
          part === 0 ? formatTableLabel(table.tableNumber) : `${formatTableLabel(table.tableNumber)} (cont.)`,
          bold
        ),
        bold,
        13,
        splitX - 14 - leftX - trailingW,
        9
      );
      page.drawText(headerLabel.text, {
        x: leftX,
        y: headerY,
        font: bold,
        size: headerLabel.size,
        color: rgb(0.11, 0.13, 0.18)
      });
      if (part === 0) {
        const paxX = Math.max(leftX + 102, leftX + bold.widthOfTextAtSize(headerLabel.text, headerLabel.size) + 14);
        page.drawText(paxText, {
          x: paxX,
          y: headerY,
          font: bold,
          size: 10,
          color: rgb(0.16, 0.2, 0.26)
        });
        drawCourseCheckboxes(Math.max(leftX + 150, paxX + paxW + 16), headerY + 9);
      }

      let localY = rowTop - headerBlockH;
      const drawnBefore = lineIndex;
      const floorY = rowBottom + boxBottomPad - 4;
      while (lineIndex < lines.length && localY >= floorY) {
        const line = lines[lineIndex];
        // Start a new entry only if all of it fits (unless the box is still empty).
        if (line.keepHeight && lineIndex > drawnBefore && localY - line.keepHeight + line.size < floorY) break;
        page.drawText(fitTextToFont(line.text, line.font), { x: line.x, y: localY, font: line.font, size: line.size, color: line.color });
        localY -= line.step;
        lineIndex += 1;
      }
      // Always make progress, even if a pathological page size leaves no room for a line.
      if (lineIndex === drawnBefore && lineIndex < lines.length) lineIndex += 1;

      drawScribbleArea(splitX, rowTop - 10, notesW, rowHeight - 16);
      y -= rowHeight + 8;
      part += 1;
    }
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
  page.drawText(fitTextToFont("Service Summary", titleBold), {
    x: 24,
    y,
    font: titleBold,
    size: 14,
    color: inkOnWhite(theme.primaryColor, "#012f43")
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
      page.drawText(truncateToWidth(fitTextToFont(`- ${dish} (${count})`, font), font, 9.3, width - 54), { x: 34, y, font, size: 9.3 });
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
        page.drawText(truncateToWidth(fitTextToFont(`- ${dish}:`, bold), bold, 9.3, width - 54), {
          x: 34,
          y,
          font: bold,
          size: 9.3
        });
        y -= 9.5;
        combos.forEach(([combo, count]) => {
          ensureSummarySpace(10);
          page.drawText(truncateToWidth(fitTextToFont(`  • ${combo} (${count})`, font), font, 9.2, width - 60), {
            x: 40,
            y,
            font,
            size: 9.2,
            color: rgb(0.63, 0.23, 0.07)
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

  const eventTitleFont = titleFontFor([theme.eventName || "Event"], title, bold);
  const eventTitle = fitTextToFont(theme.eventName || "Event", eventTitleFont);
  const maxTitleWidth = Math.max(100, width - safeSideWidth * 2 - 20);
  let titleSize = 30;
  let titleLines = wrapTextToWidth(eventTitle, eventTitleFont, titleSize, maxTitleWidth);
  while (titleLines.length > 2 && titleSize > 18) {
    titleSize -= 1;
    titleLines = wrapTextToWidth(eventTitle, eventTitleFont, titleSize, maxTitleWidth);
  }
  const titleLineHeight = titleSize + 3;
  const titleBlockHeight = titleLines.length * titleLineHeight;
  let titleY = height - 16 - titleSize - (2 - Math.min(2, titleLines.length)) * 4;
  if (titleBlockHeight > 44) {
    titleY -= (titleBlockHeight - 44) / 2;
  }
  const titleCenterY = titleY - ((Math.min(2, titleLines.length) - 1) * titleLineHeight) / 2 + titleSize * 0.35;
  titleLines.slice(0, 2).forEach((line, lineIndex) => {
    const lineWidth = eventTitleFont.widthOfTextAtSize(line, titleSize);
    page.drawText(line, {
      x: (width - lineWidth) / 2,
      y: titleY - lineIndex * titleLineHeight,
      font: eventTitleFont,
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
      const label = formatTableLabel(String(cell.tableNumber));
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
    menuCardContact?: MenuCardContact;
    /** Collects human-readable notices about content that could not be laid out as requested. */
    warnings?: string[];
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
    return renderPlaceCardsPdf(model, options.placeCard, options.theme, { warnings: options.warnings });
  }
  if (documentType === "menuBooklet") {
    return renderMenuBookletPdf(
      model,
      options.menuBooklet,
      options.theme,
      options.menuLongNames ?? {},
      options.dishMenuDuplicateGroups ?? [],
      options.menuCardContact,
      { warnings: options.warnings }
    );
  }
  if (documentType === "floorplan") {
    return renderFloorplanPdf(model, options.floorplan, options.theme);
  }
  return renderServicePlanPdf(model, options.theme);
}

/**
 * Guest and table names containing characters the print fonts have no glyphs for (e.g. Chinese,
 * Arabic). Those characters print as gaps, so callers should warn before anything goes to print.
 */
export async function findUndrawableText(model: EventModel): Promise<string[]> {
  const { body } = await createDocWithFonts();
  const warnings: string[] = [];
  const names = model.guests.filter((guest) => guest.name.trim() && !fontCanDraw(guest.name, body));
  if (names.length) {
    const shown = names
      .slice(0, 5)
      .map((guest) => `${guest.name}${guest.tableNumber ? ` (${formatTableLabel(guest.tableNumber)})` : ""}`)
      .join(", ");
    warnings.push(
      `${names.length} guest name${names.length === 1 ? " uses" : "s use"} characters the print font can't draw, so ${
        names.length === 1 ? "it" : "they"
      } will print blank or with gaps: ${shown}${names.length > 5 ? ` and ${names.length - 5} more` : ""}. Add a Latin spelling in Last-minute edits.`
    );
  }
  const tables = model.tableOrder.filter((table) => !fontCanDraw(formatTableLabel(table), body));
  if (tables.length) {
    warnings.push(`Table name${tables.length === 1 ? "" : "s"} with characters the print font can't draw: ${tables.slice(0, 5).join(", ")}.`);
  }
  return warnings;
}
