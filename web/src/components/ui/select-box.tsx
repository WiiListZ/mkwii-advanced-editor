// The app's drop-down list (the Select of select.tsx) written like a <select>: the same <option>
// children, value and onChange (e.target.value is the chosen option's value, as a string), so a
// <select> becomes a SelectBox without changing its options or its handler. The trigger is a
// button with role "combobox"; it and each option carry data-value (tests choose by it).

import * as React from "react";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

// Radix gives no item the empty value: an option with value "" is kept under this one.
const EMPTY = "\u0000none";
const encode = (value: string) => (value === "" ? EMPTY : value);
const decode = (value: string) => (value === EMPTY ? "" : value);

type Option = { value: string; label: React.ReactNode; disabled?: boolean; title?: string };

// The options of <option> children, also inside fragments and arrays (as {list.map(…)} gives them).
function readOptions(children: React.ReactNode, out: Option[] = []) {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const props = child.props as any;
    if (child.type === React.Fragment) { readOptions(props.children, out); return; }
    if (child.type !== "option") return;
    const text = React.Children.toArray(props.children).join("");
    out.push({ value: String(props.value ?? text), label: props.children, disabled: props.disabled, title: props.title });
  });
  return out;
}

export type SelectBoxChange = { target: { value: string }; currentTarget: { value: string } };

export function SelectBox({ value, onChange, children, className, disabled, id, title, "aria-label": label }: {
  value: string | number | undefined;
  onChange?: (event: SelectBoxChange) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  title?: string;
  "aria-label"?: string;
}) {
  const options = readOptions(children);
  const current = encode(String(value ?? ""));
  return (
    <Select value={current} disabled={disabled} onValueChange={(next) => {
      const chosen = decode(next);
      onChange?.({ target: { value: chosen }, currentTarget: { value: chosen } });
    }}>
      <SelectTrigger id={id} title={title} aria-label={label} data-value={decode(current)}
        className={cn("h-8 w-auto gap-1.5 bg-background px-2 text-xs", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={encode(option.value)} disabled={option.disabled} title={option.title} data-value={option.value} className="text-xs">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
