"use client";

import { BringToFront, SendToBack, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Field, Section, Segmented, Switch } from "@/app/components/ui";
import { NumericInput } from "@/app/floorplans/NumericInput";
import {
  DEFAULT_FILLS,
  DEFAULT_UNITS_PER_METRE,
  ROUND_TABLE_SIZES,
  roundTableRadius,
  type RoundTableSize,
  chairMetrics,
  seatOffsets,
  FILL_SWATCHES,
  MAX_TABLE_SEATS,
  recommendedRectSize,
  roundRadiusForSeats,
  tableSeatCount,
  tableShape
} from "@/lib/floorplans/geometry";
import { guestCountFor, tableKey, type TableGuestMap } from "@/lib/floorplans/guests";
import {
  CHAIR_PRESETS,
  CHEVRON_DEFAULT_ANGLE,
  CHEVRON_MAX_ANGLE,
  MAX_SEATING_ROWS,
  ROW_SHAPES,
  MAX_SEATS_PER_ROW,
  blockAisleWidth,
  chairPreset,
  evenAisles,
  keepFrontRow,
  longestRun,
  pruneRemoved,
  seatGap,
  rowShape,
  seatingAisles,
  seatingCurveRadius,
  seatingMinCurveRadius,
  seatingRowLengths,
  seatingSeatCount,
  seatingWheelchairCount,
  seatingSize,
  seatway
} from "@/lib/floorplans/seating";
import type { FloorplanCanvasObject, FloorplanSeatingObject, FloorplanTableObject } from "@/types";

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
  /** Seat editing for a single seating block: null when not editing. */
  seatEdit?: { id: string; tool: "remove" | "wheelchair" } | null;
  onSeatEdit?: (tool: "remove" | "wheelchair" | null) => void;
  /** Fill the selected rectangle with theatre seating. */
  onFillShape?: () => void;
  /** Take out the chairs that stand on a pillar, bar or other object. */
  onClearUnderObjects?: () => void;
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
      <NumericInput
        min={min}
        max={max}
        step={step}
        decimals={1}
        value={Number.isFinite(value) ? value : null}
        onCommit={(n) => {
          if (n != null) onChange(n);
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
      <NumericInput
        min={Math.ceil(((min * factor) / upm) * 100) / 100}
        step={0.1}
        value={shown}
        onCommit={(m) => {
          if (m != null && m > 0) onChange(Math.max(min, (m * upm) / factor));
        }}
      />
    </Field>
  );
}

/** Table number: the field can be emptied while retyping; an empty value is never saved. */
function TableNumberInput({
  value,
  disabled,
  onChange
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  return (
    <input
      value={text}
      disabled={disabled}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value.trim()) onChange(e.target.value);
      }}
      onBlur={() => {
        focused.current = false;
        if (!text.trim()) setText(value);
      }}
    />
  );
}

function titleFor(obj: FloorplanCanvasObject, count: number): string {
  if (count > 1) return `${count} selected`;
  if (obj.type === "table") return `Table ${obj.tableNumber}`;
  if (obj.type === "rect") return obj.label || "Rectangle";
  if (obj.type === "circle") return obj.label || "Circle";
  if (obj.type === "seating") return obj.name?.trim() || "Seating block";
  return "Text";
}

