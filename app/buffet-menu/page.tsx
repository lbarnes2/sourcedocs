"use client";

import {
  type CollisionDetection,
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
import { Download, FilePlus, FolderOpen, GripVertical, Plus, Save, Trash2, X } from "lucide-react";
import { catSortableId, parseSortableId } from "@/app/buffet-menu/dndTypes";
import { useAccess } from "@/app/components/CurrentUser";
import type { BuffetMenuListItem } from "@/lib/buffetMenu/savedR2";
import { savedLabel } from "@/lib/format/savedLabel";
import { readResponseError } from "@/lib/http/readError";
import { downloadBlob } from "@/lib/pdf/pdfToPngExport";
import { LogoPicker } from "@/app/components/LogoPicker";
import { Callout, Field, Modal, PageHeader, Section, Toasts } from "@/app/components/ui";
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
import type { AppSettings } from "@/types/appSettings";
import type { BuffetMenuItem, BuffetMenuSettings } from "@/types/buffetMenu";

type BackgroundItem = { key: string; label: string; assetUrl: string };

type Store = BuffetMenuStore;

type BuffetExportMode = "zip" | "display" | "matrix" | "labels" | "labelsA7";
const BUFFET_DOWNLOAD_FILE_NAMES: Record<BuffetExportMode, string> = {
  zip: "buffet-menu-documents.zip",
  display: "buffet-menu-display.pdf",
  matrix: "buffet-allergen-matrix.pdf",
  labels: "buffet-labels-a6.pdf",
  labelsA7: "buffet-labels-a7.pdf"
};

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

/** Categories only collide with categories, items only with items/containers, so nested lists don't fight. */
const collisionDetection: CollisionDetection = (args) => {
  const activeIsCategory = String(args.active.id).startsWith("cat:");
  return closestCorners({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (container) => String(container.id).startsWith("cat:") === activeIsCategory
    )
  });
};

