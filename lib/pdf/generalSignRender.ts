import QRCode from "qrcode";
import { type PDFFont, type PDFImage, type PDFPage, rgb } from "pdf-lib";
import { embedRasterBytes } from "@/lib/pdf/imageFormat";
import { hexToRgb } from "@/lib/pdf/color";
import { fitTextToFont, titleFontFor } from "@/lib/pdf/fontText";
import { drawLucideIconStroke } from "@/lib/pdf/lucidePdfDraw";
import {
  INNER_BORDER_INSET,
  bodyMetricsAtSize,
  breakMultilineText,
  breakSignageTitleIntoLines,
  computeLogoPlacement,
  createDocWithFonts,
  drawSignageBorder,
  drawSignageLucideArrow,
  mmToPt,
  signagePageDimensions,
  titleMetricsAtSize
} from "@/lib/pdf/signageRender";
import { signSymbolNode, type SignSymbolId } from "@/lib/signage/symbols";
import type {
  GeneralSignTone,
  GeneralSignWifi,
  PaperOrientation,
  PaperSize,
  SignageArrowDirection,
  SignageThemeColors
} from "@/types";

export interface GeneralSignPageInput {
  paperSize: PaperSize;
  orientation: PaperOrientation;
  tone: GeneralSignTone;
  /** Up to three pictograms shown side by side (e.g. Gents + Ladies + Accessible). */
  symbols: SignSymbolId[];
  /** Main wording in Sora; may be empty when the symbols say it all. */
  heading: string;
  /** Secondary wording under the heading; line breaks are kept. */
  body?: string;
  arrow: SignageArrowDirection;
  /** Small line along the bottom edge, e.g. the event or venue name. */
  footer?: string;
  wifi?: GeneralSignWifi;
  theme: SignageThemeColors;
}

type Rgb = ReturnType<typeof rgb>;

const SAFETY_YELLOW = "#F9B000";
const SAFETY_BLACK = "#1D1D1B";
const SAFETY_RED = "#C8102E";
const SAFETY_RED_SOFT = "#F2B8C0";
const WHITE = rgb(1, 1, 1);

type Palette = {
  border: Rgb;
  borderAccent: Rgb;
  heading: Rgb;
  body: Rgb;
  /** Wi-Fi field labels, QR caption, arrow. */
  emphasis: Rgb;
  /** Badge fill (info circle, caution triangle, prohibition ring). */
  badge: Rgb;
  /** Pictogram stroke. */
  symbol: Rgb;
};

function paletteFor(tone: GeneralSignTone, theme: SignageThemeColors): Palette {
  const primary = hexToRgb(theme.primaryColor, "#012f43");
  const accent = hexToRgb(theme.accentColor, "#acc1cb");
  const text = hexToRgb(theme.textColor, "#0d1f28");
  const black = hexToRgb(SAFETY_BLACK, SAFETY_BLACK);
  switch (tone) {
    case "caution":
      return {
        border: black,
        borderAccent: hexToRgb(SAFETY_YELLOW, SAFETY_YELLOW),
        heading: black,
        body: black,
        emphasis: black,
        badge: hexToRgb(SAFETY_YELLOW, SAFETY_YELLOW),
        symbol: black
      };
    case "prohibition":
      return {
        border: hexToRgb(SAFETY_RED, SAFETY_RED),
        borderAccent: hexToRgb(SAFETY_RED_SOFT, SAFETY_RED_SOFT),
        heading: black,
        body: black,
        emphasis: hexToRgb(SAFETY_RED, SAFETY_RED),
        badge: hexToRgb(SAFETY_RED, SAFETY_RED),
        symbol: black
      };
    case "info":
      return { border: primary, borderAccent: accent, heading: text, body: text, emphasis: primary, badge: primary, symbol: WHITE };
    default:
      return { border: primary, borderAccent: accent, heading: text, body: text, emphasis: primary, badge: primary, symbol: primary };
  }
}

/* -------------------------------------------------------------------------- */
/* Pictogram badges                                                            */
/* -------------------------------------------------------------------------- */

