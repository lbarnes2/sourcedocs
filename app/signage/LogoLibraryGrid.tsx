"use client";

import { useState } from "react";

export type SignageLogoItem = { key: string; label: string; assetUrl: string };

type Props = {
  kind: "venue" | "client";
  items: SignageLogoItem[];
  value: string;
  onChange: (key: string) => void;
  emptyOption?: { label: string; value: string };
  disabled?: boolean;
  onRenamed?: (oldKey: string, newKey: string) => void;
  onRefresh?: () => void | Promise<void>;
  onError?: (message: string) => void;
};

export function SignageLogoLibraryGrid({
  kind,
  items,
  value,
  onChange,
  emptyOption,
  disabled,
  onRenamed,
  onRefresh,
  onError
}: Props) {
  const [renamingKey, setRenamingKey] = useState<string | null>(null);

  async function rename(item: SignageLogoItem) {
    const defaultBase = item.label.replace(/\.[^.]+$/u, "");
    const next = window.prompt("Name for this logo (used in the file name in storage)", defaultBase);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    setRenamingKey(item.key);
    onError?.("");
    try {
      const r = await fetch(`/api/logos/${kind}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: item.key, name: trimmed })
      });
      const j = (await r.json()) as { error?: string; key?: string };
      if (!r.ok) {
        onError?.(j.error ?? "Rename failed.");
        return;
      }
      if (j.key && j.key !== item.key) {
        onRenamed?.(item.key, j.key);
      }
      await onRefresh?.();
    } catch {
      onError?.("Rename failed.");
    } finally {
      setRenamingKey(null);
    }
  }

  const off = Boolean(disabled);

  return (
    <div className="signage-logo-grid-wrap">
      {items.length === 0 ? (
        <p className="text-muted" style={{ margin: "0 0 10px", fontSize: 13 }}>
          No logos in this library yet — upload a file below.
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
        {items.map((item) => {
          const selected = value === item.key;
          return (
            <div
              key={item.key}
              className={selected ? "signage-logo-tile signage-logo-tile--selected" : "signage-logo-tile"}
            >
              <button
                type="button"
                className="signage-logo-tile-hit"
                disabled={off}
                onClick={() => !off && onChange(item.key)}
                aria-label={`Select ${item.label}`}
              >
                <img src={item.assetUrl} alt="" className="signage-logo-tile-img" />
              </button>
              <span className="signage-logo-tile-label" title={item.label}>
                {item.label}
              </span>
              <button
                type="button"
                className="secondary signage-logo-tile-rename"
                disabled={off || renamingKey === item.key}
                onClick={() => void rename(item)}
              >
                {renamingKey === item.key ? "…" : "Rename"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
