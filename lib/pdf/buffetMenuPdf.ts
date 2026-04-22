import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { normalizeForCormorant } from "@/lib/buffetMenu/cormorantNormalize";
import { ALLERGENS, type AllergenId } from "@/lib/buffetMenu/allergens";
import { allItemsInOrderForLabels, flattenForDisplayMenu, type DisplayLine } from "@/lib/buffetMenu/flattenMenu";
import { drawLucideIconStroke, lucideCheck, lucideSquare, lucideSquareCheck } from "@/lib/pdf/lucidePdfDraw";
import type { BuffetMenuState } from "@/types/buffetMenu";

function mmToPt(mm: number): number {
  return (mm * 72) / 25.4;
}

const LIB_FONTS = path.join(process.cwd(), "lib", "fonts");
const PDF_FONT_SOURCES = {
  body: path.join(LIB_FONTS, "NotoSans-Regular.ttf"),
  bodyBold: path.join(LIB_FONTS, "NotoSans-Bold.ttf"),
  bodyItalic: path.join(LIB_FONTS, "NotoSans-Italic.ttf"),
  title: path.join(LIB_FONTS, "CormorantGaramond-wght.ttf")
};

const WATER_BG_PATH = path.join(process.cwd(), "lib", "assets", "buffet", "water-menu-bg.png");

const A4_PORTRAIT_W = mmToPt(210);
const A4_PORTRAIT_H = mmToPt(297);
const A4_LAND_W = mmToPt(297);
const A4_LAND_H = mmToPt(210);

const A6_W = mmToPt(105);
const A6_H = mmToPt(148.5);
const LABELS_PER_SHEET = 4;

/** Spacing after each food item (not after category title lines, except small gap). */
const DISPLAY_ITEM_GAP_RATIO = 0.22; /* of item line height */
const DISPLAY_AFTER_CATEGORY_PT = 3;

type EmbeddedFonts = { body: PDFFont; bodyBold: PDFFont; bodyItalic: PDFFont };

async function loadTitleFont(doc: PDFDocument): Promise<PDFFont> {
  const b = await readFile(PDF_FONT_SOURCES.title);
  return doc.embedFont(b, { subset: false });
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

async function embedImageFromBytes(
  doc: PDFDocument,
  bytes: Uint8Array,
  contentType?: string
): Promise<PDFImage> {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("png")) return doc.embedPng(bytes);
  if (ct.includes("jpeg") || ct.includes("jpg")) return doc.embedJpg(bytes);
  if (bytes.length >= 2 && bytes[0] === 0x89 && bytes[1] === 0x50) return doc.embedPng(bytes);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return doc.embedJpg(bytes);
  try {
    return await doc.embedPng(bytes);
  } catch {
    return doc.embedJpg(bytes);
  }
}

function totalDisplayHeight(
  displayLines: DisplayLine[],
  itemSize: number,
  categoryRatio: number,
  contentWidth: number,
  title: PDFFont
): number {
  const catSize = itemSize * categoryRatio;
  const itemLH = itemSize * 1.25;
  const catLH = catSize * 1.25;
  const itemGap = itemSize * DISPLAY_ITEM_GAP_RATIO;
  let h = 0;
  for (let i = 0; i < displayLines.length; i++) {
    const line = displayLines[i]!;
    if (line.kind === "category") {
      const wrapped = wrapWords(normalizeForCormorant(line.title), title, catSize, contentWidth);
      h += wrapped.length * catLH;
      h += DISPLAY_AFTER_CATEGORY_PT;
    } else {
      const wrapped = wrapWords(normalizeForCormorant(line.title), title, itemSize, contentWidth);
      h += wrapped.length * itemLH;
      h += itemGap;
    }
  }
  if (displayLines.length && displayLines[displayLines.length - 1]!.kind === "item") {
    h -= itemGap;
  }
  return h;
}

/**
 * A4 portrait display menu: full-bleed water background, text only in the central band (~64% of height), centred.
 */
