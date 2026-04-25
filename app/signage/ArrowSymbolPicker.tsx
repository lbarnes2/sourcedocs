"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import {
  Ban,
  CornerDownLeft,
  CornerDownRight,
  CornerLeftDown,
  CornerLeftUp,
  CornerRightDown,
  CornerRightUp,
  CornerUpLeft,
  CornerUpRight,
  MoveDown,
  MoveDownLeft,
  MoveDownRight,
  MoveLeft,
  MoveRight,
  MoveUp,
  MoveUpLeft,
  MoveUpRight,
  Redo2
} from "lucide-react";
import { ARROW_PICKER_SECTIONS } from "@/lib/signage/arrowOptions";
import type { SignageArrowDirection } from "@/types";

const ARROW_LUCIDE_ICONS: Record<Exclude<SignageArrowDirection, "none" | "turnAround">, LucideIcon> = {
  up: MoveUp,
  down: MoveDown,
  left: MoveLeft,
  right: MoveRight,
  upLeft: MoveUpLeft,
  upRight: MoveUpRight,
  downLeft: MoveDownLeft,
  downRight: MoveDownRight,
  cornerUpLeft: CornerUpLeft,
  cornerUpRight: CornerUpRight,
  cornerRightUp: CornerRightUp,
  cornerRightDown: CornerRightDown,
  cornerDownRight: CornerDownRight,
  cornerDownLeft: CornerDownLeft,
  cornerLeftDown: CornerLeftDown,
  cornerLeftUp: CornerLeftUp
};

export function ArrowGlyph({
  value,
  size = 40,
  className
}: {
  value: SignageArrowDirection;
  size?: number;
  className?: string;
}) {
  if (value === "none") {
    return <Ban size={size} className={className} strokeWidth={1.5} style={{ opacity: 0.4 }} aria-hidden />;
  }
  if (value === "turnAround") {
    return (
      <Redo2
        size={size}
        className={className}
        strokeWidth={2}
        style={{ transform: "rotate(-90deg)" }}
        aria-hidden
      />
    );
  }
  const C = ARROW_LUCIDE_ICONS[value];
  return <C size={size} className={className} strokeWidth={2} aria-hidden />;
}

type Props = {
  value: SignageArrowDirection;
  onChange: (v: SignageArrowDirection) => void;
  disabled?: boolean;
  id?: string;
  /** Shown on the open button next to the preview */
  "aria-label"?: string;
};

export function ArrowSymbolPicker({ value, onChange, disabled, id, "aria-label": ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const autoId = useId();
  const buttonId = id ?? autoId;

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function select(v: SignageArrowDirection) {
    onChange(v);
    setOpen(false);
  }

  return (
    <div className="signage-arrow-picker">
      <button
        type="button"
        id={buttonId}
        className="signage-arrow-picker-trigger"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? titleId : undefined}
        onClick={() => !disabled && setOpen((o) => !o)}
        aria-label={ariaLabel}
      >
        <span className="signage-arrow-picker-preview" aria-hidden>
          <ArrowGlyph value={value} size={24} />
        </span>
        <span className="signage-arrow-picker-chevron" aria-hidden>
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              className="signage-arrow-dialog-backdrop"
              role="presentation"
              onClick={(e) => {
                if (e.target === e.currentTarget) close();
              }}
            >
              <div
                className="signage-arrow-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="signage-arrow-dialog-head">
                  <h3 id={titleId} className="signage-arrow-dialog-title">
                    Choose arrow symbol
                  </h3>
                  <button type="button" className="signage-arrow-dialog-close secondary" onClick={close} aria-label="Close">
                    Close
                  </button>
                </div>
                <div className="signage-arrow-dialog-body">
                  {ARROW_PICKER_SECTIONS.map((section) => (
                    <section key={section.title} className="signage-arrow-section">
                      <h4 className="signage-arrow-section-title">{section.title}</h4>
                      <div className="signage-arrow-grid">
                        {section.options.map((opt) => {
                          const selected = opt.value === value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              className={
                                selected ? "signage-arrow-cell signage-arrow-cell--selected" : "signage-arrow-cell"
                              }
                              onClick={() => select(opt.value)}
                            >
                              <span className="signage-arrow-cell-glyph">
                                <ArrowGlyph value={opt.value} size={44} />
                              </span>
                              <span className="signage-arrow-cell-label">{opt.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
