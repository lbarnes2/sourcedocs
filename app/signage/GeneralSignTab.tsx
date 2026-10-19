"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Save } from "lucide-react";
import { ArrowSymbolPicker } from "./ArrowSymbolPicker";
import { GeneralSignTemplates } from "./GeneralSignTemplates";
import { SymbolPicker } from "./SymbolPicker";
import { LogoPicker } from "@/app/components/LogoPicker";
import { Callout, ColorField, Field, Modal, Section, Segmented, Switch } from "@/app/components/ui";
import { defaultSignageTheme } from "@/lib/defaults";
import { readResponseError } from "@/lib/http/readError";
import { PAPER_SIZE_OPTIONS, pdfPageDimensions } from "@/lib/paperSizes";
import { downloadBlob, downloadPdfBlobAsPngs, pdfBlobToPngPages } from "@/lib/pdf/pdfToPngExport";
import type { SignSymbolId } from "@/lib/signage/symbols";
import * as limits from "@/lib/validation/limits";
import type {
  GeneralSignTemplate,
  GeneralSignTone,
  PaperSize,
  SignageArrowDirection,
  SignageThemeColors,
  WifiSecurity
} from "@/types";

type LogoItem = { key: string; label: string; assetUrl: string };
type Orientation = "portrait" | "landscape";
type OutputFormat = "pdf" | "png";

const PAPER_OPTIONS = PAPER_SIZE_OPTIONS.map((o) => ({ value: o.value, label: o.value }));
const ORIENTATION_OPTIONS = [
  { value: "portrait" as const, label: "Portrait" },
  { value: "landscape" as const, label: "Landscape" }
];
const FORMAT_OPTIONS = [
  { value: "pdf" as const, label: "PDF" },
  { value: "png" as const, label: "PNG" }
];
const TONE_OPTIONS = [
  { value: "plain" as const, label: "Plain", title: "Symbols in your primary colour" },
  { value: "info" as const, label: "Information", title: "White symbols on a circle in your primary colour" },
  { value: "caution" as const, label: "Caution", title: "Yellow warning triangle and hazard stripes" },
  { value: "prohibition" as const, label: "Prohibition", title: "Red ring and slash over the symbol" }
];
const SECURITY_OPTIONS = [
  { value: "WPA" as const, label: "WPA/WPA2/WPA3" },
  { value: "WEP" as const, label: "WEP" },
  { value: "nopass" as const, label: "No password" }
];

const PREVIEW_DEBOUNCE_MS = 450;

/** Template fields that describe the sign, normalised so a freshly applied template compares equal to the form. */
function templateContentKey(t: Omit<GeneralSignTemplate, "id" | "label">): string {
  return JSON.stringify([
    t.tone,
    t.symbols,
    t.heading.trim(),
    t.body?.trim() || "",
    t.arrow,
    t.footer?.trim() || "",
    t.wifi
      ? [t.wifi.network.trim(), t.wifi.security === "nopass" ? "" : t.wifi.password ?? "", t.wifi.security, t.wifi.showQr]
      : null,
    t.paperSize ?? "A4",
    t.orientation ?? "portrait"
  ]);
}

function newTemplateId(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "template";
  return `${slug}-${Math.random().toString(36).slice(2, 8)}`;
}

