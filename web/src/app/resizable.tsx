// Side-by-side panels whose widths the user drags. The widths are remembered per window.

import * as React from "react";
import { cn } from "@/lib/utils";

export function useColumnWidths(key: string, defaults: number[], min = 120) {
  const storageKey = `mkwii-columns:${key}`;
  const [widths, setWidths] = React.useState<number[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (Array.isArray(saved) && saved.length === defaults.length && saved.every((n) => Number.isFinite(n))) return saved;
    } catch { /* first use */ }
    return defaults;
  });
  const resize = React.useCallback((index: number, delta: number) => {
    setWidths((current) => {
      const next = current.slice();
      next[index] = Math.max(min, Math.min(900, current[index] + delta));
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* not kept */ }
      return next;
    });
  }, [storageKey, min]);
  const reset = React.useCallback(() => {
    setWidths(defaults);
    try { localStorage.removeItem(storageKey); } catch { /* nothing to remove */ }
  }, [storageKey, defaults.join(",")]);
  // Fixed columns, a handle after each, then the last column takes the rest.
  const template = [...widths.map((w) => `${w}px 8px`), "minmax(0,1fr)"].join(" ");
  return { widths, resize, reset, template };
}

// Drag handle between two columns; double-click restores the default widths.
export function ColumnHandle({ onResize, onReset, label = "Resize columns" }: { onResize: (delta: number) => void; onReset?: () => void; label?: string }) {
  const start = React.useRef<number | null>(null);
  return (
    <div role="separator" aria-orientation="vertical" aria-label={label} title={`${label} (double-click to reset)`}
      className="group hidden cursor-col-resize touch-none select-none items-stretch justify-center sm:flex"
      onPointerDown={(e) => { if (e.button !== 0) return; start.current = e.clientX; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault(); }}
      onPointerMove={(e) => { if (start.current === null) return; const delta = e.clientX - start.current; if (delta) { start.current = e.clientX; onResize(delta); } }}
      onPointerUp={(e) => { start.current = null; e.currentTarget.releasePointerCapture(e.pointerId); }}
      onDoubleClick={onReset}>
      <div className={cn("w-px bg-border transition-colors group-hover:w-0.5 group-hover:bg-primary/60")} />
    </div>
  );
}
