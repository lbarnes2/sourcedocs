"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type LogoKind = "venue" | "client";
type LogoItem = { key: string; label: string; assetUrl: string };

async function parseApiResponse(response: Response): Promise<{ error?: string; items?: LogoItem[]; configured?: boolean; key?: string }> {
  return response.json().catch(() => ({}));
}

export default function LogoLibraryPage() {
  const [venueItems, setVenueItems] = useState<LogoItem[]>([]);
  const [clientItems, setClientItems] = useState<LogoItem[]>([]);
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [workingKey, setWorkingKey] = useState<string | null>(null);
  const [error, setError] = useState("");

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

  async function renameLogo(kind: LogoKind, item: LogoItem) {
    const suggested = item.label.replace(/\.[^.]+$/u, "");
    const nextName = window.prompt("Rename logo", suggested);
    if (nextName === null) return;
    const trimmed = nextName.trim();
    if (!trimmed) return;
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
      const response = await fetch(`/api/logos/${kind}?key=${encodeURIComponent(key)}`, { method: "DELETE" });
      const payload = await parseApiResponse(response);
      if (!response.ok) throw new Error(payload.error || "Delete failed.");
      await loadLogos();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setWorkingKey(null);
    }
  }

  function renderSection(kind: LogoKind, title: string, items: LogoItem[]) {
    return (
      <section className="panel logo-library-section">
        <h2 className="step-heading">
          <span className="step-heading-badge">•</span>
          <span>{title}</span>
        </h2>
        <label>
          Upload logo
          <input
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
            disabled={busy || !configured}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void uploadLogo(kind, file);
            }}
          />
        </label>
        {items.length === 0 ? (
          <p className="pill" style={{ marginTop: 12 }}>
            No logos uploaded yet.
          </p>
        ) : (
          <div className="signage-logo-grid" style={{ marginTop: 12 }}>
            {items.map((item) => (
              <div key={item.key} className="signage-logo-tile logo-library-tile">
                <span className="signage-logo-tile-hit">
                  <img src={item.assetUrl} alt="" className="signage-logo-tile-img" />
                </span>
                <span className="signage-logo-tile-label" title={item.label}>
                  {item.label}
                </span>
                <div className="logo-library-actions">
                  <button type="button" className="secondary" disabled={workingKey === item.key} onClick={() => void renameLogo(kind, item)}>
                    {workingKey === item.key ? "Working…" : "Rename"}
                  </button>
                  <button type="button" disabled={workingKey === item.key} onClick={() => void deleteLogo(kind, item.key)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <main className="app-logo-library">
      <header className="app-header">
        <Link href="/" className="app-backlink">
          ← Home
        </Link>
        <h1>Logo Library</h1>
        <p className="app-tagline">
          Upload, rename, and remove shared venue and client logos. Other tools can select logos from this library.
        </p>
      </header>
      {!configured ? (
        <p className="pill" style={{ marginBottom: 14 }}>
          R2 is not configured. Configure environment variables in <code>.env.example</code> to enable logo storage.
        </p>
      ) : null}
      {error ? <p className="error panel">{error}</p> : null}
      {renderSection("venue", "Venue logos", venueItems)}
      {renderSection("client", "Client logos", clientItems)}
    </main>
  );
}
