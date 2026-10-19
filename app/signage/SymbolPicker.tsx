"use client";

import { createElement, useState } from "react";
import { Plus, X } from "lucide-react";
import { Modal } from "@/app/components/ui";
import { SIGN_SYMBOL_SECTIONS, signSymbolLabel, signSymbolNode, type SignSymbolId } from "@/lib/signage/symbols";
import * as limits from "@/lib/validation/limits";

/** Renders a sign pictogram (Lucide or custom) from the same node data the PDF uses. */
export function SymbolGlyph({ id, size = 24 }: { id: SignSymbolId; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {signSymbolNode(id).map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}

type Props = {
  value: SignSymbolId[];
  onChange: (symbols: SignSymbolId[]) => void;
  disabled?: boolean;
};

/** Up to three pictograms, shown as removable chips; the dialog toggles symbols on and off. */
export function SymbolPicker({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const max = limits.MAX_GENERAL_SIGN_SYMBOLS;
  const full = value.length >= max;

  function toggle(id: SignSymbolId) {
    if (value.includes(id)) onChange(value.filter((v) => v !== id));
    else if (!full) onChange([...value, id]);
  }

  return (
    <>
      <div className="symbol-chips">
        {value.map((id) => (
          <span key={id} className="symbol-chip">
            <SymbolGlyph id={id} size={20} />
            <span>{signSymbolLabel(id)}</span>
            <button
              type="button"
              className="symbol-chip-remove"
              onClick={() => onChange(value.filter((v) => v !== id))}
              disabled={disabled}
              aria-label={`Remove ${signSymbolLabel(id)}`}
            >
              <X size={14} aria-hidden />
            </button>
          </span>
        ))}
        <button type="button" className="btn-ghost" onClick={() => setOpen(true)} disabled={disabled}>
          <Plus size={16} aria-hidden /> {value.length ? "Change symbols" : "Add symbol"}
        </button>
      </div>

      {open ? (
        <Modal
          title={`Choose symbols (up to ${max})`}
          onClose={() => setOpen(false)}
          size="lg"
          footer={
            <button type="button" className="btn-primary" onClick={() => setOpen(false)}>
              Done
            </button>
          }
        >
          {SIGN_SYMBOL_SECTIONS.map((section) => (
            <section key={section.title} className="arrow-section">
              <h4 className="arrow-section-title">{section.title}</h4>
              <div className="arrow-grid">
                {section.symbols.map((id) => {
                  const selected = value.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={selected}
                      className={selected ? "arrow-cell arrow-cell--selected" : "arrow-cell"}
                      onClick={() => toggle(id)}
                      disabled={!selected && full}
                    >
                      <SymbolGlyph id={id} size={32} />
                      <span className="arrow-cell-label">{signSymbolLabel(id)}</span>
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
