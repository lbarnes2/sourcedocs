"use client";

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  closestCorners,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { catSortableId, parseSortableId } from "@/app/buffet-menu/dndTypes";
import { ALLERGENS, type AllergenId } from "@/lib/buffetMenu/allergens";
import {
  BUFFET_UNCAT_CONTAINER,
  type BuffetMenuStore,
  containerKeys,
  createEmptyMenuStore,
  fromMenuState,
  newCategory,
  newItem,
  toMenuState
} from "@/lib/buffetMenu/menuStore";
import type { BuffetMenuItem } from "@/types/buffetMenu";

type Store = BuffetMenuStore;

function findItemContainerLocal(store: Store, itemId: string): string | null {
  for (const k of containerKeys(store)) {
    if ((store.orderMap[k] || []).includes(itemId)) return k;
  }
  return null;
}

function resolveOverContainer(store: Store, overId: string): string | null {
  if (String(overId).startsWith("cat:")) {
    const p = parseSortableId(overId);
    if (p.kind === "cat" && store.categories.some((c) => c.id === p.value)) return p.value;
  }
  if (containerKeys(store).includes(overId)) return overId;
  return findItemContainerLocal(store, overId);
}

function applyItemDragEnd(store: Store, activeId: string, overId: string | null): Store {
  if (!overId) return store;
  const from = findItemContainerLocal(store, activeId);
  if (!from) return store;
  const to = resolveOverContainer(store, overId);
  if (!to) return store;
  if (from === to) {
    const list = [...(store.orderMap[from] || [])];
    const oldIndex = list.indexOf(activeId);
    if (oldIndex < 0) return store;
    let newIndex = list.indexOf(overId);
    if (newIndex < 0) {
      if (overId === from) newIndex = list.length - 1;
      else return store;
    }
    if (oldIndex === newIndex) return store;
    return {
      ...store,
      orderMap: { ...store.orderMap, [from]: arrayMove(list, oldIndex, newIndex) }
    };
  }
  const fromList = (store.orderMap[from] || []).filter((id) => id !== activeId);
  const toList = [...(store.orderMap[to] || [])];
  let insertIndex = toList.indexOf(overId);
  if (insertIndex < 0) insertIndex = toList.length;
  toList.splice(insertIndex, 0, activeId);
  const newCat = to === BUFFET_UNCAT_CONTAINER ? null : to;
  const item = store.items[activeId];
  if (!item) return store;
  return {
    ...store,
    orderMap: { ...store.orderMap, [from]: fromList, [to]: toList },
    items: { ...store.items, [activeId]: { ...item, categoryId: newCat } }
  };
}

function applyCategoryDragEnd(store: Store, activeId: string, overId: string | null): Store {
  if (!overId) return store;
  const a = parseSortableId(activeId);
  const o = parseSortableId(overId);
  if (a.kind !== "cat" || o.kind !== "cat") return store;
  const ids = store.categories.map((c) => c.id);
  const oldIndex = ids.indexOf(a.value);
  const newIndex = ids.indexOf(o.value);
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return store;
  const next = arrayMove([...store.categories], oldIndex, newIndex);
  return { ...store, categories: next };
}

type LogoItem = { key: string; label: string; assetUrl: string };

function SortableCategoryRow({
  id,
  title,
  onTitle,
  onRemove
}: {
  id: string;
  title: string;
  onTitle: (v: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: catSortableId(id) });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="buffet-cat-row">
      <button type="button" className="buffet-drag-h" aria-label="Drag to reorder category" {...attributes} {...listeners}>
        ⣿
      </button>
      <input className="buffet-cat-input" value={title} onChange={(e) => onTitle(e.target.value)} placeholder="Category name" />
      <button type="button" className="secondary buffet-cat-remove" onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}