export async function renderBuffetDisplayMenuPdf(menu: BuffetMenuState): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const title = await loadTitleFont(doc);
  const bgBytes = new Uint8Array(await readFile(WATER_BG_PATH));
  const bgImage = await embedImageFromBytes(doc, bgBytes);

  const page = doc.addPage([A4_PORTRAIT_W, A4_PORTRAIT_H]);
  const ph = A4_PORTRAIT_H;
  const pw = A4_PORTRAIT_W;
  page.drawImage(bgImage, { x: 0, y: 0, width: pw, height: ph });

  const contentBottom = 0.18 * ph;
  const contentTop = 0.82 * ph;
  const contentH = contentTop - contentBottom;
  const yVC = (contentTop + contentBottom) / 2;
  const marginX = mmToPt(12);
  const contentWidth = pw - marginX * 2;
  const categoryRatio = 0.72;
  const itemGap = (size: number) => size * DISPLAY_ITEM_GAP_RATIO;

  const displayLines = flattenForDisplayMenu(menu);
  if (displayLines.length === 0) {
    const emptyMsg = "Add menu items to generate this page.";
    const w = title.widthOfTextAtSize(emptyMsg, 12);
    page.drawText(emptyMsg, {
      x: (pw - w) / 2,
      y: yVC,
      size: 12,
      font: title,
      color: rgb(0, 0, 0)
    });
    return doc.save();
  }

  let lo = 5;
  let hi = 28;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const t = totalDisplayHeight(displayLines, mid, categoryRatio, contentWidth, title);
    if (t <= contentH) lo = mid;
    else hi = mid - 1;
  }
  const itemSize = lo;
  const catSize = itemSize * categoryRatio;
  const itemLH = itemSize * 1.25;
  const catLH = catSize * 1.25;
  const gap = itemGap(itemSize);

  const totalH = totalDisplayHeight(displayLines, itemSize, categoryRatio, contentWidth, title);
  /* Vertically centre the full block; first baseline = band centre + half block height. */
  let cursorY = yVC + totalH / 2;
  for (let idx = 0; idx < displayLines.length; idx++) {
    const line = displayLines[idx]!;
    if (line.kind === "category") {
      const wrapped = wrapWords(normalizeForCormorant(line.title), title, catSize, contentWidth);
      for (const w of wrapped) {
        const tw = title.widthOfTextAtSize(w, catSize);
        const x = marginX + (contentWidth - tw) / 2;
        page.drawText(w, { x, y: cursorY, size: catSize, font: title, color: rgb(0, 0, 0) });
        cursorY -= catLH;
      }
      cursorY -= DISPLAY_AFTER_CATEGORY_PT;
    } else {
      const wrapped = wrapWords(normalizeForCormorant(line.title), title, itemSize, contentWidth);
      for (const w of wrapped) {
        const tw = title.widthOfTextAtSize(w, itemSize);
        const x = marginX + (contentWidth - tw) / 2;
        page.drawText(w, { x, y: cursorY, size: itemSize, font: title, color: rgb(0, 0, 0) });
        cursorY -= itemLH;
      }
      if (idx < displayLines.length - 1) cursorY -= gap;
    }
    if (cursorY < contentBottom) break;
  }

  return doc.save();
}

const ink = rgb(0, 0, 0);
const lineGray = rgb(0.35, 0.35, 0.35);

/**
 * A4 landscape allergen matrix with grid lines and Lucide "check" marks in cells.
 */
