"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowSymbolPicker } from "./ArrowSymbolPicker";
import { LogoPicker } from "@/app/components/LogoPicker";
import { defaultSignageTheme } from "@/lib/defaults";
import { PAPER_SIZE_OPTIONS } from "@/lib/paperSizes";
import { downloadPdfBlobAsPngs, downloadPdfBlobsAsPngZip } from "@/lib/pdf/pdfToPngExport";
import * as limits from "@/lib/validation/limits";
import type { PaperSize, SignageArrowDirection, VenueSignageProfile, VenueSignageSlot } from "@/types";

function newVenueId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  }
  return `venue-${Date.now()}`;
}

function emptySlot(): VenueSignageSlot {
  return { count: 1, paperSize: "A4", orientation: "portrait", arrow: "up" };
}

function defaultProfile(): VenueSignageProfile {
  return {
    id: newVenueId(),
    name: "New venue profile",
    slots: [emptySlot()],
    theme: { ...defaultSignageTheme },
    defaultVenueLabel: undefined,
    defaultSubVenueLabel: undefined
  };
}

type LogoItem = { key: string; label: string; assetUrl: string };

async function downloadPdf(response: Response, fallbackName: string) {
  const blob = await response.blob();
  const cd = response.headers.get("Content-Disposition");
  const m = cd?.match(/filename="([^"]+)"/);
  const name = m?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.endsWith(".pdf") ? name : `${name}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadPdfBase64(base64: string, filename: string) {
  const blob = pdfBase64ToBlob(base64);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

function pdfBase64ToBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "application/pdf" });
}

export default function SignagePage() {
  const [profiles, setProfiles] = useState<VenueSignageProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState<VenueSignageProfile>(() => defaultProfile());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [venueLogos, setVenueLogos] = useState<LogoItem[]>([]);
  const [clientLogos, setClientLogos] = useState<LogoItem[]>([]);
  const [logosConfigured, setLogosConfigured] = useState(false);

  const [packEventName, setPackEventName] = useState("");
  const [packVenueKey, setPackVenueKey] = useState("");
  const [packClientKey, setPackClientKey] = useState("");
  const [packOverrideTheme, setPackOverrideTheme] = useState(false);
  const [packPrimary, setPackPrimary] = useState(defaultSignageTheme.primaryColor);
  const [packAccent, setPackAccent] = useState(defaultSignageTheme.accentColor);
  const [packText, setPackText] = useState(defaultSignageTheme.textColor);
  const [packVenueOverride, setPackVenueOverride] = useState("");
  const [packSubVenueOverride, setPackSubVenueOverride] = useState("");
  const [packEventDate, setPackEventDate] = useState("");
  const [packOutputFormat, setPackOutputFormat] = useState<"pdf" | "png">("pdf");

  const [adhocEventName, setAdhocEventName] = useState("");
  const [adhocPaper, setAdhocPaper] = useState<PaperSize>("A4");
  const [adhocOrientation, setAdhocOrientation] = useState<"portrait" | "landscape">("portrait");
  const [adhocArrow, setAdhocArrow] = useState<SignageArrowDirection>("left");
  const [adhocVenueKey, setAdhocVenueKey] = useState("");
  const [adhocClientKey, setAdhocClientKey] = useState("");
  const [adhocTheme, setAdhocTheme] = useState({ ...defaultSignageTheme });
  const [adhocVenueLine, setAdhocVenueLine] = useState("");
  const [adhocSubVenueLine, setAdhocSubVenueLine] = useState("");
  const [adhocEventDate, setAdhocEventDate] = useState("");
  const [adhocOutputFormat, setAdhocOutputFormat] = useState<"pdf" | "png">("pdf");

  const [venueProfileEditorOpen, setVenueProfileEditorOpen] = useState(false);

  const loadProfiles = useCallback(async () => {
    setError("");
    const r = await fetch("/api/signage/venues");
    if (!r.ok) {
      setError("Failed to load venue profiles.");
      return;
    }
    const data = (await r.json()) as { profiles: VenueSignageProfile[] };
    setProfiles(data.profiles);
  }, []);

  const loadLogos = useCallback(async () => {
    const [vr, cr] = await Promise.all([fetch("/api/logos/venue"), fetch("/api/logos/client")]);
    const vj = vr.ok ? await vr.json() : { configured: false, items: [] };
    const cj = cr.ok ? await cr.json() : { configured: false, items: [] };
    setVenueLogos(vj.items ?? []);
    setClientLogos(cj.items ?? []);
    setLogosConfigured(Boolean(vj.configured));
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await Promise.all([loadProfiles(), loadLogos()]);
      setLoading(false);
    })();
  }, [loadProfiles, loadLogos]);

  const [didInitialPick, setDidInitialPick] = useState(false);
  useEffect(() => {
    if (loading || didInitialPick || !profiles.length) return;
    setDidInitialPick(true);
    setSelectedId(profiles[0].id);
    setDraft({ ...profiles[0], slots: profiles[0].slots.map((s) => ({ ...s })) });
  }, [loading, didInitialPick, profiles]);

  function selectProfile(id: string) {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    setSelectedId(id);
    setDraft({
      ...p,
      slots: p.slots.length ? p.slots.map((s) => ({ ...s })) : [emptySlot()],
      theme: { ...p.theme }
    });
    setPackOverrideTheme(false);
    setPackPrimary(p.theme.primaryColor);
    setPackAccent(p.theme.accentColor);
    setPackText(p.theme.textColor);
  }

  async function saveDraft() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/signage/venues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft)
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? "Save failed.");
      }
      await loadProfiles();
      setSelectedId(draft.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    if (!selectedId) return;
    if (!window.confirm("Delete this venue profile?")) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/signage/venues?id=${encodeURIComponent(selectedId)}`, {
        method: "DELETE"
      });
      if (!r.ok) throw new Error("Delete failed.");
      setSelectedId(null);
      setDraft(defaultProfile());
      await loadProfiles();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  function newProfile() {
    const p = defaultProfile();
    setSelectedId(null);
    setDraft(p);
    setPackPrimary(p.theme.primaryColor);
    setPackAccent(p.theme.accentColor);
    setPackText(p.theme.textColor);
    setPackOverrideTheme(false);
  }

  function updateSlot(index: number, patch: Partial<VenueSignageSlot>) {
    setDraft((d) => {
      const slots = d.slots.map((s, i) => (i === index ? { ...s, ...patch } : s));
      return { ...d, slots };
    });
  }

  function addSlot() {
    setDraft((d) => ({ ...d, slots: [...d.slots, emptySlot()] }));
  }

  function removeSlot(index: number) {
    setDraft((d) => ({
      ...d,
      slots: d.slots.length > 1 ? d.slots.filter((_, i) => i !== index) : d.slots
    }));
  }

  async function generatePack() {
    if (!selectedId) {
      setError("Select or save a venue profile first.");
      return;
    }
    if (!packEventName.trim()) {
      setError("Enter an event name for the pack.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const themeOverride = packOverrideTheme
        ? {
            primaryColor: packPrimary.trim(),
            accentColor: packAccent.trim(),
            textColor: packText.trim()
          }
        : undefined;
      const body = {
        mode: "pack" as const,
        venueProfileId: selectedId,
        eventName: packEventName.trim(),
        themeOverride,
        venueLogoKey: packVenueKey || undefined,
        clientLogoKey: packClientKey || undefined,
        ...(packVenueOverride.trim() ? { venueLabel: packVenueOverride.trim() } : {}),
        ...(packSubVenueOverride.trim() ? { subVenueLabel: packSubVenueOverride.trim() } : {}),
        ...(packEventDate.trim() ? { eventDate: packEventDate.trim() } : {})
      };
      const r = await fetch("/api/signage/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? "Generation failed.");
      }
      const ct = r.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const data = (await r.json()) as {
          split?: boolean;
          filenameBase?: string;
          pdfs?: Array<{ fileSuffix: string; base64: string }>;
        };
        const base = data.filenameBase?.trim() || "signage";
        const pdfs = data.pdfs ?? [];
        if (!pdfs.length) {
          throw new Error("No PDFs were generated.");
        }
        if (packOutputFormat === "png") {
          await downloadPdfBlobsAsPngZip(
            pdfs.map((pdf) => ({
              blob: pdfBase64ToBlob(pdf.base64),
              baseName: `${base}-${pdf.fileSuffix}`
            })),
            `${base}-png.zip`
          );
        } else {
          pdfs.forEach((pdf, index) => {
            const delay = index * 200;
            window.setTimeout(() => downloadPdfBase64(pdf.base64, `${base}-${pdf.fileSuffix}.pdf`), delay);
          });
        }
      } else {
        const fallbackName = `signage-${packEventName.trim()}`;
        if (packOutputFormat === "png") {
          await downloadPdfBlobAsPngs(await r.blob(), fallbackName);
        } else {
          await downloadPdf(r, fallbackName);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function generateAdhoc() {
    if (!adhocEventName.trim()) {
      setError("Enter an event name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = {
        mode: "adhoc" as const,
        eventName: adhocEventName.trim(),
        paperSize: adhocPaper,
        orientation: adhocOrientation,
        arrow: adhocArrow,
        theme: adhocTheme,
        venueLogoKey: adhocVenueKey || undefined,
        clientLogoKey: adhocClientKey || undefined,
        ...(adhocVenueLine.trim() ? { venueLabel: adhocVenueLine.trim() } : {}),
        ...(adhocSubVenueLine.trim() ? { subVenueLabel: adhocSubVenueLine.trim() } : {}),
        ...(adhocEventDate.trim() ? { eventDate: adhocEventDate.trim() } : {})
      };
      const r = await fetch("/api/signage/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? "Generation failed.");
      }
      const fallbackName = `signage-${adhocEventName.trim()}`;
      if (adhocOutputFormat === "png") {
        await downloadPdfBlobAsPngs(await r.blob(), fallbackName);
      } else {
        await downloadPdf(r, fallbackName);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-signage">
      <header className="app-header">
        <Link href="/" className="app-backlink">
          ← Home
        </Link>
        <h1>Event Signage</h1>
        <p className="app-tagline">
          Configure venue sign packs (counts, sizes, arrows), then download separate PDFs for each paper size
          with event branding and optional venue and client logos—ready for tray selection on multifunction printers.
        </p>
      </header>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <>
          <div className="panel panel--collapsible">
            <div
              className={
                venueProfileEditorOpen ? "panel-collapsible-head panel-collapsible-head--open" : "panel-collapsible-head"
              }
            >
              <h2 className="step-heading step-heading--collapsible">
                <button
                  type="button"
                  className="panel-collapsible-trigger"
                  aria-expanded={venueProfileEditorOpen}
                  aria-controls="venue-profile-editor"
                  id="venue-profile-editor-toggle"
                  onClick={() => setVenueProfileEditorOpen((o) => !o)}
                >
                  <span className="step-heading-badge">1</span>
                  <span className="panel-collapsible-title">Venue profiles</span>
                  <span className="panel-collapsible-chevron" aria-hidden>
                    {venueProfileEditorOpen ? "▼" : "▶"}
                  </span>
                </button>
              </h2>
              {!venueProfileEditorOpen ? (
                <p className="text-muted panel-collapsible-summary" id="venue-profile-editor-summary">
                  {draft.name} · {draft.slots.length} slot{draft.slots.length === 1 ? "" : "s"}
                  {!selectedId ? " · unsaved draft" : null}
                </p>
              ) : null}
            </div>

            <div id="venue-profile-editor" hidden={!venueProfileEditorOpen}>
            <p className="text-muted" style={{ marginTop: 0 }}>
              Each profile lists the signs you need for that venue (e.g. 3× A4 portrait up, 1× A3 welcome with no arrow).
              Save defaults for venue and client logos to speed up one-click generation.
            </p>
            <p className="text-muted" style={{ marginTop: -4 }}>
              Need to add, rename, or delete a logo? Use the <Link href="/logo-library">Logo Library</Link>.
            </p>
            {!logosConfigured && (
              <p className="pill" style={{ marginBottom: 12 }}>
                R2 is not configured — logo keys on generated PDFs require R2 (see{" "}
                <code>.env.example</code>). You can still generate signs with colours and arrows.
              </p>
            )}
            <div className="grid two" style={{ marginBottom: 14 }}>
              <label>
                Saved profiles
                <select
                  value={selectedId ?? ""}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id) selectProfile(id);
                  }}
                >
                  <option value="">— New unsaved —</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
                <button type="button" className="secondary" onClick={newProfile}>
                  New profile
                </button>
                <button type="button" disabled={busy || !selectedId} onClick={() => void deleteSelected()}>
                  Delete selected
                </button>
              </div>
            </div>

            <div className="grid two">
              <label>
                Profile id (filename-safe)
                <input
                  value={draft.id}
                  onChange={(e) => setDraft((d) => ({ ...d, id: e.target.value }))}
                  disabled={profiles.some((p) => p.id === draft.id)}
                  title="Cannot change id after save; create a new profile to pick a new id."
                />
              </label>
              <label>
                Display name
                <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
              </label>
            </div>

            <label style={{ display: "block", marginTop: 12 }}>
              Venue line on signs (default for packs)
              <input
                value={draft.defaultVenueLabel ?? ""}
                maxLength={limits.MAX_SIGNAGE_VENUE_LABEL_CHARS}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    defaultVenueLabel: e.target.value ? e.target.value : undefined
                  }))
                }
                placeholder="e.g. The Grand Hotel — shown in bold below the event name"
              />
            </label>

            <label style={{ display: "block", marginTop: 12 }}>
              Sub-venue line (optional, default for packs)
              <input
                value={draft.defaultSubVenueLabel ?? ""}
                maxLength={limits.MAX_SIGNAGE_VENUE_LABEL_CHARS}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    defaultSubVenueLabel: e.target.value ? e.target.value : undefined
                  }))
                }
                placeholder="e.g. Oak Room — regular weight, under the venue line"
              />
            </label>

            <h3 style={{ fontSize: "0.95rem", marginTop: 18 }}>Sign slots (order = PDF page order)</h3>
            {draft.slots.map((slot, index) => (
              <div key={index} className="subpanel" style={{ marginBottom: 10 }}>
                <div className="grid two">
                  <label>
                    Count
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={slot.count}
                      onChange={(e) => updateSlot(index, { count: Math.max(1, Number(e.target.value) || 1) })}
                    />
                  </label>
                  <label>
                    Arrow
                    <ArrowSymbolPicker
                      value={slot.arrow}
                      onChange={(v) => updateSlot(index, { arrow: v })}
                      disabled={busy}
                      aria-label={`Arrow symbol for slot ${index + 1}`}
                    />
                  </label>
                </div>
                <div className="grid two" style={{ marginTop: 10 }}>
                  <label>
                    Paper
                    <select
                      value={slot.paperSize}
                      onChange={(e) => updateSlot(index, { paperSize: e.target.value as PaperSize })}
                    >
                      {PAPER_SIZE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Orientation
                    <select
                      value={slot.orientation}
                      onChange={(e) =>
                        updateSlot(index, { orientation: e.target.value as "portrait" | "landscape" })
                      }
                    >
                      <option value="portrait">Portrait</option>
                      <option value="landscape">Landscape</option>
                    </select>
                  </label>
                </div>
                <button type="button" className="secondary" style={{ marginTop: 10 }} onClick={() => removeSlot(index)}>
                  Remove slot
                </button>
              </div>
            ))}
            <button type="button" className="secondary" onClick={addSlot}>
              + Add slot
            </button>

            <h3 style={{ fontSize: "0.95rem", marginTop: 18 }}>PDF colours</h3>
            <div className="grid two">
              <label>
                Primary
                <input
                  type="color"
                  value={draft.theme.primaryColor}
                  onChange={(e) => setDraft((d) => ({ ...d, theme: { ...d.theme, primaryColor: e.target.value } }))}
                />
              </label>
              <label>
                Accent
                <input
                  type="color"
                  value={draft.theme.accentColor}
                  onChange={(e) => setDraft((d) => ({ ...d, theme: { ...d.theme, accentColor: e.target.value } }))}
                />
              </label>
              <label>
                Text
                <input
                  type="color"
                  value={draft.theme.textColor}
                  onChange={(e) => setDraft((d) => ({ ...d, theme: { ...d.theme, textColor: e.target.value } }))}
                />
              </label>
            </div>

            <h3 style={{ fontSize: "0.95rem", marginTop: 18 }}>Default logos (optional)</h3>
            <div className="grid two">
              <div>
                <LogoPicker
                  title="Default venue logo"
                  items={venueLogos}
                  value={draft.defaultVenueLogoKey ?? ""}
                  onChange={(key) =>
                    setDraft((d) => ({
                      ...d,
                      defaultVenueLogoKey: key || undefined
                    }))
                  }
                  emptyOption={{ label: "None", value: "" }}
                  disabled={!logosConfigured || busy}
                />
              </div>
              <div>
                <LogoPicker
                  title="Default client logo"
                  items={clientLogos}
                  value={draft.defaultClientLogoKey ?? ""}
                  onChange={(key) =>
                    setDraft((d) => ({
                      ...d,
                      defaultClientLogoKey: key || undefined
                    }))
                  }
                  emptyOption={{ label: "None", value: "" }}
                  disabled={!logosConfigured || busy}
                />
              </div>
            </div>

            <button type="button" style={{ marginTop: 16 }} disabled={busy} onClick={() => void saveDraft()}>
              {busy ? "Saving…" : "Save venue profile"}
            </button>
            </div>
          </div>

          <div className="panel">
            <h2 className="step-heading">
              <span className="step-heading-badge">2</span>
              <span>Generate pack from profile</span>
            </h2>
            <div className="grid two">
              <label>
                Event name (on every sign)
                <input value={packEventName} onChange={(e) => setPackEventName(e.target.value)} placeholder="e.g. Smith Wedding" />
              </label>
              <label>
                Profile
                <select
                  value={selectedId ?? ""}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id) selectProfile(id);
                  }}
                >
                  <option value="">— Select —</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid two" style={{ marginTop: 10 }}>
              <label>
                Event date (on signs)
                <input
                  value={packEventDate}
                  maxLength={limits.MAX_SIGNAGE_EVENT_DATE_CHARS}
                  onChange={(e) => setPackEventDate(e.target.value)}
                  placeholder="e.g. Saturday 20 June 2026"
                />
              </label>
              <label>
                Venue line (override)
                <input
                  value={packVenueOverride}
                  maxLength={limits.MAX_SIGNAGE_VENUE_LABEL_CHARS}
                  onChange={(e) => setPackVenueOverride(e.target.value)}
                  placeholder="Leave blank to use profile default"
                />
              </label>
            </div>
            <label style={{ display: "block", marginTop: 10 }}>
              Sub-venue line (override)
              <input
                value={packSubVenueOverride}
                maxLength={limits.MAX_SIGNAGE_VENUE_LABEL_CHARS}
                onChange={(e) => setPackSubVenueOverride(e.target.value)}
                placeholder="Leave blank to use profile default"
              />
            </label>
            <p className="text-muted" style={{ marginBottom: 8 }}>
              Pack download gives one PDF for each paper size present in the profile. Venue, optional sub-venue, and date
              appear under the event name; leave overrides blank to use profile defaults. Logo choices below override
              profile defaults for this download only. Enable the checkbox to override colours for this run.
            </p>
            <label className="checkbox-row" style={{ marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={packOverrideTheme}
                onChange={(e) => {
                  setPackOverrideTheme(e.target.checked);
                  if (e.target.checked && selectedId) {
                    const p = profiles.find((x) => x.id === selectedId);
                    if (p) {
                      setPackPrimary(p.theme.primaryColor);
                      setPackAccent(p.theme.accentColor);
                      setPackText(p.theme.textColor);
                    }
                  }
                }}
              />
              <span>Override profile colours for this download</span>
            </label>
            {packOverrideTheme ? (
              <div className="grid two">
                <label>
                  Primary
                  <input type="color" value={packPrimary} onChange={(e) => setPackPrimary(e.target.value)} />
                </label>
                <label>
                  Accent
                  <input type="color" value={packAccent} onChange={(e) => setPackAccent(e.target.value)} />
                </label>
                <label>
                  Text
                  <input type="color" value={packText} onChange={(e) => setPackText(e.target.value)} />
                </label>
              </div>
            ) : null}
            <div className="grid two">
              <div>
                <LogoPicker
                  title="Venue logo (this run)"
                  items={venueLogos}
                  value={packVenueKey}
                  onChange={setPackVenueKey}
                  emptyOption={{ label: "Use profile default", value: "" }}
                  disabled={!logosConfigured || busy}
                />
              </div>
              <div>
                <LogoPicker
                  title="Client logo (this run)"
                  items={clientLogos}
                  value={packClientKey}
                  onChange={setPackClientKey}
                  emptyOption={{ label: "Use profile default", value: "" }}
                  disabled={!logosConfigured || busy}
                />
              </div>
            </div>
            <div className="grid two" style={{ marginTop: 12 }}>
              <label>
                Format
                <select value={packOutputFormat} onChange={(e) => setPackOutputFormat(e.target.value as "pdf" | "png")}>
                  <option value="pdf">PDF</option>
                  <option value="png">PNG image</option>
                </select>
              </label>
            </div>
            <button type="button" style={{ marginTop: 16 }} disabled={busy} onClick={() => void generatePack()}>
              {busy ? "Working…" : `Download sign pack ${packOutputFormat === "png" ? "PNGs" : "PDFs"}`}
            </button>
          </div>

          <div className="panel">
            <h2 className="step-heading">
              <span className="step-heading-badge">3</span>
              <span>Ad-hoc single sign</span>
            </h2>
            <div className="grid two">
              <label>
                Event name
                <input value={adhocEventName} onChange={(e) => setAdhocEventName(e.target.value)} />
              </label>
              <label>
                Arrow
                <ArrowSymbolPicker
                  value={adhocArrow}
                  onChange={setAdhocArrow}
                  disabled={busy}
                  aria-label="Arrow symbol for ad-hoc sign"
                />
              </label>
              <label>
                Paper
                <select value={adhocPaper} onChange={(e) => setAdhocPaper(e.target.value as PaperSize)}>
                  {PAPER_SIZE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Orientation
                <select
                  value={adhocOrientation}
                  onChange={(e) => setAdhocOrientation(e.target.value as "portrait" | "landscape")}
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </label>
              <label>
                Format
                <select
                  value={adhocOutputFormat}
                  onChange={(e) => setAdhocOutputFormat(e.target.value as "pdf" | "png")}
                >
                  <option value="pdf">PDF</option>
                  <option value="png">PNG image</option>
                </select>
              </label>
            </div>
            <div className="grid two">
              <label>
                Venue line
                <input
                  value={adhocVenueLine}
                  maxLength={limits.MAX_SIGNAGE_VENUE_LABEL_CHARS}
                  onChange={(e) => setAdhocVenueLine(e.target.value)}
                  placeholder="Optional — bold, below event name"
                />
              </label>
              <label>
                Event date
                <input
                  value={adhocEventDate}
                  maxLength={limits.MAX_SIGNAGE_EVENT_DATE_CHARS}
                  onChange={(e) => setAdhocEventDate(e.target.value)}
                  placeholder="Optional — regular weight"
                />
              </label>
            </div>
            <label style={{ display: "block", marginTop: 10 }}>
              Sub-venue line
              <input
                value={adhocSubVenueLine}
                maxLength={limits.MAX_SIGNAGE_VENUE_LABEL_CHARS}
                onChange={(e) => setAdhocSubVenueLine(e.target.value)}
                placeholder="Optional — same size as venue, regular weight, under venue"
              />
            </label>
            <div className="grid two">
              <label>
                Primary
                <input
                  type="color"
                  value={adhocTheme.primaryColor}
                  onChange={(e) => setAdhocTheme((t) => ({ ...t, primaryColor: e.target.value }))}
                />
              </label>
              <label>
                Accent
                <input
                  type="color"
                  value={adhocTheme.accentColor}
                  onChange={(e) => setAdhocTheme((t) => ({ ...t, accentColor: e.target.value }))}
                />
              </label>
              <label>
                Text
                <input
                  type="color"
                  value={adhocTheme.textColor}
                  onChange={(e) => setAdhocTheme((t) => ({ ...t, textColor: e.target.value }))}
                />
              </label>
            </div>
            <div className="grid two">
              <div>
                <LogoPicker
                  title="Venue logo"
                  items={venueLogos}
                  value={adhocVenueKey}
                  onChange={setAdhocVenueKey}
                  emptyOption={{ label: "None", value: "" }}
                  disabled={!logosConfigured || busy}
                />
              </div>
              <div>
                <LogoPicker
                  title="Client logo"
                  items={clientLogos}
                  value={adhocClientKey}
                  onChange={setAdhocClientKey}
                  emptyOption={{ label: "None", value: "" }}
                  disabled={!logosConfigured || busy}
                />
              </div>
            </div>
            <button type="button" className="secondary" style={{ marginTop: 16 }} disabled={busy} onClick={() => void generateAdhoc()}>
              {busy ? "Working…" : "Download single sign PDF"}
            </button>
          </div>
        </>
      )}
    </main>
  );
}