function SortableItemRow({
  itemId,
  item,
  onChange,
  onRemove
}: {
  itemId: string;
  item: BuffetMenuItem;
  onChange: (next: BuffetMenuItem) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: itemId });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="buffet-item-row">
      <button type="button" className="buffet-drag-h" aria-label="Drag to reorder item" {...attributes} {...listeners}>
        ⣿
      </button>
      <div className="buffet-item-fields">
        <input
          className="buffet-item-title"
          value={item.title}
          onChange={(e) => onChange({ ...item, title: e.target.value })}
          placeholder="Menu item"
        />
        <div className="buffet-allergen-grid">
          {ALLERGENS.map((a) => (
            <label key={a.id} className="buffet-allergen-cell">
              <input
                type="checkbox"
                checked={item.allergens[a.id as AllergenId]}
                onChange={(e) =>
                  onChange({
                    ...item,
                    allergens: { ...item.allergens, [a.id]: e.target.checked }
                  })
                }
              />
              <span>{a.shortLabel}</span>
            </label>
          ))}
        </div>
        <div className="buffet-diet-row">
          <label>
            <input
              type="checkbox"
              checked={item.vegetarian}
              onChange={(e) => {
                const v = e.target.checked;
                onChange({ ...item, vegetarian: v, vegan: v ? item.vegan : false });
              }}
            />
            Vegetarian
          </label>
          <label>
            <input
              type="checkbox"
              checked={item.vegan}
              onChange={(e) => {
                const v = e.target.checked;
                onChange({ ...item, vegan: v, vegetarian: v ? true : item.vegetarian });
              }}
            />
            Vegan
          </label>
        </div>
      </div>
      <button type="button" className="secondary buffet-item-remove" onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}

function ItemColumnDrop({
  id,
  children,
  emptyLabel
}: {
  id: string;
  children: React.ReactNode;
  emptyLabel: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`buffet-item-col${isOver ? " buffet-item-col--over" : ""}`}>
      {children}
      <p className="buffet-empty-hint text-muted">{emptyLabel}</p>
    </div>
  );
}

