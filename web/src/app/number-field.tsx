// Number boxes that cannot hold a value outside their limits: typing past the maximum stops at the
// maximum, a minus sign is refused where negative numbers are not allowed, and a number below the
// minimum (which may still be on its way to a valid one, like "5" before "50") is raised when the
// box loses focus. Arrow keys step the value within the limits.

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const parse = (text: string) => Number(text.trim().replace(",", "."));
const format = (n: number) => String(Math.round(n * 1000) / 1000);

// What a keystroke may leave in the box.
export function clampTyped(text: string, min?: number, max?: number, integer = false) {
  let t = text.replace(/\s+/g, "");
  if (integer) t = t.replace(/[.,].*$/, "");
  if (min !== undefined && min >= 0) t = t.replace(/-/g, "");
  if (t === "" || t === "-" || t === "." || t === "-.") return t;
  const n = parse(t);
  if (!Number.isFinite(n)) return text.length < 24 && /^-?\d*[.,]?\d*(e-?\d*)?$/i.test(t) ? t : t.slice(0, -1);
  if (max !== undefined && n > max) return format(max);
  if (min !== undefined && n < min && n < 0) return format(min);
  return t;
}

export function clampValue(n: number, min?: number, max?: number, integer = false) {
  let v = integer ? Math.round(n) : n;
  if (min !== undefined) v = Math.max(min, v);
  if (max !== undefined) v = Math.min(max, v);
  return v;
}

type FieldProps = Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "min" | "max" | "step" | "type"> & {
  value: number; min?: number; max?: number; step?: number; integer?: boolean;
  onValue: (n: number) => void;
  // commit: the value is passed on when the box loses focus or Enter is pressed (one change per edit);
  // otherwise every valid keystroke passes it on (forms that read the value when confirmed).
  commit?: boolean;
};

export function NumberField({ value, min, max, step = 1, integer = false, onValue, commit = false, className, onKeyDown, onBlur, ...rest }: FieldProps) {
  const [text, setText] = React.useState(format(value));
  React.useEffect(() => { if (parse(text) !== value) setText(format(value)); }, [value]);
  const finish = () => {
    if (text === format(value)) return; // left without a change
    const n = parse(text);
    if (!Number.isFinite(n) || text.trim() === "") { setText(format(value)); return; }
    const v = clampValue(n, min, max, integer);
    setText(format(v));
    if (v !== value) onValue(v);
  };
  return <Input {...rest} inputMode={integer && (min ?? 0) >= 0 ? "numeric" : "decimal"} value={text}
    aria-valuemin={min} aria-valuemax={max} title={rest.title ?? (min !== undefined || max !== undefined ? `From ${min ?? "−∞"} to ${max ?? "∞"}` : undefined)}
    className={cn("tabular-nums", className)}
    onChange={(e) => {
      const t = clampTyped(e.target.value, min, max, integer);
      setText(t);
      if (commit) return;
      const n = parse(t);
      if (t.trim() !== "" && Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max)) onValue(integer ? Math.round(n) : n);
    }}
    onBlur={(e) => { finish(); onBlur?.(e); }}
    onKeyDown={(e) => {
      e.stopPropagation();
      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const base = Number.isFinite(parse(text)) ? parse(text) : value;
        const v = clampValue(base + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1), min, max, integer);
        setText(format(v));
        if (!commit || v !== value) onValue(v);
      }
      onKeyDown?.(e);
    }} />;
}
