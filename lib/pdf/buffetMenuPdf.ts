import { readFile } from "node:fs/promises";
import { embedRasterBytes } from "@/lib/pdf/imageFormat";
import path from "node:path";
import { degrees, PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { ALLERGENS, type AllergenId } from "@/lib/buffetMenu/allergens";
import { allItemsInOrderForLabels, flattenForDisplayMenu, type DisplayLine } from "@/lib/buffetMenu/flattenMenu";
import { drawLucideIconStroke, lucideCheck, lucideSquare, lucideSquareCheck } from "@/lib/pdf/lucidePdfDraw";
import type { BuffetLabelSize, BuffetMenuState } from "@/types/buffetMenu";

function mmToPt(mm: number): number {
  return (mm * 72) / 25.4;
}

const LIB_FONTS = path.join(process.cwd(), "lib", "fonts");
const PDF_FONT_SOURCES = {
  body: path.join(LIB_FONTS, "NotoSans-Regular.ttf"),
  bodyLight: path.join(LIB_FONTS, "NotoSans-Light.ttf"),
  bodyBold: path.join(LIB_FONTS, "NotoSans-Bold.ttf"),
  bodyItalic: path.join(LIB_FONTS, "NotoSans-Italic.ttf")
};

const WATER_BG_PATH = path.join(process.cwd(), "lib", "assets", "buffet", "water-menu-bg.png");

const A4_PORTRAIT_W = mmToPt(210);
const A4_PORTRAIT_H = mmToPt(297);
const A4_LAND_W = mmToPt(297);
const A4_LAND_H = mmToPt(210);

/** Labels tile an A4 sheet exactly; label size = sheet size / grid. */
type LabelSheetFormat = {
  sheetW: number;
  sheetH: number;
  cols: number;
  rows: number;
  allergenCols: number;
  /** Max logo height as a fraction of label height. */
  logoMaxHRatio: number;
};

const LABEL_SHEET_FORMATS: Record<BuffetLabelSize, LabelSheetFormat> = {
  /* 105 × 148.5 mm, 2×2 on A4 portrait */
  a6: { sheetW: A4_PORTRAIT_W, sheetH: A4_PORTRAIT_H, cols: 2, rows: 2, allergenCols: 4, logoMaxHRatio: 0.28 },
  /* 74.25 × 105 mm, 4×2 on A4 landscape */
  a7: { sheetW: A4_LAND_W, sheetH: A4_LAND_H, cols: 4, rows: 2, allergenCols: 3, logoMaxHRatio: 0.22 }
};

/** Clear space kept at the foot of each label so a sign holder's lip doesn't cover the allergens. */
const LABEL_HOLDER_CLEARANCE_MM = 10;

/* Display menu spacing, all as fractions of the item font size so it scales with the menu. */
const DISPLAY_ITEM_GAP_RATIO = 0.38; /* extra between consecutive items */
const DISPLAY_AFTER_CATEGORY_RATIO = 0.55; /* between a category heading and its first item */
const DISPLAY_BEFORE_CATEGORY_RATIO = 0.9; /* between the previous group and the next heading */
const DISPLAY_LINE_HEIGHT = 1.25;
/** Baseline offset from the top of a line box, so ascenders stay inside the content band. */
const DISPLAY_BASELINE_FROM_TOP = 0.98;
const DISPLAY_MAX_ITEM_PT = 28;
const DISPLAY_MIN_ITEM_PT = 1;
/** Very long menus flow into extra columns rather than shrink items below this size. */
const DISPLAY_MIN_READABLE_PT = 10;
const DISPLAY_MAX_COLUMNS = 4;
const DISPLAY_COLUMN_GAP_MM = 8;

type EmbeddedFonts = { body: PDFFont; bodyBold: PDFFont; bodyItalic: PDFFont };

/** Noto Sans Light for the display menu; falls back to Regular if the file is missing. */
async function loadNotoForDisplayMenu(doc: PDFDocument, regular: PDFFont): Promise<PDFFont> {
  try {
    const bytes = await readFile(PDF_FONT_SOURCES.bodyLight);
    return await doc.embedFont(bytes, { subset: true });
  } catch {
    return regular;
  }
}

function wrapWords(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return [""];
  const words = t.split(" ");
  const lines: string[] = [];
  let cur = words[0]!;
  for (let i = 1; i < words.length; i++) {
    const trial = `${cur} ${words[i]!}`;
    if (font.widthOfTextAtSize(trial, fontSize) <= maxWidth) cur = trial;
    else {
      lines.push(cur);
      cur = words[i]!;
    }
  }
  lines.push(cur);
  return lines;
}

async function loadEmbeddedFonts(doc: PDFDocument): Promise<EmbeddedFonts> {
  const [b, bb] = await Promise.all([readFile(PDF_FONT_SOURCES.body), readFile(PDF_FONT_SOURCES.bodyBold)]);
  const [body, bodyBold] = await Promise.all([doc.embedFont(b, { subset: true }), doc.embedFont(bb, { subset: true })]);
  let bodyItalic = body;
  try {
    const bi = await readFile(PDF_FONT_SOURCES.bodyItalic);
    bodyItalic = await doc.embedFont(bi, { subset: true });
  } catch {
    /* optional file — fall back to Regular for "italic" */
  }
  return { body, bodyBold, bodyItalic };
}

async function embedImageFromBytes(doc: PDFDocument, bytes: Uint8Array): Promise<PDFImage> {
  const image = await embedRasterBytes(doc, bytes);
  if (!image) throw new Error("Logo is not a PNG or JPEG image.");
  return image;
}

type DisplayFonts = { item: PDFFont; category: PDFFont };

type DisplayBlock = {
  isCategory: boolean;
  font: PDFFont;
  size: number;
  lines: string[];
  /** Vertical space before this block's first line box (dropped at the top of a column). */
  gapBefore: number;
  /** Height of the line boxes, excluding `gapBefore`. */
  height: number;
};

/** Lays out the display menu at a given item size; every block's gap and line height derive from it. */
function layoutDisplayBlocks(
  displayLines: DisplayLine[],
  itemSize: number,
  categoryRatio: number,
  columnWidth: number,
  fonts: DisplayFonts
): DisplayBlock[] {
  const catSize = itemSize * categoryRatio;
  const blocks: DisplayBlock[] = [];
  for (let i = 0; i < displayLines.length; i++) {
    const line = displayLines[i]!;
    const prev = i > 0 ? displayLines[i - 1]! : null;
    const isCat = line.kind === "category";
    const font = isCat ? fonts.category : fonts.item;
    const size = isCat ? catSize : itemSize;
    const gapBefore = !prev
      ? 0
      : isCat
        ? itemSize * DISPLAY_BEFORE_CATEGORY_RATIO
        : prev.kind === "category"
          ? itemSize * DISPLAY_AFTER_CATEGORY_RATIO
          : itemSize * DISPLAY_ITEM_GAP_RATIO;
    const lines = wrapWords(line.title, font, size, columnWidth);
    blocks.push({ isCategory: isCat, font, size, lines, gapBefore, height: lines.length * size * DISPLAY_LINE_HEIGHT });
  }
  return blocks;
}

type DisplayColumn = { blocks: DisplayBlock[]; height: number };

/**
 * Greedily flows blocks into at most `maxColumns` columns of height `columnH`, never leaving a category
 * heading at the foot of a column without its first item. Returns null if the menu does not fit.
 */
function packDisplayColumns(blocks: DisplayBlock[], maxColumns: number, columnH: number): DisplayColumn[] | null {
  const columns: DisplayColumn[] = [{ blocks: [], height: 0 }];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const next = block.isCategory ? blocks[i + 1] : undefined;
    let col = columns[columns.length - 1]!;
    const needed = (c: DisplayColumn) =>
      (c.blocks.length ? block.gapBefore : 0) + block.height + (next ? next.gapBefore + next.height : 0);
    if (col.blocks.length && col.height + needed(col) > columnH) {
      if (columns.length >= maxColumns) return null;
      col = { blocks: [], height: 0 };
      columns.push(col);
    }
    if (col.height + needed(col) > columnH) return null;
    col.height += (col.blocks.length ? block.gapBefore : 0) + block.height;
    col.blocks.push(block);
  }
  return columns;
}

