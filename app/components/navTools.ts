import { Images, LayoutGrid, Salad, Signpost, UtensilsCrossed } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavTool = {
  href: string;
  name: string;
  shortName: string;
  description: string;
  icon: LucideIcon;
  color: string;
};

export const NAV_TOOLS: NavTool[] = [
  {
    href: "/banqueting",
    name: "Banqueting documents",
    shortName: "Banqueting",
    description: "Table plans, place cards, menu cards and service plans from a guest list.",
    icon: UtensilsCrossed,
    color: "#0b5068"
  },
  {
    href: "/buffet-menu",
    name: "Buffet menus",
    shortName: "Buffet menus",
    description: "Display menu, allergen matrix and buffet labels.",
    icon: Salad,
    color: "#4553a0"
  },
  {
    href: "/signage",
    name: "Event signage",
    shortName: "Signage",
    description: "Directional sign packs from venue profiles, or a one-off sign.",
    icon: Signpost,
    color: "#0d7377"
  },
  {
    href: "/floorplans",
    name: "Floorplans",
    shortName: "Floorplans",
    description: "Lay out tables, shapes and labels, then print.",
    icon: LayoutGrid,
    color: "#b45309"
  },
  {
    href: "/logo-library",
    name: "Logo library",
    shortName: "Logos",
    description: "Upload and manage the venue and client logos every tool uses.",
    icon: Images,
    color: "#a3245b"
  }
];
