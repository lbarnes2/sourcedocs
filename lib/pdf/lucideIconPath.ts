/**
 * Lucide icons use a 24×24 viewBox; default stroke width is 2.
 *
 * **Do not** concatenate multi-path `d` strings: a leading `m` on path 2 is relative to (0,0)
 * when that path renders alone, but relative to path 1’s end when merged — wrong. Converting
 * `m`→`M` also breaks implicit line-tos (they become absolute after `M`).
 *
 * Draw each path segment with the same pdf-lib transform instead of merging.
 *
 * `Square` / `SquareCheck` use `<rect>` (not path); we convert to an equivalent `d` for pdf-lib.
 */
export type LucideIconNode = readonly (readonly [string, Record<string, string | number | undefined>])[];

/** Rounded-rectangle to closed path; numbers match SVG `rect` + `rx` / `ry`. */
function rectAttrsToPathD(attrs: Record<string, string | number | undefined>): string {
  const x = Number(attrs.x);
  const y = Number(attrs.y);
  const w = Number(attrs.width);
  const h = Number(attrs.height);
  const rx = Number(attrs.rx ?? attrs.ry ?? 0);
  const ry = Number(attrs.ry ?? attrs.rx ?? rx);
  if (!Number.isFinite(x + y + w + h) || w <= 0 || h <= 0) return "";
  const rxc = Math.min(rx > 0 ? rx : 0, w / 2);
  const ryc = Math.min(ry > 0 ? ry : 0, h / 2);
  if (rxc <= 0 || ryc <= 0) {
    return `M${x} ${y}L${x + w} ${y}L${x + w} ${y + h}L${x} ${y + h}Z`;
  }
  return [
    `M${x + rxc} ${y}H${x + w - rxc}A${rxc} ${ryc} 0 0 1 ${x + w} ${y + ryc}V${y + h - ryc}A${rxc} ${ryc} 0 0 1 ${x + w - rxc} ${y + h}H${
      x + rxc
    }A${rxc} ${ryc} 0 0 1 ${x} ${y + h - ryc}V${y + ryc}A${rxc} ${ryc} 0 0 1 ${x + rxc} ${y}Z`
  ].join("");
}

/** Ellipse (or circle when rx = ry) as two half-arcs, so it closes cleanly. */
function ellipseToPathD(cx: number, cy: number, rx: number, ry: number): string {
  if (!Number.isFinite(cx + cy + rx + ry) || rx <= 0 || ry <= 0) return "";
  return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
}

function pointsToPathD(points: string | number | undefined, close: boolean): string {
  const nums = String(points ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter(Number.isFinite);
  if (nums.length < 4) return "";
  let d = `M${nums[0]} ${nums[1]}`;
  for (let i = 2; i + 1 < nums.length; i += 2) d += `L${nums[i]} ${nums[i + 1]}`;
  return close ? `${d}Z` : d;
}

/** One `d` string per drawable segment (`path`, or `rect` / `circle` / `ellipse` / `line` / `poly*` converted). */
export function lucideIconPathDs(node: LucideIconNode): string[] {
  const ds: string[] = [];
  for (const [tag, attrs] of node) {
    let d = "";
    if (tag === "path" && typeof attrs.d === "string") {
      d = attrs.d;
    } else if (tag === "rect" && typeof attrs.x !== "undefined" && typeof attrs.y !== "undefined") {
      d = rectAttrsToPathD(attrs);
    } else if (tag === "circle") {
      const r = Number(attrs.r);
      d = ellipseToPathD(Number(attrs.cx), Number(attrs.cy), r, r);
    } else if (tag === "ellipse") {
      d = ellipseToPathD(Number(attrs.cx), Number(attrs.cy), Number(attrs.rx), Number(attrs.ry));
    } else if (tag === "line") {
      d = `M${attrs.x1} ${attrs.y1}L${attrs.x2} ${attrs.y2}`;
    } else if (tag === "polyline" || tag === "polygon") {
      d = pointsToPathD(attrs.points, tag === "polygon");
    }
    if (d) ds.push(d);
  }
  return ds;
}