function SortableCategoryBlock({
  id,
  title,
  itemCount,
  onTitle,
  onRemove,
  readOnly,
  children
}: {
  id: string;
  title: string;
  itemCount: number;
  onTitle: (v: string) => void;
  onRemove: () => void;
  readOnly: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: catSortableId(id),
    disabled: readOnly
  });
  const style = { transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="menu-cat">
      <div className="menu-cat-head">
        {readOnly ? null : (
          <button type="button" className="drag-handle" aria-label="Drag to reorder category" {...attributes} {...listeners}>
            <GripVertical size={16} />
          </button>
        )}
        <input
          className="menu-cat-title"
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder="Category name"
          aria-label="Category name"
          readOnly={readOnly}
        />
        <span className="badge">{itemCount}</span>
        {readOnly ? null : (
          <button
            type="button"
            className="icon-btn icon-btn--sm btn-danger"
            onClick={onRemove}
            aria-label="Remove category"
            title="Remove category (its items move to Uncategorised)"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function SortableItemRow({
  itemId,
  item,
  onChange,
  onRemove,
  readOnly
}: {
  itemId: string;
  item: BuffetMenuItem;
  onChange: (next: BuffetMenuItem) => void;
  onRemove: () => void;
  readOnly: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: itemId,
    disabled: readOnly
  });
  const style = { transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="menu-item">
      {readOnly ? null : (
        <button type="button" className="drag-handle" aria-label="Drag to reorder item" {...attributes} {...listeners}>
          <GripVertical size={16} />
        </button>
      )}
      <div className="menu-item-fields">
        <div className="menu-item-top">
          <input
            className="menu-item-title"
            value={item.title}
            onChange={(e) => onChange({ ...item, title: e.target.value })}
            placeholder="Dish name"
            aria-label="Dish name"
            readOnly={readOnly}
          />
          <label className="chip chip--diet" title="Vegetarian">
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
          <label className="chip chip--diet" title="Vegan">
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
        <div className="chip-group chip-group--allergens" role="group" aria-label="Allergens">
          {ALLERGENS.map((a) => (
            <label key={a.id} className="chip chip--sm" title={a.fullLabel}>
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
              {a.shortLabel}
            </label>
          ))}
        </div>
      </div>
      {readOnly ? null : (
        <button type="button" className="icon-btn icon-btn--sm btn-danger" onClick={onRemove} aria-label="Remove item">
          <X size={16} />
        </button>
      )}
    </div>
  );
}

function ItemColumnDrop({
  id,
  children,
  isEmpty,
  emptyLabel
}: {
  id: string;
  children: React.ReactNode;
  isEmpty: boolean;
  emptyLabel: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`menu-items${isOver ? " menu-items--over" : ""}`}>
      {children}
      {isEmpty ? <p className="menu-items-empty">{emptyLabel}</p> : null}
    </div>
  );
}

export default function BuffetMenuPage() {
  const { user, canEdit } = useAccess();
  /* Locked until the account has loaded; the view-only notice only once we know it's a viewer. */
  const readOnly = !canEdit;
  const viewOnly = user !== null && !canEdit;
  const [store, setStore] = useState<BuffetMenuStore>(() => createEmptyMenuStore());
  const [savedName, setSavedName] = useState("Untitled menu");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [venueLogos, setVenueLogos] = useState<LogoItem[]>([]);
  const [logosConfigured, setLogosConfigured] = useState(false);
  const [venueLogoKey, setVenueLogoKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedList, setSavedList] = useState<BuffetMenuListItem[]>([]);
  const [r2SaveEnabled, setR2SaveEnabled] = useState(false);
  /** Edited on the Settings page; read here so downloads include it. */
  const [settings, setSettings] = useState<BuffetMenuSettings | null>(null);
  const [backgrounds, setBackgrounds] = useState<BackgroundItem[]>([]);
  const [defaultBackgroundKey, setDefaultBackgroundKey] = useState("");
  /** "" = use the default from Settings. */
  const [displayBackgroundKey, setDisplayBackgroundKey] = useState("");
  const [savedOpen, setSavedOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const refreshSaved = useCallback(async () => {
    try {
      const res = await fetch("/api/buffet-menu/saved");
      const data = (await res.json()) as { configured?: boolean; items?: BuffetMenuListItem[] };
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
    void (async () => {
      try {
        const res = await fetch("/api/buffet-menu/settings");
        if (!res.ok) throw new Error(await readResponseError(res, "Could not load the allergen statement."));
        setSettings((await res.json()) as BuffetMenuSettings);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load the allergen statement.");
      }
    })();
    void (async () => {
      try {
        const [bgRes, appRes] = await Promise.all([fetch("/api/settings/backgrounds"), fetch("/api/settings")]);
        if (bgRes.ok) setBackgrounds(((await bgRes.json()) as { items: BackgroundItem[] }).items);
        if (appRes.ok) setDefaultBackgroundKey(((await appRes.json()) as AppSettings).defaultDisplayBackgroundKey);
      } catch {
        setBackgrounds([]);
      }
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

  const downloadExport = async (exportMode: BuffetExportMode) => {
    setError("");
    setBusy(true);
    try {
      const menu = toMenuState(store);
      const res = await fetch("/api/buffet-menu/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          menu,
          venueLogoKey: venueLogoKey || null,
          displayBackgroundKey: displayBackgroundKey || null,
          allergenStatement: settings?.showAllergenStatement ? settings.allergenStatement : "",
          export: exportMode
        })
      });
      if (!res.ok) throw new Error(await readResponseError(res, "Generation failed."));
      downloadBlob(await res.blob(), BUFFET_DOWNLOAD_FILE_NAMES[exportMode]);
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
          venueLogoKey: venueLogoKey || null,
          displayBackgroundKey: displayBackgroundKey || null
        })
      });
      if (!res.ok) throw new Error(await readResponseError(res, "Save failed."));
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
      if (!res.ok) throw new Error(await readResponseError(res, "Could not load."));
      const doc = (await res.json()) as import("@/types/buffetMenu").BuffetMenuSavedFile;
      setSavedName(doc.name);
      setSavedId(id);
      setVenueLogoKey(doc.venueLogoKey || "");
      setDisplayBackgroundKey(doc.displayBackgroundKey || "");
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
      if (!res.ok) throw new Error(await readResponseError(res, "Delete failed."));
      if (savedId === id) {
        setSavedId(null);
        setStore(createEmptyMenuStore());
        setSavedName("Untitled menu");
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
    setDisplayBackgroundKey("");
  };

  const uncatIds = store.orderMap[BUFFET_UNCAT_CONTAINER] ?? [];
  const itemTotal = Object.keys(store.items).length;
  const statementPrinted = Boolean(settings?.showAllergenStatement && settings.allergenStatement.trim());
  const defaultBackground = backgrounds.find((b) => b.key === defaultBackgroundKey);

  const renderItems = (ids: string[]) =>
    ids.map((id) => {
      const it = store.items[id];
      if (!it) return null;
      return (
        <SortableItemRow
          key={id}
          itemId={id}
          item={it}
          onChange={updateItem}
          onRemove={() => removeItem(id)}
          readOnly={readOnly}
        />
      );
    });

  return (
    <main className="page">
      <PageHeader
        title="Buffet menus"
        description="Build the menu once with allergens, then print the display menu, allergen matrix and buffet labels."
        actions={
          user === null ? null : canEdit ? (
            <>
              <input
                className="header-input"
                value={savedName}
                onChange={(e) => setSavedName(e.target.value)}
                maxLength={200}
                aria-label="Menu name"
                placeholder="Menu name"
              />
              <button
                type="button"
                onClick={saveToCloud}
                disabled={busy || !r2SaveEnabled}
                title={!r2SaveEnabled ? "R2 is not configured" : undefined}
              >
                <Save size={15} aria-hidden /> Save
              </button>
              <button type="button" onClick={() => setSavedOpen(true)}>
                <FolderOpen size={15} aria-hidden /> Open
              </button>
              <button type="button" className="icon-btn icon-btn--bordered" onClick={newMenu} disabled={busy} aria-label="New menu" title="New menu">
                <FilePlus size={16} />
              </button>
            </>
          ) : (
            <>
              {savedId ? <span className="header-name">{savedName}</span> : null}
              <button type="button" className="btn-primary" onClick={() => setSavedOpen(true)}>
                <FolderOpen size={15} aria-hidden /> Open a saved menu
              </button>
            </>
          )
        }
      />

      {savedOpen ? (
        <Modal title="Saved menus" onClose={() => setSavedOpen(false)}>
          {!r2SaveEnabled ? (
            <Callout tone="warning">R2 isn&apos;t configured, so menus can&apos;t be saved or loaded.</Callout>
          ) : savedList.length === 0 ? (
            <p className="text-muted" style={{ margin: 0 }}>
              No saved menus yet.
            </p>
          ) : (
            <ul className="list">
              {savedList.map((s) => (
                <li key={s.id} className={s.id === savedId ? "list-item list-item--active" : "list-item"}>
                  <div className="list-item-main">
                    <button
                      type="button"
                      className="list-item-title"
                      disabled={busy}
                      onClick={() => {
                        void loadSaved(s.id);
                        setSavedOpen(false);
                      }}
                    >
                      {s.name}
                    </button>
                    <span className="list-item-meta">{savedLabel(s.savedAt, s.savedBy)}</span>
                  </div>
                  <button
                    type="button"
                    className="btn-sm"
                    disabled={busy}
                    onClick={() => {
                      void loadSaved(s.id);
                      setSavedOpen(false);
                    }}
                  >
                    Open
                  </button>
                  {canEdit ? (
                    <button
                      type="button"
                      className="icon-btn icon-btn--sm btn-danger"
                      aria-label={`Delete ${s.name}`}
                      onClick={() => void deleteSaved(s.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Modal>
      ) : null}

      {viewOnly ? (
        <Callout tone="info" className="readonly-note">
          You have view-only access: open a saved menu to print it. Dishes and allergens can only be changed by an
          editor.
        </Callout>
      ) : null}

      <Section
        title="Menu"
        description={
          viewOnly
            ? "Dishes and allergens as saved. View only."
            : "Drag the handles to reorder categories and dishes, or to move a dish between categories. Tick the allergens each dish contains."
        }
      >
        <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={onDragEnd}>
          {/* A disabled fieldset locks every tick box and field inside, including the allergens. */}
          <fieldset className="fieldset-plain stack" disabled={readOnly}>
            <div className="menu-cat menu-cat--uncat">
              <div className="menu-cat-head">
                <span className="menu-cat-label">Uncategorised</span>
                <span className="badge">{uncatIds.length}</span>
              </div>
              <ItemColumnDrop
                id={BUFFET_UNCAT_CONTAINER}
                isEmpty={uncatIds.length === 0}
                emptyLabel={
                  readOnly
                    ? "No dishes."
                    : store.categories.length
                      ? "Drop dishes here to remove them from a category."
                      : "No dishes yet."
                }
              >
                <SortableContext items={uncatIds} strategy={verticalListSortingStrategy}>
                  {renderItems(uncatIds)}
                </SortableContext>
              </ItemColumnDrop>
              {readOnly ? null : (
                <button type="button" className="btn-ghost btn-sm menu-add-item" onClick={() => addItemTo(BUFFET_UNCAT_CONTAINER)}>
                  <Plus size={14} aria-hidden /> Add dish
                </button>
              )}
            </div>

            <SortableContext items={categoryIds} strategy={verticalListSortingStrategy}>
              {store.categories.map((c) => {
                const ids = store.orderMap[c.id] ?? [];
                return (
                  <SortableCategoryBlock
                    key={c.id}
                    id={c.id}
                    title={c.title}
                    itemCount={ids.length}
                    onTitle={(t) =>
                      setStore((s) => ({ ...s, categories: s.categories.map((x) => (x.id === c.id ? { ...x, title: t } : x)) }))
                    }
                    onRemove={() => removeCategory(c.id)}
                    readOnly={readOnly}
                  >
                    <ItemColumnDrop id={c.id} isEmpty={ids.length === 0} emptyLabel="Drop dishes here or add one.">
                      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                        {renderItems(ids)}
                      </SortableContext>
                    </ItemColumnDrop>
                    {readOnly ? null : (
                      <button type="button" className="btn-ghost btn-sm menu-add-item" onClick={() => addItemTo(c.id)}>
                        <Plus size={14} aria-hidden /> Add dish
                      </button>
                    )}
                  </SortableCategoryBlock>
                );
              })}
            </SortableContext>

            {readOnly ? null : (
              <button type="button" className="btn-dashed" onClick={addCategory}>
                <Plus size={15} aria-hidden /> Add category
              </button>
            )}
          </fieldset>
        </DndContext>
      </Section>

      <Section
        title="Download"
        description="A4 display menu (no allergens shown), A4 landscape allergen matrix, and buffet labels at A6 (4 per sheet) or A7 (8 per sheet)."
      >
        <div className="form-grid">
          <LogoPicker
            title="Venue logo (matrix and labels)"
            items={venueLogos}
            value={venueLogoKey}
            onChange={setVenueLogoKey}
            emptyOption={{ label: "None", value: "" }}
            disabled={!logosConfigured || busy}
          />
          <LogoPicker
            title="Display menu background"
            items={backgrounds}
            value={displayBackgroundKey}
            onChange={setDisplayBackgroundKey}
            emptyOption={{
              label: defaultBackground ? `Default (${defaultBackground.label})` : "Default",
              value: "",
              assetUrl: defaultBackground?.assetUrl
            }}
            disabled={busy || backgrounds.length === 0}
            manageHref="/settings"
            manageLabel="Manage backgrounds"
            portrait
          />
        </div>
        <p className="text-muted text-sm" style={{ margin: "12px 0 0" }}>
          Allergen statement: {settings === null ? "…" : statementPrinted ? "printed on the matrix" : "not printed"}.{" "}
          <Link className="text-link" href="/settings">
            Edit in Settings
          </Link>
        </p>
        <div className="card-foot card-foot--inset card-foot--between">
          <div className="row">
            <button type="button" className="btn-sm" onClick={() => void downloadExport("display")} disabled={busy || itemTotal === 0}>
              Display menu
            </button>
            <button type="button" className="btn-sm" onClick={() => void downloadExport("matrix")} disabled={busy || itemTotal === 0}>
              Allergen matrix
            </button>
            <button type="button" className="btn-sm" onClick={() => void downloadExport("labels")} disabled={busy || itemTotal === 0}>
              A6 labels
            </button>
            <button type="button" className="btn-sm" onClick={() => void downloadExport("labelsA7")} disabled={busy || itemTotal === 0}>
              A7 labels
            </button>
          </div>
          <button type="button" className="btn-primary" onClick={() => void downloadExport("zip")} disabled={busy || itemTotal === 0}>
            <Download size={16} aria-hidden />
            {busy ? "Working…" : "Download all (ZIP)"}
          </button>
        </div>
      </Section>

      <Toasts>
        {error ? (
          <Callout tone="error" onDismiss={() => setError("")}>
            {error}
          </Callout>
        ) : null}
      </Toasts>
    </main>
  );
}
