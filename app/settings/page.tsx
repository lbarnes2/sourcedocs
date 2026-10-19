"use client";

import { useCallback, useEffect, useState } from "react";
import { ImagePlus, Star, Trash2 } from "lucide-react";
import { useAccess } from "@/app/components/CurrentUser";
import { Callout, Disclosure, Field, PageHeader, Section, Switch, Toasts } from "@/app/components/ui";
import { readResponseError } from "@/lib/http/readError";
import { LOGO_UPLOAD_ACCEPT } from "@/lib/logos/logoUpload";
import { MAX_BUFFET_ALLERGEN_STATEMENT_CHARS } from "@/lib/validation/limits";
import type { AppSettings } from "@/types/appSettings";
import type { BuffetMenuSettings } from "@/types/buffetMenu";
import { UsersSection } from "./UsersSection";

type BackgroundItem = { key: string; label: string; assetUrl: string; builtin: boolean };

function SaveRow({
  dirty,
  saved,
  busy,
  onSave,
  label
}: {
  dirty: boolean;
  saved: boolean;
  busy: boolean;
  onSave: () => void;
  label: string;
}) {
  return (
    <div className="row">
      <button type="button" className="btn-primary btn-sm" onClick={onSave} disabled={busy || !saved || !dirty}>
        {busy ? "Saving…" : label}
      </button>
      <span className="text-muted text-sm">{dirty ? "Unsaved changes" : saved ? "Saved" : ""}</span>
    </div>
  );
}

