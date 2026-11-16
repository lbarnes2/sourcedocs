"use client";

import { DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { MENU_KEY_LABELS } from "@/lib/docs/menuCards";
import type { MenuCardLayout, MenuCourseKey, MenuDietaryKey } from "@/types";

export const emptyMenuCardLayout: MenuCardLayout = {
  order: { starter: [], main: [], dessert: [] },
  keys: {}
};

const COURSES: Array<{ key: MenuCourseKey; label: string }> = [
  { key: "starter", label: "Starter" },
  { key: "main", label: "Main course" },
  { key: "dessert", label: "Dessert" }
];
const KEYS: MenuDietaryKey[] = ["v", "ve", "gf"];

export interface MenuCourseDishes {
  /** Dish as it is identified on the menu (before the long name), in its current order. */
  dishes: Array<{ id: string; label: string }>;
}

function DishRow({
  id,
  label,
  keys,
  onToggle
}: {
  id: string;
  label: string;
  keys: MenuDietaryKey[];
  onToggle: (key: MenuDietaryKey) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  return (
    <li ref={setNodeRef} style={style} className="menu-order-row">
      <button type="button" className="drag-handle" aria-label={`Drag to reorder ${label}`} {...attributes} {...listeners}>
        <GripVertical size={16} />
      </button>
      <span className="menu-order-label">{label}</span>
      <span className="menu-order-keys" role="group" aria-label={`Dietary keys for ${label}`}>
        {KEYS.map((key) => (
          <label key={key} className={keys.includes(key) ? "chip chip--sm chip--on" : "chip chip--sm"} title={MENU_KEY_LABELS[key]}>
            <input type="checkbox" checked={keys.includes(key)} onChange={() => onToggle(key)} />({key})
          </label>
        ))}
      </span>
    </li>
  );
}

/**
 * Menu card arrangement: drag dishes into the order they should print within each course, and tick
 * the dietary keys — (v), (ve), (gf) — to print after a dish.
 */
export function MenuCardEditor({
  courses,
  layout,
  onChange
}: {
  courses: Record<MenuCourseKey, MenuCourseDishes>;
  layout: MenuCardLayout;
  onChange: (next: MenuCardLayout) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const reorder = (course: MenuCourseKey, event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = courses[course].dishes.map((dish) => dish.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onChange({ ...layout, order: { ...layout.order, [course]: arrayMove(ids, from, to) } });
  };

  const toggle = (dish: string, key: MenuDietaryKey) => {
    const current = layout.keys[dish] ?? [];
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    const keys = { ...layout.keys };
    if (next.length) keys[dish] = next;
    else delete keys[dish];
    onChange({ ...layout, keys });
  };

  const visible = COURSES.filter((course) => courses[course.key].dishes.length > 0);
  if (!visible.length) {
    return (
      <p className="text-muted" style={{ margin: 0 }}>
        Check the guest list first — its dishes will appear here to arrange.
      </p>
    );
  }

  return (
    <div className="stack">
      <p className="field-hint" style={{ margin: 0 }}>
        Drag dishes into the order they should print. Tick (v) vegetarian, (ve) vegan or (gf) gluten free to print the
        key after a dish; the menu gets a line explaining the keys used.
      </p>
      <div className="menu-order-grid">
        {visible.map((course) => (
          <div key={course.key} className="inset">
            <h3 style={{ margin: "0 0 8px" }}>{course.label}</h3>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => reorder(course.key, event)}>
              <SortableContext items={courses[course.key].dishes.map((dish) => dish.id)} strategy={verticalListSortingStrategy}>
                <ul className="menu-order-list">
                  {courses[course.key].dishes.map((dish) => (
                    <DishRow
                      key={dish.id}
                      id={dish.id}
                      label={dish.label}
                      keys={layout.keys[dish.id] ?? []}
                      onToggle={(key) => toggle(dish.id, key)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          </div>
        ))}
      </div>
    </div>
  );
}
