"use client";

import Link from "next/link";
import { ArrowLeft, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { LogoPicker, type LogoPickerItem } from "@/app/components/LogoPicker";
import { Callout, Field, Modal, PageHeader, Section, Toasts } from "@/app/components/ui";
import { RoomThumb, templateSizeText } from "@/app/floorplans/RoomThumb";
import { readResponseError } from "@/lib/http/readError";
import type { FloorplanVenue } from "@/types";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Venues and the room templates in each: the rooms a plan can start from. */
export default function VenuesAndRoomsPage() {
  const [venues, setVenues] = useState<FloorplanVenue[] | null>(null);
  const [logos, setLogos] = useState<LogoPickerItem[]>([]);
  const [error, setError] = useState("");
  const [naming, setNaming] = useState<{ venue: FloorplanVenue | null; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/floorplans/venues");
      if (!res.ok) throw new Error(await readResponseError(res, "Could not load venues."));
      setVenues(((await res.json()) as { venues: FloorplanVenue[] }).venues);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load venues.");
      setVenues([]);
    }
  }

  useEffect(() => {
    void load();
    void fetch("/api/logos/venue")
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        if (payload && Array.isArray(payload.items)) setLogos(payload.items);
      })
      .catch(() => undefined);
  }, []);

  async function saveVenue(venue: FloorplanVenue) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/floorplans/venues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(venue)
      });
      if (!res.ok) throw new Error(await readResponseError(res, "Could not save the venue."));
      const saved = ((await res.json()) as { venue: FloorplanVenue }).venue;
      setVenues((list) => {
        const rest = (list ?? []).filter((v) => v.id !== saved.id);
        return [...rest, saved].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      });
      return saved;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the venue.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function deleteVenue(venue: FloorplanVenue) {
    const rooms = venue.rooms.length;
    if (
      !window.confirm(
        `Delete ${venue.name}${rooms ? ` and its ${rooms} room${rooms === 1 ? "" : "s"}` : ""}? Plans already made from them keep their copy. This can't be undone.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/floorplans/venues/${encodeURIComponent(venue.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readResponseError(res, "Could not delete the venue."));
      setVenues((list) => (list ?? []).filter((v) => v.id !== venue.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the venue.");
    } finally {
      setBusy(false);
    }
  }

  function duplicateRoom(venue: FloorplanVenue, roomId: string) {
    const room = venue.rooms.find((r) => r.id === roomId);
    if (!room) return;
    const copy = { ...room, id: crypto.randomUUID(), name: `${room.name} (copy)`, version: 1 };
    void saveVenue({ ...venue, rooms: [...venue.rooms, copy] });
  }

  function deleteRoom(venue: FloorplanVenue, roomId: string) {
    const room = venue.rooms.find((r) => r.id === roomId);
    if (!room || !window.confirm(`Delete the room “${room.name}”? Plans already made from it keep their copy.`)) return;
    void saveVenue({ ...venue, rooms: venue.rooms.filter((r) => r.id !== roomId) });
  }

  async function submitName() {
    if (!naming) return;
    const name = naming.name.trim();
    if (!name) return;
    const venue: FloorplanVenue = naming.venue
      ? { ...naming.venue, name }
      : { id: crypto.randomUUID(), name, logoKey: null, updatedAt: new Date().toISOString(), rooms: [] };
    if (await saveVenue(venue)) setNaming(null);
  }

  return (
    <main className="page page--wide">
      <PageHeader
        title="Venues & rooms"
        description="Rooms you lay out again and again: walls, doors, windows and fixtures. Start a plan from one with Room → Add a room from a template."
        actions={
          <>
            <Link href="/floorplans" className="btn">
              <ArrowLeft size={15} aria-hidden /> Floorplans
            </Link>
            <button type="button" className="btn-primary" onClick={() => setNaming({ venue: null, name: "" })}>
              <Plus size={15} aria-hidden /> New venue
            </button>
          </>
        }
      />

      {venues == null ? (
        <p className="text-muted">Loading…</p>
      ) : venues.length === 0 ? (
        <Section title="No venues yet" description="Add a venue, then draw its rooms. Plans made from a room keep their own copy, and offer an update when you change the room here.">
          <button type="button" className="btn-primary" onClick={() => setNaming({ venue: null, name: "" })}>
            <Plus size={15} aria-hidden /> New venue
          </button>
        </Section>
      ) : (
        <div className="stack">
          {venues.map((venue) => (
            <Section
              key={venue.id}
              title={venue.name}
              description={`${venue.rooms.length} room${venue.rooms.length === 1 ? "" : "s"}`}
              actions={
                <>
                  <button type="button" className="icon-btn icon-btn--sm" title="Rename venue" aria-label={`Rename ${venue.name}`} onClick={() => setNaming({ venue, name: venue.name })}>
                    <Pencil size={15} />
                  </button>
                  <button type="button" className="icon-btn icon-btn--sm btn-danger" title="Delete venue" aria-label={`Delete ${venue.name}`} disabled={busy} onClick={() => void deleteVenue(venue)}>
                    <Trash2 size={15} />
                  </button>
                </>
              }
            >
              <div className="stack">
                {logos.length ? (
                  <div style={{ maxWidth: 360 }}>
                    <LogoPicker
                      title="Venue logo"
                      items={logos}
                      value={venue.logoKey ?? ""}
                      onChange={(key) => void saveVenue({ ...venue, logoKey: key || null })}
                      emptyOption={{ label: "No venue logo", value: "" }}
                    />
                  </div>
                ) : null}
                <ul className="room-grid">
                  {venue.rooms.map((room) => (
                    <li key={room.id} className="room-card">
                      <Link href={`/floorplans/rooms/${venue.id}/${room.id}`} className="room-card-main" title={`Edit ${room.name}`}>
                        <RoomThumb room={room.room} fixtures={room.fixtures} />
                        <span className="room-card-text">
                          <strong>{room.name}</strong>
                          <span className="field-hint">{templateSizeText(room)}</span>
                          <span className="field-hint">
                            Version {room.version} · {formatDate(room.updatedAt)}
                          </span>
                        </span>
                      </Link>
                      <div className="room-card-actions">
                        <button type="button" className="icon-btn icon-btn--sm" title="Duplicate" aria-label={`Duplicate ${room.name}`} disabled={busy} onClick={() => duplicateRoom(venue, room.id)}>
                          <Copy size={14} />
                        </button>
                        <button type="button" className="icon-btn icon-btn--sm btn-danger" title="Delete" aria-label={`Delete ${room.name}`} disabled={busy} onClick={() => deleteRoom(venue, room.id)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </li>
                  ))}
                  <li className="room-card room-card--new">
                    <Link href={`/floorplans/rooms/${venue.id}/new`} className="room-card-main">
                      <Plus size={20} aria-hidden /> New room
                    </Link>
                  </li>
                </ul>
              </div>
            </Section>
          ))}
        </div>
      )}

      {naming ? (
        <Modal
          title={naming.venue ? "Rename venue" : "New venue"}
          size="sm"
          onClose={() => setNaming(null)}
          footer={
            <>
              <button type="button" onClick={() => setNaming(null)}>
                Cancel
              </button>
              <button type="button" className="btn-primary" disabled={busy || !naming.name.trim()} onClick={() => void submitName()}>
                {naming.venue ? "Rename" : "Add venue"}
              </button>
            </>
          }
        >
          <Field label="Venue name">
            <input
              autoFocus
              value={naming.name}
              placeholder="e.g. Hartwell House"
              onChange={(e) => setNaming({ ...naming, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitName();
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
