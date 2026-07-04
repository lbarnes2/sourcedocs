"use client";

import Link from "next/link";

export type LogoPickerItem = { key: string; label: string; assetUrl: string };

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
  const off = Boolean(disabled);

  return (
    <div className="logo-picker-wrap">
      {(title || manageHref) && (
        <div className="logo-picker-head">
          {title ? <div className="logo-picker-title">{title}</div> : <span />}
          {manageHref ? (
            <Link className="logo-picker-manage-link" href={manageHref}>
              {manageLabel}
            </Link>
          ) : null}
        </div>
      )}
      {items.length === 0 ? (
        <p className="text-muted" style={{ margin: "0 0 10px", fontSize: 13 }}>
          No logos available in this library yet.
        </p>
      ) : null}
      <div className="signage-logo-grid">
        {emptyOption ? (
          <button
            type="button"
            aria-pressed={value === emptyOption.value}
            disabled={off}
            className={
              value === emptyOption.value ? "signage-logo-tile signage-logo-tile--selected" : "signage-logo-tile"
            }
            onClick={() => !off && onChange(emptyOption.value)}
          >
            <span className="signage-logo-tile-empty">{emptyOption.label}</span>
          </button>
        ) : null}
        {secondaryEmptyOption ? (
          <button
            type="button"
            aria-pressed={value === secondaryEmptyOption.value}
            disabled={off}
            className={
              value === secondaryEmptyOption.value
                ? "signage-logo-tile signage-logo-tile--selected"
                : "signage-logo-tile"
            }
            onClick={() => !off && onChange(secondaryEmptyOption.value)}
          >
            <span className="signage-logo-tile-empty">{secondaryEmptyOption.label}</span>
          </button>
        ) : null}
        {items.map((item) => {
          const selected = value === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className={selected ? "signage-logo-tile signage-logo-tile--selected" : "signage-logo-tile"}
              disabled={off}
              onClick={() => !off && onChange(item.key)}
              aria-label={`Select ${item.label}`}
            >
              <span className="signage-logo-tile-hit">
                <img src={item.assetUrl} alt="" className="signage-logo-tile-img" />
              </span>
              <span className="signage-logo-tile-label" title={item.label}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