export async function renderBuffetAllergenMatrixPdf(
  menu: BuffetMenuState,
  logoBytes: Uint8Array | null,
  logoContentType?: string
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const { body, bodyBold, bodyItalic: _i } = await loadEmbeddedFonts(doc);
  void _i;
  const page = doc.addPage([A4_LAND_W, A4_LAND_H]);
  const W = A4_LAND_W;
  const H = A4_LAND_H;
  const items = allItemsInOrderForLabels(menu);

  const margin = mmToPt(8);
  const titleY = H - margin - 16;
  const title = "Allergen Matrix";
  const titleW = bodyBold.widthOfTextAtSize(title, 16);
  page.drawText(title, { x: (W - titleW) / 2, y: titleY, size: 16, font: bodyBold, color: ink });

  if (logoBytes && logoBytes.length > 0) {
    try {
      const logoImg = await embedImageFromBytes(doc, logoBytes, logoContentType);
      const maxLogoW = mmToPt(42);
      const maxLogoH = mmToPt(16);
      const r = Math.min(maxLogoW / logoImg.width, maxLogoH / logoImg.height);
      const logoW = logoImg.width * r;
      const logoH = logoImg.height * r;
      page.drawImage(logoImg, { x: W - margin - logoW, y: H - margin - logoH, width: logoW, height: logoH });
    } catch {
      /* skip */
    }
  }

  const tableTop = titleY - 30;
  const tableLeft = margin;
  const tableRight = W - margin;
  const tableBottom = margin + 6;
  const nameColW = (tableRight - tableLeft) * 0.26;
  const colW = (tableRight - tableLeft - nameColW) / ALLERGENS.length;
  const n = items.length;
  const maxRows = 40;
  const namePadBot = 2.2;
  const maxNameLines = 4;

  let fontSize = 8.5;
  let headerSize = 6.2;
  const headerH = 24;
  let lineStep = fontSize * 1.12;
  /** Distance from top grid line to first text baseline: cap height + small gap (keeps glyphs below the line). */
  const nameTopToFirstBaseline = (s: number) => s * 0.72 + 1.2;
  const rowHFor = (s: number, maxLines: number) => {
    const ls = s * 1.12;
    return nameTopToFirstBaseline(s) + (maxLines - 1) * ls + s * 0.22 + namePadBot;
  };
  let rowH = rowHFor(fontSize, maxNameLines);
  for (let pass = 0; pass < 40; pass++) {
    lineStep = fontSize * 1.12;
    let maxLines = 1;
    for (const it of items) {
      const raw = it.title.length > 200 ? it.title.slice(0, 197) + "…" : it.title;
      const lines = wrapWords(raw, body, fontSize, nameColW - 3);
      maxLines = Math.max(maxLines, Math.min(maxNameLines, lines.length));
    }
    rowH = rowHFor(fontSize, maxLines);
    const bodyH = n * rowH;
    if (headerH + bodyH <= tableTop - tableBottom && n <= maxRows) break;
    fontSize = Math.max(3.2, fontSize * 0.96);
    headerSize = Math.max(2.8, fontSize * 0.8);
  }
  lineStep = fontSize * 1.12;

  const dataTop = tableTop - headerH;
  const bottomY = dataTop - n * rowH;
  const lineT = 0.5;

  /* Full grid: horizontals then verticals, then text on top. */
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

  /* Header row text — vertically centred in the header band between tableTop and dataTop */
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
    const short = a.shortLabel;
    const lines = wrapWords(short, bodyBold, headerSize, colW - 0.5);
    const blockH = lines.length * headerSize * 0.88;
    let colY = headerBandMidY + blockH / 2 - headerSize * 0.22;
    for (const ln of lines) {
      const lw = bodyBold.widthOfTextAtSize(ln, headerSize);
      page.drawText(ln, { x: colLeft + (colW - lw) / 2, y: colY, size: headerSize, font: bodyBold, color: ink });
      colY -= headerSize * 0.88;
    }
  }

  /* Data: name block top-padded to row (aligns to grid); up to 4 wrapped lines; checks centred in cell */
  for (let r = 0; r < n; r++) {
    const it = items[r]!;
    const name = it.title.length > 200 ? it.title.slice(0, 197) + "…" : it.title;
    const rowTopY = dataTop - r * rowH;
    const rowBotY = rowTopY - rowH;
    const nameLines = wrapWords(name, body, fontSize, nameColW - 3);
    const showLines = nameLines.slice(0, maxNameLines);
    /* First baseline: below top row line by cap+gap so outlines stay inside the cell */
    let ny = rowTopY - nameTopToFirstBaseline(fontSize);
    for (const nl of showLines) {
      page.drawText(nl, { x: tableLeft + 2, y: ny, size: fontSize, font: body, color: ink });
      ny -= lineStep;
    }
    const rowMidY = (rowTopY + rowBotY) / 2;
    const iconPt = Math.min(rowH, colW) * 0.4;
    for (let c = 0; c < ALLERGENS.length; c++) {
      const id = ALLERGENS[c]!.id as AllergenId;
      if (it.allergens[id]) {
        const cellCx = tableLeft + nameColW + (c + 0.5) * colW;
        drawLucideIconStroke(page, lucideCheck, cellCx, rowMidY, iconPt, ink);
      }
    }
  }

  return doc.save();
}

/**
 * A6 labels: 2×2 on A4; top 75% logo, title, diet; bottom 25% allergen grid (3 cols, Lucide Square / SquareCheck).
 */