/**
 * A4 portrait display menu: full-bleed water background, Noto Sans Light (or Regular if Light is missing), centred in band.
 */
export async function renderBuffetDisplayMenuPdf(menu: BuffetMenuState): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const { body, bodyBold } = await loadEmbeddedFonts(doc);
  const displayFont = await loadNotoForDisplayMenu(doc, body);
  const fonts: DisplayFonts = { item: displayFont, category: bodyBold };
  const bgBytes = new Uint8Array(await readFile(WATER_BG_PATH));
  const bgImage = await embedImageFromBytes(doc, bgBytes);

  const page = doc.addPage([A4_PORTRAIT_W, A4_PORTRAIT_H]);
  const ph = A4_PORTRAIT_H;
  const pw = A4_PORTRAIT_W;
  page.drawImage(bgImage, { x: 0, y: 0, width: pw, height: ph });

  /* White band of the water background runs ~18%–82%; keep text clear of its edges. */
  const bandInset = mmToPt(6);
  const contentBottom = 0.18 * ph + bandInset;
  const contentTop = 0.82 * ph - bandInset;
  const contentH = contentTop - contentBottom;
  const yVC = (contentTop + contentBottom) / 2;
  const marginX = mmToPt(12);
  const contentWidth = pw - marginX * 2;
  const categoryRatio = 0.72;

  const displayLines = flattenForDisplayMenu(menu);
  if (displayLines.length === 0) {
    const emptyMsg = "Add menu items to generate this page.";
    const w = displayFont.widthOfTextAtSize(emptyMsg, 12);
    page.drawText(emptyMsg, {
      x: (pw - w) / 2,
      y: yVC,
      size: 12,
      font: displayFont,
      color: rgb(0, 0, 0)
    });
    return doc.save();
  }

  const columnGap = mmToPt(DISPLAY_COLUMN_GAP_MM);
  const columnWidthFor = (n: number) => (contentWidth - (n - 1) * columnGap) / n;
  const packAt = (size: number, n: number) =>
    packDisplayColumns(layoutDisplayBlocks(displayLines, size, categoryRatio, columnWidthFor(n), fonts), n, contentH);

  /* Largest item size (to 0.1pt) at which the whole menu fits the band in `n` columns. */
  const bestSizeFor = (n: number) => {
    let lo = DISPLAY_MIN_ITEM_PT;
    let hi = DISPLAY_MAX_ITEM_PT;
    if (packAt(hi, n)) return hi;
    while (hi - lo > 0.1) {
      const mid = (lo + hi) / 2;
      if (packAt(mid, n)) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  /* Fewest columns that keep text readable; if even the maximum can't, whichever count reads largest. */
  let columnCount = 1;
  let itemSize = bestSizeFor(1);
  for (let n = 2; n <= DISPLAY_MAX_COLUMNS && itemSize < DISPLAY_MIN_READABLE_PT; n++) {
    const size = bestSizeFor(n);
    if (size > itemSize) {
      itemSize = size;
      columnCount = n;
    }
  }
  const columnWidth = columnWidthFor(columnCount);
  const blocks = layoutDisplayBlocks(displayLines, itemSize, categoryRatio, columnWidth, fonts);
  const columns = packDisplayColumns(blocks, columnCount, contentH) ?? [
    { blocks, height: blocks.reduce((h, b, i) => h + (i ? b.gapBefore : 0) + b.height, 0) }
  ];

  /* Columns share a top edge; the tallest one is vertically centred in the band. */
  const tallest = Math.min(contentH, Math.max(...columns.map((c) => c.height)));
  const columnsTop = yVC + tallest / 2;
  columns.forEach((column, ci) => {
    const colLeft = marginX + ci * (columnWidth + columnGap);
    let lineTop = columnsTop;
    column.blocks.forEach((block, bi) => {
      if (bi > 0) lineTop -= block.gapBefore;
      const lineH = block.size * DISPLAY_LINE_HEIGHT;
      for (const w of block.lines) {
        const tw = block.font.widthOfTextAtSize(w, block.size);
        const x = colLeft + (columnWidth - tw) / 2;
        const y = lineTop - block.size * DISPLAY_BASELINE_FROM_TOP;
        page.drawText(w, { x, y, size: block.size, font: block.font, color: rgb(0, 0, 0) });
        lineTop -= lineH;
      }
    });
  });

  return doc.save();
}

const ink = rgb(0, 0, 0);
const lineGray = rgb(0.35, 0.35, 0.35);

/**
 * A4 landscape allergen matrix with grid lines and Lucide "check" marks in cells.
 * Paginates when items do not fit on a single page (up to MAX_BUFFET_MENU_ITEMS).
 */
export async function renderBuffetAllergenMatrixPdf(
  menu: BuffetMenuState,
  logoBytes: Uint8Array | null,
  allergenStatement = ""
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const { body, bodyBold, bodyItalic: _i } = await loadEmbeddedFonts(doc);
  void _i;
  const W = A4_LAND_W;
  const H = A4_LAND_H;
  const items = allItemsInOrderForLabels(menu);

  const margin = mmToPt(12);
  const titleSize = 18;
  const titleY = H - margin - titleSize * 0.75;
  const tableLeft = margin;
  const tableRight = W - margin;
  const tableW = tableRight - tableLeft;
  const nameColW = tableW * 0.27;
  const colW = (tableW - nameColW) / ALLERGENS.length;
  const namePadX = 4;
  const namePadBot = 4;
  const maxNameLines = 4;

  let logoImg: PDFImage | null = null;
  if (logoBytes && logoBytes.length > 0) {
    try {
      logoImg = await embedImageFromBytes(doc, logoBytes);
    } catch {
      /* skip */
    }
  }
  let logoW = 0;
  let logoH = 0;
  if (logoImg) {
    const r = Math.min(mmToPt(42) / logoImg.width, mmToPt(16) / logoImg.height);
    logoW = logoImg.width * r;
    logoH = logoImg.height * r;
  }
  /* Table starts a clear gap below whichever is taller: the title or the logo. */
  const tableTop = H - margin - Math.max(titleSize * 0.75, logoH) - mmToPt(8);

  /* Optional small-print statement at the foot of every page; long statements drop from 9pt to 8pt. */
  const statementParas = allergenStatement
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  let statementSize = 9;
  let statementLines: string[] = [];
  if (statementParas.length) {
    for (const size of [9, 8]) {
      statementSize = size;
      statementLines = statementParas.flatMap((p) => wrapWords(p, body, size, tableW));
      if (statementLines.length <= 4) break;
    }
  }
  const statementLH = statementSize * 1.3;
  const statementH = statementLines.length * statementLH;
  const tableBottom = margin + (statementH ? statementH + mmToPt(6) : 0);

  let fontSize = 10.5;
  let headerSize = 8.5;
  const HEADER_ROT_DEG = 45;
  const headerRad = (Math.PI * HEADER_ROT_DEG) / 180;
  const headerCos = Math.cos(headerRad);
  const headerSin = Math.sin(headerRad);

  const maxAllergyLabelWidth = (hs: number) =>
    Math.max(...ALLERGENS.map((a) => bodyBold.widthOfTextAtSize(a.shortLabel, hs)));
  /** Vertical room for one-line labels tilted 45° (span along y ≈ w·sin(45) plus padding). */
  const headerHForTilted = (hs: number) => {
    const w = maxAllergyLabelWidth(hs);
    return Math.min(90, Math.max(40, w * headerSin + hs * 0.85 + 18));
  };

  /** Distance from top grid line to first text baseline: cap height + small gap (keeps glyphs below the line). */
  const nameTopToFirstBaseline = (s: number) => s * 0.72 + 4;
  const rowHFor = (s: number, maxLines: number) => {
    const ls = s * 1.12;
    return nameTopToFirstBaseline(s) + (maxLines - 1) * ls + s * 0.22 + namePadBot;
  };

  const maxLinesForItems = (slice: typeof items, size: number) => {
    let maxLines = 1;
    for (const it of slice) {
      const raw = it.title.length > 200 ? it.title.slice(0, 197) + "…" : it.title;
      const lines = wrapWords(raw, body, size, nameColW - namePadX * 2);
      maxLines = Math.max(maxLines, Math.min(maxNameLines, lines.length));
    }
    return maxLines;
  };

  // Shrink until at least one data row fits under the header (pagination handles the rest).
  let maxLines = maxLinesForItems(items, fontSize);
  let rowH = rowHFor(fontSize, maxLines);
  let headerH = headerHForTilted(headerSize);
  for (let pass = 0; pass < 40; pass++) {
    maxLines = maxLinesForItems(items, fontSize);
    rowH = rowHFor(fontSize, maxLines);
    headerH = headerHForTilted(headerSize);
    if (headerH + rowH <= tableTop - tableBottom) break;
    fontSize = Math.max(3.4, fontSize * 0.97);
    headerSize = Math.max(3.0, fontSize * 0.82);
  }
  headerSize = Math.min(10.5, headerSize * 1.1);
  headerH = headerHForTilted(headerSize);
  maxLines = maxLinesForItems(items, fontSize);
  rowH = rowHFor(fontSize, maxLines);
  const lineStep = fontSize * 1.12;

  const bodyAvail = tableTop - tableBottom - headerH;
  const rowsPerPage = Math.max(1, Math.floor(bodyAvail / rowH));
  const pageChunks: (typeof items)[] =
    items.length === 0 ? [[]] : [];
  for (let i = 0; i < items.length; i += rowsPerPage) {
    pageChunks.push(items.slice(i, i + rowsPerPage));
  }

  for (let pageIndex = 0; pageIndex < pageChunks.length; pageIndex++) {
    const pageItems = pageChunks[pageIndex]!;
    const n = pageItems.length;
    const page = doc.addPage([W, H]);

    const title =
      pageChunks.length > 1 ? `Allergen Matrix (${pageIndex + 1}/${pageChunks.length})` : "Allergen Matrix";
    const titleW = bodyBold.widthOfTextAtSize(title, titleSize);
    page.drawText(title, { x: (W - titleW) / 2, y: titleY, size: titleSize, font: bodyBold, color: ink });

    let sy = margin + statementH - statementSize;
    for (const ln of statementLines) {
      page.drawText(ln, { x: tableLeft, y: sy, size: statementSize, font: body, color: ink });
      sy -= statementLH;
    }

    if (logoImg) {
      page.drawImage(logoImg, { x: W - margin - logoW, y: H - margin - logoH, width: logoW, height: logoH });
    }

    const dataTop = tableTop - headerH;
    const bottomY = dataTop - n * rowH;
    const lineT = 0.5;

    const horizYs: number[] = [tableTop, dataTop];
    for (let k = 1; k <= n; k++) {
      horizYs.push(dataTop - k * rowH);
    }
    for (const yH of horizYs) {
      page.drawLine({
        start: { x: tableLeft, y: yH },
        end: { x: tableRight, y: yH },
        thickness: lineT,
        color: lineGray
      });
    }
    const vertXs2: number[] = [tableLeft];
    for (let c = 0; c <= ALLERGENS.length; c++) {
      vertXs2.push(tableLeft + nameColW + c * colW);
    }
    for (const vx of vertXs2) {
      page.drawLine({ start: { x: vx, y: tableTop }, end: { x: vx, y: bottomY }, thickness: lineT, color: lineGray });
    }

    const headerBandMidY = (tableTop + dataTop) / 2;
    const nameHead = "Menu item";
    const headLines = wrapWords(nameHead, bodyBold, headerSize, nameColW - 2);
    const headBlockH = headLines.length * headerSize * 0.88;
    let hy = headerBandMidY + headBlockH / 2 - headerSize * 0.22;
    for (const ln of headLines) {
      const lw = bodyBold.widthOfTextAtSize(ln, headerSize);
      page.drawText(ln, { x: tableLeft + (nameColW - lw) / 2, y: hy, size: headerSize, font: bodyBold, color: ink });
      hy -= headerSize * 0.88;
    }
    for (let c = 0; c < ALLERGENS.length; c++) {
      const a = ALLERGENS[c]!;
      const colLeft = tableLeft + nameColW + c * colW;
      const label = a.shortLabel;
      const w = bodyBold.widthOfTextAtSize(label, headerSize);
      const cap = headerSize * 0.7;
      const cx = colLeft + colW / 2;
      const cy = headerBandMidY;
      const x = cx - (w / 2) * headerCos - cap * 0.35 * headerSin;
      const y = cy - (w / 2) * headerSin - cap * 0.35 * headerCos;
      page.drawText(label, {
        x,
        y,
        size: headerSize,
        font: bodyBold,
        color: ink,
        rotate: degrees(HEADER_ROT_DEG)
      });
    }

    for (let r = 0; r < n; r++) {
      const it = pageItems[r]!;
      const name = it.title.length > 200 ? it.title.slice(0, 197) + "…" : it.title;
      const rowTopY = dataTop - r * rowH;
      const rowBotY = rowTopY - rowH;
      const nameLines = wrapWords(name, body, fontSize, nameColW - namePadX * 2);
      const showLines = nameLines.slice(0, maxNameLines);
      if (nameLines.length > maxNameLines) {
        // Make it obvious the item name continues rather than silently cutting it off.
        let last = `${showLines[maxNameLines - 1]}…`;
        while (last.length > 1 && body.widthOfTextAtSize(last, fontSize) > nameColW - namePadX * 2) {
          last = `${last.slice(0, -2)}…`;
        }
        showLines[maxNameLines - 1] = last;
      }
      let ny = rowTopY - nameTopToFirstBaseline(fontSize);
      for (const nl of showLines) {
        page.drawText(nl, { x: tableLeft + namePadX, y: ny, size: fontSize, font: body, color: ink });
        ny -= lineStep;
      }
      const rowMidY = (rowTopY + rowBotY) / 2;
      const cell = Math.min(rowH, colW);
      const iconPt = Math.max(9, Math.min(20, cell * 0.72));
      for (let c = 0; c < ALLERGENS.length; c++) {
        const id = ALLERGENS[c]!.id as AllergenId;
        if (it.allergens[id]) {
          const cellCx = tableLeft + nameColW + (c + 0.5) * colW;
          drawLucideIconStroke(page, lucideCheck, cellCx, rowMidY, iconPt, ink);
        }
      }
    }
  }

  return doc.save();
}

/**
 * Buffet labels tiled on A4 (A6: 2×2 portrait sheet, A7: 4×2 landscape sheet);
 * top 75% logo, title, diet; bottom 25% allergen grid (Lucide Square / SquareCheck),
 * all raised above a blank strip at the foot of the label for the sign holder.
 */
export async function renderBuffetLabelSheetsPdf(
  menu: BuffetMenuState,
  logoBytes: Uint8Array | null,
  size: BuffetLabelSize = "a6"
): Promise<Uint8Array> {
  const { sheetW, sheetH, cols, rows, allergenCols, logoMaxHRatio } = LABEL_SHEET_FORMATS[size];
  const labelW = sheetW / cols;
  const labelH = sheetH / rows;
  const labelsPerSheet = cols * rows;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const { body, bodyBold, bodyItalic } = await loadEmbeddedFonts(doc);
  const items = allItemsInOrderForLabels(menu);

  let logoImg: PDFImage | null = null;
  if (logoBytes && logoBytes.length > 0) {
    try {
      logoImg = await embedImageFromBytes(doc, logoBytes);
    } catch {
      logoImg = null;
    }
  }

  if (items.length === 0) {
    const page = doc.addPage([sheetW, sheetH]);
    const msg = "No menu items to print.";
    const w = body.widthOfTextAtSize(msg, 12);
    page.drawText(msg, { x: (sheetW - w) / 2, y: sheetH - mmToPt(40), size: 12, font: body, color: ink });
    return doc.save();
  }

  for (let i = 0; i < items.length; i += labelsPerSheet) {
    const page = doc.addPage([sheetW, sheetH]);
    const batch = items.slice(i, i + labelsPerSheet);
    for (let s = 0; s < batch.length; s++) {
      const it = batch[s]!;
      /* Fill left-to-right, top-to-bottom. */
      const gx = s % cols;
      const gy = rows - 1 - Math.floor(s / cols);
      const x0 = gx * labelW;
      const y0 = gy * labelH;
      const pad = mmToPt(2.5);
      const borderInset = mmToPt(1.5);
      const innerW = labelW - pad * 2;
      const innerTop = y0 + labelH - pad;
      const innerBot = y0 + pad + mmToPt(LABEL_HOLDER_CLEARANCE_MM);
      const innerH = innerTop - innerBot;
      const allergenH = innerH * 0.25;
      const mainBandBottom = innerBot + allergenH;
      const mainH = innerTop - mainBandBottom;

      page.drawRectangle({
        x: x0 + borderInset,
        y: y0 + borderInset,
        width: labelW - 2 * borderInset,
        height: labelH - 2 * borderInset,
        borderColor: rgb(0.25, 0.32, 0.42),
        borderWidth: 1
      });

      let cursorY = innerTop;
      if (logoImg) {
        const maxW = innerW;
        const maxH = Math.min(labelH * logoMaxHRatio, mainH * 0.5);
        const r = Math.min(maxW / logoImg.width, maxH / logoImg.height, 1);
        const lw = logoImg.width * r;
        const lh = logoImg.height * r;
        page.drawImage(logoImg, { x: x0 + (labelW - lw) / 2, y: cursorY - lh, width: lw, height: lh });
        cursorY -= lh + mmToPt(2);
      }
      const title = it.title.trim() || "Item";
      const dietLine = it.vegan ? "Vegan" : it.vegetarian ? "Vegetarian" : null;
      const nAllergen = ALLERGENS.length;
      const gridCols = allergenCols;
      const gridRows = Math.ceil(nAllergen / gridCols);
      const colGap = mmToPt(0.35);
      const wCol = (innerW - (gridCols - 1) * colGap) / gridCols;

      const titleGapDiet = mmToPt(2.6);
      const availForTitle = cursorY - mainBandBottom - titleGapDiet;
      let titleSize = 30;
      let titleLines: string[] = [];
      const titleToDietGapH = dietLine ? mmToPt(1.6) : 0;
      for (let t = 0; t < 200 && titleSize >= 6.5; t++) {
        titleLines = wrapWords(title, bodyBold, titleSize, innerW);
        const titleBlockH = titleLines.length * titleSize * 1.1;
        const dietSize = Math.max(8, titleSize * 0.45);
        const dietH = dietLine ? titleToDietGapH + dietSize * 1.22 : 0;
        /* wrapWords never splits a word, so a single long word can still be wider than the label. */
        const fitsWidth =
          titleLines.every((l) => bodyBold.widthOfTextAtSize(l, titleSize) <= innerW) &&
          (!dietLine || bodyItalic.widthOfTextAtSize(dietLine, dietSize) <= innerW);
        if (fitsWidth && titleBlockH + dietH <= availForTitle) break;
        titleSize -= 0.5;
      }

      for (const line of titleLines) {
        cursorY -= titleSize * 1.1;
        const tw = bodyBold.widthOfTextAtSize(line, titleSize);
        page.drawText(line, { x: x0 + (labelW - tw) / 2, y: cursorY, size: titleSize, font: bodyBold, color: ink });
      }
      if (dietLine) {
        cursorY -= titleToDietGapH;
        const dietSize = Math.max(8, titleSize * 0.45);
        cursorY -= dietSize * 1.22;
        const dw = bodyItalic.widthOfTextAtSize(dietLine, dietSize);
        page.drawText(dietLine, { x: x0 + (labelW - dw) / 2, y: cursorY, size: dietSize, font: bodyItalic, color: ink });
      }

      const zonePad = mmToPt(1.2);
      const zoneTopY = mainBandBottom - zonePad;
      const zoneBotY = innerBot + zonePad;
      const useH = Math.max(0, zoneTopY - zoneBotY);
      const cellH = useH / Math.max(1, gridRows);
      const tfs = Math.min(9, Math.max(6.2, cellH * 0.62));
      const boxS = cellH * 0.85;
      for (let row = 0; row < gridRows; row++) {
        for (let col = 0; col < gridCols; col++) {
          const k = row * gridCols + col;
          if (k >= nAllergen) break;
          const a = ALLERGENS[k]!;
          const yRowTop = zoneTopY - row * cellH;
          const yMid = yRowTop - cellH * 0.5;
          const lab = a.shortLabel;
          const colX0 = x0 + pad + col * (wCol + colGap);
          const textGap = 0.75;
          const startX = colX0;
          const isOn = it.allergens[a.id as AllergenId];
          const iconCx = startX + boxS * 0.5;
          drawLucideIconStroke(page, isOn ? lucideSquareCheck : lucideSquare, iconCx, yMid, boxS, ink);
          const textBase = yMid - tfs * 0.32;
          page.drawText(lab, { x: startX + boxS + textGap, y: textBase, size: tfs, font: body, color: ink });
        }
      }
    }
  }

  return doc.save();
}

export async function renderAllBuffetPdfs(
  menu: BuffetMenuState,
  logo: { bytes: Uint8Array; contentType?: string } | null,
  options: { allergenStatement?: string } = {}
): Promise<{ display: Uint8Array; matrix: Uint8Array; labelsA6: Uint8Array; labelsA7: Uint8Array }> {
  const [display, matrix, labelsA6, labelsA7] = await Promise.all([
    renderBuffetDisplayMenuPdf(menu),
    renderBuffetAllergenMatrixPdf(menu, logo?.bytes ?? null, options.allergenStatement ?? ""),
    renderBuffetLabelSheetsPdf(menu, logo?.bytes ?? null, "a6"),
    renderBuffetLabelSheetsPdf(menu, logo?.bytes ?? null, "a7")
  ]);
  return { display, matrix, labelsA6, labelsA7 };
}
