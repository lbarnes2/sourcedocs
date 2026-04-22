import { BUFFET_UNCAT_CONTAINER } from "@/lib/buffetMenu/menuStore";

export function catSortableId(id: string): string {
  return `cat:${id}`;
}

export function parseSortableId(id: string | number): { kind: "cat" | "item"; value: string } {
  const s = String(id);
  if (s.startsWith("cat:")) return { kind: "cat", value: s.slice(4) };
  return { kind: "item", value: s };
}

export { BUFFET_UNCAT_CONTAINER };
