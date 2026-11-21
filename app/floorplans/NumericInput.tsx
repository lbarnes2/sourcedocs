"use client";

import { type InputHTMLAttributes, useEffect, useRef, useState } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "min" | "max"> & {
  /** null shows an empty field. */
  value: number | null;
  /** Called with in-range values while typing, and with the clamped value on blur / Enter. */
  onCommit: (value: number | null) => void;
  min?: number;
  max?: number;
  integer?: boolean;
  /** Decimal places shown when the field isn't being edited. */
  decimals?: number;
  /** Clearing the field commits null instead of putting the last value back. */
  allowEmpty?: boolean;
};

function format(value: number | null, decimals: number): string {
  if (value == null || !Number.isFinite(value)) return "";
  const f = 10 ** decimals;
  return String(Math.round(value * f) / f);
}

/**
 * A number field that lets you type freely. The draft text is kept locally: values outside
 * `min`–`max` (like the "3" on the way to "30") are held back rather than clamped mid-keystroke,
 * and the field is tidied up when it loses focus.
 */
export function NumericInput({
  value,
  onCommit,
  min,
  max,
  integer = false,
  decimals = 2,
  allowEmpty = false,
  onBlur,
  onKeyDown,
  onFocus,
  ...rest
}: Props) {
  const [text, setText] = useState(() => format(value, decimals));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(format(value, decimals));
  }, [value, decimals]);

  const parse = (raw: string): number | null => {
    if (raw.trim() === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const inRange = (n: number) =>
    (min == null || n >= min) && (max == null || n <= max) && (!integer || Number.isInteger(n));

  const settle = () => {
    const n = parse(text);
    if (n == null) {
      if (allowEmpty) {
        if (value != null) onCommit(null);
        setText("");
      } else {
        setText(format(value, decimals));
      }
      return;
    }
    let next = integer ? Math.round(n) : n;
    if (min != null) next = Math.max(min, next);
    if (max != null) next = Math.min(max, next);
    if (next !== value) onCommit(next);
    setText(format(next, decimals));
  };

  return (
    <input
      {...rest}
      type="number"
      min={min}
      max={max}
      value={text}
      onFocus={(e) => {
        focused.current = true;
        onFocus?.(e);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const n = parse(raw);
        if (n != null && inRange(n) && n !== value) onCommit(n);
      }}
      onBlur={(e) => {
        focused.current = false;
        settle();
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          settle();
          (e.target as HTMLInputElement).select();
        }
        onKeyDown?.(e);
      }}
    />
  );
}