export function Inspector({
  primary,
  selectionCount,
  tableGuests,
  totalGuests,
  gridSize,
  unitsPerMetre,
  onPatch,
  onDelete,
  onOrder,
  seatEdit,
  onSeatEdit,
  onClearUnderObjects,
  onFillShape
}: Props) {
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

        {primary.type === "seating" ? (
          <SeatingFields
            block={primary}
            multiple={selectionCount > 1}
            unitsPerMetre={unitsPerMetre}
            patchSeating={(fn, key) => onPatch((o) => (o.type === "seating" ? fn(o) : o), key)}
            seatTool={seatEdit?.id === primary.id ? seatEdit.tool : null}
            onSeatTool={onSeatEdit}
            onClearUnderObjects={onClearUnderObjects}
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
            {onFillShape && selectionCount === 1 ? (
              <button type="button" className="btn-sm" onClick={onFillShape}>
                Fill with seating…
              </button>
            ) : null}
            <Switch
              label="Exit"
              hint="Counts towards total exit width (its longer side) in the plan measurements."
              checked={Boolean(primary.exit)}
              onChange={(exit) => onPatch((o) => (o.type === "rect" ? { ...o, exit: exit || undefined } : o))}
            />
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
            Changes apply to every selected{" "}
            {primary.type === "table"
              ? "table"
              : primary.type === "text"
                ? "label"
                : primary.type === "seating"
                  ? "seating block"
                  : "shape"}{" "}
            of the
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
      min={-360}
      max={360}
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
  // Same rule everywhere: the smallest standard round for the seat count (5 ft to 10, 6 ft to 12, then larger).
  const roundRadius = (n: number) => roundRadiusForSeats(n, unitsPerMetre ?? DEFAULT_UNITS_PER_METRE);

  const setSeats = (n: number) =>
    patchTable((t) => ({ ...t, seats: Math.max(0, Math.min(60, Math.round(n))) }), "seats");

  const crowded = (() => {
    // Round chairs scale with the table, so judge rounds by standard spacing rather than by chairs touching.
    if (shape === "round") return seats > 0 && table.radius < roundRadius(seats) - 0.05;
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
          <TableNumberInput
            key={table.id}
            value={table.tableNumber}
            disabled={multiple}
            onChange={(tableNumber) => patchTable((t) => ({ ...t, tableNumber }), "number")}
          />
        </Field>
        <NumberField label="Seats" min={0} max={MAX_TABLE_SEATS} step={1} value={seats} onChange={setSeats} />
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
            {shape === "round" ? "More seats than this size takes at standard spacing." : "Chairs overlap at this size."}
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

function AislePositions({
  value,
  seats,
  disabled,
  onChange
}: {
  value: number[];
  seats: number;
  disabled: boolean;
  onChange: (aisles: number[]) => void;
}) {
  const shown = value.join(", ");
  const [text, setText] = useState(shown);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(shown);
  }, [shown]);
  const parse = (raw: string) =>
    Array.from(
      new Set(
        raw
          .split(/[\s,;]+/)
          .map((part) => Math.round(Number(part)))
          .filter((n) => Number.isFinite(n) && n >= 1 && n < seats)
      )
    ).sort((a, b) => a - b);
  return (
    <input
      value={text}
      disabled={disabled}
      inputMode="numeric"
      placeholder="e.g. 6, 14"
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parse(e.target.value));
      }}
      onBlur={() => {
        focused.current = false;
        setText(shown);
      }}
    />
  );
}

