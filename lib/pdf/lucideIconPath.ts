/**
 * Lucide icons use a 24×24 viewBox; default stroke width is 2.
 *
 * **Do not** concatenate multi-path `d` strings: a leading `m` on path 2 is relative to (0,0)
 * when that path renders alone, but relative to path 1’s end when merged — wrong. Converting
 * `m`→`M` also breaks implicit line-tos (they become absolute after `M`).
 *
 * Draw each path segment with the same pdf-lib transform instead of merging.
 */
export type LucideIconNode = readonly (readonly [string, Record<string, string | number | undefined>])[];

/** One `d` string per `<path>` in the icon (preserves Lucide-relative commands). */
export function lucideIconPathDs(node: LucideIconNode): string[] {
  const ds: string[] = [];
  for (const [tag, attrs] of node) {
    if (tag === "path" && typeof attrs.d === "string") {
      ds.push(attrs.d);
    }
  }
  return ds;
}