export async function renderBuffetLabelSheetsPdf(
  menu: BuffetMenuState,
  logoBytes: Uint8Array | null,
  logoContentType?: string
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const { body, bodyBold, bodyItalic } = await loadEmbeddedFonts(doc);
  const items = allItemsInOrderForLabels(menu);

  let logoImg: PDFImage | null = null;
  if (logoBytes && logoBytes.length > 0) {
    try {
      logoImg = await embedImageFromBytes(doc, logoBytes, logoContentType);
    } catch {
      logoImg = null;
    }
  }

  if (items.length === 0) {
    const page = doc.addPage([A4_PORTRAIT_W, A4_PORTRAIT_H]);
    const msg = "No menu items to print.";
    const w = body.widthOfTextAtSize(msg, 12);
    page.drawText(msg, { x: (A4_PORTRAIT_W - w) / 2, y: A4_PORTRAIT_H - mmToPt(40), size: 12, font: body, color: ink });
    return doc.save();
  }

  const slots: [number, number][] = [
    [0, 1],
    [1, 1],
    [0, 0],
    [1, 0]
  ];

  for (let i = 0; i < items.length; i += LABELS_PER_SHEET) {
    const page = doc.addPage([A4_PORTRAIT_W, A4_PORTRAIT_H]);
    const batch = items.slice(i, i + LABELS_PER_SHEET);
    for (let s = 0; s < batch.length; s++) {
      const it = batch[s]!;
      const [gx, gy] = slots[s]!;
      const x0 = gx * A6_W;
      const y0 = gy * A6_H;
      const pad = mmToPt(2.5);
      const borderInset = mmToPt(1.5);
      const innerW = A6_W - pad * 2;
      const innerTop = y0 + A6_H - pad;
      const innerBot = y0 + pad;
      const innerH = innerTop - innerBot;
      const allergenH = innerH * 0.25;
      const mainBandBottom = innerBot + allergenH;
      const mainH = innerTop - mainBandBottom;

      page.drawRectangle({
        x: x0 + borderInset,
        y: y0 + borderInset,
        width: A6_W - 2 * borderInset,
        height: A6_H - 2 * borderInset,
        borderColor: rgb(0.25, 0.32, 0.42),
        borderWidth: 1
      });

      let cursorY = innerTop;
      if (logoImg) {
        const maxW = innerW;
        const maxH = Math.min(A6_H * 0.28, mainH * 0.5);
        const r = Math.min(maxW / logoImg.width, maxH / logoImg.height, 1);
        const lw = logoImg.width * r;
        const lh = logoImg.height * r;
        page.drawImage(logoImg, { x: x0 + (A6_W - lw) / 2, y: cursorY - lh, width: lw, height: lh });
        cursorY -= lh + mmToPt(2);
      }
      const title = it.title.trim() || "Item";
      const dietLine = it.vegan ? "Vegan" : it.vegetarian ? "Vegetarian" : null;
      const nAllergen = ALLERGENS.length;
      const gridCols = 3;
      const gridRows = Math.ceil(nAllergen / gridCols);
      const colGap = mmToPt(0.6);
      const wCol = (innerW - (gridCols - 1) * colGap) / gridCols;

      const titleGapDiet = mmToPt(1.2);
      const availForTitle = cursorY - mainBandBottom - titleGapDiet;
      let titleSize = 30;
      let titleLines: string[] = [];
      for (let t = 0; t < 200 && titleSize >= 6.5; t++) {
        titleLines = wrapWords(title, bodyBold, titleSize, innerW);
        const titleBlockH = titleLines.length * titleSize * 1.1;
        const dietH = dietLine ? Math.max(8, titleSize * 0.44) * 1.22 : 0;
        if (titleBlockH + dietH <= availForTitle) break;
        titleSize -= 0.5;
      }

      for (const line of titleLines) {
        cursorY -= titleSize * 1.1;
        const tw = bodyBold.widthOfTextAtSize(line, titleSize);
        page.drawText(line, { x: x0 + (A6_W - tw) / 2, y: cursorY, size: titleSize, font: bodyBold, color: ink });
      }
      if (dietLine) {
        const dietSize = Math.max(8, titleSize * 0.45);
        cursorY -= dietSize * 1.28;
        const dw = bodyItalic.widthOfTextAtSize(dietLine, dietSize);
        page.drawText(dietLine, { x: x0 + (A6_W - dw) / 2, y: cursorY, size: dietSize, font: bodyItalic, color: ink });
      }

      const zonePad = mmToPt(1.2);
      const zoneTopY = mainBandBottom - zonePad;
      const zoneBotY = innerBot + zonePad;
      const useH = Math.max(0, zoneTopY - zoneBotY);
      const cellH = useH / Math.max(1, gridRows);
      const tfs = Math.min(6.2, Math.max(3.8, cellH * 0.38));
      const boxS = Math.min(5, Math.max(3.6, cellH * 0.42));
      for (let row = 0; row < gridRows; row++) {
        for (let col = 0; col < gridCols; col++) {
          const k = row * gridCols + col;
          if (k >= nAllergen) break;
          const a = ALLERGENS[k]!;
          const yRowTop = zoneTopY - row * cellH;
          const yMid = yRowTop - cellH * 0.5;
          const lab = a.shortLabel;
          const tw2 = body.widthOfTextAtSize(lab, tfs);
          const colX0 = x0 + pad + col * (wCol + colGap);
          const textGap = 1.1;
          const groupW = boxS + textGap + tw2;
          const startX = colX0 + (wCol - groupW) / 2;
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
  logo: { bytes: Uint8Array; contentType?: string } | null
): Promise<{ display: Uint8Array; matrix: Uint8Array; labels: Uint8Array }> {
  const [display, matrix, labels] = await Promise.all([
    renderBuffetDisplayMenuPdf(menu),
    renderBuffetAllergenMatrixPdf(menu, logo?.bytes ?? null, logo?.contentType),
    renderBuffetLabelSheetsPdf(menu, logo?.bytes ?? null, logo?.contentType)
  ]);
  return { display, matrix, labels };
}
