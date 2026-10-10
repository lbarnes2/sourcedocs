"use client";

import { useCallback, useEffect, useState } from "react";
import { ImagePlus, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { Callout, Field, Modal, PageHeader, Section, Toasts } from "@/app/components/ui";
import { LOGO_UPLOAD_ACCEPT } from "@/lib/logos/logoUpload";

type LogoKind = "venue" | "client";
type LogoItem = { key: string; label: string; assetUrl: string; printable?: boolean };

async function parseApiResponse(
  response: Response
): Promise<{ error?: string; items?: LogoItem[]; configured?: boolean; key?: string; references?: string[] }> {
  return response.json().catch(() => ({}));
}

export default function LogoLibraryPage() {
  const [venueItems, setVenueItems] = useState<LogoItem[]>([]);
  const [clientItems, setClientItems] = useState<LogoItem[]>([]);
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [workingKey, setWorkingKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [renaming, setRenaming] = useState<{ kind: LogoKind; item: LogoItem; name: string } | null>(null);

  const loadLogos = useCallback(async () => {
    setError("");
    const [venueResponse, clientResponse] = await Promise.all([fetch("/api/logos/venue"), fetch("/api/logos/client")]);
    const venuePayload = venueResponse.ok ? await parseApiResponse(venueResponse) : { configured: false, items: [] };
    const clientPayload = clientResponse.ok ? await parseApiResponse(clientResponse) : { configured: false, items: [] };
    setVenueItems(Array.isArray(venuePayload.items) ? venuePayload.items : []);
    setClientItems(Array.isArray(clientPayload.items) ? clientPayload.items : []);
    setConfigured(Boolean(venuePayload.configured) && Boolean(clientPayload.configured));
  }, []);

  useEffect(() => {
    void loadLogos();
  }, [loadLogos]);

  async function uploadLogo(kind: LogoKind, file: File) {
    setBusy(true);
    setError("");
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch(`/api/logos/${kind}`, { method: "POST", body: formData });
      const payload = await parseApiResponse(response);
      if (!response.ok) throw new Error(payload.error || "Upload failed.");
      await loadLogos();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  function startRename(kind: LogoKind, item: LogoItem) {
    setRenaming({ kind, item, name: item.label.replace(/\.[^.]+$/u, "") });
  }

  async function renameLogo(kind: LogoKind, item: LogoItem, nextName: string) {
    const trimmed = nextName.trim();
    if (!trimmed) return;
    setRenaming(null);
    setWorkingKey(item.key);
    setError("");
    try {
      const response = await fetch(`/api/logos/${kind}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: item.key, name: trimmed })
      });
      const payload = await parseApiResponse(response);
      if (!response.ok) throw new Error(payload.error || "Rename failed.");
      await loadLogos();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed.");
    } finally {
      setWorkingKey(null);
    }
  }

  async function deleteLogo(kind: LogoKind, key: string) {
    if (!window.confirm("Delete this logo from the library?")) return;
    setWorkingKey(key);
    setError("");
    try {
      const url = `/api/logos/${kind}?key=${encodeURIComponent(key)}`;
      let response = await fetch(url, { method: "DELETE" });
      let payload = await parseApiResponse(response);
      if (response.status === 409 && payload.references?.length) {
        const list = payload.references.slice(0, 12).join("\n• ");
        const more = payload.references.length > 12 ? `\n…and ${payload.references.length - 12} more` : "";
        const proceed = window.confirm(
          `This logo is still used by:\n• ${list}${more}\n\nThose items will print without it. Delete anyway?`
        );
        if (!proceed) return;
        response = await fetch(`${url}&force=1`, { method: "DELETE" });
        payload = await parseApiResponse(response);
      }
      if (!response.ok) throw new Error(payload.error || "Delete failed.");
      await loadLogos();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setWorkingKey(null);
    }
  }

  function renderSection(kind: LogoKind, title: string, description: string, items: LogoItem[]) {
    return (
      <Section
        title={
          <>
            {title} <span className="badge">{items.length}</span>
          </>
        }
        description={description}
        actions={
          <label className={`upload-button${busy || !configured ? " upload-button--disabled" : ""}`}>
            <input
              type="file"
              accept={LOGO_UPLOAD_ACCEPT}
              disabled={busy || !configured}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void uploadLogo(kind, file);
              }}
            />
            <ImagePlus size={15} aria-hidden />
            {busy ? "Uploading…" : "Upload"}
          </label>
        }
      >
        {items.length === 0 ? (
          <p className="text-muted" style={{ margin: 0 }}>
            No logos uploaded yet. PNG or JPEG work best.
          </p>
        ) : (
          <div className="logo-grid">
            {items.map((item) => (
              <div key={item.key} className="library-tile">
                <span className="logo-tile-img">
                  <img src={item.assetUrl} alt="" />
                </span>
                <span className="logo-tile-label" title={item.label}>
                  {item.label}
                </span>
                {item.printable === false ? (
                  <span className="library-tile-warn" title="Not PNG/JPEG — re-upload as PNG or JPEG to use it in PDFs">
                    <TriangleAlert size={12} aria-hidden /> Can&apos;t print
                  </span>
                ) : null}
                <div className="library-tile-actions">
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    disabled={workingKey === item.key}
                    onClick={() => startRename(kind, item)}
                    aria-label={`Rename ${item.label}`}
                    title="Rename"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm btn-danger"
                    disabled={workingKey === item.key}
                    onClick={() => void deleteLogo(kind, item.key)}
                    aria-label={`Delete ${item.label}`}
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    );
  }

  return (
    <main className="page">
      <PageHeader
        title="Logo library"
        description="Venue and client logos shared by every tool."
      />
      {!configured ? (
        <Callout tone="warning">
          R2 isn&apos;t configured, so logo storage is unavailable. See <code>.env.example</code>.
        </Callout>
      ) : null}
      {renderSection("venue", "Venue logos", "Used on signage, buffet menus, floorplans and banqueting documents.", venueItems)}
      {renderSection("client", "Client logos", "Used on place cards, menus, signage and floorplans.", clientItems)}

      {renaming ? (
        <Modal
          title="Rename logo"
          size="sm"
          onClose={() => setRenaming(null)}
          footer={
            <>
              <button type="button" onClick={() => setRenaming(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!renaming.name.trim()}
                onClick={() => void renameLogo(renaming.kind, renaming.item, renaming.name)}
              >
                Rename
              </button>
            </>
          }
        >
          <Field label="Name">
            <input
              autoFocus
              value={renaming.name}
              onChange={(event) => setRenaming({ ...renaming, name: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") void renameLogo(renaming.kind, renaming.item, renaming.name);
              }}
            />
          </Field>
        </Modal>
      ) : null}

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
