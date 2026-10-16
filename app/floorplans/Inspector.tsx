"use client";

import { BringToFront, SendToBack, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Field, Section, Segmented, Switch } from "@/app/components/ui";
import {
  DEFAULT_FILLS,
  DEFAULT_UNITS_PER_METRE,
  ROUND_TABLE_SIZES,
  roundTableRadius,
  type RoundTableSize,
  chairMetrics,
  seatOffsets,
  FILL_SWATCHES,
  recommendedRadius,
  recommendedRectSize,
  tableSeatCount,
  tableShape
} from "@/lib/floorplans/geometry";
import { guestCountFor, tableKey, type TableGuestMap } from "@/lib/floorplans/guests";
import type { FloorplanCanvasObject, FloorplanTableObject } from "@/types";

interface Props {
  /** The object being edited (last one selected). */
  primary: FloorplanCanvasObject;
  selectionCount: number;
  tableGuests: TableGuestMap | null;
  /** Guests seated at tables on the plan; used for room area per guest. */
  totalGuests: number;
  gridSize: number;
  unitsPerMetre: number | null;
  /** Applies a change to every selected object of the primary's type. `key` coalesces rapid edits into one undo step. */
  onPatch: (patch: (obj: FloorplanCanvasObject) => FloorplanCanvasObject, key?: string) => void;
  onDelete: () => void;
  onOrder: (where: "front" | "back") => void;
}

function Swatches({
  value,
  onChange,
  allowNone,
  defaultHex
}: {
  value: string | undefined;
  onChange: (hex: string | undefined) => void;
  allowNone?: boolean;
  defaultHex: string;
}) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Fill colour">
      <button
        type="button"
        role="radio"
        aria-checked={value === undefined}
        className={`swatch${value === undefined ? " swatch--active" : ""}`}
        style={{ background: defaultHex }}
        title="Default"
        aria-label="Default colour"
        onClick={() => onChange(undefined)}
      />
      {FILL_SWATCHES.map((s) => (
        <button
          key={s.hex}
          type="button"
          role="radio"
          aria-checked={value === s.hex}
          className={`swatch${value === s.hex ? " swatch--active" : ""}`}
          style={{ background: s.hex }}
          title={s.name}
          aria-label={s.name}
          onClick={() => onChange(s.hex)}
        />
      ))}
      {allowNone ? (
        <button
          type="button"
          role="radio"
          aria-checked={value === "none"}
          className={`swatch swatch--none${value === "none" ? " swatch--active" : ""}`}
          title="No fill (outline only)"
          aria-label="No fill"
          onClick={() => onChange("none")}
        />
      ) : null}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  hint,
  onChange
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  hint?: ReactNode;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? Math.round(value * 10) / 10 : ""}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </Field>
  );
}

/**
 * A length stored in canvas units. With a scale set it is shown and edited in metres; `factor` 2 turns a
 * stored radius into a diameter.
 */
function LengthField({
  label,
  units,
  upm,
  min = 6,
  factor = 1,
  hint,
  onChange
}: {
  label: string;
  units: number;
  upm: number | null;
  min?: number;
  factor?: 1 | 2;
  hint?: ReactNode;
  onChange: (units: number) => void;
}) {
  if (!upm) {
    return (
      <NumberField
        label={factor === 2 ? label.replace(/\(m\)$/, "").replace("Diameter", "Radius") : label.replace(/ \(m\)$/, "")}
        min={min}
        value={units}
        hint={hint}
        onChange={(v) => onChange(Math.max(min, v))}
      />
    );
  }
  const shown = (units * factor) / upm;
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        min={(min * factor) / upm}
        step={0.1}
        value={Math.round(shown * 100) / 100}
        onChange={(e) => {
          const m = Number(e.target.value);
          if (Number.isFinite(m) && m > 0) onChange(Math.max(min, (m * upm) / factor));
        }}
      />
    </Field>
  );
}

function titleFor(obj: FloorplanCanvasObject, count: number): string {
  if (count > 1) return `${count} selected`;
  if (obj.type === "table") return `Table ${obj.tableNumber}`;
  if (obj.type === "rect") return obj.label || "Rectangle";
  if (obj.type === "circle") return obj.label || "Circle";
  return "Text";
}

