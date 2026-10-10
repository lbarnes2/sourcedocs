"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, ChevronDown, ImageOff } from "lucide-react";
import { Modal } from "./ui";

export type LogoPickerItem = { key: string; label: string; assetUrl: string; printable?: boolean };

type Props = {
  title?: string;
  items: LogoPickerItem[];
  value: string;
  onChange: (key: string) => void;
  emptyOption?: { label: string; value: string };
  /** Extra leading tile (e.g. “No logo” vs “Use profile default”) with its own `value`. */
  secondaryEmptyOption?: { label: string; value: string };
  disabled?: boolean;
  manageHref?: string;
  manageLabel?: string;
};

/**
 * Compact logo field: shows the current choice (thumbnail + name) and opens a grid
 * of library logos in a dialog. Keeps forms tidy however many logos the library holds.
 */
export function LogoPicker({
  title,
  items,
  value,
  onChange,
  emptyOption,
  secondaryEmptyOption,
  disabled,
  manageHref = "/logo-library",
  manageLabel = "Manage logos"
}: Props) {
  const [open, setOpen] = useState(false);
  const off = Boolean(disabled);
  const selectedItem = items.find((item) => item.key === value);
  const emptyChoices = [emptyOption, secondaryEmptyOption].filter(
    (option): option is { label: string; value: string } => Boolean(option)
  );
  const selectedEmpty = emptyChoices.find((option) => option.value === value);
  const currentLabel = selectedItem?.label ?? selectedEmpty?.label ?? (value ? "Unknown logo" : "None");

  function choose(key: string) {
    onChange(key);
    setOpen(false);
  }

  return (
    <div className="field">
      {title ? <span className="field-label">{title}</span> : null}
      <button
        type="button"
        className="logo-trigger"
        disabled={off}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        aria-label={title ? `${title}: ${currentLabel}` : currentLabel}
      >
        <span className="logo-trigger-thumb" aria-hidden>
          {selectedItem ? <img src={selectedItem.assetUrl} alt="" /> : <ImageOff size={16} />}
        </span>
        <span className="logo-trigger-label">{currentLabel}</span>
        <ChevronDown size={16} className="logo-trigger-chevron" aria-hidden />
      </button>

      {open ? (
        <Modal
          title={title ?? "Choose logo"}
          onClose={() => setOpen(false)}
          size="lg"
          footer={
            manageHref ? (
              <Link className="text-link" href={manageHref}>
                {manageLabel}
              </Link>
            ) : undefined
          }
        >
          <div className="logo-grid">
            {emptyChoices.map((option) => (
              <button
                key={`empty-${option.value}`}
                type="button"
                aria-pressed={value === option.value}
                className={value === option.value ? "logo-tile logo-tile--selected" : "logo-tile"}
                onClick={() => choose(option.value)}
              >
                <span className="logo-tile-img logo-tile-img--empty">
                  <ImageOff size={22} aria-hidden />
                </span>
                <span className="logo-tile-label">{option.label}</span>
                {value === option.value ? <Check size={14} className="logo-tile-check" aria-hidden /> : null}
              </button>
            ))}
            {items.map((item) => {
              const selected = value === item.key;
              // WebP/GIF uploads from before PNG/JPEG-only validation cannot be embedded in PDFs.
              const unprintable = item.printable === false;
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={selected}
                  className={selected ? "logo-tile logo-tile--selected" : "logo-tile"}
                  disabled={unprintable}
                  title={unprintable ? "Not a PNG/JPEG — re-upload in the Logo Library to use it in PDFs" : item.label}
                  onClick={() => !unprintable && choose(item.key)}
                >
                  <span className="logo-tile-img">
                    <img src={item.assetUrl} alt="" />
                  </span>
                  <span className="logo-tile-label">{item.label}</span>
                  {selected ? <Check size={14} className="logo-tile-check" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
          {items.length === 0 ? (
            <p className="text-muted" style={{ marginTop: 12 }}>
              No logos in this library yet.
            </p>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
