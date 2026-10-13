// Imperative dialogs: `await dialogs.confirm(...)` / `await dialogs.open("kind", props)`.
// The DialogHost component renders whatever is on the stack.

import { useSyncExternalStore } from "react";

export interface DialogEntry {
  id: number;
  kind: string;
  props: any;
  resolve: (value: any) => void;
  closing?: boolean; // playing the exit animation, already resolved
}

export interface ConfirmOptions { title: string; description?: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean }
export interface FormField {
  key: string; label: string; type: "number" | "text" | "switch" | "select";
  value: any; min?: number; max?: number; step?: number; hint?: string; options?: [string, string][];
  visible?: (values: Record<string, any>) => boolean; // shown only while this returns true
}
export interface FormOptions { title: string; description?: string; fields: FormField[]; confirmLabel?: string }

let stack: DialogEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
// Matches the exit animation in index.css; the dialog stays mounted that long after closing.
const EXIT_MS = 140;

export const dialogs = {
  subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); },
  get stack() { return stack; },
  open<T = any>(kind: string, props: any = {}): Promise<T | null> {
    return new Promise((resolve) => {
      stack = [...stack, { id: nextId++, kind, props, resolve }];
      emit();
    });
  },
  close(id: number, value: any = null) {
    const entry = stack.find((d) => d.id === id);
    if (!entry || entry.closing) return;
    stack = stack.map((d) => (d === entry ? { ...d, closing: true } : d));
    emit();
    entry.resolve(value);
    setTimeout(() => {
      stack = stack.filter((d) => d.id !== id);
      emit();
    }, EXIT_MS);
  },
  confirm(opts: ConfirmOptions): Promise<boolean> {
    return dialogs.open("confirm", opts).then((v) => !!v);
  },
  alert(opts: { title: string; description?: string }): Promise<void> {
    return dialogs.open("alert", opts).then(() => undefined);
  },
  form(opts: FormOptions): Promise<Record<string, any> | null> {
    return dialogs.open("form", opts);
  },
};

export function useDialogStack() {
  return useSyncExternalStore(dialogs.subscribe, () => stack);
}
