"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, Plus, Signpost, Trash2, X } from "lucide-react";
import { ArrowGlyph, ArrowSymbolPicker } from "./ArrowSymbolPicker";
import { LogoPicker } from "@/app/components/LogoPicker";
import {
  Callout,
  ColorField,
  Disclosure,
  Field,
  PageHeader,
  Section,
  Segmented,
  Switch,
  Tabs
} from "@/app/components/ui";
import { defaultSignageTheme } from "@/lib/defaults";
import { PAPER_SIZE_OPTIONS } from "@/lib/paperSizes";
import { readResponseError } from "@/lib/http/readError";
import { downloadBlob, downloadPdfBlobAsPngs, downloadPdfBlobsAsPngZip } from "@/lib/pdf/pdfToPngExport";
import * as limits from "@/lib/validation/limits";
import { SIGNAGE_LOGO_NONE_SENTINEL } from "@/lib/signage/logoSelection";
import type {
  PaperSize,
  SignageArrowDirection,
  SignageDualEventArrangement,
  SignageThemeColors,
  VenueSignageProfile,
  VenueSignageSlot
} from "@/types";

function signageLogoKeyForApi(key: string): string | null | undefined {
  if (key === SIGNAGE_LOGO_NONE_SENTINEL) return null;
  const t = key.trim();
  return t ? t : undefined;
}

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

/** Key-order-insensitive JSON for dirty checks (undefined fields are dropped, as on save). */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v
  );
}

type LogoItem = { key: string; label: string; assetUrl: string };
type Orientation = "portrait" | "landscape";
type OutputFormat = "pdf" | "png";
type SignageTab = "pack" | "single" | "profiles";

const PAPER_OPTIONS = PAPER_SIZE_OPTIONS.map((o) => ({ value: o.value, label: o.value }));
const ORIENTATION_OPTIONS = [
  { value: "portrait" as const, label: "Portrait" },
  { value: "landscape" as const, label: "Landscape" }
];
const FORMAT_OPTIONS = [
  { value: "pdf" as const, label: "PDF" },
  { value: "png" as const, label: "PNG" }
];
const ARRANGEMENT_OPTIONS = [
  { value: "sideBySide" as const, label: "Side by side", title: "Two columns, arrows under each title" },
  { value: "stacked" as const, label: "Stacked", title: "Portrait: one above the other with a divider. Landscape: arrow beside each block." }
];

async function downloadPdf(response: Response, fallbackName: string) {
  const blob = await response.blob();
  const cd = response.headers.get("Content-Disposition");
  const m = cd?.match(/filename="([^"]+)"/);
  const name = m?.[1] ?? fallbackName;
  downloadBlob(blob, name.endsWith(".pdf") ? name : `${name}.pdf`);
}

function downloadPdfBase64(base64: string, filename: string) {
  downloadBlob(pdfBase64ToBlob(base64), filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}

function pdfBase64ToBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "application/pdf" });
}

/** Optional text input that stores `undefined` when cleared. */
function optional(value: string): string | undefined {
  return value ? value : undefined;
}

/* -------------------------------------------------------------------------- */
/* Second event block (shared by single signs and profile sign slots)          */
/* -------------------------------------------------------------------------- */

type SecondEventValue = {
  eventName: string;
  arrow: SignageArrowDirection;
  arrangement: SignageDualEventArrangement;
  venue: string;
  subVenue: string;
  date: string;
};

function SecondEventBlock({
  value,
  onChange,
  onRemove,
  disabled,
  namePlaceholder,
  fallbackHint
}: {
  value: SecondEventValue;
  onChange: (patch: Partial<SecondEventValue>) => void;
  onRemove: () => void;
  disabled?: boolean;
  namePlaceholder?: string;
  fallbackHint: string;
}) {
  const hasOwnDetails = Boolean(value.venue || value.subVenue || value.date);
  return (
    <div className="second-event">
      <div className="second-event-head">
        <div>
          <div className="second-event-title">Second event</div>
          <div className="field-hint">Shares this sign with the first event, with its own arrow.</div>
        </div>
        <button type="button" className="btn-ghost btn-sm" onClick={onRemove} disabled={disabled}>
          <X size={14} aria-hidden /> Remove
        </button>
      </div>
      <div className="form-grid form-grid--3">
        <Field label="Event name" className="span-2">
          <input
            value={value.eventName}
            maxLength={limits.MAX_EVENT_NAME_CHARS}
            placeholder={namePlaceholder}
            onChange={(e) => onChange({ eventName: e.target.value })}
          />
        </Field>
        <Field label="Arrow" as="div">
          <ArrowSymbolPicker
            value={value.arrow}
            onChange={(arrow) => onChange({ arrow })}
            disabled={disabled}
            aria-label="Second event arrow"
          />
        </Field>
        <Field label="Layout" as="div" className="span-all">
          <Segmented
            value={value.arrangement}
            options={ARRANGEMENT_OPTIONS}
            onChange={(arrangement) => onChange({ arrangement })}
            aria-label="Two-event layout"
          />
        </Field>
      </div>
      <Disclosure label="Different venue or date for this event" defaultOpen={hasOwnDetails} className="second-event-more">
        <div className="form-grid form-grid--3">
          <Field label="Venue line">
            <input
              value={value.venue}
              maxLength={limits.MAX_SIGNAGE_VENUE_LABEL_CHARS}
              placeholder="Same as first event"
              onChange={(e) => onChange({ venue: e.target.value })}
            />
          </Field>
          <Field label="Sub-venue line">
            <input
              value={value.subVenue}
              maxLength={limits.MAX_SIGNAGE_VENUE_LABEL_CHARS}
              placeholder="Same as first event"
              onChange={(e) => onChange({ subVenue: e.target.value })}
            />
          </Field>
          <Field label="Date line">
            <input
              value={value.date}
              maxLength={limits.MAX_SIGNAGE_EVENT_DATE_CHARS}
              placeholder="Same as first event"
              onChange={(e) => onChange({ date: e.target.value })}
            />
          </Field>
        </div>
        <p className="field-hint" style={{ margin: "8px 0 0" }}>
          {fallbackHint}
        </p>
      </Disclosure>
    </div>
  );
}

function AddSecondEventButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="btn-dashed" onClick={onClick} disabled={disabled}>
      <Plus size={15} aria-hidden /> Add a second event to this sign
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Profile sign slot row                                                       */
/* -------------------------------------------------------------------------- */

function slotHasSecondEvent(slot: VenueSignageSlot): boolean {
  return slot.secondaryArrow != null && slot.secondaryArrow !== "none";
}

function SlotEditor({
  slot,
  index,
  canRemove,
  busy,
  onChange,
  onRemove
}: {
  slot: VenueSignageSlot;
  index: number;
  canRemove: boolean;
  busy: boolean;
  onChange: (patch: Partial<VenueSignageSlot>) => void;
  onRemove: () => void;
}) {
  const dual = slotHasSecondEvent(slot);
  const [open, setOpen] = useState(() => Boolean(slot.message) || dual);
  const clearSecondEvent = () =>
    onChange({
      secondaryArrow: undefined,
      secondaryEventName: undefined,
      dualEventArrangement: undefined,
      secondaryVenueLabel: undefined,
      secondarySubVenueLabel: undefined,
      secondaryEventDate: undefined
    });
  return (
    <div className={`slot${open ? " slot--open" : ""}`}>
      <div className="slot-row">
        <span className="slot-index">{index + 1}</span>
        <label className="slot-count" title="Number of copies">
          <input
            type="number"
            min={1}
            max={500}
            value={slot.count}
            aria-label={`Copies of sign ${index + 1}`}
            onChange={(e) => onChange({ count: Math.max(1, Number(e.target.value) || 1) })}
          />
          <span aria-hidden>×</span>
        </label>
        <select
          className="slot-paper"
          value={slot.paperSize}
          aria-label={`Paper size for sign ${index + 1}`}
          onChange={(e) => onChange({ paperSize: e.target.value as PaperSize })}
        >
          {PAPER_SIZE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Segmented
          size="sm"
          value={slot.orientation}
          options={ORIENTATION_OPTIONS}
          onChange={(orientation) => onChange({ orientation })}
          aria-label={`Orientation for sign ${index + 1}`}
        />
        <ArrowSymbolPicker
          compact
          value={slot.arrow}
          onChange={(arrow) => onChange({ arrow })}
          disabled={busy}
          aria-label={`Arrow for sign ${index + 1}`}
        />
        <span className="slot-tags">
          {slot.message ? <span className="badge">Message</span> : null}
          {dual ? <span className="badge badge--accent">2 events</span> : null}
        </span>
        <span className="slot-actions">
        <button
          type="button"
          className="icon-btn icon-btn--sm"
          aria-expanded={open}
          aria-label={open ? "Hide sign options" : "More sign options"}
          title={open ? "Hide options" : "Message & second event"}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown size={16} className={`card-chevron${open ? " card-chevron--open" : ""}`} />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--sm btn-danger"
          aria-label={`Remove sign ${index + 1}`}
          title="Remove sign"
          disabled={!canRemove}
          onClick={onRemove}
        >
          <Trash2 size={15} />
        </button>
        </span>
      </div>
      {open ? (
        <div className="slot-body stack">
          <Field label={<>Sign message <span className="optional">(optional)</span></>} hint="Printed above the arrow on this sign for every event.">
            <textarea
              rows={2}
              value={slot.message ?? ""}
              maxLength={limits.MAX_SIGNAGE_MESSAGE_CHARS}
              placeholder="e.g. Please use the left hand entrance"
              onChange={(e) => onChange({ message: optional(e.target.value) })}
            />
          </Field>
          {dual ? (
            <SecondEventBlock
              value={{
                eventName: slot.secondaryEventName ?? "",
                arrow: slot.secondaryArrow ?? "right",
                arrangement: slot.dualEventArrangement ?? "sideBySide",
                venue: slot.secondaryVenueLabel ?? "",
                subVenue: slot.secondarySubVenueLabel ?? "",
                date: slot.secondaryEventDate ?? ""
              }}
              onChange={(patch) =>
                patch.arrow === "none"
                  ? clearSecondEvent()
                  : onChange({
                  ...("eventName" in patch ? { secondaryEventName: optional(patch.eventName ?? "") } : {}),
                  ...("arrow" in patch ? { secondaryArrow: patch.arrow } : {}),
                  ...("arrangement" in patch ? { dualEventArrangement: patch.arrangement } : {}),
                  ...("venue" in patch ? { secondaryVenueLabel: optional(patch.venue ?? "") } : {}),
                  ...("subVenue" in patch ? { secondarySubVenueLabel: optional(patch.subVenue ?? "") } : {}),
                  ...("date" in patch ? { secondaryEventDate: optional(patch.date ?? "") } : {})
                })
              }
              onRemove={clearSecondEvent}
              disabled={busy}
              namePlaceholder="e.g. Evening reception"
              fallbackHint="Blank lines use this profile's second-event defaults, then the first event's lines."
            />
          ) : (
            <AddSecondEventButton onClick={() => onChange({ secondaryArrow: "right" })} disabled={busy} />
          )}
        </div>
      ) : null}
    </div>
  );
}

/** One-line summary of what a profile prints, e.g. "3 × A4 portrait ↑". */
function PackSummary({ profile }: { profile: VenueSignageProfile }) {
  const total = profile.slots.reduce((sum, slot) => sum + slot.count, 0);
  const paperSizes = Array.from(new Set(profile.slots.map((slot) => slot.paperSize)));
  return (
    <div className="pack-summary">
      <div className="pack-summary-head">
        <span>
          <strong>{total}</strong> sign{total === 1 ? "" : "s"} · {paperSizes.length} PDF{paperSizes.length === 1 ? "" : "s"} (
          {paperSizes.join(", ")})
        </span>
      </div>
      <ul className="pack-summary-list">
        {profile.slots.map((slot, index) => (
          <li key={index}>
            <span className="pack-summary-glyph" aria-hidden>
              <ArrowGlyph value={slot.arrow} size={16} />
              {slotHasSecondEvent(slot) ? <ArrowGlyph value={slot.secondaryArrow ?? "none"} size={16} /> : null}
            </span>
            <span>
              {slot.count} × {slot.paperSize} {slot.orientation}
            </span>
            {slotHasSecondEvent(slot) ? (
              <span className="text-muted">+ {slot.secondaryEventName?.trim() || "second event"}</span>
            ) : null}
            {slot.message ? <span className="text-muted pack-summary-msg">“{slot.message}”</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function SignagePage() {
  const [tab, setTab] = useState<SignageTab>("pack");
  const [profiles, setProfiles] = useState<VenueSignageProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState<VenueSignageProfile>(() => defaultProfile());
  /** Snapshot of the draft as last opened/saved, for unsaved-changes checks. */
  const [baseline, setBaseline] = useState(() => stableStringify(draft));
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
  const [packOutputFormat, setPackOutputFormat] = useState<OutputFormat>("pdf");

  const [adhocEventName, setAdhocEventName] = useState("");
  const [adhocEventName2, setAdhocEventName2] = useState("");
  const [adhocPaper, setAdhocPaper] = useState<PaperSize>("A4");
  const [adhocOrientation, setAdhocOrientation] = useState<Orientation>("portrait");
  const [adhocArrow, setAdhocArrow] = useState<SignageArrowDirection>("left");
  const [adhocSecondaryArrow, setAdhocSecondaryArrow] = useState<SignageArrowDirection>("none");
  const [adhocVenueKey, setAdhocVenueKey] = useState("");
  const [adhocClientKey, setAdhocClientKey] = useState("");
  const [adhocTheme, setAdhocTheme] = useState<SignageThemeColors>({ ...defaultSignageTheme });
  const [adhocVenueLine, setAdhocVenueLine] = useState("");
  const [adhocSubVenueLine, setAdhocSubVenueLine] = useState("");
  const [adhocEventDate, setAdhocEventDate] = useState("");
  const [adhocMessage, setAdhocMessage] = useState("");
  const [adhocDualArrangement, setAdhocDualArrangement] = useState<SignageDualEventArrangement>("sideBySide");
  const [adhocSecondaryVenueLine, setAdhocSecondaryVenueLine] = useState("");
  const [adhocSecondarySubVenueLine, setAdhocSecondarySubVenueLine] = useState("");
  const [adhocSecondaryEventDate, setAdhocSecondaryEventDate] = useState("");
  const [adhocOutputFormat, setAdhocOutputFormat] = useState<OutputFormat>("pdf");

  const adhocDual = adhocSecondaryArrow !== "none";

  const savedProfile = useMemo(() => profiles.find((p) => p.id === selectedId) ?? null, [profiles, selectedId]);
  const draftDirty = stableStringify(draft) !== baseline;

  const loadProfiles = useCallback(async () => {
    setError("");
    const r = await fetch("/api/signage/venues");
    if (!r.ok) {
      setError("Failed to load venue profiles.");
      return;
    }
    const data = (await r.json()) as { profiles: VenueSignageProfile[] };
    setProfiles(data.profiles);
    return data.profiles;
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
    openDraft(profiles[0]);
  }, [loading, didInitialPick, profiles]);

  /** Loads a profile into the editor and records it as the unchanged baseline. */
  function openDraft(p: VenueSignageProfile) {
    const copy = { ...p, slots: p.slots.map((s) => ({ ...s })), theme: { ...p.theme } };
    setDraft(copy);
    setBaseline(stableStringify(copy));
  }

  /** Asks before discarding unsaved profile edits. */
  function confirmDiscardDraft(): boolean {
    if (!draftDirty) return true;
    return window.confirm(`Discard unsaved changes to “${draft.name || "this profile"}”?`);
  }

  function selectProfile(id: string) {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    if (id !== selectedId && !confirmDiscardDraft()) return;
    setSelectedId(id);
    openDraft({ ...p, slots: p.slots.length ? p.slots : [emptySlot()] });
    setPackOverrideTheme(false);
    setPackPrimary(p.theme.primaryColor);
    setPackAccent(p.theme.accentColor);
    setPackText(p.theme.textColor);
  }

  async function saveDraft() {
    // A new profile whose ID matches a saved one would silently overwrite it.
    if (!selectedId && profiles.some((p) => p.id === draft.id.trim())) {
      setError("That profile ID is already used by another venue. Change it under Advanced before saving.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/signage/venues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft)
      });
      if (!r.ok) {
        throw new Error(await readResponseError(r, "Save failed."));
      }
      const fresh = await loadProfiles();
      setSelectedId(draft.id);
      // The server trims and normalises fields; adopt its copy so the editor doesn't stay "unsaved".
      const saved = fresh?.find((p) => p.id === draft.id);
      openDraft(saved ?? draft);
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
      if (!r.ok) throw new Error(await readResponseError(r, "Delete failed."));
      setSelectedId(null);
      openDraft(defaultProfile());
      await loadProfiles();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  function newProfile() {
    if (!confirmDiscardDraft()) return;
    const p = defaultProfile();
    setSelectedId(null);
    openDraft(p);
    setPackPrimary(p.theme.primaryColor);
    setPackAccent(p.theme.accentColor);
    setPackText(p.theme.textColor);
    setPackOverrideTheme(false);
    setTab("profiles");
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

  function removeAdhocSecondEvent() {
    setAdhocSecondaryArrow("none");
    setAdhocEventName2("");
    setAdhocDualArrangement("sideBySide");
    setAdhocSecondaryVenueLine("");
    setAdhocSecondarySubVenueLine("");
    setAdhocSecondaryEventDate("");
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
    setNotice("");
    try {
      const themeOverride = packOverrideTheme
        ? {
            primaryColor: packPrimary.trim(),
            accentColor: packAccent.trim(),
            textColor: packText.trim()
          }
        : undefined;
      const venueLogoKey = signageLogoKeyForApi(packVenueKey);
      const clientLogoKey = signageLogoKeyForApi(packClientKey);
      const body = {
        mode: "pack" as const,
        venueProfileId: selectedId,
        eventName: packEventName.trim(),
        themeOverride,
        ...(venueLogoKey !== undefined ? { venueLogoKey } : {}),
        ...(clientLogoKey !== undefined ? { clientLogoKey } : {}),
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
        throw new Error(await readResponseError(r, "Generation failed."));
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
          // One PDF per paper size (for printer tray selection). Space the downloads out so
          // browsers treat them as separate user-initiated files.
          pdfs.forEach((pdf, index) => {
            const delay = index * 700;
            window.setTimeout(() => downloadPdfBase64(pdf.base64, `${base}-${pdf.fileSuffix}.pdf`), delay);
          });
          if (pdfs.length > 1) {
            setNotice(
              `Downloading ${pdfs.length} PDFs (one per paper size). If your browser asks, allow multiple downloads for this site.`
            );
          }
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
        venueLogoKey: signageLogoKeyForApi(adhocVenueKey),
        clientLogoKey: signageLogoKeyForApi(adhocClientKey),
        ...(adhocVenueLine.trim() ? { venueLabel: adhocVenueLine.trim() } : {}),
        ...(adhocSubVenueLine.trim() ? { subVenueLabel: adhocSubVenueLine.trim() } : {}),
        ...(adhocEventDate.trim() ? { eventDate: adhocEventDate.trim() } : {}),
        ...(!adhocDual && adhocMessage.trim() ? { message: adhocMessage.trim() } : {}),
        ...(adhocDual
          ? {
              secondaryArrow: adhocSecondaryArrow,
              dualEventArrangement: adhocDualArrangement,
              ...(adhocEventName2.trim() ? { eventName2: adhocEventName2.trim() } : {}),
              ...(adhocSecondaryVenueLine.trim() ? { secondaryVenueLabel: adhocSecondaryVenueLine.trim() } : {}),
              ...(adhocSecondarySubVenueLine.trim() ? { secondarySubVenueLabel: adhocSecondarySubVenueLine.trim() } : {}),
              ...(adhocSecondaryEventDate.trim() ? { secondaryEventDate: adhocSecondaryEventDate.trim() } : {})
            }
          : {})
      };
      const r = await fetch("/api/signage/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        throw new Error(await readResponseError(r, "Generation failed."));
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

  const profileSelect = (
    <select
      value={selectedId ?? ""}
      onChange={(e) => {
        const id = e.target.value;
        if (id) selectProfile(id);
      }}
    >
      <option value="">— Select a venue —</option>
      {profiles.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );

  /* ------------------------------ Sign pack tab ----------------------------- */
  const packTab = !profiles.length ? (
    <Section>
      <div className="empty-state">
        <span className="empty-state-icon">
          <Signpost size={20} aria-hidden />
        </span>
        <div>
          <strong>No venue profiles yet</strong>
          <div>A venue profile lists the signs a venue needs. Set one up once, then print a pack for any event.</div>
        </div>
        <button type="button" className="btn-primary" onClick={newProfile}>
          <Plus size={16} aria-hidden /> Create a venue profile
        </button>
      </div>
    </Section>
  ) : (
    <Section
      title="Print a sign pack"
      description="Every sign in the venue profile, branded for this event. You get one PDF per paper size, ready for tray selection."
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Venue profile" as="div" className="span-all field--half">
            <div className="row" style={{ flexWrap: "nowrap" }}>
              {profileSelect}
              <button type="button" className="btn-ghost" onClick={() => setTab("profiles")} disabled={!selectedId}>
                Edit
              </button>
            </div>
          </Field>
          <Field label="Event name">
            <input value={packEventName} onChange={(e) => setPackEventName(e.target.value)} placeholder="e.g. Smith Wedding" />
          </Field>
          <Field label={<>Event date <span className="optional">(optional)</span></>}>
            <input
              value={packEventDate}
              maxLength={limits.MAX_SIGNAGE_EVENT_DATE_CHARS}
              onChange={(e) => setPackEventDate(e.target.value)}
              placeholder="e.g. Saturday 20 June 2026"
            />
          </Field>
        </div>

        {savedProfile ? <PackSummary profile={savedProfile} /> : null}
        {savedProfile && draftDirty ? (
          <Callout tone="warning">
            This profile has unsaved edits. The pack prints the saved version —{" "}
            <button type="button" className="text-button" onClick={() => setTab("profiles")}>
              review and save
            </button>{" "}
            to include them.
          </Callout>
        ) : null}

        <Disclosure label="Customise venue lines, colours and logos for this event">
          <div className="stack">
            <div className="form-grid">
              <Field label="Venue line">
                <input
                  value={packVenueOverride}
                  maxLength={limits.MAX_SIGNAGE_VENUE_LABEL_CHARS}
                  onChange={(e) => setPackVenueOverride(e.target.value)}
                  placeholder={savedProfile?.defaultVenueLabel ? `Profile: ${savedProfile.defaultVenueLabel}` : "Profile default (none)"}
                />
              </Field>
              <Field label="Sub-venue line">
                <input
                  value={packSubVenueOverride}
                  maxLength={limits.MAX_SIGNAGE_VENUE_LABEL_CHARS}
                  onChange={(e) => setPackSubVenueOverride(e.target.value)}
                  placeholder={
                    savedProfile?.defaultSubVenueLabel ? `Profile: ${savedProfile.defaultSubVenueLabel}` : "Profile default (none)"
                  }
                />
              </Field>
            </div>
            <div className="stack stack--sm">
              <Switch
                checked={packOverrideTheme}
                onChange={(checked) => {
                  setPackOverrideTheme(checked);
                  if (checked && savedProfile) {
                    setPackPrimary(savedProfile.theme.primaryColor);
                    setPackAccent(savedProfile.theme.accentColor);
                    setPackText(savedProfile.theme.textColor);
                  }
                }}
                label="Use different colours for this event"
              />
              {packOverrideTheme ? (
                <div className="color-row">
                  <ColorField label="Primary" value={packPrimary} onChange={setPackPrimary} />
                  <ColorField label="Accent" value={packAccent} onChange={setPackAccent} />
                  <ColorField label="Text" value={packText} onChange={setPackText} />
                </div>
              ) : null}
            </div>
            <div className="form-grid">
              <LogoPicker
                title="Venue logo"
                items={venueLogos}
                value={packVenueKey}
                onChange={setPackVenueKey}
                emptyOption={{ label: "Profile default", value: "" }}
                secondaryEmptyOption={{ label: "No logo", value: SIGNAGE_LOGO_NONE_SENTINEL }}
                disabled={!logosConfigured || busy}
              />
              <LogoPicker
                title="Client logo"
                items={clientLogos}
                value={packClientKey}
                onChange={setPackClientKey}
                emptyOption={{ label: "Profile default", value: "" }}
                secondaryEmptyOption={{ label: "No logo", value: SIGNAGE_LOGO_NONE_SENTINEL }}
                disabled={!logosConfigured || busy}
              />
            </div>
          </div>
        </Disclosure>
      </div>
      <div className="card-foot card-foot--inset">
        <Segmented value={packOutputFormat} options={FORMAT_OPTIONS} onChange={setPackOutputFormat} aria-label="Output format" />
        <button type="button" className="btn-primary" disabled={busy || !selectedId} onClick={() => void generatePack()}>
          <Download size={16} aria-hidden />
          {busy ? "Working…" : "Download sign pack"}
        </button>
      </div>
    </Section>
  );

  /* ----------------------------- Single sign tab ---------------------------- */
  const singleTab = (
    <>
      <Section title="What the sign says">
        <div className="stack">
          <div className="form-grid form-grid--3">
            <Field label="Event name" className="span-2">
              <input value={adhocEventName} onChange={(e) => setAdhocEventName(e.target.value)} placeholder="e.g. Smith Wedding" />
            </Field>
            <Field label="Arrow" as="div">
              <ArrowSymbolPicker value={adhocArrow} onChange={setAdhocArrow} disabled={busy} aria-label="Arrow" />
            </Field>
            <Field label={<>Venue line <span className="optional">(optional)</span></>}>
              <input
                value={adhocVenueLine}
                maxLength={limits.MAX_SIGNAGE_VENUE_LABEL_CHARS}
                onChange={(e) => setAdhocVenueLine(e.target.value)}
                placeholder="e.g. The Grand Hotel"
              />
            </Field>
            <Field label={<>Sub-venue line <span className="optional">(optional)</span></>}>
              <input
                value={adhocSubVenueLine}
                maxLength={limits.MAX_SIGNAGE_VENUE_LABEL_CHARS}
                onChange={(e) => setAdhocSubVenueLine(e.target.value)}
                placeholder="e.g. Oak Room"
              />
            </Field>
            <Field label={<>Date line <span className="optional">(optional)</span></>}>
              <input
                value={adhocEventDate}
                maxLength={limits.MAX_SIGNAGE_EVENT_DATE_CHARS}
                onChange={(e) => setAdhocEventDate(e.target.value)}
                placeholder="e.g. Saturday 20 June"
              />
            </Field>
            {!adhocDual ? (
              <Field
                label={<>Sign message <span className="optional">(optional)</span></>}
                hint="Printed in bold above the arrow."
                className="span-all"
              >
                <textarea
                  rows={2}
                  value={adhocMessage}
                  maxLength={limits.MAX_SIGNAGE_MESSAGE_CHARS}
                  onChange={(e) => setAdhocMessage(e.target.value)}
                  placeholder="e.g. Please use the left hand entrance"
                />
              </Field>
            ) : null}
          </div>
          {adhocDual ? (
            <SecondEventBlock
              value={{
                eventName: adhocEventName2,
                arrow: adhocSecondaryArrow,
                arrangement: adhocDualArrangement,
                venue: adhocSecondaryVenueLine,
                subVenue: adhocSecondarySubVenueLine,
                date: adhocSecondaryEventDate
              }}
              onChange={(patch) => {
                if (patch.eventName !== undefined) setAdhocEventName2(patch.eventName);
                if (patch.arrow !== undefined) {
                  // Picking "No arrow" for the second event turns the two-event layout off.
                  if (patch.arrow === "none") removeAdhocSecondEvent();
                  else setAdhocSecondaryArrow(patch.arrow);
                }
                if (patch.arrangement !== undefined) setAdhocDualArrangement(patch.arrangement);
                if (patch.venue !== undefined) setAdhocSecondaryVenueLine(patch.venue);
                if (patch.subVenue !== undefined) setAdhocSecondarySubVenueLine(patch.subVenue);
                if (patch.date !== undefined) setAdhocSecondaryEventDate(patch.date);
              }}
              onRemove={removeAdhocSecondEvent}
              disabled={busy}
              namePlaceholder="e.g. Evening reception"
              fallbackHint="Blank lines repeat the first event's venue, sub-venue and date. Sign messages aren't printed on two-event signs."
            />
          ) : (
            <AddSecondEventButton onClick={() => setAdhocSecondaryArrow("right")} disabled={busy} />
          )}
        </div>
      </Section>

      <Section title="Page and branding">
        <div className="stack">
          <div className="row" style={{ gap: 24 }}>
            <Field label="Paper" as="div">
              <Segmented value={adhocPaper} options={PAPER_OPTIONS} onChange={setAdhocPaper} aria-label="Paper size" />
            </Field>
            <Field label="Orientation" as="div">
              <Segmented value={adhocOrientation} options={ORIENTATION_OPTIONS} onChange={setAdhocOrientation} aria-label="Orientation" />
            </Field>
          </div>
          <Field label="Colours" as="div">
            <div className="color-row">
              <ColorField label="Primary" value={adhocTheme.primaryColor} onChange={(v) => setAdhocTheme((t) => ({ ...t, primaryColor: v }))} />
              <ColorField label="Accent" value={adhocTheme.accentColor} onChange={(v) => setAdhocTheme((t) => ({ ...t, accentColor: v }))} />
              <ColorField label="Text" value={adhocTheme.textColor} onChange={(v) => setAdhocTheme((t) => ({ ...t, textColor: v }))} />
            </div>
          </Field>
          <div className="form-grid">
            <LogoPicker
              title="Venue logo"
              items={venueLogos}
              value={adhocVenueKey}
              onChange={setAdhocVenueKey}
              emptyOption={{ label: "None", value: "" }}
              disabled={!logosConfigured || busy}
            />
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
        <div className="card-foot card-foot--inset">
          <Segmented value={adhocOutputFormat} options={FORMAT_OPTIONS} onChange={setAdhocOutputFormat} aria-label="Output format" />
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void generateAdhoc()}>
            <Download size={16} aria-hidden />
            {busy ? "Working…" : "Download sign"}
          </button>
        </div>
      </Section>
    </>
  );

  /* --------------------------- Venue profiles tab --------------------------- */
  const hasSecondaryDefaults = Boolean(
    draft.defaultSecondaryVenueLabel || draft.defaultSecondarySubVenueLabel || draft.defaultSecondaryEventDate
  );
  const profilesTab = (
    <div className="split">
      <aside className="split-aside">
        <div className="row row--between" style={{ marginBottom: 8 }}>
          <span className="subhead" style={{ margin: 0 }}>
            Venues
          </span>
          <button type="button" className="btn-sm" onClick={newProfile}>
            <Plus size={14} aria-hidden /> New
          </button>
        </div>
        {profiles.length || !selectedId ? (
          <ul className="nav-list">
            {!selectedId ? (
              <li>
                <button type="button" className="nav-list-item nav-list-item--active">
                  {draft.name || "Untitled"} <span className="badge badge--warning">Unsaved</span>
                </button>
              </li>
            ) : null}
            {profiles.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={p.id === selectedId ? "nav-list-item nav-list-item--active" : "nav-list-item"}
                  onClick={() => selectProfile(p.id)}
                >
                  <span className="nav-list-item-text">{p.name}</span>
                  <span className="nav-list-item-meta">
                    {p.slots.reduce((sum, s) => sum + s.count, 0)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </aside>

      <Section
        className="split-main"
        title={draft.name || "Untitled profile"}
        description={selectedId ? undefined : "New profile — not saved yet."}
        actions={
          <>
            {selectedId ? (
              <button type="button" className="btn-ghost btn-danger btn-sm" disabled={busy} onClick={() => void deleteSelected()}>
                <Trash2 size={14} aria-hidden /> Delete
              </button>
            ) : null}
            <button type="button" className="btn-primary btn-sm" disabled={busy || (Boolean(selectedId) && !draftDirty)} onClick={() => void saveDraft()}>
              {busy ? "Saving…" : !selectedId || draftDirty ? "Save profile" : "Saved"}
            </button>
          </>
        }
      >
        <div className="stack">
          <div className="split-switcher row" style={{ flexWrap: "nowrap" }}>
            <select
              value={selectedId ?? ""}
              aria-label="Venue profile"
              onChange={(e) => {
                if (e.target.value) selectProfile(e.target.value);
              }}
            >
              {!selectedId ? <option value="">{draft.name || "Untitled"} (unsaved)</option> : null}
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button type="button" onClick={newProfile}>
              <Plus size={14} aria-hidden /> New
            </button>
          </div>
          <div className="form-grid">
            <Field label="Profile name" className="span-all">
              <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            </Field>
            <Field label="Venue line" hint="Bold, below the event name. Can be changed per event.">
              <input
                value={draft.defaultVenueLabel ?? ""}
                maxLength={limits.MAX_SIGNAGE_VENUE_LABEL_CHARS}
                onChange={(e) => setDraft((d) => ({ ...d, defaultVenueLabel: optional(e.target.value) }))}
                placeholder="e.g. The Grand Hotel"
              />
            </Field>
            <Field label={<>Sub-venue line <span className="optional">(optional)</span></>} hint="Regular weight, under the venue line.">
              <input
                value={draft.defaultSubVenueLabel ?? ""}
                maxLength={limits.MAX_SIGNAGE_VENUE_LABEL_CHARS}
                onChange={(e) => setDraft((d) => ({ ...d, defaultSubVenueLabel: optional(e.target.value) }))}
                placeholder="e.g. Oak Room"
              />
            </Field>
          </div>

          <div>
            <h3 className="subhead">Signs in this pack</h3>
            <p className="field-hint" style={{ margin: "-4px 0 10px" }}>
              Printed in this order. Open a sign&apos;s options to add a fixed message or a second event.
            </p>
            <div className="stack stack--sm">
              {draft.slots.map((slot, index) => (
                <SlotEditor
                  key={`${selectedId ?? "new"}-${index}`}
                  slot={slot}
                  index={index}
                  canRemove={draft.slots.length > 1}
                  busy={busy}
                  onChange={(patch) => updateSlot(index, patch)}
                  onRemove={() => removeSlot(index)}
                />
              ))}
              <button type="button" className="btn-dashed" onClick={addSlot}>
                <Plus size={15} aria-hidden /> Add sign
              </button>
            </div>
          </div>

          <div>
            <h3 className="subhead">Branding</h3>
            <div className="stack">
              <div className="color-row">
                <ColorField
                  label="Primary"
                  value={draft.theme.primaryColor}
                  onChange={(v) => setDraft((d) => ({ ...d, theme: { ...d.theme, primaryColor: v } }))}
                />
                <ColorField
                  label="Accent"
                  value={draft.theme.accentColor}
                  onChange={(v) => setDraft((d) => ({ ...d, theme: { ...d.theme, accentColor: v } }))}
                />
                <ColorField
                  label="Text"
                  value={draft.theme.textColor}
                  onChange={(v) => setDraft((d) => ({ ...d, theme: { ...d.theme, textColor: v } }))}
                />
              </div>
              <div className="form-grid">
                <LogoPicker
                  title="Default venue logo"
                  items={venueLogos}
                  value={draft.defaultVenueLogoKey ?? ""}
                  onChange={(key) => setDraft((d) => ({ ...d, defaultVenueLogoKey: key || undefined }))}
                  emptyOption={{ label: "None", value: "" }}
                  disabled={!logosConfigured || busy}
                />
                <LogoPicker
                  title="Default client logo"
                  items={clientLogos}
                  value={draft.defaultClientLogoKey ?? ""}
                  onChange={(key) => setDraft((d) => ({ ...d, defaultClientLogoKey: key || undefined }))}
                  emptyOption={{ label: "None", value: "" }}
                  disabled={!logosConfigured || busy}
                />
              </div>
            </div>
          </div>

          <hr className="divider" style={{ margin: "4px 0" }} />

          <Disclosure label="Second-event defaults" defaultOpen={hasSecondaryDefaults}>
            <p className="field-hint" style={{ margin: "0 0 10px" }}>
              Used on two-event signs when the sign doesn&apos;t set its own lines. Blank falls back to the first event.
            </p>
            <div className="form-grid form-grid--3">
              <Field label="Venue line">
                <input
                  value={draft.defaultSecondaryVenueLabel ?? ""}
                  maxLength={limits.MAX_SIGNAGE_VENUE_LABEL_CHARS}
                  onChange={(e) => setDraft((d) => ({ ...d, defaultSecondaryVenueLabel: optional(e.target.value) }))}
                />
              </Field>
              <Field label="Sub-venue line">
                <input
                  value={draft.defaultSecondarySubVenueLabel ?? ""}
                  maxLength={limits.MAX_SIGNAGE_VENUE_LABEL_CHARS}
                  onChange={(e) => setDraft((d) => ({ ...d, defaultSecondarySubVenueLabel: optional(e.target.value) }))}
                />
              </Field>
              <Field label="Date line">
                <input
                  value={draft.defaultSecondaryEventDate ?? ""}
                  maxLength={limits.MAX_SIGNAGE_EVENT_DATE_CHARS}
                  onChange={(e) => setDraft((d) => ({ ...d, defaultSecondaryEventDate: optional(e.target.value) }))}
                />
              </Field>
            </div>
          </Disclosure>

          <Disclosure label="Advanced">
            <Field
              label="Profile ID"
              hint={selectedId ? "Fixed once saved. Create a new profile to use a different ID." : "Filename-safe. Can't be changed after saving."}
            >
              <input
                className="mono"
                value={draft.id}
                onChange={(e) => setDraft((d) => ({ ...d, id: e.target.value }))}
                disabled={Boolean(selectedId)}
              />
            </Field>
          </Disclosure>
        </div>
      </Section>
    </div>
  );

  return (
    <main className="page">
      <PageHeader
        title="Event signage"
        description="Print a venue's full sign pack in one go, or make a one-off sign."
      />

      {error ? (
        <Callout tone="error" onDismiss={() => setError("")}>
          {error}
        </Callout>
      ) : null}
      {notice ? (
        <Callout onDismiss={() => setNotice("")}>{notice}</Callout>
      ) : null}
      {!loading && !logosConfigured ? (
        <Callout tone="warning">
          Logo storage (R2) isn&apos;t configured, so logos are unavailable. You can still print signs with colours and
          arrows. See <code>.env.example</code>.
        </Callout>
      ) : null}

      <Tabs<SignageTab>
        value={tab}
        onChange={setTab}
        aria-label="Signage mode"
        tabs={[
          { value: "pack", label: "Sign pack" },
          { value: "single", label: "Single sign" },
          { value: "profiles", label: "Venue profiles", badge: loading ? undefined : profiles.length }
        ]}
      />

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : tab === "pack" ? (
        packTab
      ) : tab === "single" ? (
        singleTab
      ) : (
        profilesTab
      )}
    </main>
  );
}