export function Inspector({ primary, selectionCount, tableGuests, totalGuests, gridSize, unitsPerMetre, onPatch, onDelete, onOrder }: Props) {
  const patchTable = (fn: (t: FloorplanTableObject) => FloorplanTableObject, key?: string) =>
    onPatch((o) => (o.type === "table" ? fn(o) : o), key);

  return (
    <Section
      title={titleFor(primary, selectionCount)}
      actions={
        <>
          <button type="button" className="icon-btn icon-btn--sm" title="Bring to front" aria-label="Bring to front" onClick={() => onOrder("front")}>
            <BringToFront size={15} />
          </button>
          <button type="button" className="icon-btn icon-btn--sm" title="Send to back" aria-label="Send to back" onClick={() => onOrder("back")}>
            <SendToBack size={15} />
          </button>
          <button type="button" className="icon-btn icon-btn--sm btn-danger" title="Delete" aria-label="Delete selection" onClick={onDelete}>
            <Trash2 size={15} />
          </button>
        </>
      }
    >
      <div className="stack">
        {primary.type === "table" ? (
          <TableFields
            table={primary}
            tableGuests={tableGuests}
            patchTable={patchTable}
            multiple={selectionCount > 1}
            unitsPerMetre={unitsPerMetre}
          />
        ) : null}

        {primary.type === "rect" ? (
          <>
            <div className="form-grid">
              <Field label="Label" className="span-all">
                <input
                  value={primary.label ?? ""}
                  placeholder="e.g. Stage"
                  onChange={(e) =>
                    onPatch((o) => (o.type === "rect" ? { ...o, label: e.target.value || undefined } : o), "label")
                  }
                />
              </Field>
              <LengthField
                label="Width (m)"
                units={primary.width}
                upm={unitsPerMetre}
                onChange={(v) => onPatch((o) => (o.type === "rect" ? { ...o, width: v } : o), "width")}
              />
              <LengthField
                label="Depth (m)"
                units={primary.height}
                upm={unitsPerMetre}
                onChange={(v) => onPatch((o) => (o.type === "rect" ? { ...o, height: v } : o), "height")}
              />
              <RotationField
                value={primary.rotation ?? 0}
                onChange={(v) => onPatch((o) => (o.type === "rect" ? { ...o, rotation: v || undefined } : o), "rotation")}
              />
            </div>
            {unitsPerMetre ? (
              <p className="field-hint" style={{ margin: 0 }}>
                Area {((primary.width * primary.height) / (unitsPerMetre * unitsPerMetre)).toFixed(1)} m²
                {tableGuests && totalGuests > 0
                  ? ` · ${((primary.width * primary.height) / (unitsPerMetre * unitsPerMetre) / totalGuests).toFixed(2)} m² per guest`
                  : ""}
              </p>
            ) : null}
            <Field label="Fill" as="div">
              <Swatches
                value={primary.fill}
                allowNone
                defaultHex={DEFAULT_FILLS.rect}
                onChange={(fill) => onPatch((o) => (o.type === "rect" ? { ...o, fill } : o))}
              />
            </Field>
          </>
        ) : null}

        {primary.type === "circle" ? (
          <>
            <div className="form-grid">
              <Field label="Label" className="span-all">
                <input
                  value={primary.label ?? ""}
                  onChange={(e) =>
                    onPatch((o) => (o.type === "circle" ? { ...o, label: e.target.value || undefined } : o), "label")
                  }
                />
              </Field>
              <LengthField
                label="Diameter (m)"
                factor={2}
                min={4}
                units={primary.radius}
                upm={unitsPerMetre}
                onChange={(v) => onPatch((o) => (o.type === "circle" ? { ...o, radius: v } : o), "radius")}
              />
            </div>
            <Field label="Fill" as="div">
              <Swatches
                value={primary.fill}
                allowNone
                defaultHex={DEFAULT_FILLS.circle}
                onChange={(fill) => onPatch((o) => (o.type === "circle" ? { ...o, fill } : o))}
              />
            </Field>
          </>
        ) : null}

        {primary.type === "text" ? (
          <>
            <Field label="Text">
              <textarea
                rows={2}
                value={primary.text}
                onChange={(e) => onPatch((o) => (o.type === "text" ? { ...o, text: e.target.value } : o), "text")}
              />
            </Field>
            <div className="form-grid">
              <NumberField
                label="Font size"
                min={6}
                max={200}
                value={primary.fontSize}
                onChange={(v) => onPatch((o) => (o.type === "text" ? { ...o, fontSize: Math.max(6, Math.min(200, v)) } : o), "font")}
              />
              <RotationField
                value={primary.rotation ?? 0}
                onChange={(v) => onPatch((o) => (o.type === "text" ? { ...o, rotation: v || undefined } : o), "rotation")}
              />
            </div>
            <Switch
              label="Bold"
              checked={Boolean(primary.bold)}
              onChange={(bold) => onPatch((o) => (o.type === "text" ? { ...o, bold: bold || undefined } : o))}
            />
          </>
        ) : null}

        {selectionCount > 1 ? (
          <p className="field-hint" style={{ margin: 0 }}>
            Changes apply to every selected {primary.type === "table" ? "table" : primary.type === "text" ? "label" : "shape"} of the
            same kind. Grid snap is {gridSize} units.
          </p>
        ) : null}
      </div>
    </Section>
  );
}

