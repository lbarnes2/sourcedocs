"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { SymbolGlyph } from "./SymbolPicker";
import { useAccess } from "@/app/components/CurrentUser";
import { Section } from "@/app/components/ui";
import { DEFAULT_GENERAL_SIGN_TEMPLATES } from "@/lib/signage/generalTemplateDefaults";
import * as limits from "@/lib/validation/limits";
import type { GeneralSignTemplate } from "@/types";

type Props = {
  templates: GeneralSignTemplate[];
  selectedId: string | null;
  onSelect: (template: GeneralSignTemplate) => void;
  /** Persist a reordered / renamed / pruned list. */
  onSaveList: (templates: GeneralSignTemplate[]) => Promise<void>;
  busy?: boolean;
};

/** "Start from" grid of saved templates, with an edit mode for renaming, reordering and deleting. */
export function GeneralSignTemplates({ templates, selectedId, onSelect, onSaveList, busy }: Props) {
  const { canEdit } = useAccess();
  const [editing, setEditing] = useState(false);
  const missingDefaults = DEFAULT_GENERAL_SIGN_TEMPLATES.filter((d) => !templates.some((t) => t.id === d.id));

  function move(index: number, delta: number) {
    const next = [...templates];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    void onSaveList(next);
  }

  function rename(index: number, label: string) {
    const trimmed = label.trim();
    if (!trimmed || trimmed === templates[index]!.label) return;
    void onSaveList(templates.map((t, i) => (i === index ? { ...t, label: trimmed } : t)));
  }

  function remove(index: number) {
    const t = templates[index]!;
    if (!window.confirm(`Delete the “${t.label}” template for everyone?`)) return;
    void onSaveList(templates.filter((_, i) => i !== index));
  }

  return (
    <Section
      title="Start from"
      description={
        editing
          ? "Templates are shared with everyone who uses this app. Rename, reorder or delete them here."
          : "Pick a template, then change anything you like."
      }
      actions={
        canEdit ? (
          <button type="button" className="btn-ghost" onClick={() => setEditing((e) => !e)} disabled={busy}>
            {editing ? "Done" : (
              <>
                <Pencil size={14} aria-hidden /> Edit templates
              </>
            )}
          </button>
        ) : null
      }
    >
      {editing && canEdit ? (
        <div className="stack stack--sm">
          <ul className="template-list">
            {templates.map((t, i) => (
              <li key={t.id} className="template-row">
                <span className="preset-glyphs">
                  {t.symbols.map((id) => (
                    <SymbolGlyph key={id} id={id} size={16} />
                  ))}
                </span>
                <input
                  defaultValue={t.label}
                  maxLength={limits.MAX_GENERAL_SIGN_TEMPLATE_LABEL_CHARS}
                  aria-label={`Name of ${t.label}`}
                  onBlur={(e) => rename(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  disabled={busy}
                />
                <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={busy || i === 0} aria-label={`Move ${t.label} up`}>
                  <ArrowUp size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => move(i, 1)}
                  disabled={busy || i === templates.length - 1}
                  aria-label={`Move ${t.label} down`}
                >
                  <ArrowDown size={16} aria-hidden />
                </button>
                <button type="button" className="icon-btn" onClick={() => remove(i)} disabled={busy} aria-label={`Delete ${t.label}`}>
                  <Trash2 size={16} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          {missingDefaults.length ? (
            <div>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => void onSaveList([...templates, ...structuredClone(missingDefaults)])}
                disabled={busy}
              >
                <RotateCcw size={14} aria-hidden /> Restore {missingDefaults.length} built-in template
                {missingDefaults.length === 1 ? "" : "s"}
              </button>
            </div>
          ) : null}
        </div>
      ) : templates.length ? (
        <div className="preset-grid">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={selectedId === t.id}
              className={selectedId === t.id ? "arrow-cell arrow-cell--selected" : "arrow-cell"}
              onClick={() => onSelect(t)}
            >
              <span className="preset-glyphs">
                {t.symbols.map((id) => (
                  <SymbolGlyph key={id} id={id} size={t.symbols.length > 1 ? 16 : 20} />
                ))}
              </span>
              <span className="arrow-cell-label">{t.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-muted">No templates yet. Design a sign below and save it as a template.</p>
      )}
    </Section>
  );
}