function SeatingFields({
  block,
  multiple,
  unitsPerMetre,
  patchSeating,
  seatTool,
  onSeatTool,
  onClearUnderObjects
}: {
  block: FloorplanSeatingObject;
  multiple: boolean;
  unitsPerMetre: number | null;
  patchSeating: (fn: (s: FloorplanSeatingObject) => FloorplanSeatingObject, key?: string) => void;
  seatTool: "remove" | "wheelchair" | null;
  onSeatTool?: (tool: "remove" | "wheelchair" | null) => void;
  onClearUnderObjects?: () => void;
}) {
  const [rowMode, setRowMode] = useState<"seatway" | "pitch">("seatway");
  const upm = unitsPerMetre;
  const k = upm ?? DEFAULT_UNITS_PER_METRE;
  const aisles = seatingAisles(block);
  const count = seatingSeatCount(block);
  const wheelchair = seatingWheelchairCount(block);
  const positions = seatingRowLengths(block);
  const removed = positions.reduce((a, b) => a + b, 0) - count - wheelchair;
  const shape = rowShape(block);
  const size = seatingSize(block);
  const metres = (units: number) => (upm ? `${(units / upm).toFixed(2)} m` : `${Math.round(units)} units`);
  const preset = CHAIR_PRESETS.find((p) => p.id === block.chairPreset);

  // Every change keeps the front row where it is; the block grows away from the stage.
  const change = (fn: (s: FloorplanSeatingObject) => FloorplanSeatingObject, key?: string) =>
    patchSeating((s) => keepFrontRow(s, pruneRemoved(fn(s))), key);

  const setChair = (id: string) =>
    change((s) => {
      const p = chairPreset(id);
      const w = p.widthM * k;
      const d = p.depthM * k;
      return {
        ...s,
        chairPreset: p.id,
        chairWidth: w,
        chairDepth: d,
        seatSpacing: w + seatGap(s),
        rowPitch: d + seatway(s)
      };
    });

  return (
    <>
      <div className="form-grid">
        <Field label="Name" className="span-all" hint="Printed behind the back row, e.g. Left, Stalls.">
          <input
            value={block.name ?? ""}
            disabled={multiple}
            onChange={(e) => patchSeating((s) => ({ ...s, name: e.target.value || undefined }), "name")}
          />
        </Field>
        <NumberField
          label="Rows"
          min={1}
          max={MAX_SEATING_ROWS}
          step={1}
          value={block.rows}
          onChange={(v) => change((s) => ({ ...s, rows: Math.round(v) }), "rows")}
        />
        <NumberField
          label={shape === "curved" ? "Seats in front row" : "Seats per row"}
          min={1}
          max={MAX_SEATS_PER_ROW}
          step={1}
          value={block.seatsPerRow}
          onChange={(v) =>
            change((s) => {
              const n = Math.round(v);
              return { ...s, seatsPerRow: n, aisles: (s.aisles ?? []).filter((a) => a < n) };
            }, "seats")
          }
        />
      </div>
      <p className="field-hint" style={{ margin: 0 }}>
        <strong>{count}</strong> seat{count === 1 ? "" : "s"} · {metres(size.w)} × {metres(size.h)}
        {wheelchair > 0 ? ` · ${wheelchair} wheelchair space${wheelchair === 1 ? "" : "s"}` : ""}
        {removed > 0 ? ` · ${removed} taken out` : ""}
        {shape === "curved" && positions.length > 1 ? ` · rows of ${positions[0]} to ${positions[positions.length - 1]}` : ""}
      </p>
      <Field label="Rows are" as="div">
        <Segmented
          value={shape}
          options={ROW_SHAPES}
          onChange={(next) => change((s) => ({ ...s, rowShape: next === "straight" ? undefined : next }), "rowShape")}
        />
      </Field>
      {shape === "curved" ? (
        <div className="form-grid">
          <LengthField
            label="Curve radius (m)"
            min={seatingMinCurveRadius(block)}
            units={seatingCurveRadius(block)}
            upm={upm}
            hint={`To the front row. Smaller is tighter; at least ${metres(seatingMinCurveRadius(block))}.`}
            onChange={(v) => change((s) => ({ ...s, curveRadius: Math.max(seatingMinCurveRadius(s), v) }), "curve")}
          />
        </div>
      ) : null}
      {shape === "chevron" ? (
        <div className="form-grid">
          <NumberField
            label="Wing angle (°)"
            min={0}
            max={CHEVRON_MAX_ANGLE}
            step={1}
            value={block.chevronAngle ?? CHEVRON_DEFAULT_ANGLE}
            hint="How far each side turns in towards the middle. A chevron always has a centre aisle."
            onChange={(v) => change((s) => ({ ...s, chevronAngle: Math.max(0, Math.min(CHEVRON_MAX_ANGLE, v)) }), "chevron")}
          />
        </div>
      ) : null}
      {!multiple && onSeatTool ? (
        seatTool ? (
          <div className="seat-edit stack stack--sm">
            <Field label="Clicking a chair" as="div">
              <Segmented
                value={seatTool}
                options={[
                  { value: "remove", label: "Takes it out" },
                  { value: "wheelchair", label: "Wheelchair space" }
                ]}
                onChange={(tool) => onSeatTool(tool)}
              />
            </Field>
            <p className="field-hint" style={{ margin: 0 }}>
              Click again to put a chair back. Drag across chairs to change a row at once; hold ⌥ Option for the other
              choice. Esc when done.
            </p>
            <button type="button" className="btn-sm btn-primary" onClick={() => onSeatTool(null)}>
              Done editing seats
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <button
              type="button"
              className="btn-sm"
              title="Or double-click the block"
              onClick={() => onSeatTool("remove")}
            >
              Edit seats…
            </button>
            {onClearUnderObjects ? (
              <button
                type="button"
                className="btn-sm"
                title="Take out chairs that stand on a pillar, bar, AV desk or other object"
                onClick={onClearUnderObjects}
              >
                Clear seats under objects
              </button>
            ) : null}
          </div>
        )
      ) : null}
      {removed > 0 || wheelchair > 0 ? (
        <button
          type="button"
          className="btn-sm"
          onClick={() => patchSeating((s) => ({ ...s, removed: undefined, wheelchair: undefined }))}
        >
          Put back all chairs
        </button>
      ) : null}

      <div className="form-grid">
        <Field label="Chair" className="span-all">
          <select value={preset?.id ?? ""} onChange={(e) => e.target.value && setChair(e.target.value)}>
            {preset ? null : <option value="">Custom size</option>}
            {CHAIR_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} ({Math.round(p.widthM * 100)} × {Math.round(p.depthM * 100)} cm)
              </option>
            ))}
          </select>
        </Field>
        <LengthField
          label="Chair width (m)"
          min={1}
          units={block.chairWidth}
          upm={upm}
          onChange={(v) =>
            change((s) => ({ ...s, chairWidth: v, seatSpacing: v + seatGap(s), chairPreset: undefined }), "chairW")
          }
        />
        <LengthField
          label="Chair depth (m)"
          min={1}
          units={block.chairDepth}
          upm={upm}
          onChange={(v) =>
            change((s) => ({ ...s, chairDepth: v, rowPitch: v + seatway(s), chairPreset: undefined }), "chairD")
          }
        />
        <LengthField
          label="Chair gap (m)"
          min={0}
          units={seatGap(block)}
          upm={upm}
          onChange={(v) => change((s) => ({ ...s, seatSpacing: s.chairWidth + v }), "gap")}
        />
      </div>

      <Field label="Row spacing" as="div">
        <Segmented
          value={rowMode}
          options={[
            { value: "seatway", label: "Seatway" },
            { value: "pitch", label: "Row pitch" }
          ]}
          onChange={setRowMode}
        />
      </Field>
      <div className="form-grid">
        {rowMode === "seatway" ? (
          <LengthField
            label="Seatway (m)"
            min={0}
            units={seatway(block)}
            upm={upm}
            hint="Clear gap from the back of one row to the front of the next."
            onChange={(v) => change((s) => ({ ...s, rowPitch: s.chairDepth + v }), "seatway")}
          />
        ) : (
          <LengthField
            label="Row pitch (m)"
            min={1}
            units={block.rowPitch}
            upm={upm}
            hint="Front of one row to the front of the next."
            onChange={(v) => change((s) => ({ ...s, rowPitch: Math.max(s.chairDepth, v) }), "pitch")}
          />
        )}
      </div>

      <div className="form-grid">
        <NumberField
          label="Aisles"
          min={shape === "chevron" ? 1 : 0}
          max={Math.max(0, block.seatsPerRow - 1)}
          step={1}
          value={aisles.length}
          onChange={(v) =>
            change((s) => ({
              ...s,
              aisles: evenAisles(s.seatsPerRow, Math.round(v)),
              aisleWidth: s.aisleWidth ?? 1.2 * k
            }), "aisles")
          }
        />
        <LengthField
          label="Aisle width (m)"
          min={0}
          units={blockAisleWidth(block)}
          upm={upm}
          onChange={(v) => change((s) => ({ ...s, aisleWidth: Math.max(seatGap(s), v) }), "aisleW")}
        />
        {aisles.length ? (
          <Field
            label="Aisle after seat"
            className="span-all"
            hint={`Seat counts from the left, looking at the stage${shape === "curved" ? ", in the front row" : ""}.`}
          >
            <AislePositions
              key={block.id}
              value={aisles}
              seats={block.seatsPerRow}
              disabled={multiple}
              onChange={(next) => change((s) => ({ ...s, aisles: next }), "aislePos")}
            />
          </Field>
        ) : null}
        <RotationField
          value={block.rotation ?? 0}
          onChange={(v) => patchSeating((s) => ({ ...s, rotation: v || undefined }), "rotation")}
        />
      </div>

      {!multiple ? (
        <p className="field-hint" style={{ margin: 0 }}>
          Longest run {longestRun(block)} seats · seatway {metres(seatway(block))}
          {aisles.length ? ` · aisles ${metres(blockAisleWidth(block))}` : ""}
        </p>
      ) : null}
    </>
  );
}
