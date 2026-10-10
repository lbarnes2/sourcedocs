"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Ban,
  ChevronDown,
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
import { Modal } from "@/app/components/ui";
import { ARROW_PICKER_SECTIONS, labelForArrow } from "@/lib/signage/arrowOptions";
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
  /** Hide the text label next to the glyph (for tight rows). */
  compact?: boolean;
};

export function ArrowSymbolPicker({ value, onChange, disabled, id, "aria-label": ariaLabel, compact }: Props) {
  const [open, setOpen] = useState(false);

  function select(v: SignageArrowDirection) {
    onChange(v);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        id={id}
        className={compact ? "arrow-trigger arrow-trigger--compact" : "arrow-trigger"}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => !disabled && setOpen(true)}
        aria-label={ariaLabel ? `${ariaLabel}: ${labelForArrow(value)}` : labelForArrow(value)}
        title={labelForArrow(value)}
      >
        <span className="arrow-trigger-glyph" aria-hidden>
          <ArrowGlyph value={value} size={20} />
        </span>
        {compact ? null : <span className="arrow-trigger-label">{labelForArrow(value)}</span>}
        <ChevronDown size={14} className="arrow-trigger-chevron" aria-hidden />
      </button>

      {open ? (
        <Modal title="Choose arrow" onClose={() => setOpen(false)}>
          {ARROW_PICKER_SECTIONS.map((section) => (
            <section key={section.title} className="arrow-section">
              <h4 className="arrow-section-title">{section.title}</h4>
              <div className="arrow-grid">
                {section.options.map((opt) => {
                  const selected = opt.value === value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      aria-pressed={selected}
                      className={selected ? "arrow-cell arrow-cell--selected" : "arrow-cell"}
                      onClick={() => select(opt.value)}
                    >
                      <ArrowGlyph value={opt.value} size={32} />
                      <span className="arrow-cell-label">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </Modal>
      ) : null}
    </>
  );
}