export default function SettingsPage() {
  const { user, isAdmin } = useAccess();
  const [app, setApp] = useState<AppSettings | null>(null);
  const [savedApp, setSavedApp] = useState<AppSettings | null>(null);
  const [buffet, setBuffet] = useState<BuffetMenuSettings>({ allergenStatement: "", showAllergenStatement: false });
  const [savedBuffet, setSavedBuffet] = useState<BuffetMenuSettings | null>(null);
  const [backgrounds, setBackgrounds] = useState<BackgroundItem[]>([]);
  const [busy, setBusy] = useState<"contact" | "statement" | "upload" | null>(null);
  const [workingKey, setWorkingKey] = useState<string | null>(null);
  const [uploadWarning, setUploadWarning] = useState("");
  const [error, setError] = useState("");

  const contactDirty =
    app !== null &&
    savedApp !== null &&
    (app.contactPhone !== savedApp.contactPhone || app.contactWebsites !== savedApp.contactWebsites);
  const statementDirty =
    savedBuffet !== null &&
    (buffet.allergenStatement !== savedBuffet.allergenStatement ||
      buffet.showAllergenStatement !== savedBuffet.showAllergenStatement);

  const loadBackgrounds = useCallback(async () => {
    const res = await fetch("/api/settings/backgrounds");
    if (!res.ok) throw new Error(await readResponseError(res, "Could not load backgrounds."));
    setBackgrounds(((await res.json()) as { items: BackgroundItem[] }).items);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [appRes, buffetRes] = await Promise.all([fetch("/api/settings"), fetch("/api/buffet-menu/settings")]);
        if (!appRes.ok) throw new Error(await readResponseError(appRes, "Could not load settings."));
        if (!buffetRes.ok) throw new Error(await readResponseError(buffetRes, "Could not load the allergen statement."));
        const appData = (await appRes.json()) as AppSettings;
        const buffetData = (await buffetRes.json()) as BuffetMenuSettings;
        setApp(appData);
        setSavedApp(appData);
        setBuffet(buffetData);
        setSavedBuffet(buffetData);
        await loadBackgrounds();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load settings.");
      }
    })();
  }, [loadBackgrounds]);

  async function putAppSettings(next: AppSettings): Promise<AppSettings> {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next)
    });
    if (!res.ok) throw new Error(await readResponseError(res, "Could not save settings."));
    return (await res.json()) as AppSettings;
  }

  async function saveContact() {
    if (!app || !savedApp) return;
    setBusy("contact");
    setError("");
    try {
      /* Only the contact fields: the default background is saved as soon as it's chosen. */
      const saved = await putAppSettings({ ...savedApp, contactPhone: app.contactPhone, contactWebsites: app.contactWebsites });
      setSavedApp(saved);
      setApp((a) => (a ? { ...a, contactPhone: saved.contactPhone, contactWebsites: saved.contactWebsites } : a));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save settings.");
    } finally {
      setBusy(null);
    }
  }

  async function makeDefault(key: string) {
    if (!savedApp) return;
    setWorkingKey(key);
    setError("");
    try {
      const saved = await putAppSettings({ ...savedApp, defaultDisplayBackgroundKey: key });
      setSavedApp(saved);
      setApp((a) => (a ? { ...a, defaultDisplayBackgroundKey: saved.defaultDisplayBackgroundKey } : a));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the default.");
    } finally {
      setWorkingKey(null);
    }
  }

  async function uploadBackground(file: File) {
    setBusy("upload");
    setError("");
    setUploadWarning("");
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/settings/backgrounds", { method: "POST", body: form });
      if (!res.ok) throw new Error(await readResponseError(res, "Upload failed."));
      const { warning } = (await res.json()) as { warning?: string };
      if (warning) setUploadWarning(warning);
      await loadBackgrounds();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(null);
    }
  }

  async function deleteBackground(item: BackgroundItem) {
    const isDefault = savedApp?.defaultDisplayBackgroundKey === item.key;
    const message = isDefault
      ? `Delete “${item.label}”? It's the default, so the built-in water background becomes the default again. Saved menus that chose it will use the default.`
      : `Delete “${item.label}”? Saved menus that chose it will use the default instead.`;
    if (!window.confirm(message)) return;
    setWorkingKey(item.key);
    setError("");
    try {
      const res = await fetch(`/api/settings/backgrounds?key=${encodeURIComponent(item.key)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readResponseError(res, "Delete failed."));
      const appRes = await fetch("/api/settings");
      if (appRes.ok) {
        const fresh = (await appRes.json()) as AppSettings;
        setSavedApp(fresh);
        setApp((a) => (a ? { ...a, defaultDisplayBackgroundKey: fresh.defaultDisplayBackgroundKey } : fresh));
      }
      await loadBackgrounds();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setWorkingKey(null);
    }
  }

  async function saveStatement() {
    setBusy("statement");
    setError("");
    try {
      const res = await fetch("/api/buffet-menu/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buffet)
      });
      if (!res.ok) throw new Error(await readResponseError(res, "Could not save the allergen statement."));
      const data = (await res.json()) as BuffetMenuSettings;
      setBuffet(data);
      setSavedBuffet(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the allergen statement.");
    } finally {
      setBusy(null);
    }
  }

  const builtin = backgrounds.find((b) => b.builtin);

  return (
    <main className="page">
      <PageHeader title="Settings" description="Shared settings used by every tool. Changes apply to everything printed from now on." />

      {user && !isAdmin ? (
        <Callout tone="info" className="readonly-note">
          Only admins can change these settings.
        </Callout>
      ) : null}

      {/* Locked (until the account loads, and for non-admins) so nobody edits what they can't save. */}
      <fieldset className="fieldset-plain" disabled={!isAdmin}>

        <Section
          title="Menu card contact details"
          description="Printed on the back cover of banqueting menu cards. Leave a line blank to leave it off."
        >
          <div className="stack">
            <div className="form-grid">
              <Field label="Phone number">
                <input
                  value={app?.contactPhone ?? ""}
                  disabled={!app}
                  maxLength={100}
                  onChange={(e) => setApp((a) => (a ? { ...a, contactPhone: e.target.value } : a))}
                  placeholder="e.g. 0117 428 4000"
                />
              </Field>
              <Field label="Web addresses" hint="Separate several with a vertical bar ( | ).">
                <input
                  value={app?.contactWebsites ?? ""}
                  disabled={!app}
                  maxLength={300}
                  onChange={(e) => setApp((a) => (a ? { ...a, contactWebsites: e.target.value } : a))}
                  placeholder="e.g. bristol.ac.uk/venues | bristol.ac.uk/catering"
                />
              </Field>
            </div>
            <SaveRow
              dirty={contactDirty}
              saved={savedApp !== null}
              busy={busy === "contact"}
              onSave={() => void saveContact()}
              label="Save contact details"
            />
          </div>
        </Section>

        <Section
          title={
            <>
              Display menu backgrounds <span className="badge">{backgrounds.length}</span>
            </>
          }
          description="Full-page “Empty Belly” posters printed behind the A4 buffet display menu. Menus use the default unless they pick another on the Buffet menus page."
          actions={
            <label className={`upload-button${busy === "upload" ? " upload-button--disabled" : ""}`}>
              <input
                type="file"
                accept={LOGO_UPLOAD_ACCEPT}
                disabled={busy === "upload"}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void uploadBackground(file);
                }}
              />
              <ImagePlus size={15} aria-hidden />
              {busy === "upload" ? "Uploading…" : "Upload"}
            </label>
          }
        >
          <div className="stack">
            {uploadWarning ? (
              <Callout tone="warning" onDismiss={() => setUploadWarning("")}>
                {uploadWarning}
              </Callout>
            ) : null}
            <div className="bg-grid">
              {backgrounds.map((item) => {
                const isDefault = savedApp?.defaultDisplayBackgroundKey === item.key;
                return (
                  <div key={item.key} className="library-tile">
                    <span className="bg-tile-img">
                      <img src={item.assetUrl} alt="" />
                      <span className="bg-tile-band" aria-hidden />
                    </span>
                    <span className="bg-tile-label" title={item.label}>
                      {item.label}
                    </span>
                    <div className="bg-tile-foot">
                      {isDefault ? (
                        <span className="badge badge--accent">
                          <Star size={12} aria-hidden /> Default
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn-sm"
                          disabled={workingKey !== null || !savedApp}
                          onClick={() => void makeDefault(item.key)}
                        >
                          Make default
                        </button>
                      )}
                      {item.builtin ? null : (
                        <button
                          type="button"
                          className="icon-btn icon-btn--sm btn-danger"
                          disabled={workingKey !== null}
                          onClick={() => void deleteBackground(item)}
                          aria-label={`Delete ${item.label}`}
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-muted text-sm" style={{ margin: 0 }}>
              The dashed box on each preview shows where the menu text is printed.
            </p>
            <Disclosure label="Making a new Empty Belly poster">
              <ul className="spec-list">
                <li>
                  <strong>Size:</strong> A4 portrait (210 × 297 mm). Export at 2480 × 3508 px (300 dpi), or at least
                  1240 × 1754 px. Other proportions get stretched to fill the page.
                </li>
                <li>
                  <strong>Clear area for the menu:</strong> keep a plain white or very pale band across the middle of the
                  page, from 18% to 82% of the height (about 54 mm in from the top and from the bottom). The menu is
                  printed there in black, with a 12 mm margin each side.
                </li>
                <li>
                  <strong>Artwork:</strong> put the decoration above and below that band. Run it right to the edges, with
                  no crop marks or bleed, but keep logos and words at least 5 mm from the edges because most printers
                  can&apos;t print right up to them.
                </li>
                <li>
                  <strong>File:</strong> JPEG (best) or PNG, RGB colour, under 4 MB.
                </li>
                {builtin ? (
                  <li>
                    For a template, start from the{" "}
                    <a className="text-link" href={builtin.assetUrl} download="water-menu-background.jpg">
                      built-in water background
                    </a>
                    .
                  </li>
                ) : null}
              </ul>
            </Disclosure>
          </div>
        </Section>

        <Section
          title="Allergen statement"
          description="Small print at the foot of every allergen matrix page, for all buffet menus."
        >
          <div className="stack">
            <Switch
              checked={buffet.showAllergenStatement}
              disabled={savedBuffet === null}
              onChange={(checked) => setBuffet((s) => ({ ...s, showAllergenStatement: checked }))}
              label="Print on the allergen matrix"
            />
            <Field label="Statement" as="div">
              <textarea
                value={buffet.allergenStatement}
                disabled={savedBuffet === null}
                onChange={(e) => setBuffet((s) => ({ ...s, allergenStatement: e.target.value }))}
                maxLength={MAX_BUFFET_ALLERGEN_STATEMENT_CHARS}
                rows={4}
                aria-label="Allergen statement"
                placeholder="e.g. Please speak to a member of staff about allergens before choosing your food. Dishes are prepared in a kitchen that handles all 14 major allergens."
              />
            </Field>
            <SaveRow
              dirty={statementDirty}
              saved={savedBuffet !== null}
              busy={busy === "statement"}
              onSave={() => void saveStatement()}
              label="Save statement"
            />
          </div>
        </Section>

      </fieldset>

      {user && isAdmin ? <UsersSection currentUserId={user.id} onError={setError} /> : null}

      <Toasts>
        {error ? (
          <Callout tone="error" onDismiss={() => setError("")}>
            {error}
          </Callout>
        ) : null}
      </Toasts>
    </main>
  );
}