export default function BuffetMenuPage() {
  const [store, setStore] = useState<BuffetMenuStore>(() => createEmptyMenuStore());
  const [savedName, setSavedName] = useState("Untitled menu");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [venueLogos, setVenueLogos] = useState<LogoItem[]>([]);
  const [logosConfigured, setLogosConfigured] = useState(false);
  const [venueLogoKey, setVenueLogoKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedList, setSavedList] = useState<{ id: string; name: string; savedAt: string }[]>([]);
  const [r2SaveEnabled, setR2SaveEnabled] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const refreshSaved = useCallback(async () => {
    try {
      const res = await fetch("/api/buffet-menu/saved");
      const data = (await res.json()) as { configured?: boolean; items?: { id: string; name: string; savedAt: string }[] };
      setR2SaveEnabled(Boolean(data.configured));
      if (data.configured && data.items) setSavedList(data.items);
      else setSavedList([]);
    } catch {
      setSavedList([]);
      setR2SaveEnabled(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/logos/venue");
        const data = (await res.json()) as { configured?: boolean; items?: LogoItem[] };
        setLogosConfigured(Boolean(data.configured));
        setVenueLogos(data.items ?? []);
      } catch {
        setVenueLogos([]);
      }
      await refreshSaved();
    })();
  }, [refreshSaved]);

  const categoryIds = useMemo(() => store.categories.map((c) => catSortableId(c.id)), [store.categories]);

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const parsed = parseSortableId(active.id);
    if (parsed.kind === "cat") {
      setStore((s) => applyCategoryDragEnd(s, String(active.id), String(over.id)));
      return;
    }
    setStore((s) => applyItemDragEnd(s, parsed.value, String(over.id)));
  };

  const addCategory = () => {
    const cat = newCategory();
    setStore((s) => ({
      ...s,
      categories: [...s.categories, cat],
      orderMap: { ...s.orderMap, [cat.id]: [] }
    }));
  };

  const removeCategory = (catId: string) => {
    setStore((s) => {
      const cat = s.categories.find((c) => c.id === catId);
      if (!cat) return s;
      const rem = { ...s.orderMap };
      const mov = rem[catId] ?? [];
      delete rem[catId];
      const u = [...(rem[BUFFET_UNCAT_CONTAINER] ?? []), ...mov];
      const nextItems = { ...s.items };
      for (const iid of mov) {
        const it = nextItems[iid];
        if (it) nextItems[iid] = { ...it, categoryId: null };
      }
      return {
        ...s,
        categories: s.categories.filter((c) => c.id !== catId),
        orderMap: { ...rem, [BUFFET_UNCAT_CONTAINER]: u },
        items: nextItems
      };
    });
  };

  const addItemTo = (containerId: string) => {
    const it = newItem(
      containerId === BUFFET_UNCAT_CONTAINER ? { categoryId: null } : { categoryId: containerId }
    );
    setStore((s) => ({
      ...s,
      items: { ...s.items, [it.id]: it },
      orderMap: { ...s.orderMap, [containerId]: [...(s.orderMap[containerId] ?? []), it.id] }
    }));
  };

  const removeItem = (itemId: string) => {
    setStore((s) => {
      const nextO = { ...s.orderMap };
      for (const k of Object.keys(nextO)) {
        nextO[k] = (nextO[k] || []).filter((id) => id !== itemId);
      }
      const { [itemId]: _, ...rest } = s.items;
      return { ...s, orderMap: nextO, items: rest };
    });
  };

  const updateItem = (item: BuffetMenuItem) => {
    setStore((s) => ({ ...s, items: { ...s.items, [item.id]: item } }));
  };

  const downloadZip = async () => {
    setError("");
    setBusy(true);
    try {
      const menu = toMenuState(store);
      const res = await fetch("/api/buffet-menu/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          menu,
          venueLogoKey: venueLogoKey || null
        })
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || "Generation failed.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "buffet-menu-documents.zip";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  };

  const saveToCloud = async () => {
    setError("");
    setBusy(true);
    try {
      const menu = toMenuState(store);
      const res = await fetch("/api/buffet-menu/saved", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: savedId ?? undefined,
          name: savedName.trim() || "Untitled menu",
          menu,
          venueLogoKey: venueLogoKey || null
        })
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "Save failed.");
      }
      const j = (await res.json()) as { id: string };
      setSavedId(j.id);
      await refreshSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const loadSaved = async (id: string) => {
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`/api/buffet-menu/saved/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error("Could not load.");
      const doc = (await res.json()) as { name: string; venueLogoKey: string | null; menu: import("@/types/buffetMenu").BuffetMenuState };
      setSavedName(doc.name);
      setSavedId(id);
      setVenueLogoKey(doc.venueLogoKey || "");
      setStore(fromMenuState(doc.menu));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed.");
    } finally {
      setBusy(false);
    }
  };

  const deleteSaved = async (id: string) => {
    if (!window.confirm("Delete this saved menu?")) return;
    setError("");
    try {
      const res = await fetch(`/api/buffet-menu/saved/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed.");
      if (savedId === id) {
        setSavedId(null);
        setStore(createEmptyMenuStore());
      }
      await refreshSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    }
  };

  const newMenu = () => {
    if (store.items && Object.keys(store.items).length > 0 && !window.confirm("Clear the current menu?")) return;
    setSavedId(null);
    setStore(createEmptyMenuStore());
    setSavedName("Untitled menu");
  };

  return (
    <main className="app-buffet">
      <header className="app-header">
        <Link href="/" className="app-backlink">
          ← Home
        </Link>
        <h1>Buffet menu documents</h1>
        <p className="app-tagline">Build a menu with categories and allergen data, then download display menu, allergen matrix, and buffet label sheets. Saved menus are stored in the cloud when R2 is configured.</p>
      </header>

      {error ? <p className="error panel">{error}</p> : null}

      <div className="panel">
        <h2>Saved menus</h2>
        <div className="grid two buffet-saved-bar">
          <div className="field-stack">
            <span className="field-label-text">Menu name</span>
            <input value={savedName} onChange={(e) => setSavedName(e.target.value)} maxLength={200} />
          </div>
          <div className="field-stack" style={{ justifyContent: "flex-end" }}>
            <div className="buffet-saved-actions">
              <button type="button" onClick={saveToCloud} disabled={busy || !r2SaveEnabled} title={!r2SaveEnabled ? "R2 is not configured" : ""}>
                Save
              </button>
              <button type="button" className="secondary" onClick={newMenu} disabled={busy}>
                New
              </button>
            </div>
          </div>
        </div>
        {savedList.length > 0 ? (
          <ul className="buffet-saved-list">
            {savedList.map((s) => (
              <li key={s.id}>
                <button type="button" className="text-button" onClick={() => void loadSaved(s.id)}>
                  {s.name}
                </button>
                <span className="text-muted"> · {new Date(s.savedAt).toLocaleString()}</span>
                <button type="button" className="secondary small" onClick={() => void deleteSaved(s.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{r2SaveEnabled ? "No saved menus yet." : "R2 is not configured — save/load disabled."}</p>
        )}
      </div>

      <div className="panel">
        <h2>Venue logo (matrix and labels)</h2>
        <p className="text-muted">Select a logo from the library for the allergen matrix and buffet labels.</p>
        <div className="signage-logo-grid">
          {venueLogos.map((logo) => (
            <button
              key={logo.key}
              type="button"
              className={`signage-logo-tile${venueLogoKey === logo.key ? " signage-logo-tile--selected" : ""}`}
              onClick={() => setVenueLogoKey(logo.key)}
            >
              <span className="signage-logo-tile-hit">
                <img className="signage-logo-tile-img" src={logo.assetUrl} alt="" />
              </span>
              <span className="signage-logo-tile-label">{logo.label}</span>
            </button>
          ))}
        </div>
        {venueLogoKey ? (
          <button type="button" className="secondary" style={{ marginTop: 8 }} onClick={() => setVenueLogoKey("")}>
            Clear selection
          </button>
        ) : null}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
        <div className="panel">
          <h2>Categories</h2>
          <p className="text-muted">Drag to reorder. Items stay inside their block until you move them in the item sections below.</p>
          <SortableContext items={categoryIds} strategy={verticalListSortingStrategy}>
            {store.categories.map((c) => (
              <SortableCategoryRow
                key={c.id}
                id={c.id}
                title={c.title}
                onTitle={(t) => setStore((s) => ({ ...s, categories: s.categories.map((x) => (x.id === c.id ? { ...x, title: t } : x)) }))}
                onRemove={() => removeCategory(c.id)}
              />
            ))}
          </SortableContext>
          <button type="button" onClick={addCategory} className="secondary" style={{ marginTop: 8 }}>
            Add category
          </button>
        </div>

        <div className="panel">
          <h2>Menu items</h2>
          <p className="text-muted">Drag items with the handle. Use “Add” in each section — uncategorised first, then each category’s block.</p>

          <h3>Uncategorised</h3>
          <ItemColumnDrop id={BUFFET_UNCAT_CONTAINER} emptyLabel="Drop items here or add new.">
            <SortableContext
              items={store.orderMap[BUFFET_UNCAT_CONTAINER] ?? []}
              strategy={verticalListSortingStrategy}
            >
              {(store.orderMap[BUFFET_UNCAT_CONTAINER] ?? []).map((id) => {
                const it = store.items[id];
                if (!it) return null;
                return (
                  <SortableItemRow key={id} itemId={id} item={it} onChange={updateItem} onRemove={() => removeItem(id)} />
                );
              })}
            </SortableContext>
          </ItemColumnDrop>
          <button type="button" className="secondary" onClick={() => addItemTo(BUFFET_UNCAT_CONTAINER)} style={{ marginTop: 6 }}>
            Add item (uncategorised)
          </button>

          {store.categories.map((c) => (
            <div key={c.id} className="buffet-cat-block">
              <h3>{c.title || "Untitled category"}</h3>
              <ItemColumnDrop id={c.id} emptyLabel="Drop items here or add.">
                <SortableContext items={store.orderMap[c.id] ?? []} strategy={verticalListSortingStrategy}>
                  {(store.orderMap[c.id] ?? []).map((id) => {
                    const it = store.items[id];
                    if (!it) return null;
                    return (
                      <SortableItemRow key={id} itemId={id} item={it} onChange={updateItem} onRemove={() => removeItem(id)} />
                    );
                  })}
                </SortableContext>
              </ItemColumnDrop>
              <button type="button" className="secondary" onClick={() => addItemTo(c.id)} style={{ marginTop: 6 }}>
                Add item
              </button>
            </div>
          ))}
        </div>
      </DndContext>

      <div className="panel">
        <h2>Download</h2>
        <p className="text-muted">Zipped PDFs: A4 display menu (no allergens on menu), A4 landscape allergen matrix, A4 pages with A6 buffet labels.</p>
        <button type="button" onClick={() => void downloadZip()} disabled={busy}>
          {busy ? "Working…" : "Download all documents (ZIP)"}
        </button>
      </div>
    </main>
  );
}