function RotationField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <NumberField
      label="Rotation °"
      min={0}
      max={359}
      step={15}
      value={value}
      onChange={(v) => onChange(((Math.round(v) % 360) + 360) % 360)}
    />
  );
}

function TableFields({
  table,
  tableGuests,
  patchTable,
  multiple,
  unitsPerMetre
}: {
  table: FloorplanTableObject;
  tableGuests: TableGuestMap | null;
  patchTable: (fn: (t: FloorplanTableObject) => FloorplanTableObject, key?: string) => void;
  multiple: boolean;
  unitsPerMetre: number | null;
}) {
  const shape = tableShape(table);
  const seats = tableSeatCount(table);
  const guestCount = guestCountFor(table.tableNumber, tableGuests);
  const names = tableGuests ? (tableGuests[tableKey(table.tableNumber)]?.guests ?? []) : [];

  // Seat count never resizes the table; a hint below says when the chairs no longer fit.
  const rectSize = (n: number, oneSide: boolean) => {
    const size = recommendedRectSize(n, oneSide);
    const k = (unitsPerMetre ?? DEFAULT_UNITS_PER_METRE) / DEFAULT_UNITS_PER_METRE;
    return { width: size.width * k, height: size.height * k };
  };
  const roundRadius = (n: number) =>
    recommendedRadius(n) * ((unitsPerMetre ?? DEFAULT_UNITS_PER_METRE) / DEFAULT_UNITS_PER_METRE);

  const setSeats = (n: number) =>
    patchTable((t) => ({ ...t, seats: Math.max(0, Math.min(60, Math.round(n))) }), "seats");

  const crowded = (() => {
    const offsets = seatOffsets(table);
    if (offsets.length < 2) return false;
    const { radius } = chairMetrics(table);
    for (let i = 0; i < offsets.length; i += 1) {
      for (let j = i + 1; j < offsets.length; j += 1) {
        if (Math.hypot(offsets[i].x - offsets[j].x, offsets[i].y - offsets[j].y) < radius * 2 - 0.01) return true;
      }
    }
    return false;
  })();

  const setShape = (value: "round" | "rect") =>
    patchTable((t) => {
      if (tableShape(t) === value) return t;
      const n = tableSeatCount(t);
      if (value === "rect") {
        const size = rectSize(n, Boolean(t.seatsOneSide));
        return { ...t, shape: "rect", width: size.width, height: size.height, radius: size.height / 2, seatSpan: undefined };
      }
      return { ...t, shape: undefined, width: undefined, height: undefined, seatsOneSide: undefined, radius: roundRadius(n) };
    });

  return (
    <>
      <div className="form-grid">
        <Field label="Table number">
          <input
            value={table.tableNumber}
            disabled={multiple}
            onChange={(e) => patchTable((t) => ({ ...t, tableNumber: e.target.value || t.tableNumber }), "number")}
          />
        </Field>
        <NumberField label="Seats" min={0} max={60} value={seats} onChange={setSeats} />
        <Field label="Label" className="span-all" hint="Printed instead of “Table N”, e.g. Top table.">
          <input
            value={table.label ?? ""}
            onChange={(e) => patchTable((t) => ({ ...t, label: e.target.value || undefined }), "label")}
          />
        </Field>
      </div>

      {crowded ? (
        <div className="stack stack--sm">
          <p className="field-hint" style={{ margin: 0 }}>
            Chairs overlap at this size.
          </p>
          <button
            type="button"
            className="btn-sm"
            onClick={() =>
              patchTable((t) => {
                const n = tableSeatCount(t);
                if (tableShape(t) === "round") return { ...t, radius: Math.max(t.radius, roundRadius(n)) };
                return { ...t, width: Math.max(t.width ?? 0, rectSize(n, Boolean(t.seatsOneSide)).width) };
              })
            }
          >
            Enlarge table to fit
          </button>
        </div>
      ) : null}

      <Field label="Shape" as="div">
        <Segmented
          value={shape}
          options={[
            { value: "round", label: "Round" },
            { value: "rect", label: "Rectangular" }
          ]}
          onChange={setShape}
        />
      </Field>

      {shape === "round" ? (
        <div className="form-grid">
          <Field label="Standard size" as="div" className="span-all">
            <div style={{ display: "flex", gap: 6 }}>
              {(Object.keys(ROUND_TABLE_SIZES) as RoundTableSize[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  className="btn-sm"
                  title={`${ROUND_TABLE_SIZES[key].label} round, ${ROUND_TABLE_SIZES[key].seats} chairs`}
                  onClick={() =>
                    patchTable((t) => ({
                      ...t,
                      radius: roundTableRadius(key, unitsPerMetre ?? DEFAULT_UNITS_PER_METRE),
                      seats: ROUND_TABLE_SIZES[key].seats
                    }))
                  }
                >
                  {ROUND_TABLE_SIZES[key].label} · {ROUND_TABLE_SIZES[key].seats}
                </button>
              ))}
            </div>
          </Field>
          <LengthField
            label="Diameter (m)"
            factor={2}
            units={table.radius}
            upm={unitsPerMetre}
            onChange={(v) => patchTable((t) => ({ ...t, radius: Math.min(400, v) }), "radius")}
          />
          <NumberField
            label="Seat arc °"
            min={30}
            max={360}
            step={10}
            value={table.seatSpan ?? 360}
            hint="360 = all round; less for cabaret."
            onChange={(v) =>
              patchTable((t) => ({ ...t, seatSpan: v >= 360 ? undefined : Math.max(30, Math.round(v)) }), "arc")
            }
          />
          {(table.seatSpan ?? 360) < 360 ? (
            <RotationField value={table.rotation ?? 0} onChange={(v) => patchTable((t) => ({ ...t, rotation: v || undefined }), "rotation")} />
          ) : null}
        </div>
      ) : (
        <>
          <div className="form-grid">
            <LengthField
              label="Length (m)"
              units={table.width ?? table.radius * 3}
              upm={unitsPerMetre}
              onChange={(v) => patchTable((t) => ({ ...t, width: v }), "width")}
            />
            <LengthField
              label="Depth (m)"
              units={table.height ?? table.radius * 2}
              upm={unitsPerMetre}
              onChange={(v) =>
                patchTable((t) => ({ ...t, height: v, radius: Math.max(6, Math.min(t.width ?? v, v) / 2) }), "height")
              }
            />
            <RotationField value={table.rotation ?? 0} onChange={(v) => patchTable((t) => ({ ...t, rotation: v || undefined }), "rotation")} />
          </div>
          <Switch
            label="Seats on one side only"
            hint="Chairs along the front edge, e.g. a top table."
            checked={Boolean(table.seatsOneSide)}
            onChange={(on) => patchTable((t) => ({ ...t, seatsOneSide: on || undefined }))}
          />
        </>
      )}

      <Field label="Fill" as="div" hint="Overrides the occupancy colour when set.">
        <Swatches
          value={table.fill}
          defaultHex={DEFAULT_FILLS.table}
          onChange={(fill) => patchTable((t) => ({ ...t, fill }))}
        />
      </Field>

      {guestCount != null && !multiple ? (
        <div className="stack stack--sm">
          <p className="field-hint" style={{ margin: 0 }}>
            <strong>{guestCount}</strong> guest{guestCount === 1 ? "" : "s"} for {seats} seat{seats === 1 ? "" : "s"}
            {guestCount > seats ? ` — ${guestCount - seats} too many` : guestCount < seats ? ` — ${seats - guestCount} spare` : ""}
          </p>
          {guestCount > 0 && guestCount !== seats ? (
            <button type="button" className="btn-sm" onClick={() => setSeats(guestCount)}>
              Set seats to {guestCount}
            </button>
          ) : null}
          {names.length ? (
            <ul className="field-hint" style={{ margin: 0, paddingLeft: 16, maxHeight: 140, overflow: "auto" }}>
              {names.map((g, i) => (
                <li key={`${g.name}-${i}`}>
                  {g.name}
                  {g.dietary ? ` — ${g.dietary}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
