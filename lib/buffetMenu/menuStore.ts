import { emptyAllergenMap } from "@/lib/buffetMenu/allergens";
import type { BuffetMenuCategory, BuffetMenuItem, BuffetMenuState } from "@/types/buffetMenu";

export const BUFFET_UNCAT_CONTAINER = "__uncategorized__" as const;

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `m-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export type BuffetMenuStore = {
  categories: BuffetMenuCategory[];
  /** `BUFFET_UNCAT_CONTAINER` + one key per category id → ordered item ids */
  orderMap: Record<string, string[]>;
  items: Record<string, BuffetMenuItem>;
};

export function createEmptyMenuStore(): BuffetMenuStore {
  return {
    categories: [],
    orderMap: { [BUFFET_UNCAT_CONTAINER]: [] },
    items: {}
  };
}

export function toMenuState(store: BuffetMenuStore): BuffetMenuState {
  const items: BuffetMenuItem[] = [];
  const un = store.orderMap[BUFFET_UNCAT_CONTAINER] ?? [];
  for (const id of un) {
    const it = store.items[id];
    if (it) items.push({ ...it, categoryId: null });
  }
  for (const cat of store.categories) {
    const list = store.orderMap[cat.id] ?? [];
    for (const id of list) {
      const it = store.items[id];
      if (it) items.push({ ...it, categoryId: cat.id });
    }
  }
  return { categories: store.categories, items };
}

export function fromMenuState(state: BuffetMenuState): BuffetMenuStore {
  const orderMap: Record<string, string[]> = {
    [BUFFET_UNCAT_CONTAINER]: []
  };
  for (const c of state.categories) {
    orderMap[c.id] = [];
  }
  for (const it of state.items) {
    if (it.categoryId == null) {
      orderMap[BUFFET_UNCAT_CONTAINER]!.push(it.id);
    } else {
      if (!orderMap[it.categoryId]) orderMap[it.categoryId] = [];
      orderMap[it.categoryId]!.push(it.id);
    }
  }
  const byId: Record<string, BuffetMenuItem> = {};
  for (const it of state.items) {
    byId[it.id] = { ...it };
  }
  return {
    categories: state.categories.map((c) => ({ ...c })),
    orderMap,
    items: byId
  };
}

export function newItem(partial: Partial<BuffetMenuItem> = {}): BuffetMenuItem {
  return {
    id: newId(),
    title: "",
    categoryId: null,
    allergens: emptyAllergenMap(),
    vegetarian: false,
    vegan: false,
    ...partial
  };
}

export function newCategory(title = "New category"): BuffetMenuCategory {
  return { id: newId(), title };
}

export function containerKeys(store: BuffetMenuStore): string[] {
  return [BUFFET_UNCAT_CONTAINER, ...store.categories.map((c) => c.id)];
}
