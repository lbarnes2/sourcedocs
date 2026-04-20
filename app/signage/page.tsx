"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { defaultSignageTheme } from "@/lib/defaults";
import type { SignageArrowDirection, VenueSignageProfile, VenueSignageSlot } from "@/types";

const ARROW_OPTIONS: { value: SignageArrowDirection; label: string }[] = [
  { value: "none", label: "None" },
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "upLeft", label: "Up + left" },
  { value: "upRight", label: "Up + right" },
  { value: "downLeft", label: "Down + left" },
  { value: "downRight", label: "Down + right" }
];

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
    theme: { ...defaultSignageTheme }
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

  const [adhocEventName, setAdhocEventName] = useState("");
  const [adhocPaper, setAdhocPaper] = useState<"A3" | "A4">("A4");
  const [adhocOrientation, setAdhocOrientation] = useState<"portrait" | "landscape">("portrait");
  const [adhocArrow, setAdhocArrow] = useState<SignageArrowDirection>("left");
  const [adhocVenueKey, setAdhocVenueKey] = useState("");
  const [adhocClientKey, setAdhocClientKey] = useState("");
  const [adhocTheme, setAdhocTheme] = useState({ ...defaultSignageTheme });

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

  async function uploadVenue(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/logos/venue", { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Upload failed.");
    await loadLogos();
    return j.key as string;
  }

  async function uploadClient(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/logos/client", { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Upload failed.");
    await loadLogos();
    return j.key as string;
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
        clientLogoKey: packClientKey || undefined
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
      await downloadPdf(r, `signage-${packEventName.trim()}`);
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
        clientLogoKey: adhocClientKey || undefined
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
      await downloadPdf(r, `signage-${adhocEventName.trim()}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-signage">
      <p style={{ margin: "0 0 10px" }}>
        <Link href="/" className="text-muted" style={{ fontSize: 14, textDecoration: "none" }}>
          ← Home
        </Link>
      </p>
      <header className="app-header">
        <h1>Event Signage</h1>
        <p className="app-tagline">
          Configure venue sign packs (counts, sizes, arrows), then generate a single multi-page PDF with event branding
          and optional venue and client logos.
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
          <div className="panel">
            <h2 className="step-heading">
              <span className="step-heading-badge">1</span>
              <span>Venue profiles</span>
            </h2>
            <p className="text-muted" style={{ marginTop: 0 }}>
              Each profile lists the signs you need for that venue (e.g. 3× A4 portrait up, 1× A3 welcome with no arrow).
              Save defaults for venue and client logos to speed up one-click generation.
            </p>
            {!logosConfigured && (
              <p className="pill" style={{ marginBottom: 12 }}>
                R2 is not configured — logo uploads and logo keys on generated PDFs require R2 (see{" "}
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
                    <select
                      value={slot.arrow}
                      onChange={(e) => updateSlot(index, { arrow: e.target.value as SignageArrowDirection })}
                    >
                      {ARROW_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="grid two" style={{ marginTop: 10 }}>
                  <label>
                    Paper
                    <select
                      value={slot.paperSize}
                      onChange={(e) => updateSlot(index, { paperSize: e.target.value as "A3" | "A4" })}
                    >
                      <option value="A4">A4</option>
                      <option value="A3">A3</option>
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
              <label>
                Default venue logo
                <select
                  value={draft.defaultVenueLogoKey ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      defaultVenueLogoKey: e.target.value || undefined
                    }))
                  }
                >
                  <option value="">None</option>
                  {venueLogos.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Upload venue logo
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    void (async () => {
                      try {
                        const key = await uploadVenue(f);
                        setDraft((d) => ({ ...d, defaultVenueLogoKey: key }));
                        await loadLogos();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Upload failed.");
                      }
                    })();
                  }}
                />
              </label>
              <label>
                Default client logo
                <select
                  value={draft.defaultClientLogoKey ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      defaultClientLogoKey: e.target.value || undefined
                    }))
                  }
                >
                  <option value="">None</option>
                  {clientLogos.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Upload client logo
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    void (async () => {
                      try {
                        const key = await uploadClient(f);
                        setDraft((d) => ({ ...d, defaultClientLogoKey: key }));
                        await loadLogos();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Upload failed.");
                      }
                    })();
                  }}
                />
              </label>
            </div>

            <button type="button" style={{ marginTop: 16 }} disabled={busy} onClick={() => void saveDraft()}>
              {busy ? "Saving…" : "Save venue profile"}
            </button>
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
            <p className="text-muted" style={{ marginBottom: 8 }}>
              Logo dropdowns override profile defaults for this download only. Enable the checkbox to override colours
              for this run.
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
              <label>
                Venue logo (this run)
                <select value={packVenueKey} onChange={(e) => setPackVenueKey(e.target.value)}>
                  <option value="">Use profile default</option>
                  {venueLogos.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Client logo (this run)
                <select value={packClientKey} onChange={(e) => setPackClientKey(e.target.value)}>
                  <option value="">Use profile default</option>
                  {clientLogos.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button type="button" disabled={busy} onClick={() => void generatePack()}>
              {busy ? "Working…" : "Download sign pack PDF"}
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
                <select value={adhocArrow} onChange={(e) => setAdhocArrow(e.target.value as SignageArrowDirection)}>
                  {ARROW_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Paper
                <select value={adhocPaper} onChange={(e) => setAdhocPaper(e.target.value as "A3" | "A4")}>
                  <option value="A4">A4</option>
                  <option value="A3">A3</option>
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
            </div>
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
              <label>
                Venue logo
                <select value={adhocVenueKey} onChange={(e) => setAdhocVenueKey(e.target.value)}>
                  <option value="">None</option>
                  {venueLogos.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Client logo
                <select value={adhocClientKey} onChange={(e) => setAdhocClientKey(e.target.value)}>
                  <option value="">None</option>
                  {clientLogos.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button type="button" className="secondary" disabled={busy} onClick={() => void generateAdhoc()}>
              {busy ? "Working…" : "Download single sign PDF"}
            </button>
          </div>
        </>
      )}
    </main>
  );
}
