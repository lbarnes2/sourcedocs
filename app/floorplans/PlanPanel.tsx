"use client";

import { useState } from "react";
import { Field, Section } from "@/app/components/ui";
import { NumericInput } from "@/app/floorplans/NumericInput";
import type { Measurement } from "@/lib/floorplans/measure";
import type { FloorplanLimits } from "@/types";

interface Props {
  measurements: Measurement[];
  limits: FloorplanLimits | undefined;
  scaled: boolean;
  seatingBlocks: number;
  activeId: string | null;
  onShow: (measurement: Measurement | null) => void;
  onLimits: (patch: Partial<FloorplanLimits>) => void;
  onSelectAllSeating: () => void;
}

const LIMIT_FIELDS: Array<{ key: keyof FloorplanLimits; label: string; integer?: boolean }> = [
  { key: "maxCapacity", label: "Most seats", integer: true },
  { key: "maxSeatsBetweenAisles", label: "Most seats in a run", integer: true },
  { key: "minAisleM", label: "Narrowest aisle (m)" },
  { key: "minSeatwayM", label: "Smallest seatway (m)" },
  { key: "minFrontDistanceM", label: "Front row to stage (m)" },
  { key: "minExitWidthM", label: "Total exit width (m)" }
];

/**
 * Shown in place of the Inspector when nothing is selected: the plan's measurements, each of which can
 * be pointed out on the canvas, plus the user's own limits to compare them with. The numbers are for
 * the user's judgement; the panel never says a layout is safe or unsafe.
 */
export function PlanPanel({ measurements, limits, scaled, seatingBlocks, activeId, onShow, onLimits, onSelectAllSeating }: Props) {
  const [limitsOpen, setLimitsOpen] = useState(false);
  const setCount = Object.values(limits ?? {}).filter((v) => v != null).length;

  return (
    <Section title="Plan" description="Measurements. Click one to show where it was taken.">
      <div className="stack">
        {!scaled ? (
          <p className="field-hint" style={{ margin: 0 }}>
            Set the scale in <strong>Plan settings</strong> to see distances.
          </p>
        ) : null}
        <ul className="measure-list">
          {measurements.map((item) => {
            const active = item.id === activeId;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`measure${item.past ? " measure--past" : ""}${active ? " measure--active" : ""}`}
                  aria-pressed={active}
                  disabled={!item.highlight}
                  onClick={() => onShow(active ? null : item)}
                >
                  <span className="measure-label">{item.label}</span>
                  <span className="measure-value">{item.value}</span>
                  {item.detail || item.limit ? (
                    <span className="measure-detail">
                      {item.detail}
                      {item.detail && item.limit ? " · " : ""}
                      {item.limit ? `your limit: ${item.limit}` : ""}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        {seatingBlocks ? (
          <button type="button" className="btn-sm" onClick={onSelectAllSeating}>
            Select all seating ({seatingBlocks})
          </button>
        ) : null}

        <button
          type="button"
          className="btn-sm btn-ghost"
          aria-expanded={limitsOpen}
          onClick={() => setLimitsOpen((open) => !open)}
        >
          {limitsOpen ? "Hide your limits" : `Your limits${setCount ? ` (${setCount} set)` : ""}`}
        </button>
        {limitsOpen ? (
          <>
            <p className="field-hint" style={{ margin: 0 }}>
              Figures from your venue, licence or risk assessment. Measurements past them are marked so you can take a look;
              whether a layout works is your call.
            </p>
            <div className="form-grid">
              {LIMIT_FIELDS.map((f) => (
                <Field key={f.key} label={f.label}>
                  <NumericInput
                    min={0}
                    integer={f.integer}
                    allowEmpty
                    placeholder="None"
                    value={limits?.[f.key] ?? null}
                    onCommit={(n) => onLimits({ [f.key]: n })}
                  />
                </Field>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </Section>
  );
}