export function GeneralSignTab({
  venueLogos,
  clientLogos,
  logosConfigured
}: {
  venueLogos: LogoItem[];
  clientLogos: LogoItem[];
  logosConfigured: boolean;
}) {
  const [templates, setTemplates] = useState<GeneralSignTemplate[] | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateNotice, setTemplateNotice] = useState("");
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");

  const [tone, setTone] = useState<GeneralSignTone>("plain");
  const [symbols, setSymbols] = useState<SignSymbolId[]>([]);
  const [heading, setHeading] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [arrow, setArrow] = useState<SignageArrowDirection>("none");
  const [footer, setFooter] = useState("");

  const [wifiOn, setWifiOn] = useState(false);
  const [wifiNetwork, setWifiNetwork] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [wifiSecurity, setWifiSecurity] = useState<WifiSecurity>("WPA");
  const [wifiQr, setWifiQr] = useState(true);

  const [paper, setPaper] = useState<PaperSize>("A4");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [theme, setTheme] = useState<SignageThemeColors>({ ...defaultSignageTheme });
  const [venueKey, setVenueKey] = useState("");
  const [clientKey, setClientKey] = useState("");
  const [format, setFormat] = useState<OutputFormat>("pdf");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

  function applyTemplate(t: GeneralSignTemplate) {
    setTemplateId(t.id);
    setTemplateNotice("");
    setTone(t.tone);
    setSymbols(t.symbols);
    setHeading(t.heading);
    setBodyText(t.body ?? "");
    setArrow(t.arrow);
    setFooter(t.footer ?? "");
    setWifiOn(Boolean(t.wifi));
    setWifiNetwork(t.wifi?.network ?? "");
    setWifiPassword(t.wifi?.password ?? "");
    setWifiSecurity(t.wifi?.security ?? "WPA");
    setWifiQr(t.wifi?.showQr ?? true);
    setPaper(t.paperSize ?? "A4");
    setOrientation(t.orientation ?? "portrait");
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/signage/general/templates");
        if (!r.ok) throw new Error(await readResponseError(r, "Couldn't load templates."));
        const list = ((await r.json()) as { templates: GeneralSignTemplate[] }).templates;
        if (cancelled) return;
        setTemplates(list);
        const first = list.find((t) => t.id === "toilets") ?? list[0];
        if (first) applyTemplate(first);
      } catch (e) {
        if (!cancelled) {
          setTemplates([]);
          setError(e instanceof Error ? e.message : "Couldn't load templates.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Load once; applyTemplate only calls state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The form as template content (no id / label). */
  const formContent: Omit<GeneralSignTemplate, "id" | "label"> = {
    tone,
    symbols,
    heading: heading.trim(),
    ...(bodyText.trim() ? { body: bodyText.trim() } : {}),
    arrow,
    ...(footer.trim() ? { footer: footer.trim() } : {}),
    ...(wifiOn
      ? {
          wifi: {
            network: wifiNetwork.trim(),
            ...(wifiSecurity !== "nopass" && wifiPassword ? { password: wifiPassword } : {}),
            security: wifiSecurity,
            showQr: wifiQr
          }
        }
      : {}),
    paperSize: paper,
    orientation
  };
  const selectedTemplate = templates?.find((t) => t.id === templateId) ?? null;
  const templateDirty = selectedTemplate ? templateContentKey(selectedTemplate) !== templateContentKey(formContent) : false;

  async function saveTemplateRequest(method: "POST" | "PUT", body: unknown): Promise<GeneralSignTemplate[]> {
    const r = await fetch("/api/signage/general/templates", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(await readResponseError(r, "Couldn't save the template."));
    return ((await r.json()) as { templates: GeneralSignTemplate[] }).templates;
  }

  async function saveTemplate(template: GeneralSignTemplate, notice: string) {
    setTemplateBusy(true);
    setError("");
    try {
      setTemplates(await saveTemplateRequest("POST", template));
      setTemplateId(template.id);
      setTemplateNotice(notice);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the template.");
    } finally {
      setTemplateBusy(false);
    }
  }

  async function saveTemplateList(list: GeneralSignTemplate[]) {
    setTemplateBusy(true);
    setError("");
    try {
      setTemplates(await saveTemplateRequest("PUT", { templates: list }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save templates.");
    } finally {
      setTemplateBusy(false);
    }
  }

  function openSaveAs() {
    const fromHeading = heading.trim().slice(0, limits.MAX_GENERAL_SIGN_TEMPLATE_LABEL_CHARS);
    setSaveAsName(
      fromHeading && fromHeading !== selectedTemplate?.label ? fromHeading : selectedTemplate ? `${selectedTemplate.label} (copy)` : ""
    );
    setSaveAsOpen(true);
  }

  async function confirmSaveAs() {
    const label = saveAsName.trim();
    if (!label) return;
    setSaveAsOpen(false);
    await saveTemplate({ id: newTemplateId(label), label, ...formContent }, `Saved as “${label}”.`);
  }

  /** Wi-Fi fields are required once switched on, so the preview waits for a network name. */
  const wifiIncomplete = wifiOn && !wifiNetwork.trim();

  const requestBody = useMemo(
    () => ({
      paperSize: paper,
      orientation,
      tone,
      symbols,
      heading: heading.trim(),
      ...(bodyText.trim() ? { body: bodyText.trim() } : {}),
      arrow,
      ...(footer.trim() ? { footer: footer.trim() } : {}),
      ...(wifiOn && wifiNetwork.trim()
        ? {
            wifi: {
              network: wifiNetwork.trim(),
              ...(wifiSecurity !== "nopass" && wifiPassword ? { password: wifiPassword } : {}),
              security: wifiSecurity,
              showQr: wifiQr
            }
          }
        : {}),
      theme,
      ...(venueKey ? { venueLogoKey: venueKey } : {}),
      ...(clientKey ? { clientLogoKey: clientKey } : {})
    }),
    [paper, orientation, tone, symbols, heading, bodyText, arrow, footer, wifiOn, wifiNetwork, wifiPassword, wifiSecurity, wifiQr, theme, venueKey, clientKey]
  );
  const requestJson = JSON.stringify(requestBody);

  async function fetchPdf(json: string, signal?: AbortSignal): Promise<Response> {
    const r = await fetch("/api/signage/general", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json,
      signal
    });
    if (!r.ok) throw new Error(await readResponseError(r, "Generation failed."));
    return r;
  }

  // Live preview: re-render the first page as a PNG shortly after the last edit.
  const previewUrlRef = useRef<string | null>(null);
  useEffect(() => {
    if (wifiIncomplete) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const r = await fetchPdf(requestJson, controller.signal);
        const [first] = await pdfBlobToPngPages(await r.blob(), "preview");
        if (controller.signal.aborted || !first) return;
        const url = URL.createObjectURL(first.blob);
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = url;
        setPreviewUrl(url);
        setPreviewError("");
      } catch (e) {
        if (!controller.signal.aborted) setPreviewError(e instanceof Error ? e.message : "Preview failed.");
      } finally {
        if (!controller.signal.aborted) setPreviewLoading(false);
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [requestJson, wifiIncomplete]);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  async function download() {
    if (wifiIncomplete) {
      setError("Enter the Wi-Fi network name, or switch off Wi-Fi details.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await fetchPdf(requestJson);
      const blob = await r.blob();
      const name = r.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "sign.pdf";
      if (format === "png") await downloadPdfBlobAsPngs(blob, name.replace(/\.pdf$/, ""));
      else downloadBlob(blob, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  }

  const themed = tone === "plain" || tone === "info";
  const [pageW, pageH] = pdfPageDimensions(paper, orientation);

  return (
    <div className="general-sign-layout">
      <div className="stack">
        {templates ? (
          <GeneralSignTemplates
            templates={templates}
            selectedId={templateId}
            onSelect={applyTemplate}
            onSaveList={saveTemplateList}
            busy={templateBusy}
          />
        ) : (
          <Section title="Start from">
            <p className="text-muted">Loading templates…</p>
          </Section>
        )}

        <Section title="What the sign says">
          <div className="stack">
            <Field label="Style" as="div">
              <Segmented value={tone} options={TONE_OPTIONS} onChange={setTone} aria-label="Sign style" />
            </Field>
            <Field label="Symbols" as="div" hint="Up to three, shown side by side.">
              <SymbolPicker value={symbols} onChange={setSymbols} disabled={busy} />
            </Field>
            <div className="form-grid form-grid--3">
              <Field label="Heading" className="span-2">
                <input
                  value={heading}
                  maxLength={limits.MAX_GENERAL_SIGN_HEADING_CHARS}
                  onChange={(e) => setHeading(e.target.value)}
                  placeholder="e.g. Toilets"
                />
              </Field>
              <Field label="Arrow" as="div">
                <ArrowSymbolPicker value={arrow} onChange={setArrow} disabled={busy} aria-label="Arrow" />
              </Field>
              <Field label={<>Message <span className="optional">(optional)</span></>} className="span-all">
                <textarea
                  rows={bodyText.length > 120 ? 5 : 2}
                  value={bodyText}
                  maxLength={limits.MAX_GENERAL_SIGN_BODY_CHARS}
                  onChange={(e) => setBodyText(e.target.value)}
                  placeholder="e.g. Please mind the step"
                />
              </Field>
            </div>
            <Switch checked={wifiOn} onChange={setWifiOn} label="Show Wi-Fi details" hint="Network name, password and a QR code guests can scan to join." />
            {wifiOn ? (
              <div className="stack stack--sm">
                <div className="form-grid">
                  <Field label="Network name">
                    <input
                      value={wifiNetwork}
                      maxLength={limits.MAX_WIFI_FIELD_CHARS}
                      onChange={(e) => setWifiNetwork(e.target.value)}
                      placeholder="e.g. GrandHotel-Guest"
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="Password">
                    <input
                      value={wifiSecurity === "nopass" ? "" : wifiPassword}
                      maxLength={limits.MAX_WIFI_FIELD_CHARS}
                      onChange={(e) => setWifiPassword(e.target.value)}
                      disabled={wifiSecurity === "nopass"}
                      placeholder={wifiSecurity === "nopass" ? "Open network" : ""}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>
                </div>
                <div className="row" style={{ gap: 24 }}>
                  <Field label="Security" as="div">
                    <Segmented value={wifiSecurity} options={SECURITY_OPTIONS} onChange={setWifiSecurity} aria-label="Wi-Fi security" />
                  </Field>
                  <Switch checked={wifiQr} onChange={setWifiQr} label="QR code" />
                </div>
              </div>
            ) : null}
          </div>
        </Section>

        <Section title="Page and branding">
          <div className="stack">
            <div className="row" style={{ gap: 24 }}>
              <Field label="Paper" as="div">
                <Segmented value={paper} options={PAPER_OPTIONS} onChange={setPaper} aria-label="Paper size" />
              </Field>
              <Field label="Orientation" as="div">
                <Segmented value={orientation} options={ORIENTATION_OPTIONS} onChange={setOrientation} aria-label="Orientation" />
              </Field>
            </div>
            <Field
              label={<>Footer line <span className="optional">(optional)</span></>}
              hint="Small text along the bottom, e.g. the event or venue name."
            >
              <input
                value={footer}
                maxLength={limits.MAX_SIGNAGE_VENUE_LABEL_CHARS}
                onChange={(e) => setFooter(e.target.value)}
                placeholder="e.g. Smith Wedding · The Grand Hotel"
              />
            </Field>
            {themed ? (
              <Field label="Colours" as="div">
                <div className="color-row">
                  <ColorField label="Primary" value={theme.primaryColor} onChange={(v) => setTheme((t) => ({ ...t, primaryColor: v }))} />
                  <ColorField label="Accent" value={theme.accentColor} onChange={(v) => setTheme((t) => ({ ...t, accentColor: v }))} />
                  <ColorField label="Text" value={theme.textColor} onChange={(v) => setTheme((t) => ({ ...t, textColor: v }))} />
                </div>
              </Field>
            ) : (
              <p className="text-muted">Caution and prohibition signs use standard safety colours.</p>
            )}
            <div className="form-grid">
              <LogoPicker
                title="Venue logo"
                items={venueLogos}
                value={venueKey}
                onChange={setVenueKey}
                emptyOption={{ label: "None", value: "" }}
                disabled={!logosConfigured || busy}
              />
              <LogoPicker
                title="Client logo"
                items={clientLogos}
                value={clientKey}
                onChange={setClientKey}
                emptyOption={{ label: "None", value: "" }}
                disabled={!logosConfigured || busy}
              />
            </div>
          </div>
          {error ? <Callout tone="error">{error}</Callout> : null}
          <div className="card-foot card-foot--inset">
            <Segmented value={format} options={FORMAT_OPTIONS} onChange={setFormat} aria-label="Output format" />
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void download()}>
              <Download size={16} aria-hidden />
              {busy ? "Working…" : "Download sign"}
            </button>
          </div>
        </Section>
      </div>

      <aside className="general-sign-preview" aria-label="Sign preview">
        <div className="general-sign-preview-frame" style={{ aspectRatio: `${pageW} / ${pageH}` }} aria-busy={previewLoading}>
          {previewUrl ? <img src={previewUrl} alt="Preview of the sign" /> : null}
          {previewLoading ? <span className="general-sign-preview-status">Updating…</span> : null}
        </div>
        <div className="template-bar">
          {selectedTemplate && templateDirty ? (
            <>
              <p className="text-muted">
                Changed from the <strong>{selectedTemplate.label}</strong> template.
              </p>
              <div className="row">
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  disabled={templateBusy}
                  onClick={() =>
                    void saveTemplate(
                      { id: selectedTemplate.id, label: selectedTemplate.label, ...formContent },
                      `Updated “${selectedTemplate.label}”.`
                    )
                  }
                >
                  <Save size={14} aria-hidden /> Update template
                </button>
                <button type="button" className="btn-ghost btn-sm" disabled={templateBusy} onClick={openSaveAs}>
                  Save as new…
                </button>
              </div>
            </>
          ) : selectedTemplate ? (
            <p className="text-muted">{templateNotice || <>Using the <strong>{selectedTemplate.label}</strong> template.</>}</p>
          ) : templates ? (
            <button type="button" className="btn-ghost btn-sm" disabled={templateBusy} onClick={openSaveAs}>
              <Save size={14} aria-hidden /> Save as template…
            </button>
          ) : null}
        </div>
        {wifiIncomplete ? (
          <p className="text-muted">Enter the Wi-Fi network name to update the preview.</p>
        ) : previewError ? (
          <Callout tone="error">{previewError}</Callout>
        ) : null}
      </aside>

      {saveAsOpen ? (
        <Modal
          title="Save as a new template"
          size="sm"
          onClose={() => setSaveAsOpen(false)}
          footer={
            <>
              <button type="button" className="btn-ghost" onClick={() => setSaveAsOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn-primary" disabled={!saveAsName.trim()} onClick={() => void confirmSaveAs()}>
                Save template
              </button>
            </>
          }
        >
          <Field label="Template name" hint="Shared with everyone who uses this app. Colours and logos aren't saved.">
            <input
              autoFocus
              onFocus={(e) => e.target.select()}
              value={saveAsName}
              maxLength={limits.MAX_GENERAL_SIGN_TEMPLATE_LABEL_CHARS}
              onChange={(e) => setSaveAsName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void confirmSaveAs();
              }}
              placeholder="e.g. Photography notice"
            />
          </Field>
        </Modal>
      ) : null}
    </div>
  );
}
