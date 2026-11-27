"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const CloseContext = createContext<() => void>(() => undefined);

/**
 * A toolbar button that opens a dropdown. The list is portalled and fixed-positioned under the button,
 * so a scrolling toolbar can't clip it. Closes on an item click, Escape, a click elsewhere, or scrolling.
 * Arrow keys move between items.
 */
export function MenuButton({
  label,
  icon,
  title,
  disabled,
  className = "",
  align = "start",
  chevron = true,
  ariaLabel,
  children
}: {
  label?: ReactNode;
  icon?: ReactNode;
  title?: string;
  disabled?: boolean;
  className?: string;
  align?: "start" | "end";
  chevron?: boolean;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const close = () => setOpen(false);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const width = listRef.current?.offsetWidth ?? 220;
    const height = listRef.current?.offsetHeight ?? 0;
    const left = align === "end" ? r.right - width : r.left;
    // Open upwards when there isn't room below (e.g. the status bar at the bottom of the canvas).
    const below = r.bottom + 4;
    const top = below + height > window.innerHeight - 8 && r.top - 4 - height > 8 ? r.top - 4 - height : below;
    setPos({ top, left: Math.max(8, Math.min(left, window.innerWidth - width - 8)) });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const items = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? []);
    items()[0]?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (listRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        close();
        return;
      }
      // While the menu is open, keys belong to it, not to the page's shortcuts (arrows would nudge the selection).
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        buttonRef.current?.focus();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const list = items();
        const i = list.indexOf(document.activeElement as HTMLElement);
        const next = e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
        list[next]?.focus();
      }
    };
    const onScroll = (e: Event) => {
      if (listRef.current?.contains(e.target as Node)) return;
      close();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`menu-trigger ${className}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        {label ? <span>{label}</span> : null}
        {chevron ? <ChevronDown size={13} aria-hidden className="menu-chevron" /> : null}
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={listRef}
              role="menu"
              className="menu"
              style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            >
              <CloseContext.Provider value={close}>{children}</CloseContext.Provider>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

export function MenuItem({
  icon,
  children,
  hint,
  shortcut,
  disabled,
  danger,
  onSelect
}: {
  icon?: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
}) {
  const close = useContext(CloseContext);
  return (
    <button
      type="button"
      role="menuitem"
      className={`menu-item${danger ? " menu-item--danger" : ""}`}
      disabled={disabled}
      onClick={() => {
        close();
        onSelect();
      }}
    >
      <span className="menu-item-icon" aria-hidden>
        {icon}
      </span>
      <span className="menu-item-text">
        <span>{children}</span>
        {hint ? <span className="menu-item-hint">{hint}</span> : null}
      </span>
      {shortcut ? <kbd className="menu-item-kbd">{shortcut}</kbd> : null}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="menu-label">{children}</div>;
}

export function MenuSeparator() {
  return <div className="menu-sep" role="separator" />;
}

/** Free content in a menu (e.g. the shortcuts list); not keyboard-navigable items. */
export function MenuPanel({ children }: { children: ReactNode }) {
  return <div className="menu-panel">{children}</div>;
}