/** Rounded equilateral triangle (apex up) as an SVG path in a y-down frame centred on (0,0). */
function roundedTrianglePathD(side: number, radius: number): string {
  const h = (side * Math.sqrt(3)) / 2;
  const pts = [
    { x: 0, y: -h / 2 },
    { x: side / 2, y: h / 2 },
    { x: -side / 2, y: h / 2 }
  ];
  const toward = (a: { x: number; y: number }, b: { x: number; y: number }, d: number) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: a.x + ((b.x - a.x) * d) / len, y: a.y + ((b.y - a.y) * d) / len };
  };
  let d = "";
  for (let i = 0; i < 3; i++) {
    const prev = pts[(i + 2) % 3]!;
    const cur = pts[i]!;
    const next = pts[(i + 1) % 3]!;
    const a = toward(cur, prev, radius);
    const b = toward(cur, next, radius);
    d += `${i === 0 ? "M" : "L"}${a.x} ${a.y}Q${cur.x} ${cur.y} ${b.x} ${b.y}`;
  }
  return `${d}Z`;
}

/** One pictogram at badge size `b`, centred on (cx, cy), styled for the tone. */
function drawSymbolBadge(
  page: PDFPage,
  id: SignSymbolId,
  tone: GeneralSignTone,
  cx: number,
  cy: number,
  b: number,
  palette: Palette
): void {
  const node = signSymbolNode(id);
  switch (tone) {
    case "info": {
      page.drawCircle({ x: cx, y: cy, size: b / 2, color: palette.badge });
      drawLucideIconStroke(page, node, cx, cy, b * 0.56, palette.symbol);
      return;
    }
    case "caution": {
      const side = b;
      const h = (side * Math.sqrt(3)) / 2;
      // drawSvgPath draws y-down from (x, y); the path is centred on the triangle's bounding box.
      page.drawSvgPath(roundedTrianglePathD(side, side * 0.08), {
        x: cx,
        y: cy,
        color: palette.badge,
        borderColor: palette.symbol,
        borderWidth: b * 0.055
      });
      // Incircle centre sits a third of the height above the base.
      const iconCy = cy - h / 2 + h * 0.36;
      drawLucideIconStroke(page, node, cx, iconCy, b * 0.42, palette.symbol);
      return;
    }
    case "prohibition": {
      const ring = b * 0.1;
      const r = b / 2 - ring / 2;
      page.drawCircle({ x: cx, y: cy, size: r, color: WHITE, borderColor: palette.badge, borderWidth: ring });
      drawLucideIconStroke(page, node, cx, cy, b * 0.56, palette.symbol);
      const inner = b / 2 - ring;
      const k = Math.SQRT1_2 * inner;
      page.drawLine({
        start: { x: cx - k, y: cy + k },
        end: { x: cx + k, y: cy - k },
        thickness: ring,
        color: palette.badge
      });
      return;
    }
    default:
      drawLucideIconStroke(page, node, cx, cy, b, palette.symbol);
  }
}

/* -------------------------------------------------------------------------- */
/* Caution hazard stripes                                                      */
/* -------------------------------------------------------------------------- */

type Pt = { x: number; y: number };

