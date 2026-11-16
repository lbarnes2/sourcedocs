"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/app/components/ui";
import { formatTableLabel } from "@/lib/event/tableLabel";
import {
  applyReupload,
  type ConflictChoice,
  MERGE_FIELD_LABELS,
  planReupload
} from "@/lib/guests/reupload";
import type { GuestRecord } from "@/types";

const shown = (value: string) => (value.trim() ? value : "(blank)");
const where = (guest: GuestRecord) => (guest.tableNumber.trim() ? formatTableLabel(guest.tableNumber) : "no table");

/**
 * Review screen for a revised guest list: what the new file adds, removes and changes, with manual
 * edits kept unless the file changed the same field (those are listed for a decision).
 */
export function ReuploadReview({
  baseline,
  current,
  next,
  onApply,
  onCancel
}: {
  baseline: GuestRecord[];
  current: GuestRecord[];
  next: GuestRecord[];
  onApply: (result: { guests: GuestRecord[]; baseline: GuestRecord[] }) => void;
  onCancel: () => void;
}) {
  /** Removed-guest id → added-guest id: "these are the same person" (a rename in the new file). */
  const [pairs, setPairs] = useState<Record<string, string>>({});
  const [conflictChoices, setConflictChoices] = useState<Record<string, ConflictChoice>>({});
  const [keepRemoved, setKeepRemoved] = useState<string[]>([]);

  const plan = useMemo(() => planReupload(baseline, current, next, pairs), [baseline, current, next, pairs]);
  /** The unpaired view, so guests already paired can still be listed and un-paired. */
  const unpaired = useMemo(() => planReupload(baseline, current, next), [baseline, current, next]);

  const changed = plan.matched.filter((entry) => entry.changes.length > 0);
  const conflicted = plan.matched.filter((entry) => entry.conflicts.length > 0);
  const pairedAddedIds = new Set(Object.values(pairs));
  const pairable = unpaired.added;
  const removedRows = unpaired.removed;

  const summary = [
    plan.added.length ? `${plan.added.length} added` : "",
    plan.removed.length ? `${plan.removed.length} removed` : "",
    changed.length ? `${changed.length} changed` : "",
    conflicted.length ? `${conflicted.length} to decide` : ""
  ].filter(Boolean);

  return (
    <Modal
      title="Review the new guest list"
      size="lg"
      onClose={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel}>
            Cancel — keep the list as it is
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => onApply(applyReupload(plan, next, { conflicts: conflictChoices, keepRemoved }))}
          >
            Apply changes
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="text-muted" style={{ margin: 0 }}>
          {summary.length ? `${summary.join(" · ")}.` : "The new file matches the current list."}{" "}
          {plan.editsKept
            ? `${plan.editsKept} manual edit${plan.editsKept === 1 ? "" : "s"} of yours ${plan.editsKept === 1 ? "is" : "are"} kept.`
            : "Guests are matched by name."}
        </p>

        {conflicted.length ? (
          <section>
            <h3 className="subhead">Changed by you and in the new file</h3>
            <ul className="review-list">
              {conflicted.flatMap((entry) =>
                entry.conflicts.map((conflict) => {
                  const key = `${entry.id}:${conflict.field}`;
                  const choice = conflictChoices[key] ?? "mine";
                  return (
                    <li key={key} className="review-row review-row--stack">
                      <span>
                        <strong>{entry.current.name}</strong> · {MERGE_FIELD_LABELS[conflict.field]}
                      </span>
                      <span className="review-choices" role="radiogroup" aria-label={`${MERGE_FIELD_LABELS[conflict.field]} for ${entry.current.name}`}>
                        <label className={choice === "mine" ? "chip chip--on" : "chip"}>
                          <input
                            type="radio"
                            name={key}
                            checked={choice === "mine"}
                            onChange={() => setConflictChoices((previous) => ({ ...previous, [key]: "mine" }))}
                          />
                          Keep mine: {shown(conflict.mine)}
                        </label>
                        <label className={choice === "file" ? "chip chip--on" : "chip"}>
                          <input
                            type="radio"
                            name={key}
                            checked={choice === "file"}
                            onChange={() => setConflictChoices((previous) => ({ ...previous, [key]: "file" }))}
                          />
                          Use new file: {shown(conflict.file)}
                        </label>
                      </span>
                    </li>
                  );
                })
              )}
            </ul>
          </section>
        ) : null}

        {plan.added.length ? (
          <section>
            <h3 className="subhead">Added ({plan.added.length})</h3>
            <ul className="review-list">
              {plan.added.map((guest) => (
                <li key={guest.id} className="review-row">
                  <span className="badge badge--success">New</span>
                  <span>
                    <strong>{guest.name}</strong> · {where(guest)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {removedRows.length ? (
          <section>
            <h3 className="subhead">No longer in the file ({removedRows.length})</h3>
            <ul className="review-list">
              {removedRows.map((guest) => {
                const pairedTo = pairs[guest.id];
                const kept = keepRemoved.includes(guest.id);
                return (
                  <li key={guest.id} className="review-row review-row--stack">
                    <span>
                      <span className={pairedTo ? "badge" : kept ? "badge" : "badge badge--danger"}>
                        {pairedTo ? "Renamed" : kept ? "Kept" : "Removed"}
                      </span>{" "}
                      <strong>{guest.name}</strong> · {where(guest)}
                    </span>
                    <span className="review-choices">
                      {!pairedTo ? (
                        <label className="chip">
                          <input
                            type="checkbox"
                            checked={kept}
                            onChange={(event) =>
                              setKeepRemoved((previous) =>
                                event.target.checked ? [...previous, guest.id] : previous.filter((id) => id !== guest.id)
                              )
                            }
                          />
                          Keep this guest
                        </label>
                      ) : null}
                      {pairable.length ? (
                        <select
                          className="select-sm"
                          value={pairedTo ?? ""}
                          aria-label={`${guest.name} is the same person as`}
                          onChange={(event) => {
                            const target = event.target.value;
                            setPairs((previous) => {
                              const nextPairs = { ...previous };
                              if (target) nextPairs[guest.id] = target;
                              else delete nextPairs[guest.id];
                              return nextPairs;
                            });
                            setKeepRemoved((previous) => previous.filter((id) => id !== guest.id));
                          }}
                        >
                          <option value="">Same person as…</option>
                          {pairable
                            .filter((candidate) => candidate.id === pairedTo || !pairedAddedIds.has(candidate.id))
                            .map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.name} ({where(candidate)})
                              </option>
                            ))}
                        </select>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {changed.length ? (
          <section>
            <h3 className="subhead">Changed in the new file ({changed.length})</h3>
            <ul className="review-list">
              {changed.map((entry) => (
                <li key={entry.id} className="review-row review-row--stack">
                  <strong>{entry.current.name}</strong>
                  <span className="text-muted">
                    {entry.changes
                      .map((change) => `${MERGE_FIELD_LABELS[change.field]}: ${shown(change.from)} → ${shown(change.to)}`)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {plan.manualOnly.length || plan.stillDeleted.length ? (
          <p className="field-hint" style={{ margin: 0 }}>
            {plan.manualOnly.length
              ? `${plan.manualOnly.length} guest${plan.manualOnly.length === 1 ? "" : "s"} you added by hand ${
                  plan.manualOnly.length === 1 ? "stays" : "stay"
                } on the list. `
              : ""}
            {plan.stillDeleted.length
              ? `${plan.stillDeleted.length} guest${plan.stillDeleted.length === 1 ? "" : "s"} you removed by hand ${
                  plan.stillDeleted.length === 1 ? "stays" : "stay"
                } removed (${plan.stillDeleted
                  .slice(0, 3)
                  .map((guest) => guest.name)
                  .join(", ")}${plan.stillDeleted.length > 3 ? "…" : ""}).`
              : ""}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
