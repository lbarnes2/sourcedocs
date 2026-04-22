import type { BuffetMenuCategory, BuffetMenuItem, BuffetMenuState } from "@/types/buffetMenu";

export type DisplayLine =
  | { kind: "category"; title: string }
  | { kind: "item"; title: string; item: BuffetMenuItem };

/** Uncategorised first (in `items` order for those with no category), then each category in order with its items. Omits empty categories. */
export function flattenForDisplayMenu(menu: BuffetMenuState): DisplayLine[] {
  const { categories, items } = menu;
  const out: DisplayLine[] = [];

  for (const it of items) {
    if (it.title.trim() && it.categoryId == null) {
      out.push({ kind: "item", title: it.title.trim(), item: it });
    }
  }

  for (const cat of categories) {
    const catItems = items.filter((it) => it.categoryId === cat.id && it.title.trim());
    if (catItems.length === 0) continue;
    out.push({ kind: "category", title: cat.title.trim() || "Untitled" });
    for (const it of catItems) {
      out.push({ kind: "item", title: it.title.trim(), item: it });
    }
  }

  return out;
}

export function itemRowsForMatrix(menu: BuffetMenuState): BuffetMenuItem[] {
  const lines = flattenForDisplayMenu(menu);
  return lines.filter((L): L is { kind: "item"; title: string; item: BuffetMenuItem } => L.kind === "item").map(
    (L) => L.item
  );
}

export function allItemsInOrderForLabels(menu: BuffetMenuState): BuffetMenuItem[] {
  return itemRowsForMatrix(menu);
}