/** Sutherland–Hodgman clip of a convex polygon to an axis-aligned rectangle. */
function clipToRect(poly: Pt[], x0: number, y0: number, x1: number, y1: number): Pt[] {
  const edges: [(p: Pt) => boolean, (a: Pt, b: Pt) => Pt][] = [
    [(p) => p.x >= x0, (a, b) => ({ x: x0, y: a.y + ((b.y - a.y) * (x0 - a.x)) / (b.x - a.x) })],
    [(p) => p.x <= x1, (a, b) => ({ x: x1, y: a.y + ((b.y - a.y) * (x1 - a.x)) / (b.x - a.x) })],
    [(p) => p.y >= y0, (a, b) => ({ x: a.x + ((b.x - a.x) * (y0 - a.y)) / (b.y - a.y), y: y0 })],
    [(p) => p.y <= y1, (a, b) => ({ x: a.x + ((b.x - a.x) * (y1 - a.y)) / (b.y - a.y), y: y1 })]
  ];
  let out = poly;
  for (const [inside, cut] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i]!;
      const prev = input[(i + input.length - 1) % input.length]!;
      if (inside(cur)) {
        if (!inside(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (inside(prev)) {
        out.push(cut(prev, cur));
      }
    }
    if (!out.length) break;
  }
  return out;
}

/** Yellow band with black 45° stripes, filling the rectangle (PDF coordinates). */
function drawHazardBand(page: PDFPage, x: number, y: number, w: number, h: number, yellow: Rgb, black: Rgb): void {
  page.drawRectangle({ x, y, width: w, height: h, color: yellow });
  const stripe = h * 0.75;
  const pageH = page.getHeight();
  for (let sx = x - h; sx < x + w; sx += stripe * 2) {
    const poly = clipToRect(
      [
        { x: sx, y },
        { x: sx + stripe, y },
        { x: sx + stripe + h, y: y + h },
        { x: sx + h, y: y + h }
      ],
      x,
      y,
      x + w,
      y + h
    );
    if (poly.length < 3) continue;
    // drawSvgPath is y-down from its origin, so draw from the page's top-left corner.
    const d = poly.map((p, i) => `${i ? "L" : "M"}${p.x} ${pageH - p.y}`).join("") + "Z";
    page.drawSvgPath(d, { x: 0, y: pageH, color: black });
  }
}

/* -------------------------------------------------------------------------- */
/* Wi-Fi QR                                                                    */
/* -------------------------------------------------------------------------- */

/** Wi-Fi join string understood by iOS and Android cameras. */
export function wifiQrPayload(wifi: GeneralSignWifi): string {
  const esc = (s: string) => s.replace(/([\\;,":])/g, "\\$1");
  const parts = [`T:${wifi.security}`, `S:${esc(wifi.network)}`];
  if (wifi.security !== "nopass" && wifi.password) parts.push(`P:${esc(wifi.password)}`);
  return `WIFI:${parts.join(";")};;`;
}

/** QR code as filled rectangles (one per horizontal run of dark modules), `size` square, top-left at (x, topY). */
function drawQr(page: PDFPage, payload: string, x: number, topY: number, size: number, color: Rgb): void {
  const qr = QRCode.create(payload, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const data = qr.modules.data;
  const m = size / n;
  for (let row = 0; row < n; row++) {
    let col = 0;
    while (col < n) {
      if (!data[row * n + col]) {
        col++;
        continue;
      }
      const start = col;
      while (col < n && data[row * n + col]) col++;
      // A hair of overlap avoids hairline seams between runs in some PDF viewers.
      page.drawRectangle({
        x: x + start * m,
        y: topY - (row + 1) * m - 0.05,
        width: (col - start) * m + 0.05,
        height: m + 0.1,
        color
      });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

/** A vertically stacked piece of the sign; `draw` gets the column centre and the block's top edge. */
type Block = { height: number; width: number; draw: (cx: number, topY: number) => void };

type TextStyle = { font: PDFFont; size: number; color: Rgb; metrics: (s: number) => { capH: number; desc: number; lineHeight: number } };

function textBlock(page: PDFPage, lines: string[], style: TextStyle): Block {
  const { capH, desc, lineHeight } = style.metrics(style.size);
  const width = Math.max(0, ...lines.map((l) => style.font.widthOfTextAtSize(l, style.size)));
  return {
    height: capH + (lines.length - 1) * lineHeight + desc,
    width,
    draw: (cx, topY) => {
      lines.forEach((line, i) => {
        const lw = style.font.widthOfTextAtSize(line, style.size);
        page.drawText(line, { x: cx - lw / 2, y: topY - capH - i * lineHeight, font: style.font, size: style.size, color: style.color });
      });
    }
  };
}

/** Blocks stacked with `gap` between them. */
function stack(blocks: Block[], gap: number): Block {
  const height = blocks.reduce((sum, b) => sum + b.height, 0) + gap * Math.max(0, blocks.length - 1);
  return {
    height,
    width: Math.max(0, ...blocks.map((b) => b.width)),
    draw: (cx, topY) => {
      let y = topY;
      for (const b of blocks) {
        b.draw(cx, y);
        y -= b.height + gap;
      }
    }
  };
}

type Fonts = { title: PDFFont; body: PDFFont; bodyBold: PDFFont };

type ColumnContent = {
  symbols: boolean;
  qr: boolean;
  heading: boolean;
  body: boolean;
  wifi: boolean;
  arrow: boolean;
};

/** What one fitting attempt tolerates: split words, and how many lines the heading may wrap to. */
type FitRules = { allowSplit: boolean; maxHeadingLines: number };

/**
 * Builds one column at scale `s` (1 = preferred size) for width `colW`, or null when the result breaks `rules`.
 */
function buildColumn(
  page: PDFPage,
  spec: GeneralSignPageInput,
  include: ColumnContent,
  fonts: Fonts,
  palette: Palette,
  unit: number,
  colW: number,
  s: number,
  rules: FitRules
): Block | null {
  let split = false;
  const onSplit = () => (split = true);
  const blocks: Block[] = [];
  const gap = unit * 0.055 * s;

  if (include.symbols && spec.symbols.length) {
    const n = spec.symbols.length;
    const spacing = 0.2;
    const b = Math.min(unit * (n === 1 ? 0.4 : 0.32) * s, colW / (n + spacing * (n - 1)));
    const rowW = n * b + (n - 1) * spacing * b;
    blocks.push({
      height: b,
      width: rowW,
      draw: (cx, topY) => {
        spec.symbols.forEach((id, i) => {
          const x = cx - rowW / 2 + b / 2 + i * b * (1 + spacing);
          drawSymbolBadge(page, id, spec.tone, x, topY - b / 2, b, palette);
        });
      }
    });
  }

  if (include.heading && spec.heading.trim()) {
    const size = Math.min(130, unit * 0.16) * s;
    const text = fitTextToFont(spec.heading.trim(), fonts.title);
    const lines = breakSignageTitleIntoLines(text, (t) => fonts.title.widthOfTextAtSize(t, size), colW, onSplit);
    if (lines.length > rules.maxHeadingLines) return null;
    blocks.push(textBlock(page, lines, { font: fonts.title, size, color: palette.heading, metrics: titleMetricsAtSize }));
  }

  if (include.body && spec.body?.trim()) {
    const size = unit * 0.058 * s;
    const lines = breakMultilineText(spec.body, (t) => fonts.body.widthOfTextAtSize(t, size), colW, onSplit);
    // Messages can be a full paragraph (e.g. a photography disclaimer), so give them paragraph leading.
    const paragraphMetrics = (sz: number) => ({ ...bodyMetricsAtSize(sz), lineHeight: sz * 1.3 });
    blocks.push(textBlock(page, lines, { font: fonts.body, size, color: palette.body, metrics: paragraphMetrics }));
  }

  if (include.wifi && spec.wifi) {
    const labelSize = unit * 0.034 * s;
    const valueSize = unit * 0.072 * s;
    const fields: [string, string][] = [["Network", spec.wifi.network]];
    if (spec.wifi.security !== "nopass" && spec.wifi.password) fields.push(["Password", spec.wifi.password]);
    const rows = fields.map(([label, value]) => {
      // Network names and passwords print exactly; one too long for the column is split by character as a last resort.
      const valueLines = breakSignageTitleIntoLines(value, (t) => fonts.bodyBold.widthOfTextAtSize(t, valueSize), colW, onSplit);
      return stack(
        [
          textBlock(page, [label], { font: fonts.body, size: labelSize, color: palette.emphasis, metrics: bodyMetricsAtSize }),
          textBlock(page, valueLines, { font: fonts.bodyBold, size: valueSize, color: palette.heading, metrics: bodyMetricsAtSize })
        ],
        labelSize * 0.45
      );
    });
    blocks.push(stack(rows, gap * 0.8));
  }

  if (split && !rules.allowSplit) return null;

  if (include.qr && spec.wifi?.showQr) {
    const q = Math.min(unit * 0.3 * s, colW);
    const captionSize = unit * 0.03 * s;
    const payload = wifiQrPayload(spec.wifi);
    const caption = textBlock(page, ["Scan to join"], {
      font: fonts.body,
      size: captionSize,
      color: palette.emphasis,
      metrics: bodyMetricsAtSize
    });
    const qrBlock: Block = { height: q, width: q, draw: (cx, topY) => drawQr(page, payload, cx - q / 2, topY, q, rgb(0, 0, 0)) };
    blocks.push(stack([qrBlock, caption], captionSize * 0.7));
  }

  if (include.arrow && spec.arrow !== "none") {
    const a = Math.min(unit * 0.26 * s, colW);
    // Lucide's left/right arrows only span the middle third of their box vertically.
    const horizontal = spec.arrow === "left" || spec.arrow === "right";
    const h = a * (horizontal ? 0.5 : 1);
    blocks.push({
      height: h,
      width: a,
      draw: (cx, topY) => drawSignageLucideArrow(page, cx, topY - h / 2, a, spec.arrow, palette.emphasis)
    });
  }

  return stack(blocks, gap);
}

/**
 * Largest scale (≤ 1) at which the column fits `maxH`. Prefers a heading of at most three lines with no split
 * words — a short heading in a tall column would otherwise stay huge and stack one word per line.
 */
function fitColumn(build: (s: number, rules: FitRules) => Block | null, maxH: number): Block {
  const passes: FitRules[] = [
    { allowSplit: false, maxHeadingLines: 3 },
    { allowSplit: false, maxHeadingLines: Infinity },
    { allowSplit: true, maxHeadingLines: Infinity }
  ];
  for (const rules of passes) {
    for (let s = 1; s >= 0.2; s -= 0.02) {
      const col = build(s, rules);
      if (col && col.height <= maxH) return col;
    }
  }
  return build(0.2, passes[2]!)!;
}

/* -------------------------------------------------------------------------- */
/* Render                                                                      */
/* -------------------------------------------------------------------------- */

export async function renderGeneralSignPdf(
  pages: GeneralSignPageInput[],
  options: {
    venueBytes?: { bytes: Uint8Array; contentType?: string } | null;
    clientBytes?: { bytes: Uint8Array; contentType?: string } | null;
  }
): Promise<Uint8Array> {
  const { doc, title: sora, body, bodyBold } = await createDocWithFonts();
  const venueImg: PDFImage | null = options.venueBytes ? await embedRasterBytes(doc, options.venueBytes.bytes) : null;
  const clientImg: PDFImage | null = options.clientBytes ? await embedRasterBytes(doc, options.clientBytes.bytes) : null;

  for (const spec of pages) {
    const [pageWidth, pageHeight] = signagePageDimensions(spec.paperSize, spec.orientation);
    const page = doc.addPage([pageWidth, pageHeight]);
    const palette = paletteFor(spec.tone, spec.theme);
    const fonts: Fonts = { title: titleFontFor([spec.heading], sora, bodyBold), body, bodyBold };
    const unit = Math.min(pageWidth, pageHeight);

    page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: WHITE });

    const margin = mmToPt(14);
    const borderW = pageWidth - 2 * margin;
    const borderH = pageHeight - 2 * margin;
    drawSignageBorder(page, {
      x: margin,
      y: margin,
      width: borderW,
      height: borderH,
      primary: palette.border,
      accent: palette.borderAccent
    });

    const innerLeft = margin + INNER_BORDER_INSET;
    const innerBottom = margin + INNER_BORDER_INSET;
    const innerW = borderW - 2 * INNER_BORDER_INSET;
    const innerTop = pageHeight - margin - INNER_BORDER_INSET;

    const band = spec.tone === "caution" ? mmToPt(spec.paperSize === "A3" ? 12 : 9) : 0;
    if (band) {
      const inset = mmToPt(1.5);
      const bx = innerLeft + inset;
      const bw = innerW - 2 * inset;
      drawHazardBand(page, bx, innerBottom + inset, bw, band, palette.badge, palette.symbol);
      drawHazardBand(page, bx, innerTop - inset - band, bw, band, palette.badge, palette.symbol);
    }

    // Logos sit below the top hazard band on caution signs.
    const logoMargin = margin + band;
    const logoBox = Math.min(mmToPt(42), borderW * 0.22);
    const logoPad = mmToPt(8);
    const venuePl = computeLogoPlacement(pageWidth, pageHeight, logoMargin, logoPad, logoBox, venueImg, "tl");
    const clientPl = computeLogoPlacement(pageWidth, pageHeight, logoMargin, logoPad, logoBox, clientImg, "tr");
    if (venuePl && venueImg) {
      page.drawImage(venueImg, { x: venuePl.x, y: venuePl.bottomY, width: venuePl.dw, height: venuePl.dh });
    }
    if (clientPl && clientImg) {
      page.drawImage(clientImg, { x: clientPl.x, y: clientPl.bottomY, width: clientPl.dw, height: clientPl.dh });
    }

    const pad = mmToPt(spec.paperSize === "A3" ? 14 : 10);
    let contentTop = innerTop - band - pad;
    const logoBottoms = [venuePl?.bottomY, clientPl?.bottomY].filter((y): y is number => y != null);
    if (logoBottoms.length) contentTop = Math.min(contentTop, Math.min(...logoBottoms) - mmToPt(8));

    let contentBottom = innerBottom + band + pad;
    const footerText = spec.footer?.trim() ? fitTextToFont(spec.footer.trim(), body) : "";
    if (footerText) {
      const size = Math.min(22, Math.max(11, unit * 0.028));
      const lines = breakSignageTitleIntoLines(footerText, (t) => body.widthOfTextAtSize(t, size), innerW - 2 * pad).slice(0, 2);
      const footer = textBlock(page, lines, { font: body, size, color: palette.body, metrics: bodyMetricsAtSize });
      const footerBottom = innerBottom + band + pad * 0.7;
      footer.draw(pageWidth / 2, footerBottom + footer.height);
      contentBottom = footerBottom + footer.height + pad;
    }

    const contentLeft = innerLeft + pad;
    const contentW = innerW - 2 * pad;
    const availH = contentTop - contentBottom;

    const hasVisual = spec.symbols.length > 0 || Boolean(spec.wifi?.showQr);
    const hasText = Boolean(spec.heading.trim() || spec.body?.trim() || spec.wifi || spec.arrow !== "none");
    const all: ColumnContent = { symbols: true, qr: true, heading: true, body: true, wifi: true, arrow: true };

    const placeColumn = (col: Block, cx: number) => {
      const top = contentBottom + (availH + col.height) / 2;
      col.draw(cx, top);
    };

    if (spec.orientation === "landscape" && hasVisual && hasText) {
      // Symbols / QR on the left, sized first; the wording gets whatever width they leave.
      const gutter = contentW * 0.06;
      const leftInclude: ColumnContent = { symbols: true, qr: true, heading: false, body: false, wifi: false, arrow: false };
      const rightInclude: ColumnContent = { symbols: false, qr: false, heading: true, body: true, wifi: true, arrow: true };
      const left = fitColumn((s, r) => buildColumn(page, spec, leftInclude, fonts, palette, unit, contentW * 0.4, s, r), availH);
      const rightW = contentW - left.width - gutter;
      const right = fitColumn((s, r) => buildColumn(page, spec, rightInclude, fonts, palette, unit, rightW, s, r), availH);
      const startX = contentLeft + (contentW - (left.width + gutter + right.width)) / 2;
      placeColumn(left, startX + left.width / 2);
      placeColumn(right, startX + left.width + gutter + right.width / 2);
    } else {
      const col = fitColumn((s, r) => buildColumn(page, spec, all, fonts, palette, unit, contentW, s, r), availH);
      placeColumn(col, contentLeft + contentW / 2);
    }
  }

  return new Uint8Array(await doc.save());
}
